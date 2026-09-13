import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { fwd, copyTree, exists } from "../fsutil.mjs";
import { TEXT_EXT, transformSkillMd, transformScript, scanResidual } from "../text.mjs";

/** What Codex calls things. AGENTS.md is the only rules file it reads. */
export const CODEX_HOST = {
  hostName: "Codex",
  askPhrase: "a direct question to the user",
  rules: { mode: "agents", projectFile: "AGENTS.md", globalSegments: [".codex", "AGENTS.md"], globalTail: ".codex/AGENTS.md" },
};

function cachebust(v) {
  const base = String(v || "0.0.0").split("+")[0];
  const ts = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
  return `${base}+codex.local-${ts}`;
}

function findCodex(HOME) {
  try {
    const cfg = fs.readFileSync(path.join(HOME, ".codex", "config.toml"), "utf8");
    const m = cfg.match(/CODEX_CLI_PATH\s*=\s*'([^']+)'/) || cfg.match(/CODEX_CLI_PATH\s*=\s*"([^"]+)"/);
    if (m && exists(m[1])) return m[1];
  } catch {}
  try { execFileSync("codex", ["--version"], { stdio: "ignore" }); return "codex"; } catch {}
  // The Windows app keeps versioned binaries out of PATH; take the newest.
  const binDir = path.join(process.env.LOCALAPPDATA || path.join(HOME, "AppData", "Local"), "OpenAI", "Codex", "bin");
  if (exists(binDir)) {
    const candidates = fs.readdirSync(binDir).map((d) => path.join(binDir, d, "codex.exe")).filter(exists)
      .map((p) => ({ p, t: fs.statSync(p).mtimeMs })).sort((a, b) => b.t - a.t);
    if (candidates.length) return candidates[0].p;
  }
  return "codex";
}

function python() {
  for (const c of ["python", "python3"]) {
    try { execFileSync(c, ["--version"], { stdio: "ignore" }); return c; } catch {}
  }
  return null;
}

export function buildCodex({ src, fsx, opts, log, warnings, generator }) {
  const HOME = os.homedir();
  const pluginsDir = path.resolve(opts.get("--plugins-dir", path.join(HOME, "plugins")));
  const marketplaceFile = path.resolve(opts.get("--marketplace-file", path.join(HOME, ".agents", "plugins", "marketplace.json")));
  const marketplaceName = opts.get("--marketplace", "personal");
  const category = opts.get("--category", "Engineering");
  const installDir = path.join(pluginsDir, src.name);
  const root = fwd(installDir);
  const shortDescriptions = opts.has("--short-descriptions");
  const doRebrand = !opts.has("--no-rebrand");

  if (pluginsDir !== path.join(HOME, "plugins")) {
    log(`! WARNING: --plugins-dir is not ~/plugins. The marketplace entry path "./plugins/${src.name}" resolves to ~/plugins/${src.name} for the default personal marketplace; a custom plugins-dir may not be found by Codex.`);
  }

  const shortDesc = src.description.length > 120 ? src.description.slice(0, 117) + "..." : src.description;
  let defaultPrompt = opts.all("--default-prompt");
  if (!defaultPrompt.length) defaultPrompt = src.manifest.interface?.defaultPrompt || src.manifest.defaultPrompt || [`Use the ${src.displayName} plugin`];
  if (!Array.isArray(defaultPrompt)) defaultPrompt = [defaultPrompt];
  defaultPrompt = defaultPrompt.slice(0, 3).map((s) => String(s).slice(0, 128));

  // No `hooks` key on purpose: Codex discovers hooks/hooks.json by default,
  // and its validator (plugin-creator skill) rejects the explicit key.
  const manifest = {
    name: src.name,
    version: cachebust(src.version),
    description: src.description,
    author: { name: src.author },
    ...(src.license ? { license: src.license } : {}),
    skills: "./skills/",
    ...(src.has.mcp ? { mcpServers: "./.mcp.json" } : {}),
    interface: {
      displayName: src.displayName,
      shortDescription: shortDesc,
      longDescription: src.description,
      developerName: src.author,
      category,
      capabilities: ["Interactive", "Read", "Write"],
      defaultPrompt,
    },
  };

  log("\n== target: codex ==");
  log(`source:      ${src.dir}`);
  log(`plugin:      ${src.name}  (v${manifest.version})`);
  log(`install dir: ${installDir}`);
  log(`marketplace: ${marketplaceFile}`);
  log(`rules file:  AGENTS.md (global ~/.codex/AGENTS.md)`);
  log(`mode:        ${fsx.dry ? "DRY-RUN (no writes, no install)" : "WRITE"}\n`);

  fsx.rm(installDir);
  fsx.mkdir(installDir);
  fsx.write(path.join(installDir, ".codex-plugin", "plugin.json"), JSON.stringify(manifest, null, 2) + "\n");
  log("- manifest .codex-plugin/plugin.json");

  const ctxFor = (rel, skillDir) => ({
    root, skillDir, name: src.name, rel, warnings, rules: CODEX_HOST.rules,
    hostName: CODEX_HOST.hostName, askPhrase: CODEX_HOST.askPhrase, rebrand: doRebrand, shortDescriptions,
  });
  const withScan = (rel, fn) => (text) => { const out = fn(text); scanResidual(rel, out, warnings, CODEX_HOST.rules); return out; };

  if (src.has.skills) {
    const n = copyTree(fsx, path.join(src.dir, "skills"), path.join(installDir, "skills"), (rel, ext) => {
      const skillDir = `${root}/skills/${rel.split("/")[0]}`;
      const ctx = ctxFor(`skills/${rel}`, skillDir);
      if (ext === ".md") return withScan(ctx.rel, (t) => transformSkillMd(t, ctx));
      if (TEXT_EXT.has(ext)) return withScan(ctx.rel, (t) => transformScript(t, ctx));
      return null;
    });
    log(`- skills/ (${src.skillDirs.length} skills: transformed ${n.transformed} files, copied ${n.copied})`);
  }
  for (const dir of ["scripts", "templates"]) {
    if (!src.has[dir]) continue;
    const n = copyTree(fsx, path.join(src.dir, dir), path.join(installDir, dir), (rel, ext) => {
      if (dir === "templates" || !TEXT_EXT.has(ext)) return null; // project payload stays verbatim
      const ctx = ctxFor(`${dir}/${rel}`, null);
      return withScan(ctx.rel, (t) => transformScript(t, ctx));
    });
    log(`- ${dir}/ (${dir === "scripts" ? `rewrote rules-file paths in ${n.transformed} files, ` : ""}copied ${n.copied} verbatim)`);
  }
  if (src.has.hooks) {
    // Verbatim: Codex reads hooks/hooks.json itself, provides ${CLAUDE_PLUGIN_ROOT}
    // to the hook commands, and speaks the same stdin/stdout JSON.
    const n = copyTree(fsx, path.join(src.dir, "hooks"), path.join(installDir, "hooks"), () => null);
    log(`- hooks/ (${n.copied} files verbatim; Codex runs PreToolUse hooks natively, deny works, ask is not supported yet)`);
  }
  if (src.has.mcp) {
    fsx.copy(path.join(src.dir, ".mcp.json"), path.join(installDir, ".mcp.json"));
    log("- .mcp.json carried by plugin");
  }
  fsx.write(path.join(installDir, ".claude-plugin-to-codex.json"), JSON.stringify({ generator, target: "codex", source: src.dir, sourceVersion: src.version, date: new Date().toISOString() }, null, 2) + "\n");

  // marketplace upsert
  let mkName = marketplaceName;
  {
    let mk;
    if (exists(marketplaceFile)) {
      mk = JSON.parse(fs.readFileSync(marketplaceFile, "utf8"));
      if (!Array.isArray(mk.plugins)) mk.plugins = [];
      mkName = mk.name || marketplaceName;
    } else {
      mk = { name: marketplaceName, interface: { displayName: src.displayName === marketplaceName ? marketplaceName : marketplaceName.replace(/(^|-)([a-z])/g, (_, p, c) => (p ? " " : "") + c.toUpperCase()) }, plugins: [] };
    }
    const entry = { name: src.name, source: { source: "local", path: `./plugins/${src.name}` }, policy: { installation: "AVAILABLE", authentication: "ON_INSTALL" }, category };
    const i = mk.plugins.findIndex((p) => p && p.name === src.name);
    if (i >= 0) mk.plugins[i] = entry; else mk.plugins.push(entry);
    fsx.write(marketplaceFile, JSON.stringify(mk, null, 2) + "\n");
    log(`- marketplace "${mkName}" entry ${i >= 0 ? "updated" : "added"} (${src.name})`);
  }

  if (!fsx.dry && !opts.has("--no-validate")) {
    const v = path.join(HOME, ".codex", "skills", ".system", "plugin-creator", "scripts", "validate_plugin.py");
    const P = python();
    if (P && exists(v)) {
      try { log("- validate: " + execFileSync(P, [v, installDir], { encoding: "utf8" }).trim()); }
      catch (e) { log("- validate FAILED:\n" + ((e.stdout || "") + (e.stderr || e.message))); warnings.push("validation failed"); }
    } else log("- validate skipped (python or validator not found)");
  }

  if (!fsx.dry && !opts.has("--no-install")) {
    const codex = findCodex(HOME);
    const add = () => execFileSync(codex, ["plugin", "add", `${src.name}@${mkName}`], { encoding: "utf8" }).trim();
    try { log("- install: " + add()); }
    catch (e) {
      const msg = (e.stdout || "") + (e.stderr || e.message);
      if (/already/i.test(msg)) {
        try {
          execFileSync(codex, ["plugin", "remove", `${src.name}@${mkName}`], { encoding: "utf8" });
          log("- install: " + add() + " (reinstalled)");
        } catch (e2) { log("- install FAILED: " + ((e2.stdout || "") + (e2.stderr || e2.message))); warnings.push("install failed"); }
      } else { log("- install FAILED: " + msg); warnings.push("install failed"); }
    }
  }

  if (src.skillDirs.length > 40 && !shortDescriptions) {
    log(`\nHint: ${src.skillDirs.length} skills. Codex caps the skill catalog at 2% of the context and shortens descriptions past that; --short-descriptions keeps the first sentence of each.`);
  }
  return { installDir, manifest };
}
