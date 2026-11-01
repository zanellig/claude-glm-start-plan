import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCredentialReader } from "./credentials.mjs";
import { ensureProfile } from "./profile.mjs";
import { MODELS } from "./protocol.mjs";
import { startProxy } from "./proxy.mjs";
import { resolveClaudeRuntime } from "./runtime.mjs";

export function sessionSettings() {
	return {
		availableModels: MODELS.map((model) => model.id),
		enforceAvailableModels: true,
		modelPicker: {
			replaceBuiltInOptions: true,
			options: MODELS.map((model) => ({
				model: model.id,
				label: model.display_name,
				description: model.description,
			})),
		},
		effortLevel: "high",
	};
}

export async function extractSettings(args) {
	const remaining = [];
	let settings = {};
	for (let index = 0; index < args.length; index++) {
		const arg = args[index];
		if (arg !== "--settings" && !arg.startsWith("--settings=")) {
			remaining.push(arg);
			continue;
		}
		const value =
			arg === "--settings" ? args[++index] : arg.slice("--settings=".length);
		if (!value) throw new Error("--settings requires JSON or a settings file.");
		let extra;
		try {
			extra = JSON.parse(
				value.trim().startsWith("{") ? value : await readFile(value, "utf8"),
			);
		} catch {
			throw new Error("Cannot read the supplied --settings JSON or file.");
		}
		if (!extra || Array.isArray(extra) || typeof extra !== "object") {
			throw new Error("--settings must contain a JSON object.");
		}
		settings = {
			...settings,
			...extra,
			env: { ...settings.env, ...extra.env },
		};
	}
	return { args: remaining, settings };
}

export async function launch(args) {
	const options = await extractSettings(args);
	args = options.args;
	const runtime = await resolveClaudeRuntime();
	if (args.length === 1 && ["--help", "-h", "--version"].includes(args[0])) {
		return (
			spawnSync(runtime.command, args, { stdio: "inherit", timeout: 10000 })
				.status ?? 1
		);
	}
	const readAuth = createCredentialReader();
	await readAuth();
	const secret = randomBytes(32).toString("hex");
	const cwd = process.cwd();
	const isGit =
		spawnSync("git", ["rev-parse", "--is-inside-work-tree"], {
			cwd,
			stdio: "ignore",
			timeout: 2000,
		}).status === 0;
	const proxy = await startProxy({ secret, readAuth, context: { cwd, isGit } });
	let child;
	let sessionDirectory;
	const onSignal = (signal) => child?.kill(signal);
	// The terminal already sends SIGINT to the entire foreground process group.
	const onInterrupt = () => {
		if (!process.stdin.isTTY) onSignal("SIGINT");
	};
	const onTerminate = () => onSignal("SIGTERM");
	try {
		const profile = await ensureProfile({
			directory: runtime.profile,
			sourceDirectory: runtime.sourceProfile,
		});
		const env = {
			...process.env,
			CLAUDE_CONFIG_DIR: profile,
			ANTHROPIC_BASE_URL: proxy.url,
			ANTHROPIC_AUTH_TOKEN: secret,
			ANTHROPIC_DEFAULT_OPUS_MODEL: MODELS[1].id,
			ANTHROPIC_DEFAULT_OPUS_MODEL_NAME: MODELS[1].display_name,
			ANTHROPIC_DEFAULT_OPUS_MODEL_DESCRIPTION: MODELS[1].description,
			ANTHROPIC_DEFAULT_SONNET_MODEL: MODELS[0].id,
			ANTHROPIC_DEFAULT_SONNET_MODEL_NAME: MODELS[0].display_name,
			ANTHROPIC_DEFAULT_SONNET_MODEL_DESCRIPTION: MODELS[0].description,
			ANTHROPIC_DEFAULT_HAIKU_MODEL: MODELS[0].upstream,
			ANTHROPIC_DEFAULT_HAIKU_MODEL_NAME: MODELS[0].display_name,
			ANTHROPIC_DEFAULT_FABLE_MODEL: MODELS[1].upstream,
			ANTHROPIC_DEFAULT_FABLE_MODEL_NAME: MODELS[1].display_name,
			CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY: "0",
			CLAUDE_CODE_MAX_CONTEXT_TOKENS: "1000000",
			CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS: "1",
			CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
			ENABLE_TOOL_SEARCH: "false",
		};
		// Never send an inherited provider credential to the local adapter, or let
		// a different provider mode take precedence over this Start-only session.
		for (const name of [
			"ANTHROPIC_API_KEY",
			"ANTHROPIC_MODEL",
			"ANTHROPIC_SMALL_FAST_MODEL",
			"ANTHROPIC_CUSTOM_HEADERS",
			"CLAUDE_CODE_USE_BEDROCK",
			"CLAUDE_CODE_USE_VERTEX",
			"CLAUDE_CODE_USE_FOUNDRY",
			"CLAUDE_CODE_USE_MANTLE",
		])
			delete env[name];
		const settings = {
			...options.settings,
			...sessionSettings(),
			env: {
				...options.settings.env,
				ANTHROPIC_BASE_URL: proxy.url,
				ANTHROPIC_AUTH_TOKEN: secret,
				ANTHROPIC_API_KEY: "",
				ANTHROPIC_CUSTOM_HEADERS: "",
				CLAUDE_CODE_USE_BEDROCK: "0",
				CLAUDE_CODE_USE_VERTEX: "0",
				CLAUDE_CODE_USE_FOUNDRY: "0",
				CLAUDE_CODE_USE_MANTLE: "0",
			},
		};
		sessionDirectory = await mkdtemp(join(tmpdir(), "claude-glm-"));
		const settingsFile = join(sessionDirectory, "settings.json");
		await writeFile(settingsFile, JSON.stringify(settings), { mode: 0o600 });
		child = spawn(
			runtime.command,
			["--settings", settingsFile, "--model", MODELS[0].id, ...args],
			{ cwd, env, stdio: "inherit" },
		);
		process.on("SIGINT", onInterrupt);
		process.on("SIGTERM", onTerminate);
		return await new Promise((resolve, reject) => {
			child.once("error", () =>
				reject(
					new Error("Cannot launch Claude Code. Check CLAUDE_GLM_CLAUDE."),
				),
			);
			child.once("close", (code, signal) =>
				resolve(code ?? (signal === "SIGINT" ? 130 : 1)),
			);
		});
	} finally {
		process.off("SIGINT", onInterrupt);
		process.off("SIGTERM", onTerminate);
		await proxy.close();
		if (sessionDirectory)
			await rm(sessionDirectory, { recursive: true, force: true });
	}
}
