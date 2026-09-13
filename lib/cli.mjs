import path from "node:path";
import { createRequire } from "node:module";
import { parseArgs } from "./args.mjs";
import { readSourceDir } from "./source.mjs";
import { makeFs } from "./fsutil.mjs";
import { buildCodex, writeFiles } from "./targets/codex.mjs";
import { buildOpencode } from "./targets/opencode.mjs";
import { buildBundle, BUNDLE_LAYOUT } from "./bundle.mjs";

const pkg = createRequire(import.meta.url)("../package.json");

export const USAGE = `claude-plugin-to-codex ${pkg.version} - port a Claude Code plugin to Codex or OpenCode.

Usage:
  npx claude-plugin-to-codex --source <plugin-dir> [--target codex|opencode] [flags]
  npx claude-plugin-to-opencode --source <plugin-dir> [flags]        (same tool, target preset)
  npx claude-plugin-to-codex --source <plugin-dir> --target opencode --bundle <dir>
                                                                     (portable bundle, no install)

Common flags:
  --source <dir>           Claude plugin root (default: cwd if it has .claude-plugin/plugin.json)
  --target <t>             codex (default) | opencode
  --bundle <dir>           write a portable bundle there instead of installing: anchors are
                           $HOME-relative, and unzipping the bundle in one known folder installs it
                           (codex: the home folder; opencode: ~/.config/opencode)
  --dry-run                preview, no writes / no install
  --short-descriptions     keep the first sentence of each skill description (Codex budgets its catalog)
  --no-rebrand             keep the words "Claude Code" in skill texts (default: the host's name)
  --help

Codex:
  --plugins-dir <dir>      where to install (default: ~/plugins) - keep aligned with the marketplace
  --marketplace <name>     marketplace name for a NEW file (default: personal)
  --marketplace-file <p>   default: ~/.agents/plugins/marketplace.json
  --category <c>           interface category (default: Engineering)
  --default-prompt <s>     starter prompt (repeatable, max 3 used)
  --no-validate            skip validate_plugin.py
  --no-install             build + register, but skip \`codex plugin add\`

OpenCode:
  --opencode-dir <dir>     OpenCode config dir (default: ~/.config/opencode)
  --out <dir>              install root (default: <opencode-dir>/skills/<name>)
  --rules-file <m>         auto (default) | agents | claude   (which rules file the port writes)
  --permissions <file>     permission fragment carried by the plugin
                           (default: <source>/hooks/opencode.permission.json when present)
  --ask-mode <m>           soft | pass   (what the guard does with an \`ask\` decision;
                           default: pass when a permission fragment exists, soft otherwise)
  --no-guard               do not generate the plugin (hooks, mcp and permissions are then not ported)
  --write-config           also merge mcp + permission rules into opencode.json (the plugin
                           injects them at startup anyway; this makes them visible in the file)
`;

export async function main(argv, { defaultTarget = "codex" } = {}) {
  const opts = parseArgs(argv);
  if (opts.has("--help") || opts.has("-h")) { console.log(USAGE); return 0; }
  const target = opts.get("--target", defaultTarget);
  if (!["codex", "opencode"].includes(target)) { console.error(`ERROR: --target must be codex or opencode (got "${target}").`); return 1; }

  let loaded;
  try { loaded = readSourceDir(opts.get("--source", null)); }
  catch (e) { console.error("ERROR: " + e.message); return 1; }
  const { dir: srcDir, files, src } = loaded;

  const fsx = makeFs(opts.has("--dry-run"));
  const warnings = [];
  const log = (...a) => console.log(...a);
  const generator = `${pkg.name} ${pkg.version}`;

  try {
    const bundleDir = opts.get("--bundle", null);
    if (bundleDir) {
      const out = path.resolve(bundleDir);
      const bundle = buildBundle(files, {
        target, generator, category: opts.get("--category", "Engineering"), defaultPrompt: opts.all("--default-prompt"),
        shortDescriptions: opts.has("--short-descriptions"), rebrand: !opts.has("--no-rebrand"), askMode: opts.get("--ask-mode", undefined),
      });
      warnings.push(...bundle.warnings);
      log(`\n== bundle: ${target} ==`);
      log(`source:      ${srcDir}`);
      log(`plugin:      ${src.name}  (v${src.version}, ${bundle.skillCount} skills)`);
      log(`output:      ${out}`);
      log(`unzip into:  ${BUNDLE_LAYOUT[target].unzipInto}`);
      log(`mode:        ${fsx.dry ? "DRY-RUN (no writes)" : "WRITE"}\n`);
      fsx.rm(out);
      fsx.mkdir(out);
      writeFiles(fsx, out, bundle.files);
      log(`- ${bundle.files.length} files written`);
    } else {
      const ctx = { srcDir, files, src, fsx, opts, log, warnings, generator };
      if (target === "codex") buildCodex(ctx); else buildOpencode(ctx);
    }
  } catch (e) {
    console.error("ERROR: " + e.message);
    return 1;
  }

  log("\n== done ==");
  if (warnings.length) { log("WARNINGS:"); warnings.forEach((w) => log("  ! " + w)); } else log("No warnings.");
  if (fsx.dry) log("\n(DRY-RUN) Nothing was written.");
  else if (!opts.get("--bundle", null) && target === "codex") {
    log("\nNext: start a NEW Codex thread so it picks up the plugin, its skills, hooks and MCP servers.");
    if (src.has.hooks) log("Hooks: Codex asks you to review and trust each hook once (it records the hash); until then the hook is skipped.");
    log("Note: a shell-heavy plugin needs Codex to run with trusted/full access, or the sandbox blocks its commands.");
  }
  return warnings.some((w) => /failed/.test(w)) ? 2 : 0;
}
