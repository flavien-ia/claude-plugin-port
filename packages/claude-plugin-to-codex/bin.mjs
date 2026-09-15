#!/usr/bin/env node
// claude-plugin-to-codex - port a Claude Code plugin to OpenAI Codex.
// The conversion is done by the claude-plugin-port engine; this command is its
// Codex face: the host is set, the help and the README speak Codex only.
import { main } from "claude-plugin-port/cli";

process.exitCode = await main(process.argv.slice(2), { host: "codex", program: "claude-plugin-to-codex" });
