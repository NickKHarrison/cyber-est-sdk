#!/usr/bin/env node
// `est dev` on its own, until 4-A's `est` command registers it (sdk/devhost/cli/dev.mjs).
import { run } from '../cli/dev.mjs';

process.exitCode = await run(process.argv.slice(2));
process.exit();
