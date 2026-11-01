import { randomUUID, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import { arch, platform, release } from "node:os";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { normalizeEvents } from "./events.mjs";
import { MODELS, transformRequest, upstreamError } from "./protocol.mjs";

const ENDPOINT = "https://zcode.z.ai/api/v1/zcode-plan/anthropic/v1/messages";
const BODY_LIMIT = 32 * 1024 * 1024;

function authorized(request, secret) {
	const candidate =
		request.headers["x-api-key"] ||
		request.headers.authorization?.replace(/^Bearer /i, "");
	return (
		typeof candidate === "string" &&
		Buffer.byteLength(candidate) === Buffer.byteLength(secret) &&
		timingSafeEqual(Buffer.from(candidate), Buffer.from(secret))
	);
}
function json(reply, status, value) {
	reply.writeHead(status, {
		"content-type": "application/json",
		"cache-control": "no-store",
	});
	reply.end(JSON.stringify(value));
}
function error(reply, status, message) {
	json(reply, status, {
		type: "error",
		error: { type: "invalid_request_error", message },
	});
}

export async function startProxy({
	secret,
	readAuth,
	context,
	fetchImpl = fetch,
}) {
	const active = new Set();
	const server = createServer(async (request, reply) => {
		const abort = new AbortController();
		active.add(abort);
		reply.once("close", () => {
			if (!reply.writableEnded) abort.abort();
		});
		try {
			if (!authorized(request, secret))
				return error(reply, 401, "Invalid local session credential.");
			const path = request.url?.split("?")[0];
			if (request.method === "GET" && path === "/v1/models") {
				return json(reply, 200, {
					data: MODELS.map(({ upstream, ...model }) => ({
						...model,
						type: "model",
					})),
					has_more: false,
				});
			}
			if (request.method !== "POST" || path !== "/v1/messages") {
				return error(reply, 404, "Endpoint unavailable.");
			}
			let size = 0;
			const chunks = [];
			for await (const chunk of request) {
				size += chunk.length;
				if (size > BODY_LIMIT)
					return error(reply, 413, "The request is too large.");
				chunks.push(chunk);
			}
			let body;
			try {
				body = transformRequest(
					JSON.parse(Buffer.concat(chunks).toString()),
					context,
				);
			} catch (cause) {
				return error(
					reply,
					400,
					cause instanceof SyntaxError
						? "Invalid JSON request."
						: cause.message,
				);
			}
			let auth;
			try {
				auth = await readAuth();
			} catch (cause) {
				return error(reply, 401, cause.message);
			}
			if (abort.signal.aborted) return;
			const upstream = await fetchImpl(ENDPOINT, {
				method: "POST",
				redirect: "error",
				signal: AbortSignal.any([
					abort.signal,
					AbortSignal.timeout(10 * 60 * 1000),
				]),
				headers: {
					authorization: `Bearer ${auth.token}`,
					"x-api-key": auth.token,
					"content-type": "application/json",
					"anthropic-version": "2023-06-01",
					"user-agent": "ZCode/3.16.3",
					"http-referer": "https://zcode.z.ai",
					"x-zcode-app-version": "3.16.3",
					"x-title": "Z Code@electron",
					"x-release-channel": "production",
					"x-client-language": "en-US",
					"x-client-timezone": Intl.DateTimeFormat().resolvedOptions().timeZone,
					"x-zcode-agent": "glm",
					"x-platform": `${platform()}-${arch()}`,
					"x-os-category":
						platform() === "darwin"
							? "macos"
							: platform() === "win32"
								? "windows"
								: "linux",
					"x-os-version": release(),
					"x-zcode-session-type": "main",
					"x-zcode-query-source": "main_turn",
					"x-session-id":
						request.headers["x-claude-code-session-id"] || randomUUID(),
					"x-request-id": randomUUID(),
					"x-query-id": randomUUID(),
					"x-zcode-trace-id": randomUUID(),
					...(auth.deviceMid ? { "x-device-mid": auth.deviceMid } : {}),
				},
				body: JSON.stringify(body),
			});
			const contentType = upstream.headers.get("content-type") || "";
			if (!upstream.ok || !contentType.includes("text/event-stream")) {
				let payload;
				try {
					payload = await upstream.json();
				} catch {
					/* Do not expose arbitrary upstream HTML. */
				}
				if (upstream.ok && payload?.type === "message")
					return json(reply, upstream.status, payload);
				const failure = upstreamError(upstream.status, payload);
				return json(reply, failure.status, failure.body);
			}
			reply.writeHead(upstream.status, {
				"content-type": "text/event-stream",
				"cache-control": "no-cache",
				"x-accel-buffering": "no",
			});
			await pipeline(
				Readable.fromWeb(upstream.body.pipeThrough(normalizeEvents())),
				reply,
				{
					signal: abort.signal,
				},
			);
		} catch {
			if (abort.signal.aborted || reply.destroyed) return;
			if (reply.headersSent) reply.destroy();
			else
				error(
					reply,
					502,
					"The Start provider is unreachable. Check your connection and retry.",
				);
		} finally {
			active.delete(abort);
		}
	});
	await new Promise((resolve, reject) => {
		server.once("error", reject);
		server.listen(0, "127.0.0.1", resolve);
	});
	return {
		url: `http://127.0.0.1:${server.address().port}`,
		async close() {
			for (const abort of active) abort.abort();
			server.closeAllConnections();
			await new Promise((resolve) => server.close(resolve));
		},
	};
}
