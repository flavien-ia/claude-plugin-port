// What a plugin says about its own ports, and the skill names both hosts accept.
//
// A plugin may ship `ports.json` at its root. Claude Code ignores the file;
// this converter reads it, so a plugin author states once what every port
// needs instead of repeating flags on each command line:
//
//   {
//     "internalPrefix": "hv-",
//     "exclude": ["add-routine", "_create-routine"]
//   }
//
// `exclude` is either a list (every target) or an object keyed by target:
// { "codex": [...], "opencode": [...] }. Options given to the API or the CLI
// are added to the file (exclusions) or win over it (prefix, keeping names).

export const PORTS_FILE = "ports.json";

/** The skill names Codex's validator and OpenCode's loader both document:
 *  lowercase letters and digits, single hyphens, no hyphen at either end. */
export const STRICT_SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_SKILL_NAME = 64;

/** The parsed `ports.json` of a plugin given as files, or null. */
export function readPortsConfig(files) {
  const f = files.find((x) => x.path === PORTS_FILE);
  if (!f || typeof f.content !== "string") return null;
  let raw;
  try {
    raw = JSON.parse(f.content);
  } catch (e) {
    throw new Error(`${PORTS_FILE}: invalid JSON (${e.message})`);
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error(`${PORTS_FILE}: expected a JSON object`);
  if (raw.internalPrefix !== undefined && typeof raw.internalPrefix !== "string") throw new Error(`${PORTS_FILE}: "internalPrefix" must be a string`);
  return raw;
}

/** The skills `config` leaves out of `target`. */
export function excludedFor(config, target) {
  const ex = config?.exclude;
  if (ex === undefined || ex === null) return [];
  const list = Array.isArray(ex) ? ex : typeof ex === "object" ? ex[target] ?? [] : null;
  if (!Array.isArray(list) || list.some((n) => typeof n !== "string")) {
    throw new Error(`${PORTS_FILE}: "exclude" must be a list of skill names, or an object of lists keyed by target`);
  }
  return list;
}

/** "hv" and "hv-" both mean "hv-": the prefix is always joined by a hyphen. */
export function normalizePrefix(prefix) {
  const p = String(prefix ?? "").toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/-+/g, "-").replace(/^-+/, "");
  if (!p) return "";
  return p.endsWith("-") ? p : `${p}-`;
}

/**
 * Old name -> new name, for every skill whose name the hosts' validators
 * refuse. A leading "_" (the usual mark of an internal helper in Claude Code
 * plugins) becomes `prefix`; the rest is lower-cased and every other character
 * becomes a hyphen. Throws rather than produce a name that collides or still
 * fails: a port must never silently shadow one skill with another.
 */
export function planSkillNames(skillNames, { prefix }) {
  const renames = new Map();
  const taken = new Set(skillNames.filter((n) => STRICT_SKILL_NAME.test(n)));
  for (const name of skillNames) {
    if (STRICT_SKILL_NAME.test(name)) continue;
    const internal = name.match(/^_+(.*)$/);
    const next = ((internal ? prefix : "") + (internal ? internal[1] : name))
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "");
    if (!STRICT_SKILL_NAME.test(next) || next.length > MAX_SKILL_NAME) {
      throw new Error(`skill "${name}": no valid name can be derived from it (got "${next}"); rename it in the plugin`);
    }
    if (taken.has(next)) {
      throw new Error(`skill "${name}" would become "${next}", which another skill already uses; choose another internal prefix`);
    }
    taken.add(next);
    renames.set(name, next);
  }
  return renames;
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Rewrites every mention of a renamed skill: its directory in paths, its
 * `name:` line, a `plugin:skill` reference, a `/command`. A name only matches
 * as a whole token, so `_setup-auth` is never rewritten inside
 * `_setup-auth-admin`, nor `_x` inside `my_x`.
 */
export function rewriteSkillNames(text, renames) {
  if (!renames?.size) return text;
  const names = [...renames.keys()].sort((a, b) => b.length - a.length).map(escapeRe);
  const re = new RegExp(`(?<![A-Za-z0-9_-])(?:${names.join("|")})(?![A-Za-z0-9_-])`, "g");
  return text.replace(re, (m) => renames.get(m) ?? m);
}

/** True when `text` mentions `name` as a whole token. */
export function mentionsSkill(text, name) {
  return new RegExp(`(?<![A-Za-z0-9_-])${escapeRe(name)}(?![A-Za-z0-9_-])`).test(text);
}

/** Log lines saying what a conversion renamed and left out, for the CLI. */
export function portSummary({ renamedSkills = {}, excludedSkills = [] }) {
  const lines = [];
  const renamed = Object.entries(renamedSkills);
  if (renamed.length) {
    const [from, to] = renamed[0];
    lines.push(`- ${renamed.length} skill name(s) changed to what both hosts accept (${from} -> ${to}${renamed.length > 1 ? ", ..." : ""}); every mention rewritten`);
  }
  if (excludedSkills.length) lines.push(`- left out of the port: ${excludedSkills.join(", ")}`);
  return lines;
}
