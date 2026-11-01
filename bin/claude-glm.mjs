#!/usr/bin/env node
import { launch } from '../src/launcher.mjs';

try {
  process.exitCode = await launch(process.argv.slice(2));
} catch (error) {
  console.error(`claude-glm: ${error.message}`);
  process.exitCode = 1;
}
