import { zcodeSystem } from "./zcode-prompt.mjs";

export const MODELS = Object.freeze([
	{
		id: "GLM-5.3-Flash",
		upstream: "GLM-5.3-Flash",
		display_name: "GLM-5.3-Flash (Start)",
		description: "Start allowance | low / high / max reasoning",
	},
	{
		id: "GLM-5.3",
		upstream: "GLM-5.3",
		display_name: "GLM-5.3 (Start)",
		description: "Start allowance | low / high / max reasoning",
	},
]);

export function resolveModel(id) {
	const name = String(id)
		.toLowerCase()
		.replace(/\[1m\]$/, "");
	const model = MODELS.find((model) =>
		[model.id.toLowerCase(), model.upstream.toLowerCase()].includes(name),
	);
	if (!model) throw new Error("Select GLM-5.3-Flash or GLM-5.3 from /model.");
	return model;
}

export function resolveEffort(effort, thinking) {
	if (thinking?.type === "disabled") return "low";
	if (effort === undefined) return "high";
	const mapped = {
		low: "low",
		medium: "high",
		high: "high",
		xhigh: "max",
		max: "max",
	}[effort];
	if (!mapped)
		throw new Error(
			"Supported effort values are low, medium, high, xhigh, and max.",
		);
	return mapped;
}

export function transformRequest(input, context) {
	if (!input || typeof input !== "object" || !Array.isArray(input.messages)) {
		throw new Error("Expected an Anthropic Messages request.");
	}
	const model = resolveModel(input.model);
	const body = structuredClone(input);
	// Preserve Claude Code's instructions as a system message. The Start gateway
	// requires its own top-level system blocks and rejects appended Claude blocks.
	const original =
		typeof body.system === "string"
			? body.system
			: (body.system || [])
					.map((block) => {
						if (block.type !== "text" || typeof block.text !== "string") {
							throw new Error("Unsupported system instruction block.");
						}
						return block.text;
					})
					.join("\n\n");
	if (original) body.messages.unshift({ role: "system", content: original });
	// Claude 5.x may attach effort updates to system messages. Transfer the latest
	// update to the GLM request instead of forwarding unsupported per-message fields.
	let effort = body.output_config?.effort;
	body.messages = body.messages.flatMap((message) => {
		if (message.role !== "system") return [message];
		if (message.output_config?.effort !== undefined)
			effort = message.output_config.effort;
		const copy = { ...message };
		delete copy.output_config;
		if (typeof copy.content === "string") return copy.content ? [copy] : [];
		if (Array.isArray(copy.content)) {
			// Match the official Anthropic compatibility adapter for plain reminders.
			if (copy.content.length === 1 && copy.content[0].type === "text") {
				copy.content = copy.content[0].text;
			}
			return copy.content.length ? [copy] : [];
		}
		return [copy];
	});
	body.model = model.upstream;
	body.system = zcodeSystem({ ...context, model: model.upstream });
	body.output_config = {
		...body.output_config,
		effort: resolveEffort(effort, body.thinking),
	};
	body.thinking = { type: "enabled" };
	delete body.context_management;
	if (!Number.isInteger(body.max_tokens) || body.max_tokens < 1)
		body.max_tokens = 16384;
	body.max_tokens = Math.min(body.max_tokens, 128000);
	return body;
}

export function upstreamError(status, payload) {
	if (payload?.error?.type && payload.error.message)
		return { status, body: payload };
	const code = payload?.code;
	const messages = {
		1005: "Your Start allowance is unavailable or has expired. Check the plan in ZCode.",
		3007: "The Start provider requires verification. Open ZCode and verify your account.",
		3009: "The model concurrency limit was reached. Retry after the current request finishes.",
		3012: "The Start provider rejected the request. Check your account in ZCode.",
	};
	return {
		status: status >= 400 ? status : 502,
		body: {
			type: "error",
			error: {
				type:
					status === 401
						? "authentication_error"
						: status === 429
							? "rate_limit_error"
							: "api_error",
				message:
					messages[code] ||
					(status === 401
						? "Your ZCode login expired. Sign in again in the desktop application."
						: `The Start provider could not complete this request${code ? ` (code ${code})` : ""}.`),
			},
		},
	};
}
