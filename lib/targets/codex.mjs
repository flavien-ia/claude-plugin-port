import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { fwd, exists } from "../fsutil.mjs";
import { convertFiles, codexManifest, marketplaceEntry } from "../convert.mjs";

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

/** Writes a converted file list under a directory. */
export function writeFiles(fsx, dir, files) {
  for (const f of files) fsx.write(path.join(dir, ...f.path.split("/")), f.content);
}

export function buildCodex({ srcDir, files, src, fsx, opts, log, warnings, generator }) {
  const HOME = os.homedir();
  const pluginsDir = path.resolve(opts.get("--plugins-dir", path.join(HOME, "plugins")));
  const marketplaceFile = path.resolve(opts.get("--marketplace-file", path.join(HOME, ".agents", "plugins", "marketplace.json")));
  const marketplaceName = opts.get("--marketplace", "personal");
  const category = opts.get("--category", "Engineering");
  const installDir = path.join(pluginsDir, src.name);
  const root = fwd(installDir);

  if (pluginsDir !== path.join(HOME, "plugins")) {
    log(`! WARNING: --plugins-dir is not ~/plugins. The marketplace entry path "./plugins/${src.name}" resolves to ~/plugins/${src.name} for the default personal marketplace; a custom plugins-dir may not be found by Codex.`);
  }

  const manifest = codexManifest(src, { category, defaultPrompt: opts.all("--default-prompt"), version: cachebust(src.version) });

  log("\n== target: codex ==");
  log(`source:      ${srcDir}`);
  log(`plugin:      ${src.name}  (v${manifest.version})`);
  log(`install dir: ${installDir}`);
  log(`marketplace: ${marketplaceFile}`);
  log(`rules file:  AGENTS.md (global ~/.codex/AGENTS.md)`);
  log(`mode:        ${fsx.dry ? "DRY-RUN (no writes, no install)" : "WRITE"}\n`);

  const converted = convertFiles(files, {
    target: "codex", root, name: src.name, rulesMode: "agents",
    rebrand: !opts.has("--no-rebrand"), shortDescriptions: opts.has("--short-descriptions"),
  });
  warnings.push(...converted.warnings);

  fsx.rm(installDir);
  fsx.mkdir(installDir);
  fsx.write(path.join(installDir, ".codex-plugin", "plugin.json"), JSON.stringify(manifest, null, 2) + "\n");
  writeFiles(fsx, installDir, converted.files);
  fsx.write(path.join(installDir, ".claude-plugin-to-codex.json"), JSON.stringify({ generator, target: "codex", source: srcDir, sourceVersion: src.version, date: new Date().toISOString() }, null, 2) + "\n");
  log("- manifest .codex-plugin/plugin.json");
  log(`- ${src.skillNames.length} skills, ${converted.files.length} files (scripts and templates included)`);
  if (src.has.hooks) log("- hooks/ carried verbatim: Codex runs PreToolUse hooks natively (deny works, ask is not supported yet)");
  if (src.has.mcp) log("- .mcp.json carried by plugin");

  // marketplace upsert
  let mkName = marketplaceName;
  {
    let mk;
    if (exists(marketplaceFile)) {
      mk = JSON.parse(fs.readFileSync(marketplaceFile, "utf8"));
      if (!Array.isArray(mk.plugins)) mk.plugins = [];
      mkName = mk.name || marketplaceName;
    } else {
      mk = { name: marketplaceName, interface: { displayName: marketplaceName.replace(/(^|-)([a-z])/g, (_, p, c) => (p ? " " : "") + c.toUpperCase()) }, plugins: [] };
    }
    const entry = marketplaceEntry(src.name, category);
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

  if (src.skillNames.length > 40 && !opts.has("--short-descriptions")) {
    log(`\nHint: ${src.skillNames.length} skills. Codex caps the skill catalog at 2% of the context and shortens descriptions past that; --short-descriptions keeps the first sentence of each.`);
  }
  return { installDir, manifest };
}
