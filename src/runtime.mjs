import { spawnSync } from "node:child_process";
import { constants } from "node:fs";
import { access, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { delimiter, isAbsolute, join, resolve } from "node:path";

// modelPicker is a required client feature, documented since 2.1.242.
const MINIMUM_CLAUDE_VERSION = [2, 1, 242];
const ZCODE_NODE_MAJOR = 24;

function options(input) {
	return {
		env: process.env,
		home: homedir(),
		cwd: process.cwd(),
		execPath: process.execPath,
		...input,
	};
}

function directory(value, context) {
	if (value === "~") return context.home;
	if (value.startsWith("~/") || value.startsWith("~\\"))
		return resolve(context.home, value.slice(2));
	return resolve(context.cwd, value);
}

function localDirectories(context) {
	const { env, home } = context;
	return {
		config: directory(env.XDG_CONFIG_HOME || join(home, ".config"), context),
		data: directory(
			env.XDG_DATA_HOME || join(home, ".local", "share"),
			context,
		),
	};
}

async function executable(path) {
	try {
		await access(
			path,
			process.platform === "win32" ? constants.F_OK : constants.X_OK,
		);
		return (await stat(path)).isFile();
	} catch {
		return false;
	}
}

async function candidates(names, context) {
	const paths = [];
	for (const name of names) {
		const extensions =
			process.platform === "win32" && !name.endsWith(".exe")
				? [".exe", ""]
				: [""];
		for (const folder of (context.env.PATH || "")
			.split(delimiter)
			.filter(Boolean)) {
			for (const extension of extensions) {
				const path = resolve(context.cwd, folder, name + extension);
				if (!paths.includes(path) && (await executable(path))) paths.push(path);
			}
		}
	}
	return paths;
}

async function override(value, key, context) {
	if (
		isAbsolute(value) ||
		value.includes("/") ||
		value.includes("\\") ||
		value.startsWith("~")
	) {
		const path = directory(value, context);
		if (await executable(path)) return path;
	} else {
		const found = await candidates([value], context);
		if (found.length) return found[0];
	}
	throw new Error(
		`${key} does not identify an executable. Set it to a command on PATH or an executable path.`,
	);
}

function version(command, context) {
	const result = spawnSync(command, ["--version"], {
		cwd: context.cwd,
		env: context.env,
		encoding: "utf8",
		timeout: 2000,
		maxBuffer: 65536,
		windowsHide: true,
	});
	const match =
		result.status === 0 &&
		result.stdout?.match(/(?:^|\s)v?(\d+)\.(\d+)\.(\d+)/);
	return match ? match.slice(1).map(Number) : undefined;
}

function atLeast(actual, minimum) {
	for (let index = 0; index < minimum.length; index++) {
		if (actual[index] !== minimum[index]) return actual[index] > minimum[index];
	}
	return true;
}

export async function resolveClaudeRuntime(input = {}) {
	const context = options(input);
	const { env } = context;
	const command = env.CLAUDE_GLM_CLAUDE
		? await override(env.CLAUDE_GLM_CLAUDE, "CLAUDE_GLM_CLAUDE", context)
		: (await candidates(["claude"], context))[0];
	if (!command)
		throw new Error(
			"Claude Code was not found on PATH. Install it or set CLAUDE_GLM_CLAUDE.",
		);
	const found = version(command, context);
	if (!found || !atLeast(found, MINIMUM_CLAUDE_VERSION)) {
		throw new Error(
			`Claude Code ${MINIMUM_CLAUDE_VERSION.join(".")} or newer is required. Check CLAUDE_GLM_CLAUDE or PATH.`,
		);
	}
	const paths = localDirectories(context);
	return {
		command,
		profile: directory(
			env.CLAUDE_GLM_PROFILE || join(paths.config, "claude-glm", "claude"),
			context,
		),
		sourceProfile: directory(
			env.CLAUDE_CONFIG_DIR || join(context.home, ".claude"),
			context,
		),
	};
}

export async function resolveZcodeRuntime(input = {}) {
	const context = options(input);
	const { env } = context;
	let node;
	if (env.ZCODE_START_NODE) {
		node = await override(env.ZCODE_START_NODE, "ZCODE_START_NODE", context);
		if (version(node, context)?.[0] !== ZCODE_NODE_MAJOR) {
			throw new Error(
				"ZCODE_START_NODE must select a Node 24 executable compatible with the ZCode TUI.",
			);
		}
	} else {
		const found = [
			context.execPath,
			...(await candidates(["node24", "node-24", "node"], context)),
		];
		for (const candidate of new Set(found)) {
			if (version(candidate, context)?.[0] === ZCODE_NODE_MAJOR) {
				node = candidate;
				break;
			}
		}
		if (!node)
			throw new Error(
				"Node 24 was not found. Put node24, node-24, or a Node 24 node on PATH, or set ZCODE_START_NODE.",
			);
	}
	const paths = localDirectories(context);
	const base = directory(
		env.ZCODE_START_DATA_DIR || join(paths.data, "zcode-start"),
		context,
	);
	const runtime = directory(
		env.ZCODE_START_RUNTIME || join(paths.data, "zcode-start", "runtime"),
		context,
	);
	const cli = join(
		runtime,
		"apps",
		"zcode-cli",
		"packages",
		"cli",
		"dist",
		"zcode.cjs",
	);
	const builtin = join(
		runtime,
		"apps",
		"zcode-cli",
		"packages",
		"cli",
		"dist",
		"provider",
		"zcode-builtin.json",
	);
	try {
		await access(cli);
		await access(builtin);
	} catch {
		throw new Error(
			"A built ZCode runtime was not found. Build and stage it as described in docs/zcode-cli.md, or set ZCODE_START_RUNTIME.",
		);
	}
	return { node, cli, builtin, base };
}
