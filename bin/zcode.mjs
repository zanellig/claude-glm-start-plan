#!/usr/bin/env node
import { launchZcode } from "../src/zcode-launcher.mjs";

try {
	process.exitCode = await launchZcode(process.argv.slice(2));
} catch (error) {
	console.error(`zcode: ${error.message}`);
	process.exitCode = 1;
}
