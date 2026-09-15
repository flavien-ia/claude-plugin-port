#!/usr/bin/env node
// claude-plugin-port - port a Claude Code plugin to Codex or OpenCode (--target).
// Most people want the command of their host instead: claude-plugin-to-codex
// or claude-plugin-to-opencode, which run this same engine with the host set.
import { main } from "../lib/cli.mjs";

process.exitCode = await main(process.argv.slice(2));
