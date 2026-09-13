// The conversion itself, on files in memory. No disk, no host lookups, no
// process environment: the CLI feeds it a directory, a web server can feed it
// an archive. Everything host-specific (where files land, how the host is told
// about them) lives in the targets and in bundle.mjs.
import { TEXT_EXT, transformSkillMd, transformScript, scanResidual } from "./text.mjs";
import { CLAUDE_ONLY_FRONTMATTER } from "./text.mjs";

export { CLAUDE_ONLY_FRONTMATTER };

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

/**
 * Converts a Claude Code plugin given as a list of files.
 *
 * @param {Array<{path: string, content: string|Uint8Array}>} files
 *        plugin-root-relative paths with forward slashes; binary content passes through
 * @param {object} o
 * @param {"codex"|"opencode"} o.target
 * @param {string} o.root        what the anchors become: an absolute path, or "$HOME/<rel>"
 * @param {string} o.name        plugin name (for the hard-coded-path rewrite)
 * @param {"agents"|"claude"} [o.rulesMode="agents"]
 * @param {boolean} [o.rebrand=true]
 * @param {boolean} [o.shortDescriptions=false]
 * @returns {{ files: Array<{path: string, content: string|Uint8Array}>, warnings: string[] }}
 */
export function convertFiles(files, o) {
  const host = HOSTS[o.target];
  if (!host) throw new Error(`unknown target ${o.target}`);
  const rules = o.rulesMode === "claude" ? (host.rulesClaude ?? host.rules) : host.rules;
  const warnings = [];
  const out = [];
  for (const f of files) {
    const rel = f.path.replace(/\\/g, "/").replace(/^\/+/, "");
    const top = rel.split("/")[0];
    const ext = extOf(rel);
    const isText = typeof f.content === "string";
    const ctx = {
      root: o.root, skillDir: null, name: o.name, rel, warnings, rules,
      hostName: host.hostName, askPhrase: host.askPhrase,
      rebrand: o.rebrand !== false, shortDescriptions: !!o.shortDescriptions,
    };
    let content = f.content;
    if (isText && top === "skills" && rel.split("/").length >= 3) {
      ctx.skillDir = `${o.root}/skills/${rel.split("/")[1]}`;
      if (ext === ".md") content = transformSkillMd(f.content, ctx);
      else if (TEXT_EXT.has(ext)) content = transformScript(f.content, ctx);
      if (content !== f.content || ext === ".md") scanResidual(rel, content, warnings, rules);
    } else if (isText && top === "scripts" && TEXT_EXT.has(ext)) {
      content = transformScript(f.content, ctx);
      scanResidual(rel, content, warnings, rules);
    }
    // templates/ (project payload), hooks/ (run by the host or the guard),
    // .mcp.json, README, LICENSE: verbatim.
    out.push({ path: rel, content });
  }
  return { files: out, warnings };
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
