import { createDecipheriv, createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { homedir, platform, userInfo } from "node:os";
import { join, resolve } from "node:path";

// Matches the existing local credential store. It never writes to that store.
export function decryptCredential(value, secret) {
	if (typeof value !== "string" || !value.trim())
		throw new Error("Missing account credential.");
	if (!value.startsWith("enc:v1:")) return value;
	const parts = value
		.slice(7)
		.split(".")
		.map((part) => Buffer.from(part, "base64url"));
	if (parts.length !== 3 || parts[0].length !== 12 || parts[1].length !== 16) {
		throw new Error("Unsupported account credential format.");
	}
	try {
		const key = createHash("sha256").update(secret).digest();
		const decipher = createDecipheriv("aes-256-gcm", key, parts[0]);
		decipher.setAuthTag(parts[1]);
		return Buffer.concat([
			decipher.update(parts[2]),
			decipher.final(),
		]).toString();
	} catch {
		throw new Error(
			"Cannot read the account credential. Check ZCODE_CREDENTIAL_SECRET.",
		);
	}
}

export function createCredentialReader({
	env = process.env,
	home = homedir(),
} = {}) {
	const configured = env.ZCODE_DATA_BASE_DIR || home;
	const base =
		configured === "~"
			? home
			: configured.startsWith("~/") || configured.startsWith("~\\")
				? join(home, configured.slice(2))
				: resolve(configured);
	const root = join(base, ".zcode", "v2");
	const secret =
		env.ZCODE_CREDENTIAL_SECRET?.trim() ||
		`zcode-credential-fallback:${platform()}:${homedir()}:${userInfo().username}`;
	return async () => {
		let record;
		try {
			record = JSON.parse(
				await readFile(join(root, "credentials.json"), "utf8"),
			);
		} catch {
			throw new Error(
				"Sign in to ZCode with your Z.ai account to use its Start allowance.",
			);
		}
		if (
			record["oauth:active_provider"] &&
			decryptCredential(record["oauth:active_provider"], secret) !== "zai"
		) {
			throw new Error(
				"Select your Z.ai account in ZCode before using this launcher.",
			);
		}
		const token = decryptCredential(record.zcodejwttoken, secret).trim();
		let deviceMid;
		try {
			const state = JSON.parse(
				await readFile(join(root, "telemetry-state.json"), "utf8"),
			);
			if (
				typeof state.deviceMid === "string" &&
				/^[\x20-\x7e]+$/.test(state.deviceMid)
			) {
				deviceMid = state.deviceMid;
			}
		} catch {
			/* Inference can work without device identity; balance queries cannot. */
		}
		return { token, deviceMid };
	};
}
