// Portable bundles: the converted plugin laid out so that unzipping it in ONE
// known folder installs it, with no command to type. The anchors are written
// as $HOME/<path>, which both bash and PowerShell expand inside double quotes,
// so the same archive serves every machine. Used by the CLI (--bundle) and by
// servers that convert on download.
import { convertFiles, describeSource, preToolUseHooks, codexManifest, mcpFromClaude, marketplaceEntry } from "./convert.mjs";
import { renderGuardPlugin } from "./guard.mjs";
import { INSTALLER_FILE, renderInstaller } from "./installer.mjs";

export { INSTALLER_FILE };

/** Where a bundle expects to be unzipped, per host, relative to the home folder. */
export const BUNDLE_LAYOUT = {
  codex: { unzipInto: "$HOME", pluginRel: (name) => `plugins/${name}` },
  opencode: { unzipInto: "$HOME/.config/opencode", pluginRel: (name) => `.config/opencode/skills/${name}` },
};

function stamp(version) {
  const base = String(version || "0.0.0").split("+")[0];
  const ts = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
  return `${base}+codex.bundle-${ts}`;
}

/**
 * Builds a bundle from a plugin given as files.
 * @returns {{ files: Array<{path, content}>, warnings: string[], name: string, version: string, unzipInto: string,
 *             skillCount: number, renamedSkills: Record<string, string>, excludedSkills: string[] }}
 */
export function buildBundle(files, {
  target, generator = "claude-plugin-to-codex", category = "Engineering", defaultPrompt = [], shortDescriptions = false,
  rebrand = true, askMode, install, internalPrefix, keepSkillNames, excludeSkills, ports,
} = {}) {
  const src = describeSource(files);
  const layout = BUNDLE_LAYOUT[target];
  if (!layout) throw new Error(`unknown target ${target}`);
  const rel = layout.pluginRel(src.name);
  const root = `$HOME/${rel}`;
  const converted = convertFiles(files, {
    target, root, name: src.name, rulesMode: "agents", rebrand, shortDescriptions, internalPrefix, keepSkillNames, excludeSkills, ports,
  });
  const out = [];
  const warnings = [...converted.warnings];
  const pluginPrefix = target === "codex" ? `plugins/${src.name}/` : `skills/${src.name}/`;

  if (target === "codex") {
    out.push({ path: `${pluginPrefix}.codex-plugin/plugin.json`, content: JSON.stringify(codexManifest(src, { category, defaultPrompt, version: stamp(src.version) }), null, 2) + "\n" });
    for (const f of converted.files) out.push({ path: pluginPrefix + f.path, content: f.content });
    // The personal marketplace Codex discovers at ~/.agents/plugins/marketplace.json.
    // A user who already has one keeps theirs and adds the entry (see install notes).
    out.push({ path: ".agents/plugins/marketplace.json", content: JSON.stringify({ name: "personal", interface: { displayName: "Personal" }, plugins: [marketplaceEntry(src.name, category)] }, null, 2) + "\n" });
  } else {
    for (const f of converted.files) out.push({ path: pluginPrefix + f.path, content: f.content });
    const hooks = preToolUseHooks(src.hooks);
    const mcp = mcpFromClaude(src.mcp);
    const permission = src.permission;
    if (hooks.length || Object.keys(mcp).length || permission) {
      out.push({
        path: `plugins/${src.name}-guard.js`,
        content: renderGuardPlugin({
          name: src.name,
          root: { kind: "home", rel },
          hooks,
          askMode: askMode || (permission ? "pass" : "soft"),
          mcp,
          permission,
          generator,
        }),
      });
    }
  }
  if (install) out.push({ path: install.path, content: install.content });
  // Unpack a newer bundle anywhere and run the installer it carries: the plugin
  // moves to a backup, the new one takes its place, the host is told.
  out.push({ path: pluginPrefix + INSTALLER_FILE, content: renderInstaller({ target, name: src.name, generator }) });
  out.push({
    path: `${pluginPrefix}.claude-plugin-to-codex.json`,
    content: JSON.stringify({
      generator, target, bundle: true, unzipInto: layout.unzipInto, sourceVersion: src.version, date: new Date().toISOString(),
      installer: INSTALLER_FILE, renamedSkills: converted.renamedSkills, excludedSkills: converted.excludedSkills,
    }, null, 2) + "\n",
  });
  return {
    files: out, warnings, name: src.name, version: src.version, unzipInto: layout.unzipInto,
    skillCount: converted.skillCount, renamedSkills: converted.renamedSkills, excludedSkills: converted.excludedSkills,
  };
}
