import { lstat, mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export async function ensureProfile({ home = homedir(), directory } = {}) {
	const profile = directory || join(home, ".config/claude-glm/claude");
	await mkdir(profile, { recursive: true, mode: 0o700 });
	const original = join(home, ".claude");
	try {
		await writeFile(
			join(profile, "settings.json"),
			await readFile(join(original, "settings.json")),
			{ mode: 0o600, flag: "wx" },
		);
	} catch (cause) {
		if (!["ENOENT", "EEXIST"].includes(cause.code)) throw cause;
	}
	// Share the user's instruction/plugin definitions, but keep preferences,
	// sessions, memories, and login state in the dedicated profile.
	for (const name of [
		"CLAUDE.md",
		"agents",
		"skills",
		"plugins",
		"hooks",
		"commands",
	]) {
		const source = join(original, name);
		try {
			await lstat(source);
			await symlink(source, join(profile, name));
		} catch (cause) {
			if (!["ENOENT", "EEXIST"].includes(cause.code)) throw cause;
		}
	}
	// Skip only the presentation onboarding, not workspace/tool authorization.
	try {
		await writeFile(
			join(profile, ".claude.json"),
			JSON.stringify({ hasCompletedOnboarding: true }),
			{ mode: 0o600, flag: "wx" },
		);
	} catch (cause) {
		if (cause.code !== "EEXIST") throw cause;
	}
	return profile;
}
