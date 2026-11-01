import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createCredentialReader } from "./credentials.mjs";
import { startProxy } from "./proxy.mjs";
import { resolveZcodeRuntime } from "./runtime.mjs";

export async function launchZcode(args) {
	const cwdFlag = args.indexOf("--cwd");
	const inlineCwd = args.find((arg) => arg.startsWith("--cwd="));
	if (cwdFlag >= 0 && !args[cwdFlag + 1])
		throw new Error("--cwd requires a path.");
	const cwd = resolve(
		cwdFlag >= 0
			? args[cwdFlag + 1]
			: inlineCwd
				? inlineCwd.slice(6)
				: process.cwd(),
	);
	const { base, node, cli, builtin } = await resolveZcodeRuntime({ cwd });
	if (
		args.length === 1 &&
		["--help", "-h", "--version", "-v", "version"].includes(args[0])
	) {
		return (
			spawnSync(node, [cli, ...args], { cwd, stdio: "inherit", timeout: 10000 })
				.status ?? 1
		);
	}
	const readAuth = createCredentialReader();
	await readAuth();
	const secret = randomBytes(32).toString("hex");
	const isGit =
		spawnSync("git", ["rev-parse", "--is-inside-work-tree"], {
			cwd,
			stdio: "ignore",
			timeout: 2000,
		}).status === 0;
	const proxy = await startProxy({ secret, readAuth, context: { cwd, isGit } });
	let directory;
	let child;
	const interrupt = () => {
		if (!process.stdin.isTTY) child?.kill("SIGINT");
	};
	const terminate = () => child?.kill("SIGTERM");
	try {
		directory = await mkdtemp(join(tmpdir(), "zcode-start-"));
		const config = {
			schemaVersion: 1,
			config: {
				providerConfigRules: {
					providerRules: [
						{
							providerId: "zcode-start",
							providerName: "ZCode Start",
							config: {
								group: "standard-personal",
								access: { type: "api-key", apiKey: secret },
								api: { type: "anthropic-messages", baseUrl: proxy.url },
								personalModelIds: ["GLM-5.3-Flash", "GLM-5.3"],
							},
						},
					],
				},
				modelConfigRules: {
					providerModelRules: [],
					manualProviderModelRules: [],
				},
				defaultModelSelection: {
					providerId: "zcode-start",
					modelId: "GLM-5.3-Flash",
				},
			},
		};
		const personal = join(directory, "provider.json");
		await writeFile(personal, JSON.stringify(config), { mode: 0o600 });
		await mkdir(base, { recursive: true, mode: 0o700 });
		const env = {
			...process.env,
			NODE_ENV: "production",
			ZCODE_DATA_BASE_DIR: base,
			ZCODE_STORAGE_DIR: join(base, ".zcode"),
			ZCODE_SESSION_DB_PATH: join(base, ".zcode/cli/db/db.sqlite"),
			ZCODE_LOG_DIR: join(base, ".zcode/cli/log"),
			ZCODE_BUILTIN_PROVIDER_CONFIG_FILE: builtin,
			ZCODE_PERSONAL_PROVIDER_CONFIG_FILE: personal,
		};
		// The CLI gets only the local session key, never the desktop JWT. Its state
		// is separate from the desktop application and cannot activate a paid plan.
		child = spawn(node, [cli, ...args], { cwd, env, stdio: "inherit" });
		process.on("SIGINT", interrupt);
		process.on("SIGTERM", terminate);
		return await new Promise((resolve, reject) => {
			child.once("error", () =>
				reject(new Error("Cannot launch the source-built ZCode CLI.")),
			);
			child.once("close", (code, signal) =>
				resolve(code ?? (signal === "SIGINT" ? 130 : 1)),
			);
		});
	} finally {
		process.off("SIGINT", interrupt);
		process.off("SIGTERM", terminate);
		await proxy.close();
		if (directory) await rm(directory, { recursive: true, force: true });
	}
}
