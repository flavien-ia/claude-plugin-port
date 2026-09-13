#!/usr/bin/env node
// claude-plugin-to-opencode: the OpenCode preset of claude-plugin-to-codex.
// This package only exists so that `npx claude-plugin-to-opencode` resolves;
// the converter itself is the dependency. Its package.json is exported, so
// the bin is reached from there rather than through the exports map.
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const root = path.dirname(require.resolve("claude-plugin-to-codex/package.json"));
const bin = path.join(root, "bin", "claude-plugin-to-opencode.mjs");
const r = spawnSync(process.execPath, [bin, ...process.argv.slice(2)], { stdio: "inherit" });
process.exit(r.status ?? 1);
