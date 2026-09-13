#!/usr/bin/env node
// claude-plugin-to-opencode - the same converter with --target opencode preset.
import { main } from "../lib/cli.mjs";

process.exitCode = await main(process.argv.slice(2), { defaultTarget: "opencode" });
