import path from "node:path";
import { createRequire } from "node:module";
import { parseArgs } from "./args.mjs";
import { readSourceDir } from "./source.mjs";
import { makeFs, readJson } from "./fsutil.mjs";
import { buildCodex, writeFiles } from "./targets/codex.mjs";
import { buildOpencode } from "./targets/opencode.mjs";
import { buildBundle, BUNDLE_LAYOUT } from "./bundle.mjs";
import { portSummary } from "./ports.mjs";

const pkg = createRequire(import.meta.url)("../package.json");

/** The command of each host, published on its own so that `npx <name>` resolves. */
export const HOST_COMMANDS = { codex: "claude-plugin-to-codex", opencode: "claude-plugin-to-opencode" };
const HOST_NAMES = { codex: "Codex", opencode: "OpenCode" };

const COMMON_FLAGS = `Common flags:
  --source <dir>           Claude plugin root (default: cwd if it has .claude-plugin/plugin.json)
  --bundle <dir>           write a portable bundle there instead of installing: anchors are
                           $HOME-relative, and unzipping the bundle in one known folder installs it
                           (codex: the home folder; opencode: ~/.config/opencode)
  --dry-run                preview, no writes / no install
  --short-descriptions     keep the first sentence of each skill description (Codex budgets its catalog)
  --no-rebrand             keep the words "Claude Code" in skill texts (default: the host's name)
  --internal-prefix <p>    what a leading "_" in a skill name becomes (default: the plugin's
                           ports.json, else "<plugin name>-"); both hosts ask for names like "my-skill"
  --keep-skill-names       keep names such as "_helper" as they are
  --exclude-skill <name>   leave a skill out of the port (repeatable, or comma-separated)
  --ports <file>           port settings to use instead of the plugin's own ports.json
  --help`;

const CODEX_FLAGS = `Codex:
  --plugins-dir <dir>      where to install (default: ~/plugins) - keep aligned with the marketplace
  --marketplace <name>     marketplace name for a NEW file (default: personal)
  --marketplace-file <p>   default: ~/.agents/plugins/marketplace.json
  --category <c>           interface category (default: Engineering)
  --default-prompt <s>     starter prompt (repeatable, max 3 used)
  --no-validate            skip validate_plugin.py
  --no-install             build + register, but skip \`codex plugin add\``;

const OPENCODE_FLAGS = `OpenCode:
  --opencode-dir <dir>     OpenCode config dir (default: ~/.config/opencode)
  --out <dir>              install root (default: <opencode-dir>/skills/<name>)
  --rules-file <m>         auto (default) | agents | claude   (which rules file the port writes)
  --permissions <file>     permission fragment carried by the plugin
                           (default: <source>/hooks/opencode.permission.json when present)
  --ask-mode <m>           soft | pass   (what the guard does with an \`ask\` decision;
                           default: pass when a permission fragment exists, soft otherwise)
  --no-guard               do not generate the plugin (hooks, mcp and permissions are then not ported)
  --write-config           also merge mcp + permission rules into opencode.json (the plugin
                           injects them at startup anyway; this makes them visible in the file)`;

/** The help text: one host's when the command is bound to a host, both otherwise. */
export function usage({ program = pkg.name, host = null } = {}) {
  if (host) {
    const other = host === "codex" ? "opencode" : "codex";
    return `${program} ${pkg.version} - port a Claude Code plugin to ${HOST_NAMES[host]}.

Usage:
  npx ${program} --source <plugin-dir> [flags]
  npx ${program} --source <plugin-dir> --bundle <dir>       (portable bundle, no install)

${COMMON_FLAGS}

${host === "codex" ? CODEX_FLAGS : OPENCODE_FLAGS}

For ${HOST_NAMES[other]}: npx ${HOST_COMMANDS[other]}. Engine and library: ${pkg.name}.
`;
  }
  return `${program} ${pkg.version} - port a Claude Code plugin to Codex or OpenCode.

Usage:
  npx claude-plugin-to-codex --source <plugin-dir> [flags]          (Codex)
  npx claude-plugin-to-opencode --source <plugin-dir> [flags]       (OpenCode)
  npx ${program} --source <plugin-dir> --target codex|opencode [flags]
  npx ${program} --source <plugin-dir> --target opencode --bundle <dir>
                                                                     (portable bundle, no install)

${COMMON_FLAGS}
  --target <t>             codex | opencode (the two commands above set it for you)

${CODEX_FLAGS}

${OPENCODE_FLAGS}
`;
}

/** The naming and exclusion options, as the API takes them. */
function portOptions(opts) {
  const port = {};
  const prefix = opts.get("--internal-prefix", null);
  if (prefix !== null) port.internalPrefix = prefix;
  if (opts.has("--keep-skill-names")) port.keepSkillNames = true;
  const excluded = opts.all("--exclude-skill").flatMap((s) => s.split(",")).map((s) => s.trim()).filter(Boolean);
  if (excluded.length) port.excludeSkills = excluded;
  const file = opts.get("--ports", null);
  if (file) port.ports = readJson(path.resolve(file));
  return port;
}

/**
 * Runs the command line.
 * @param {string[]} argv
 * @param {object} [o]
 * @param {"codex"|"opencode"|null} [o.host]  bind the command to one host (its own --target is refused)
 * @param {string} [o.program]                the command's name, for messages
 * @returns {Promise<number>} exit code
 */
export async function main(argv, { host = null, program = pkg.name } = {}) {
  const opts = parseArgs(argv);
  if (opts.has("--help") || opts.has("-h")) { console.log(usage({ program, host })); return 0; }
  const target = opts.get("--target", host ?? "codex");
  if (!["codex", "opencode"].includes(target)) { console.error(`ERROR: --target must be codex or opencode (got "${target}").`); return 1; }
  if (host && target !== host) {
    console.error(`ERROR: ${program} ports to ${HOST_NAMES[host]} only. For ${HOST_NAMES[target]}, use npx ${HOST_COMMANDS[target]}.`);
    return 1;
  }

  let loaded;
  try { loaded = readSourceDir(opts.get("--source", null)); }
  catch (e) { console.error("ERROR: " + e.message); return 1; }
  const { dir: srcDir, files, src } = loaded;

  const fsx = makeFs(opts.has("--dry-run"));
  const warnings = [];
  const log = (...a) => console.log(...a);
  const generator = `${pkg.name} ${pkg.version}${program !== pkg.name ? ` (${program})` : ""}`;

  try {
    const port = portOptions(opts);
    const bundleDir = opts.get("--bundle", null);
    if (bundleDir) {
      const out = path.resolve(bundleDir);
      const bundle = buildBundle(files, {
        target, generator, category: opts.get("--category", "Engineering"), defaultPrompt: opts.all("--default-prompt"),
        shortDescriptions: opts.has("--short-descriptions"), rebrand: !opts.has("--no-rebrand"), askMode: opts.get("--ask-mode", undefined),
        ...port,
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
      portSummary(bundle).forEach((line) => log(line));
    } else {
      const ctx = { srcDir, files, src, fsx, opts, log, warnings, generator, port };
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
