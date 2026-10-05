#!/usr/bin/env node
// claude-plugin-to-antigravity - port a Claude Code plugin to Google Antigravity.
// The conversion is done by the claude-plugin-port engine; this command is its
// Antigravity face: the host is set, the help and the README speak Antigravity only.
import { main } from "claude-plugin-port/cli";

process.exitCode = await main(process.argv.slice(2), { host: "antigravity", program: "claude-plugin-to-antigravity" });
