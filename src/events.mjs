import { upstreamError } from "./protocol.mjs";

// Keep SSE framing/UTF-8 intact, but turn a provider business-code frame into
// an Anthropic error event. Otherwise a HTTP-200 failure can look like silence.
export function normalizeEvents() {
	const decoder = new TextDecoder();
	const encoder = new TextEncoder();
	let pending = "";
	let failed = false;
	function emit(frame, controller) {
		if (failed) return;
		const data = frame
			.split(/\r\n|\r|\n/)
			.filter((line) => line.startsWith("data:"))
			.map((line) => line.slice(5).trimStart())
			.join("\n");
		let payload;
		try {
			payload = JSON.parse(data);
		} catch {
			/* Comments/pings can have no JSON data. */
		}
		const code = payload?.code ?? payload?.error?.code;
		if (code !== undefined && code !== 0 && code !== "0") {
			const error = upstreamError(200, { ...payload, code });
			controller.enqueue(
				encoder.encode(`event: error\ndata: ${JSON.stringify(error.body)}\n\n`),
			);
			failed = true;
		} else controller.enqueue(encoder.encode(frame));
	}
	return new TransformStream({
		transform(chunk, controller) {
			pending += decoder.decode(chunk, { stream: true });
			while (true) {
				const delimiter = /\r\n\r\n|\n\n|\r\r/.exec(pending);
				if (!delimiter) break;
				const end = delimiter.index + delimiter[0].length;
				emit(pending.slice(0, end), controller);
				pending = pending.slice(end);
			}
		},
		flush(controller) {
			pending += decoder.decode();
			if (pending) emit(pending, controller);
		},
	});
}
