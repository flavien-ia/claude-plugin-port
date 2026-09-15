import path from "node:path";
import os from "node:os";
import { fwd, exists, readJson } from "../fsutil.mjs";
import { convertFiles, preToolUseHooks, mcpFromClaude } from "../convert.mjs";
import { renderGuardPlugin } from "../guard.mjs";
import { mergeOpencodeConfig } from "../opencode-config.mjs";
import { portSummary } from "../ports.mjs";
import { writeFiles } from "./codex.mjs";

/**
 * OpenCode target. The skills go under the config dir (OpenCode discovers
 * skills/** there), and ONE generated plugin does the rest when OpenCode
 * starts: it runs the Claude Code PreToolUse hooks before every shell
 * command, and carries the MCP servers and permission rules into the live
 * configuration. opencode.json is left alone unless --write-config asks for
 * the rules to be written there as well.
 */
export function buildOpencode({ srcDir, files, src, fsx, opts, log, warnings, generator, port = {} }) {
  const HOME = os.homedir();
  const configDir = path.resolve(opts.get("--opencode-dir", path.join(HOME, ".config", "opencode")));
  const root = path.resolve(opts.get("--out", path.join(configDir, "skills", src.name)));
  if (root === configDir || configDir.startsWith(root + path.sep)) throw new Error("--out must be a folder of its own, not the OpenCode config dir.");

  const rulesArg = opts.get("--rules-file", "auto");
  if (!["auto", "agents", "claude"].includes(rulesArg)) throw new Error("--rules-file must be auto, agents or claude.");
  const rulesMode = rulesArg === "auto" ? (exists(path.join(HOME, ".claude", "CLAUDE.md")) ? "claude" : "agents") : rulesArg;

  const hooks = preToolUseHooks(src.hooks);
  const mcp = mcpFromClaude(src.mcp);
  const permissionPath = opts.get("--permissions", null);
  let permission = src.permission;
  if (permissionPath) {
    const raw = readJson(permissionPath);
    permission = raw.permission && typeof raw.permission === "object" ? raw.permission : raw;
    delete permission.$comment;
  }
  const askMode = opts.get("--ask-mode", permission ? "pass" : "soft");
  if (!["soft", "pass"].includes(askMode)) throw new Error("--ask-mode must be soft or pass.");
  const wantPlugin = !opts.has("--no-guard") && (hooks.length > 0 || Object.keys(mcp).length > 0 || !!permission);
  const guardFile = path.join(configDir, "plugins", `${src.name}-guard.js`);

  log("\n== target: opencode ==");
  log(`source:      ${srcDir}`);
  log(`plugin:      ${src.name}  (v${src.version})`);
  log(`install dir: ${root}`);
  log(`config dir:  ${configDir}`);
  log(`rules file:  ${rulesMode === "claude" ? "CLAUDE.md kept (shared with Claude Code; OpenCode reads it as a fallback)" : "AGENTS.md (global ~/.config/opencode/AGENTS.md)"}`);
  log(`plugin:      ${wantPlugin ? `${path.relative(configDir, guardFile)} (${hooks.length} PreToolUse hook(s), ask: ${askMode}, ${Object.keys(mcp).length} mcp, ${permission ? Object.values(permission).reduce((n, r) => n + (typeof r === "object" ? Object.keys(r).length : 1), 0) : 0} permission rules)` : "none"}`);
  log(`mode:        ${fsx.dry ? "DRY-RUN (no writes)" : "WRITE"}\n`);

  const converted = convertFiles(files, {
    target: "opencode", root: fwd(root), name: src.name, rulesMode,
    rebrand: !opts.has("--no-rebrand"), shortDescriptions: opts.has("--short-descriptions"),
    ...port,
  });
  warnings.push(...converted.warnings);

  fsx.rm(root);
  fsx.mkdir(root);
  writeFiles(fsx, root, converted.files);
  log(`- ${converted.skillCount} skills, ${converted.files.length} files; each skill is also a /command`);
  portSummary(converted).forEach((line) => log(line));

  if (wantPlugin) {
    fsx.write(guardFile, renderGuardPlugin({ name: src.name, root: { kind: "absolute", path: fwd(root) }, hooks, askMode, mcp, permission, generator }));
    log(`- plugin ${path.relative(configDir, guardFile)}: runs the hooks before each shell command (deny blocks${askMode === "soft" ? ", ask blocks once and requests the user's agreement" : ", ask is left to the permission rules"}), injects mcp + permission rules at startup`);
  }

  let config = { file: null, changed: false };
  if (opts.has("--write-config")) {
    config = mergeOpencodeConfig({ fsx, configDir, mcp, permission, log, warnings });
  }

  fsx.write(path.join(root, ".claude-plugin-to-codex.json"), JSON.stringify({
    generator, target: "opencode", source: srcDir, sourceVersion: src.version, date: new Date().toISOString(),
    rulesMode, guardFile: wantPlugin ? guardFile : null, configFile: config.file, permissionFile: permissionPath || null,
    renamedSkills: converted.renamedSkills, excludedSkills: converted.excludedSkills,
  }, null, 2) + "\n");

  log(`\nNext: start a NEW OpenCode session. Skills load from ${fwd(path.relative(HOME, root)) || root} and each one answers to /<skill-name>.`);
  if (rulesMode === "claude") log("Rules: CLAUDE.md is kept because this machine has ~/.claude/CLAUDE.md. OpenCode reads it as long as no AGENTS.md sits next to it (--rules-file agents to change).");
  if (wantPlugin) log("Uninstall: delete the install dir and the plugin file; nothing else was written.");
  return { root, guardFile: wantPlugin ? guardFile : null, configFile: config.file, rulesMode, askMode };
}
