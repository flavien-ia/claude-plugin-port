import path from "node:path";
import os from "node:os";
import { fwd, copyTree, exists, readJson } from "../fsutil.mjs";
import { TEXT_EXT, transformSkillMd, transformScript, scanResidual } from "../text.mjs";
import { preToolUseHooks } from "../source.mjs";
import { renderGuardPlugin } from "../guard.mjs";
import { mergeOpencodeConfig, mcpFromClaude } from "../opencode-config.mjs";

/**
 * What OpenCode calls things. It reads AGENTS.md natively and CLAUDE.md as a
 * fallback (project, and ~/.claude/CLAUDE.md globally), so two modes exist:
 *   agents: the port writes AGENTS.md, the native file.
 *   claude: the port keeps CLAUDE.md, so a machine that also runs Claude Code
 *           has one rules file for both tools instead of two that drift.
 */
export function opencodeHost(rulesMode) {
  return {
    hostName: "OpenCode",
    askPhrase: "the `question` tool",
    rules: rulesMode === "claude"
      ? { mode: "claude", projectFile: "CLAUDE.md" }
      : { mode: "agents", projectFile: "AGENTS.md", globalSegments: [".config", "opencode", "AGENTS.md"], globalTail: ".config/opencode/AGENTS.md" },
  };
}

export function buildOpencode({ src, fsx, opts, log, warnings, generator }) {
  const HOME = os.homedir();
  const configDir = path.resolve(opts.get("--opencode-dir", path.join(HOME, ".config", "opencode")));
  const root = path.resolve(opts.get("--out", path.join(configDir, "skills", src.name)));
  const rootFwd = fwd(root);
  if (root === configDir || configDir.startsWith(root + path.sep)) throw new Error("--out must be a folder of its own, not the OpenCode config dir.");

  const rulesArg = opts.get("--rules-file", "auto");
  if (!["auto", "agents", "claude"].includes(rulesArg)) throw new Error("--rules-file must be auto, agents or claude.");
  const rulesMode = rulesArg === "auto" ? (exists(path.join(HOME, ".claude", "CLAUDE.md")) ? "claude" : "agents") : rulesArg;
  const host = opencodeHost(rulesMode);
  const shortDescriptions = opts.has("--short-descriptions");
  const doRebrand = !opts.has("--no-rebrand");

  const guardHooks = preToolUseHooks(src.hooks);
  const wantGuard = guardHooks.length > 0 && !opts.has("--no-guard");
  const permissionPath = opts.get("--permissions", src.permissionFile);
  let permission = null;
  if (permissionPath) {
    const raw = readJson(permissionPath);
    permission = raw.permission && typeof raw.permission === "object" ? raw.permission : raw;
    delete permission.$comment;
  }
  const askMode = opts.get("--ask-mode", permission ? "pass" : "soft");
  if (!["soft", "pass"].includes(askMode)) throw new Error("--ask-mode must be soft or pass.");
  const guardFile = path.join(configDir, "plugins", `${src.name}-guard.js`);

  log("\n== target: opencode ==");
  log(`source:      ${src.dir}`);
  log(`plugin:      ${src.name}  (v${src.version})`);
  log(`install dir: ${root}`);
  log(`config dir:  ${configDir}`);
  log(`rules file:  ${rulesMode === "claude" ? "CLAUDE.md kept (shared with Claude Code; OpenCode reads it as a fallback)" : "AGENTS.md (global ~/.config/opencode/AGENTS.md)"}`);
  log(`guard:       ${wantGuard ? `${guardHooks.length} PreToolUse hook(s) -> ${guardFile} (ask: ${askMode})` : "none"}`);
  log(`mode:        ${fsx.dry ? "DRY-RUN (no writes)" : "WRITE"}\n`);

  fsx.rm(root);
  fsx.mkdir(root);

  const ctxFor = (rel, skillDir) => ({
    root: rootFwd, skillDir, name: src.name, rel, warnings, rules: host.rules,
    hostName: host.hostName, askPhrase: host.askPhrase, rebrand: doRebrand, shortDescriptions,
  });
  const withScan = (rel, fn) => (text) => { const out = fn(text); scanResidual(rel, out, warnings, host.rules); return out; };

  if (src.has.skills) {
    const n = copyTree(fsx, path.join(src.dir, "skills"), path.join(root, "skills"), (rel, ext) => {
      const skillDir = `${rootFwd}/skills/${rel.split("/")[0]}`;
      const ctx = ctxFor(`skills/${rel}`, skillDir);
      if (ext === ".md") return withScan(ctx.rel, (t) => transformSkillMd(t, ctx));
      if (TEXT_EXT.has(ext)) return withScan(ctx.rel, (t) => transformScript(t, ctx));
      return null;
    });
    log(`- skills/ (${src.skillDirs.length} skills: transformed ${n.transformed} files, copied ${n.copied}; each one is also a /command)`);
  }
  for (const dir of ["scripts", "templates"]) {
    if (!src.has[dir]) continue;
    const n = copyTree(fsx, path.join(src.dir, dir), path.join(root, dir), (rel, ext) => {
      if (dir === "templates" || !TEXT_EXT.has(ext)) return null;
      const ctx = ctxFor(`${dir}/${rel}`, null);
      return withScan(ctx.rel, (t) => transformScript(t, ctx));
    });
    log(`- ${dir}/ (${dir === "scripts" ? `transformed ${n.transformed} files, ` : ""}copied ${n.copied} verbatim)`);
  }
  if (src.has.hooks) {
    const n = copyTree(fsx, path.join(src.dir, "hooks"), path.join(root, "hooks"), () => null);
    log(`- hooks/ (${n.copied} files verbatim: the guard plugin runs them)`);
  }
  if (src.has.mcp) fsx.copy(path.join(src.dir, ".mcp.json"), path.join(root, ".mcp.json"));

  if (wantGuard) {
    fsx.write(guardFile, renderGuardPlugin({ name: src.name, root: rootFwd, hooks: guardHooks, askMode, generator }));
    log(`- plugin ${path.relative(configDir, guardFile)} (tool.execute.before: deny blocks the call${askMode === "soft" ? ", ask blocks once and requests the user's agreement" : ", ask is left to the permission rules"})`);
  }

  let config = { file: null, changed: false };
  if (!opts.has("--no-config")) {
    config = mergeOpencodeConfig({ fsx, configDir, mcp: mcpFromClaude(src.mcp), permission, log, warnings });
  } else log("- config: skipped (--no-config)");

  fsx.write(path.join(root, ".claude-plugin-to-codex.json"), JSON.stringify({
    generator, target: "opencode", source: src.dir, sourceVersion: src.version, date: new Date().toISOString(),
    rulesMode, guardFile: wantGuard ? guardFile : null, configFile: config.file, permissionFile: permissionPath || null,
  }, null, 2) + "\n");

  log(`\nNext: start a NEW OpenCode session. Skills load from ${fwd(path.relative(HOME, root)) || root} and each one answers to /<skill-name>.`);
  if (rulesMode === "claude") log("Rules: CLAUDE.md is kept because this machine has ~/.claude/CLAUDE.md. OpenCode reads it as long as no AGENTS.md sits next to it (--rules-file agents to change).");
  if (wantGuard) log("Uninstall: delete the install dir, the guard plugin file, and the mcp/permission entries the converter added to the config (listed above).");
  return { root, guardFile: wantGuard ? guardFile : null, configFile: config.file, rulesMode, askMode };
}
