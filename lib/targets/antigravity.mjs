import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fwd, exists, walkFiles } from "../fsutil.mjs";
import { convertFiles } from "../convert.mjs";
import { antigravityExtras } from "../bundle.mjs";
import { checkAntigravityPlugin, antigravityMatcher, CLAUDE_ONLY_FILES } from "../antigravity.mjs";
import { preToolUseHooks } from "../convert.mjs";
import { portSummary } from "../ports.mjs";
import { writeFiles } from "./codex.mjs";

/**
 * Antigravity target. The plugin lands in ~/.gemini/config/plugins/<name>/,
 * where both the desktop app and the `agy` CLI discover it at startup:
 * plugin.json, the converted skills (each one also a /command), the plugin's
 * scripts and templates, mcp_config.json, and a hooks.json whose adapter runs
 * the source plugin's PreToolUse hooks. Antigravity has no variable for a
 * skill's folder; its agent runs PowerShell on Windows and a POSIX shell
 * elsewhere, so the anchors become absolute paths.
 */
export function buildAntigravity({ srcDir, files, src, fsx, opts, log, warnings, generator, port = {} }) {
  const HOME = os.homedir();
  const pluginsDir = path.resolve(opts.get("--plugins-dir", path.join(HOME, ".gemini", "config", "plugins")));
  const installDir = path.join(pluginsDir, src.name);
  const hooks = preToolUseHooks(src.hooks);
  const { matcher, unmapped } = antigravityMatcher(hooks.map((h) => h.matcher));

  log("\n== target: antigravity ==");
  log(`source:      ${srcDir}`);
  log(`plugin:      ${src.name}  (v${src.version})`);
  log(`install dir: ${installDir}`);
  log("rules file:  AGENTS.md (global ~/.gemini/AGENTS.md); Antigravity never reads CLAUDE.md");
  log(`hooks:       ${hooks.length ? `${hooks.length} PreToolUse hook(s) on ${matcher || "(none)"}` : "none"}`);
  log(`mode:        ${fsx.dry ? "DRY-RUN (no writes)" : "WRITE"}\n`);
  if (unmapped.length) warnings.push(`hooks: no Antigravity tool for ${unmapped.join(", ")}; those matchers are not ported`);

  const converted = convertFiles(files, {
    target: "antigravity", root: fwd(installDir), name: src.name, rulesMode: "agents",
    rebrand: !opts.has("--no-rebrand"), shortDescriptions: opts.has("--short-descriptions"),
    ...port,
  });
  converted.files = converted.files.filter((f) => !CLAUDE_ONLY_FILES.has(f.path));
  warnings.push(...converted.warnings);

  const extras = antigravityExtras(src, { defaultPrompt: opts.all("--default-prompt"), generator, warnings });
  // Updated in place, never removed and recreated: a running Antigravity holds
  // the plugin folder open, and Windows then refuses to delete or rename it.
  const keep = new Set([...converted.files, ...extras].map((f) => f.path));
  keep.add(".claude-plugin-to-codex.json");
  const stale = exists(installDir) ? [...walkFiles(installDir)].filter((f) => !keep.has(f.rel)) : [];
  if (!fsx.dry) {
    for (const f of stale) fs.rmSync(f.abs, { force: true });
    pruneEmptyDirs(installDir);
  }
  if (stale.length) log(`- ${stale.length} file(s) of the previous version removed`);
  fsx.mkdir(installDir);
  writeFiles(fsx, installDir, converted.files);
  writeFiles(fsx, installDir, extras);
  fsx.write(path.join(installDir, ".claude-plugin-to-codex.json"), JSON.stringify({
    generator, target: "antigravity", source: srcDir, sourceVersion: src.version, date: new Date().toISOString(),
    renamedSkills: converted.renamedSkills, excludedSkills: converted.excludedSkills,
  }, null, 2) + "\n");
  log(`- ${converted.skillCount} skills, ${converted.files.length + extras.length} files; each skill is also a /command`);
  portSummary(converted).forEach((line) => log(line));

  if (!fsx.dry && !opts.has("--no-validate")) {
    const problems = checkAntigravityPlugin(installDir);
    if (problems.length) {
      log("- check FAILED:\n" + problems.map((p) => "    " + p).join("\n"));
      warnings.push(`check failed (${problems.length} problem(s))`);
    } else log("- check: manifest, skills, hooks.json and mcp_config.json are what Antigravity reads");
  }

  log("\nNext: quit Antigravity completely and open it again: it discovers a new plugin folder only at startup.");
  log("The agy CLI reads the same folder on its next run.");
  if (exists(path.join(HOME, ".gemini", "config", "config.json"))) {
    log(`If the plugin was switched off before, turn it back on in Antigravity (Customizations, Plugins, ${src.name}).`);
  }
  return { installDir };
}

/** Removes the empty folders under `dir` (not `dir` itself). */
function pruneEmptyDirs(dir) {
  if (!exists(dir)) return;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!ent.isDirectory()) continue;
    const sub = path.join(dir, ent.name);
    pruneEmptyDirs(sub);
    try { if (fs.readdirSync(sub).length === 0) fs.rmdirSync(sub); } catch {}
  }
}
