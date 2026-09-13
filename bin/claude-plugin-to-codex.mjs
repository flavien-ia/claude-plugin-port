#!/usr/bin/env node
// claude-plugin-to-codex - port a Claude Code plugin to Codex (default) or OpenCode.
// See --help, or lib/cli.mjs for the full flag list.
import { main } from "../lib/cli.mjs";

process.exitCode = await main(process.argv.slice(2), { defaultTarget: "codex" });
