#!/usr/bin/env node
/**
 * claude-plugin-to-codex - Convert a Claude Code plugin into a native Codex plugin.
 *
 * Point it at a downloaded/cloned Claude Code plugin, then run:
 *   npx claude-plugin-to-codex --source <plugin-dir>
 *
 * What it does (idempotent):
 *   1. Reads the Claude manifest (.claude-plugin/plugin.json).
 *   2. Builds a Codex plugin at ~/plugins/<name>/ :
 *        - .codex-plugin/plugin.json   (translated manifest + interface block)
 *        - skills/                      (copied, with transforms below)
 *        - scripts/, templates/         (copied verbatim - project payload)
 *        - .mcp.json                    (carried by the plugin)
 *   3. Transforms (skills/*.md only):
 *        - ${CLAUDE_SKILL_DIR}/../../{scripts,templates}/  ->  <abs-install-dir>/...
 *          (Codex runs skill commands with cwd = user project and exposes NO
 *           skill/plugin-dir env var, so the anchor must be an absolute path.)
 *        - CLAUDE.md  ->  AGENTS.md     (Codex project-memory file)
 *        - strips the non-spec `user-invocable:` frontmatter line
 *        - keeps `_`-prefixed names as-is (Codex's loader is lenient)
 *   4. Upserts the personal marketplace (~/.agents/plugins/marketplace.json).
 *   5. Validates with the official validate_plugin.py, then `codex plugin add`.
 *
 * Flags:
 *   --source <dir>           Claude plugin root (default: cwd if it has .claude-plugin/)
 *   --plugins-dir <dir>      where to install (default: ~/plugins) - keep aligned with marketplace
 *   --marketplace <name>     marketplace name for a NEW file (default: personal)
 *   --marketplace-file <p>   default: ~/.agents/plugins/marketplace.json
 *   --category <c>           interface category (default: Engineering)
 *   --default-prompt <s>     starter prompt (repeatable, max 3 used)
 *   --dry-run                preview, no writes / no install
 *   --no-validate            skip validate_plugin.py
 *   --no-install             build + register, but skip `codex plugin add`
 *   --help
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";

const argv = process.argv.slice(2);
const flag = (n) => argv.includes(n);
const opt = (n, d) => { const i = argv.indexOf(n); return i >= 0 && i + 1 < argv.length ? argv[i + 1] : d; };
const optAll = (n) => { const o = []; argv.forEach((a, i) => { if (a === n && argv[i + 1]) o.push(argv[i + 1]); }); return o; };

if (flag("--help")) { console.log(fs.readFileSync(new URL(import.meta.url)).toString().split("\n").slice(2, 44).join("\n")); process.exit(0); }

const DRY = flag("--dry-run");
const NO_INSTALL = flag("--no-install");
const NO_VALIDATE = flag("--no-validate");
const category = opt("--category", "Engineering");
const marketplaceName = opt("--marketplace", "personal");
const defaultPromptArg = optAll("--default-prompt");

const HOME = os.homedir();
const pluginsDir = path.resolve(opt("--plugins-dir", path.join(HOME, "plugins")));
const marketplaceFile = path.resolve(opt("--marketplace-file", path.join(HOME, ".agents", "plugins", "marketplace.json")));

let source = opt("--source", null);
if (!source && fs.existsSync(path.join(process.cwd(), ".claude-plugin", "plugin.json"))) source = process.cwd();
if (!source || !fs.existsSync(path.join(source, ".claude-plugin", "plugin.json"))) {
  console.error("ERROR: --source must point to a Claude Code plugin (a dir containing .claude-plugin/plugin.json).");
  process.exit(1);
}
source = path.resolve(source);

const log = (...a) => console.log(...a);
const fwd = (p) => p.replace(/\\/g, "/");
const titleCase = (s) => s.replace(/(^|-)([a-z0-9])/g, (_, p, c) => (p ? " " : "") + c.toUpperCase());

const srcManifest = JSON.parse(fs.readFileSync(path.join(source, ".claude-plugin", "plugin.json"), "utf8"));
const name = String(srcManifest.name || "").toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
if (!name) { console.error("ERROR: plugin name missing/invalid in source manifest."); process.exit(1); }

const installDir = path.join(pluginsDir, name);
const installDirFwd = fwd(installDir);

if (pluginsDir !== path.join(HOME, "plugins")) {
  log(`! WARNING: --plugins-dir is not ~/plugins. The marketplace entry path "./plugins/${name}" resolves to ~/plugins/${name} for the default personal marketplace; a custom plugins-dir may not be found by Codex.`);
}

function detectLicense() {
  for (const f of ["LICENSE", "LICENSE.md", "LICENSE.txt"]) {
    const p = path.join(source, f);
    if (fs.existsSync(p)) {
      const head = fs.readFileSync(p, "utf8").slice(0, 600);
      if (/apache/i.test(head)) return "Apache-2.0";
      if (/\bMIT\b/.test(head)) return "MIT";
      if (/GNU GENERAL PUBLIC/i.test(head)) return "GPL-3.0";
    }
  }
  return srcManifest.license || null;
}

function cachebust(v) {
  const base = String(v || "0.0.0").split("+")[0];
  const ts = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
  return `${base}+codex.local-${ts}`;
}

const displayName = titleCase(name);
const desc = srcManifest.description || `${displayName} plugin`;
const shortDesc = desc.length > 120 ? desc.slice(0, 117) + "..." : desc;
let defaultPrompt = defaultPromptArg.length
  ? defaultPromptArg
  : (srcManifest.interface?.defaultPrompt || srcManifest.defaultPrompt || [`Use the ${displayName} plugin`]);
if (!Array.isArray(defaultPrompt)) defaultPrompt = [defaultPrompt];
defaultPrompt = defaultPrompt.slice(0, 3).map((s) => String(s).slice(0, 128));
const license = detectLicense();
const hasMcp = fs.existsSync(path.join(source, ".mcp.json"));

const codexManifest = {
  name,
  version: cachebust(srcManifest.version),
  description: desc,
  author: { name: srcManifest.author?.name || "Unknown" },
  ...(license ? { license } : {}),
  skills: "./skills/",
  ...(hasMcp ? { mcpServers: "./.mcp.json" } : {}),
  interface: {
    displayName,
    shortDescription: shortDesc,
    longDescription: desc,
    developerName: srcManifest.author?.name || "Unknown",
    category,
    capabilities: ["Interactive", "Read", "Write"],
    defaultPrompt,
  },
};

const warnings = [];

// Codex uses a strict YAML parser; Claude Code is lenient. Quote any unquoted
// frontmatter scalar that would break strict YAML (most commonly a "colon +
// space" inside an unquoted description, which YAML reads as a nested mapping).
function ynNeedsQuote(v) {
  if (v === "") return false;
  if (/^["'\[{>|]/.test(v)) return false; // already quoted / flow / block scalar
  if (/:(\s|$)/.test(v)) return true; // colon followed by space or end -> nested map
  if (/\s#/.test(v)) return true; // inline comment
  if (/^[!&*?@`%>|-]/.test(v)) return true; // YAML indicator at start
  if (/["']/.test(v)) return true; // stray quote -> wrap + escape to be safe
  return false;
}
const yq = (v) => '"' + v.replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';
function normalizeFrontmatter(text) {
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const lines = text.split(/\r?\n/);
  if (lines[0]?.trim() !== "---") return text;
  let close = -1;
  for (let i = 1; i < lines.length; i++) { if (lines[i].trim() === "---") { close = i; break; } }
  if (close === -1) return text;
  for (let i = 1; i < close; i++) {
    const m = lines[i].match(/^([A-Za-z][\w-]*):[ \t]+(.*)$/);
    if (m && ynNeedsQuote(m[2])) lines[i] = `${m[1]}: ${yq(m[2])}`;
  }
  return lines.join(eol);
}

// Rewrite the Claude plugin path anchors to absolute install paths. Safe to run
// on any text file: there is NO CLAUDE.md->AGENTS.md rename here, so scripts that
// legitimately reference ~/.claude/CLAUDE.md are left untouched.
function rewriteTokens(text, skillAbsDirFwd) {
  let t = text;
  t = t.split("${CLAUDE_SKILL_DIR}/../../").join(installDirFwd + "/");
  if (skillAbsDirFwd) {
    t = t.split("${CLAUDE_SKILL_DIR}/").join(skillAbsDirFwd + "/");
    t = t.split("${CLAUDE_SKILL_DIR}").join(skillAbsDirFwd);
  }
  // ${CLAUDE_PLUGIN_ROOT} is the canonical plugin-root anchor = the install dir.
  t = t.split("${CLAUDE_PLUGIN_ROOT}/").join(installDirFwd + "/");
  t = t.split("${CLAUDE_PLUGIN_ROOT}").join(installDirFwd);
  return t;
}
function transformMd(text, skillAbsDirFwd) {
  let t = rewriteTokens(text, skillAbsDirFwd);
  t = t.split("CLAUDE.md").join("AGENTS.md");
  t = t.replace(/^[ \t]*user-invocable:.*$\r?\n?/gm, "");
  t = normalizeFrontmatter(t);
  return t;
}
function scanResidual(rel, text) {
  if (/\$\{CLAUDE_[A-Z_]+\}/.test(text)) warnings.push(`${rel}: residual \${CLAUDE_*} token`);
  if (/\bCLAUDE\.md\b/.test(text)) warnings.push(`${rel}: residual CLAUDE.md`);
}

const mkdir = (p) => { if (!DRY) fs.mkdirSync(p, { recursive: true }); };
const writeFile = (p, c) => { if (!DRY) { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, c, "utf8"); } };
const copyFile = (s, d) => { if (!DRY) { fs.mkdirSync(path.dirname(d), { recursive: true }); fs.copyFileSync(s, d); } };

function skillDirFor(absFile) {
  const rel = path.relative(installDir, absFile).split(path.sep);
  if (rel[0] === "skills" && rel.length >= 2) return fwd(path.join(installDir, "skills", rel[1]));
  return null;
}
// Non-.md text files that may contain ${CLAUDE_*} path tokens get token
// rewriting only (no CLAUDE.md rename, no frontmatter pass). Everything else is
// copied verbatim so binary assets are never corrupted.
const TOKEN_TEXT_EXT = new Set([".sh", ".bash", ".mjs", ".cjs", ".js", ".ts", ".mts", ".cts", ".txt", ".yaml", ".yml", ".toml", ".json"]);
let mdCount = 0, fileCount = 0;
function walkCopy(srcDir, dstDir, doTransform) {
  for (const ent of fs.readdirSync(srcDir, { withFileTypes: true })) {
    const sp = path.join(srcDir, ent.name), dp = path.join(dstDir, ent.name);
    if (ent.isDirectory()) { mkdir(dp); walkCopy(sp, dp, doTransform); }
    else if (ent.isFile()) {
      const ext = path.extname(ent.name).toLowerCase();
      if (doTransform && ext === ".md") {
        const out = transformMd(fs.readFileSync(sp, "utf8"), skillDirFor(dp));
        scanResidual(fwd(path.relative(installDir, dp)), out);
        writeFile(dp, out); mdCount++;
      } else if (doTransform && TOKEN_TEXT_EXT.has(ext)) {
        const out = rewriteTokens(fs.readFileSync(sp, "utf8"), skillDirFor(dp));
        scanResidual(fwd(path.relative(installDir, dp)), out);
        writeFile(dp, out); fileCount++;
      } else { copyFile(sp, dp); fileCount++; }
    }
  }
}

log("\n== install-codex ==");
log(`source:      ${source}`);
log(`plugin:      ${name}  (v${codexManifest.version})`);
log(`install dir: ${installDir}`);
log(`marketplace: ${marketplaceFile}`);
log(`mode:        ${DRY ? "DRY-RUN (no writes, no install)" : "WRITE"}\n`);

if (!DRY) { fs.rmSync(installDir, { recursive: true, force: true }); fs.mkdirSync(installDir, { recursive: true }); }

writeFile(path.join(installDir, ".codex-plugin", "plugin.json"), JSON.stringify(codexManifest, null, 2) + "\n");
log("- manifest .codex-plugin/plugin.json");
if (fs.existsSync(path.join(source, "skills"))) { walkCopy(path.join(source, "skills"), path.join(installDir, "skills"), true); log(`- skills/ (transformed ${mdCount} .md, copied ${fileCount} files)`); }
const beforeFiles = fileCount;
if (fs.existsSync(path.join(source, "scripts"))) { walkCopy(path.join(source, "scripts"), path.join(installDir, "scripts"), false); }
if (fs.existsSync(path.join(source, "templates"))) { walkCopy(path.join(source, "templates"), path.join(installDir, "templates"), false); }
log(`- scripts/ + templates/ (copied ${fileCount - beforeFiles} files verbatim)`);
if (hasMcp) { copyFile(path.join(source, ".mcp.json"), path.join(installDir, ".mcp.json")); log("- .mcp.json carried by plugin"); }

// marketplace upsert
let mkName = marketplaceName;
{
  let mk;
  if (fs.existsSync(marketplaceFile)) {
    mk = JSON.parse(fs.readFileSync(marketplaceFile, "utf8"));
    if (!Array.isArray(mk.plugins)) mk.plugins = [];
    mkName = mk.name || marketplaceName;
  } else {
    mk = { name: marketplaceName, interface: { displayName: titleCase(marketplaceName) }, plugins: [] };
  }
  const entry = { name, source: { source: "local", path: `./plugins/${name}` }, policy: { installation: "AVAILABLE", authentication: "ON_INSTALL" }, category };
  const i = mk.plugins.findIndex((p) => p && p.name === name);
  if (i >= 0) mk.plugins[i] = entry; else mk.plugins.push(entry);
  if (!DRY) { fs.mkdirSync(path.dirname(marketplaceFile), { recursive: true }); fs.writeFileSync(marketplaceFile, JSON.stringify(mk, null, 2) + "\n", "utf8"); }
  log(`- marketplace "${mkName}" entry ${i >= 0 ? "updated" : "added"} (${name})`);
}

function findCodex() {
  try {
    const cfg = fs.readFileSync(path.join(HOME, ".codex", "config.toml"), "utf8");
    const m = cfg.match(/CODEX_CLI_PATH\s*=\s*'([^']+)'/) || cfg.match(/CODEX_CLI_PATH\s*=\s*"([^"]+)"/);
    if (m) return m[1];
  } catch {}
  return "codex";
}
function py() { for (const c of ["python", "python3"]) { try { execFileSync(c, ["--version"], { stdio: "ignore" }); return c; } catch {} } return null; }

if (!DRY && !NO_VALIDATE) {
  const v = path.join(HOME, ".codex", "skills", ".system", "plugin-creator", "scripts", "validate_plugin.py");
  const P = py();
  if (P && fs.existsSync(v)) {
    try { log("- validate: " + execFileSync(P, [v, installDir], { encoding: "utf8" }).trim()); }
    catch (e) { log("- validate FAILED:\n" + ((e.stdout || "") + (e.stderr || e.message))); warnings.push("validation failed"); }
  } else log("- validate skipped (python or validator not found)");
}

if (!DRY && !NO_INSTALL) {
  const codex = findCodex();
  try { log("- install: " + execFileSync(codex, ["plugin", "add", `${name}@${mkName}`], { encoding: "utf8" }).trim()); }
  catch (e) { log("- install FAILED: " + ((e.stdout || "") + (e.stderr || e.message))); warnings.push("install failed"); }
}

log("\n== done ==");
if (warnings.length) { log("WARNINGS:"); warnings.forEach((w) => log("  ! " + w)); } else log("No warnings.");
if (DRY) log(`\n(DRY-RUN) Would build ${name} at ${installDir} and register it in the personal marketplace.`);
else {
  log("\nNext: start a NEW Codex thread so it picks up the plugin and its skills/MCP.");
  log("Note: this plugin is shell-heavy - run Codex with trusted/full access or commands may be blocked by the sandbox.");
}
