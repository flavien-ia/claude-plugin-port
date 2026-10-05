// Structural check of a built Codex plugin, run by the converter itself.
//
// Codex 0.159 stopped bundling the `plugin-creator` skill, and with it the
// `validate_plugin.py` the converter used to call: on an up-to-date Codex the
// validation was silently skipped. These are the rules of that validator (as
// of 13/09/2026) that a converted plugin can actually break: manifest shape,
// strict semver, the `interface` block Codex requires, and each skill's
// frontmatter. When the Python validator is still installed, the converter runs
// it as well; this check never depends on it.

import fs from "node:fs";
import path from "node:path";

const MANIFEST_KEYS = new Set([
  "id", "name", "version", "description", "skills", "apps", "mcpServers",
  "interface", "author", "homepage", "repository", "license", "keywords",
]);
const INTERFACE_KEYS = new Set([
  "displayName", "shortDescription", "longDescription", "developerName", "category",
  "capabilities", "websiteURL", "privacyPolicyURL", "termsOfServiceURL", "brandColor",
  "composerIcon", "logo", "logoDark", "screenshots", "defaultPrompt", "default_prompt",
]);
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
const PLUGIN_NAME = /^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*$/;

const nonEmpty = (v) => typeof v === "string" && v.trim() !== "";

/** Top-level `key: value` pairs of a frontmatter block; a folded or literal
 *  scalar (`>-`, `|`) takes the indented lines that follow it. */
export function frontmatterFields(text) {
  const t = text.replace(/\r\n/g, "\n");
  if (!t.startsWith("---\n")) return { error: "must start with YAML frontmatter" };
  const end = t.indexOf("\n---", 4);
  if (end === -1) return { error: "frontmatter is not closed" };
  const lines = t.slice(4, end).split("\n");
  const fields = {};
  for (let i = 0; i < lines.length; i++) {
    const m = /^([A-Za-z0-9_-]+):(.*)$/.exec(lines[i]);
    if (!m) continue;
    let value = m[2].trim();
    if (/^[>|][-+]?$/.test(value)) {
      const block = [];
      while (i + 1 < lines.length && /^\s+\S/.test(lines[i + 1])) block.push(lines[++i].trim());
      value = block.join(" ");
    } else if (/^(['"]).*\1$/.test(value)) {
      value = value.slice(1, -1);
    }
    fields[m[1]] = value;
  }
  return { fields };
}

/** Errors found in the plugin at `root` (empty array = passes). */
export function checkCodexPlugin(root) {
  const errors = [];
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(path.join(root, ".codex-plugin", "plugin.json"), "utf8"));
  } catch (e) {
    return [e.code === "ENOENT" ? "missing `.codex-plugin/plugin.json`" : "`.codex-plugin/plugin.json` must be valid JSON"];
  }
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) return ["`.codex-plugin/plugin.json` must contain a JSON object"];

  for (const k of Object.keys(manifest)) if (!MANIFEST_KEYS.has(k)) errors.push(`plugin.json field \`${k}\` is not accepted by Codex`);
  if (!nonEmpty(manifest.name)) errors.push("plugin.json field `name` must be a non-empty string");
  else if (!PLUGIN_NAME.test(manifest.name)) errors.push("plugin.json field `name` may only contain ASCII letters, digits, `.`, `_` and `-`");
  if (!nonEmpty(manifest.version)) errors.push("plugin.json field `version` must be a non-empty string");
  else if (!SEMVER.test(manifest.version)) errors.push("plugin.json field `version` must be strict semver");
  if (!nonEmpty(manifest.description)) errors.push("plugin.json field `description` must be a non-empty string");
  if (!manifest.author || typeof manifest.author !== "object") errors.push("plugin.json field `author` must be an object");
  else if (!nonEmpty(manifest.author.name)) errors.push("plugin.json field `author.name` must be a non-empty string");

  const ui = manifest.interface;
  if (!ui || typeof ui !== "object") errors.push("plugin.json field `interface` must be an object");
  else {
    for (const k of Object.keys(ui)) if (!INTERFACE_KEYS.has(k)) errors.push(`plugin.json field \`interface.${k}\` is not accepted by Codex`);
    for (const k of ["displayName", "shortDescription", "longDescription", "developerName", "category"]) {
      if (!nonEmpty(ui[k])) errors.push(`plugin.json field \`interface.${k}\` must be a non-empty string`);
    }
    if (!("defaultPrompt" in ui) && !("default_prompt" in ui)) errors.push("plugin.json field `interface.defaultPrompt` is required");
    if (!Array.isArray(ui.capabilities) || !ui.capabilities.every(nonEmpty)) errors.push("plugin.json field `interface.capabilities` must be an array of strings");
    if (ui.brandColor !== undefined && !/^#[0-9A-F]{6}$/i.test(ui.brandColor)) errors.push("plugin.json field `interface.brandColor` must use `#RRGGBB`");
  }

  const skillsRoot = path.join(root, "skills");
  if (fs.existsSync(skillsRoot)) {
    for (const d of fs.readdirSync(skillsRoot, { withFileTypes: true })) {
      if (!d.isDirectory() || d.name.startsWith(".")) continue;
      const file = path.join(skillsRoot, d.name, "SKILL.md");
      if (!fs.existsSync(file)) { errors.push(`skill \`${d.name}\` is missing \`SKILL.md\``); continue; }
      const { error, fields } = frontmatterFields(fs.readFileSync(file, "utf8"));
      if (error) { errors.push(`skill \`${d.name}\` ${error}`); continue; }
      if (!nonEmpty(fields.name)) errors.push(`skill \`${d.name}\` frontmatter field \`name\` must be non-empty`);
      if (!nonEmpty(fields.description)) errors.push(`skill \`${d.name}\` frontmatter field \`description\` must be non-empty`);
      const dmi = fields["disable-model-invocation"] ?? fields.disable_model_invocation;
      if (dmi !== undefined && dmi !== "false") errors.push(`skill \`${d.name}\` frontmatter field \`disable-model-invocation\` must be false`);
    }
  }
  return errors;
}
