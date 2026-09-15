// The conversion itself, on files in memory. No disk, no host lookups, no
// process environment: the CLI feeds it a directory, a web server can feed it
// an archive. Everything host-specific (where files land, how the host is told
// about them) lives in the targets and in bundle.mjs.
import { TEXT_EXT, transformSkillMd, transformScript, scanResidual, CLAUDE_ONLY_FRONTMATTER, PORTABLE_FRONTMATTER } from "./text.mjs";
import { PORTS_FILE, STRICT_SKILL_NAME, readPortsConfig, excludedFor, normalizePrefix, planSkillNames, rewriteSkillNames, mentionsSkill } from "./ports.mjs";

export { CLAUDE_ONLY_FRONTMATTER, PORTABLE_FRONTMATTER, PORTS_FILE, STRICT_SKILL_NAME, planSkillNames };

/** How each host names things and which rules file it reads. */
export const HOSTS = {
  codex: {
    hostName: "Codex",
    askPhrase: "a direct question to the user",
    rules: { mode: "agents", projectFile: "AGENTS.md", globalSegments: [".codex", "AGENTS.md"], globalTail: ".codex/AGENTS.md" },
  },
  opencode: {
    hostName: "OpenCode",
    askPhrase: "the `question` tool",
    rules: { mode: "agents", projectFile: "AGENTS.md", globalSegments: [".config", "opencode", "AGENTS.md"], globalTail: ".config/opencode/AGENTS.md" },
    // OpenCode reads CLAUDE.md as a fallback: a machine that also runs Claude
    // Code can keep one rules file for both tools.
    rulesClaude: { mode: "claude", projectFile: "CLAUDE.md" },
  },
};

const extOf = (p) => { const i = p.lastIndexOf("."); const s = p.lastIndexOf("/"); return i > s ? p.slice(i).toLowerCase() : ""; };
const normPath = (p) => p.replace(/\\/g, "/").replace(/^\/+/, "");

/**
 * A skill can carry its own text for one host: `SKILL.codex.md` replaces
 * `SKILL.md` in the Codex port (any `<file>.codex.md` or `<file>.opencode.md`
 * inside a skill folder works the same way), and no variant file ships in any
 * port. Claude Code reads SKILL.md only, so the variants cost it nothing. For
 * the skills whose mechanism differs from one host to the next.
 */
function hostVariants(list, target) {
  const re = new RegExp(`^(skills/[^/]+/.+)\\.(${Object.keys(HOSTS).join("|")})\\.md$`);
  const chosen = new Map();
  const base = [];
  for (const f of list) {
    const m = f.path.match(re);
    if (!m) base.push(f);
    else if (m[2] === target) chosen.set(`${m[1]}.md`, f.content);
  }
  const out = base.map((f) => (chosen.has(f.path) ? { path: f.path, content: chosen.get(f.path) } : f));
  for (const [p, content] of chosen) if (!base.some((f) => f.path === p)) out.push({ path: p, content });
  return out;
}

/**
 * Converts a Claude Code plugin given as a list of files.
 *
 * @param {Array<{path: string, content: string|Uint8Array}>} files
 *        plugin-root-relative paths with forward slashes; binary content passes through
 * @param {object} o
 * @param {"codex"|"opencode"} o.target
 * @param {string} o.root        what the anchors become: an absolute path, or "$HOME/<rel>"
 * @param {string} o.name        plugin name (for the hard-coded-path rewrite and the default prefix)
 * @param {"agents"|"claude"} [o.rulesMode="agents"]
 * @param {boolean} [o.rebrand=true]
 * @param {boolean} [o.shortDescriptions=false]
 * @param {string} [o.internalPrefix]   what a leading "_" becomes (default: ports.json, else "<name>-")
 * @param {boolean} [o.keepSkillNames]  keep the names the hosts' validators refuse
 * @param {string[]} [o.excludeSkills]  skills left out, on top of those ports.json excludes
 * @param {object|null} [o.ports]       port settings; undefined reads ports.json, null ignores it
 * @returns {{ files: Array<{path: string, content: string|Uint8Array}>, warnings: string[],
 *             renamedSkills: Record<string, string>, excludedSkills: string[], skillCount: number }}
 */
export function convertFiles(files, o) {
  const host = HOSTS[o.target];
  if (!host) throw new Error(`unknown target ${o.target}`);
  const rules = o.rulesMode === "claude" ? (host.rulesClaude ?? host.rules) : host.rules;
  const list = hostVariants(files.map((f) => ({ path: normPath(f.path), content: f.content })), o.target);
  const warnings = [];
  const out = [];

  const skillNames = [...new Set(list.filter((f) => /^skills\/[^/]+\/SKILL\.md$/.test(f.path)).map((f) => f.path.split("/")[1]))];
  const ports = o.ports === undefined ? readPortsConfig(list) : o.ports;
  const excluded = [...new Set([...excludedFor(ports, o.target), ...(o.excludeSkills ?? [])])];
  for (const n of excluded) if (!skillNames.includes(n)) warnings.push(`exclude: no skill named "${n}"`);
  const keepNames = o.keepSkillNames ?? ports?.keepSkillNames === true;
  const prefix = normalizePrefix(o.internalPrefix ?? ports?.internalPrefix ?? `${o.name}-`);
  const renames = keepNames ? new Map() : planSkillNames(skillNames, { prefix });
  const dropped = new Map();

  for (const f of list) {
    const rel = f.path;
    if (rel === PORTS_FILE) continue; // read by the converter, meaningless in the port
    const parts = rel.split("/");
    const top = parts[0];
    const inSkill = top === "skills" && parts.length >= 3;
    if (inSkill && excluded.includes(parts[1])) continue;
    const skill = inSkill ? (renames.get(parts[1]) ?? parts[1]) : null;
    const outRel = inSkill ? ["skills", skill, ...parts.slice(2)].join("/") : rel;
    const ext = extOf(rel);
    const isText = typeof f.content === "string";
    const ctx = {
      root: o.root, skillDir: skill ? `${o.root}/skills/${skill}` : null, name: o.name, rel: outRel, warnings, rules,
      hostName: host.hostName, askPhrase: host.askPhrase,
      rebrand: o.rebrand !== false, shortDescriptions: !!o.shortDescriptions,
      isSkillMd: inSkill && parts.length === 3 && parts[2] === "SKILL.md", dropped,
    };
    let content = f.content;
    let scan = false;
    if (isText && inSkill) {
      if (ext === ".md") content = transformSkillMd(f.content, ctx);
      else if (TEXT_EXT.has(ext)) content = transformScript(f.content, ctx);
      scan = content !== f.content || ext === ".md";
    } else if (isText && top === "scripts" && TEXT_EXT.has(ext)) {
      content = transformScript(f.content, ctx);
      scan = true;
    }
    // Any text may name a renamed skill: skills, scripts, hooks, templates, docs.
    if (isText) content = rewriteSkillNames(content, renames);
    if (scan) scanResidual(outRel, content, warnings, rules);
    // templates/ (project payload), hooks/ (run by the host or the guard),
    // .mcp.json, README, LICENSE: verbatim, apart from renamed skill names.
    out.push({ path: outRel, content });
  }

  for (const [key, count] of dropped) {
    warnings.push(`frontmatter key "${key}" dropped from ${count} skill(s): ${host.hostName} does not read it`);
  }
  const excludedSkills = excluded.filter((n) => skillNames.includes(n));
  for (const n of excludedSkills) {
    const token = renames.get(n) ?? n;
    const refs = out.filter((f) => typeof f.content === "string" && mentionsSkill(f.content, token)).map((f) => f.path);
    if (refs.length) {
      warnings.push(`excluded skill "${n}" is still mentioned in ${refs.length} file(s): ${refs.slice(0, 4).join(", ")}${refs.length > 4 ? ", ..." : ""}`);
    }
  }
  return { files: out, warnings, renamedSkills: Object.fromEntries(renames), excludedSkills, skillCount: skillNames.length - excludedSkills.length };
}

/** Reads the source manifest and the PreToolUse hooks out of a file list. */
export function describeSource(files) {
  const text = (p) => { const f = files.find((x) => x.path === p); return f && typeof f.content === "string" ? f.content : null; };
  const manifestText = text(".claude-plugin/plugin.json");
  if (!manifestText) throw new Error("not a Claude Code plugin: .claude-plugin/plugin.json missing");
  const manifest = JSON.parse(manifestText);
  const name = String(manifest.name || "").toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
  if (!name) throw new Error("plugin name missing/invalid in source manifest");
  const hooksText = text("hooks/hooks.json");
  const mcpText = text(".mcp.json");
  const permText = text("hooks/opencode.permission.json");
  const license = (() => {
    for (const f of ["LICENSE", "LICENSE.md", "LICENSE.txt"]) {
      const head = text(f)?.slice(0, 600);
      if (!head) continue;
      if (/apache/i.test(head)) return "Apache-2.0";
      if (/\bMIT\b/.test(head)) return "MIT";
      if (/GNU GENERAL PUBLIC/i.test(head)) return "GPL-3.0";
    }
    return manifest.license || null;
  })();
  const skillNames = [...new Set(files.filter((f) => /^skills\/[^/]+\/SKILL\.md$/.test(f.path)).map((f) => f.path.split("/")[1]))];
  let permission = null;
  if (permText) {
    const raw = JSON.parse(permText);
    permission = raw.permission && typeof raw.permission === "object" ? raw.permission : raw;
    if (permission && typeof permission === "object") delete permission.$comment;
  }
  return {
    manifest,
    name,
    displayName: name.replace(/(^|-)([a-z0-9])/g, (_, p, c) => (p ? " " : "") + c.toUpperCase()),
    description: manifest.description || `${name} plugin`,
    version: String(manifest.version || "0.0.0"),
    author: manifest.author?.name || "Unknown",
    license,
    hooks: hooksText ? JSON.parse(hooksText) : null,
    mcp: mcpText ? JSON.parse(mcpText) : null,
    permission,
    ports: readPortsConfig(files),
    skillNames,
    has: {
      skills: skillNames.length > 0,
      hooks: !!hooksText,
      mcp: !!mcpText,
      scripts: files.some((f) => f.path.startsWith("scripts/")),
      templates: files.some((f) => f.path.startsWith("templates/")),
    },
  };
}

/** The PreToolUse command hooks of a hooks.json, flattened. */
export function preToolUseHooks(hooks) {
  const out = [];
  for (const entry of hooks?.hooks?.PreToolUse ?? []) {
    for (const h of entry.hooks ?? []) {
      if (h.type === "command" && typeof h.command === "string") {
        out.push({ matcher: entry.matcher || "", command: h.command, timeout: typeof h.timeout === "number" ? h.timeout : 60 });
      }
    }
  }
  return out;
}

/** Codex manifest for a converted plugin. No `hooks` key on purpose: Codex
 *  discovers hooks/hooks.json by default, and its validator rejects the key. */
export function codexManifest(src, { category = "Engineering", defaultPrompt = [], version } = {}) {
  const shortDesc = src.description.length > 120 ? src.description.slice(0, 117) + "..." : src.description;
  let prompts = defaultPrompt.length ? defaultPrompt : (src.manifest.interface?.defaultPrompt || src.manifest.defaultPrompt || [`Use the ${src.displayName} plugin`]);
  if (!Array.isArray(prompts)) prompts = [prompts];
  prompts = prompts.slice(0, 3).map((s) => String(s).slice(0, 128));
  return {
    name: src.name,
    version: version || src.version,
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
      defaultPrompt: prompts,
    },
  };
}

/** Claude Code's .mcp.json -> OpenCode's `mcp` key. */
export function mcpFromClaude(mcpJson) {
  const out = {};
  for (const [name, s] of Object.entries(mcpJson?.mcpServers ?? {})) {
    if (!s || typeof s !== "object") continue;
    if (s.url) out[name] = { type: "remote", url: s.url, ...(s.headers ? { headers: s.headers } : {}), enabled: true };
    else if (s.command) out[name] = { type: "local", command: [s.command, ...(s.args ?? [])], ...(s.env ? { environment: s.env } : {}), enabled: true };
  }
  return out;
}

/** A Codex personal-marketplace entry for the plugin. */
export function marketplaceEntry(name, category = "Engineering") {
  return { name, source: { source: "local", path: `./plugins/${name}` }, policy: { installation: "AVAILABLE", authentication: "ON_INSTALL" }, category };
}
