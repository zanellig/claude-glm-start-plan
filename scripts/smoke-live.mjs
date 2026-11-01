// Explicit live check: uses the signed-in account's Start allowance.
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

if (!process.argv.includes("--live")) {
	console.error(
		"Add --live to make real model calls using your Start allowance.",
	);
	process.exit(2);
}
const launcher = fileURLToPath(
	new URL("../bin/claude-glm.mjs", import.meta.url),
);
const models = ["GLM-5.3-Flash", "GLM-5.3"];
const cases = models.flatMap((model) =>
	["low", "high", "max"].map((effort) => ({ model, effort })),
);
cases.push(
	...["medium", "xhigh"].map((effort) => ({ model: models[0], effort })),
);
if (process.argv.includes("--tools"))
	cases.push({ model: models[0], effort: "high", tool: true });
let failures = 0;
for (const item of cases) {
	const marker = item.tool ? "GLM_TOOL_OK" : "GLM_SMOKE_OK";
	const prompt = item.tool
		? `Use Bash to run printf '%s\\n' ${marker}. Then reply exactly ${marker}.`
		: `Reply exactly ${marker}.`;
	const started = Date.now();
	const args = [
		launcher,
		"--setting-sources",
		"",
		"--settings",
		'{"disableAllHooks":true,"permissions":{"defaultMode":"default"}}',
		"--strict-mcp-config",
		"--mcp-config",
		'{"mcpServers":{}}',
		"--model",
		item.model,
		"--effort",
		item.effort,
		"--no-session-persistence",
		"--max-turns",
		item.tool ? "3" : "1",
		"--output-format",
		"json",
	];
	if (item.tool) args.push("--allowedTools", "Bash");
	args.push("-p", prompt);
	const child = spawn(process.execPath, args, {
		cwd: "/tmp",
		stdio: ["ignore", "pipe", "pipe"],
	});
	let stdout = "";
	let stderr = "";
	child.stdout.on("data", (chunk) => {
		stdout += chunk;
	});
	child.stderr.on("data", (chunk) => {
		stderr += chunk;
	});
	const timer = setTimeout(() => child.kill("SIGTERM"), 60000);
	const code = await new Promise((resolve, reject) => {
		child.once("error", reject);
		child.once("close", resolve);
	});
	clearTimeout(timer);
	let result;
	try {
		result = JSON.parse(stdout);
	} catch {
		/* A non-JSON CLI failure is a failed check. */
	}
	const pass =
		code === 0 &&
		!result?.is_error &&
		result?.result?.trim() === marker &&
		(!item.tool || result.num_turns >= 2);
	if (!pass) failures++;
	console.log(
		JSON.stringify({
			...item,
			pass,
			code,
			durationMs: Date.now() - started,
			turns: result?.num_turns,
			...(pass
				? {}
				: {
						error: result?.result || stderr.slice(-1000) || stdout.slice(-1000),
					}),
		}),
	);
}
process.exitCode = failures ? 1 : 0;
