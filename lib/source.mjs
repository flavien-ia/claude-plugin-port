import fs from "node:fs";
import path from "node:path";
import { readJson, exists } from "./fsutil.mjs";

const titleCase = (s) => s.replace(/(^|-)([a-z0-9])/g, (_, p, c) => (p ? " " : "") + c.toUpperCase());

function detectLicense(dir, manifest) {
  for (const f of ["LICENSE", "LICENSE.md", "LICENSE.txt"]) {
    const p = path.join(dir, f);
    if (exists(p)) {
      const head = fs.readFileSync(p, "utf8").slice(0, 600);
      if (/apache/i.test(head)) return "Apache-2.0";
      if (/\bMIT\b/.test(head)) return "MIT";
      if (/GNU GENERAL PUBLIC/i.test(head)) return "GPL-3.0";
    }
  }
  return manifest.license || null;
}

/** Reads a Claude Code plugin (a directory holding .claude-plugin/plugin.json). */
export function readSource(sourceArg) {
  let dir = sourceArg;
  if (!dir && exists(path.join(process.cwd(), ".claude-plugin", "plugin.json"))) dir = process.cwd();
  if (!dir || !exists(path.join(dir, ".claude-plugin", "plugin.json"))) {
    throw new Error("--source must point to a Claude Code plugin (a dir containing .claude-plugin/plugin.json).");
  }
  dir = path.resolve(dir);
  const manifest = readJson(path.join(dir, ".claude-plugin", "plugin.json"));
  const name = String(manifest.name || "").toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
  if (!name) throw new Error("plugin name missing/invalid in source manifest.");

  const has = {
    skills: exists(path.join(dir, "skills")),
    scripts: exists(path.join(dir, "scripts")),
    templates: exists(path.join(dir, "templates")),
    hooks: exists(path.join(dir, "hooks", "hooks.json")),
    mcp: exists(path.join(dir, ".mcp.json")),
  };
  const hooks = has.hooks ? readJson(path.join(dir, "hooks", "hooks.json")) : null;
  const mcp = has.mcp ? readJson(path.join(dir, ".mcp.json")) : null;
  const skillDirs = has.skills
    ? fs.readdirSync(path.join(dir, "skills"), { withFileTypes: true })
        .filter((e) => e.isDirectory() && exists(path.join(dir, "skills", e.name, "SKILL.md")))
        .map((e) => e.name)
    : [];
  // An optional permission fragment for OpenCode, kept next to the hooks it
  // mirrors (see README, "OpenCode: asking the user").
  const permissionFile = path.join(dir, "hooks", "opencode.permission.json");

  return {
    dir,
    manifest,
    name,
    displayName: titleCase(name),
    description: manifest.description || `${titleCase(name)} plugin`,
    version: String(manifest.version || "0.0.0"),
    author: manifest.author?.name || "Unknown",
    license: detectLicense(dir, manifest),
    has,
    hooks,
    mcp,
    skillDirs,
    permissionFile: exists(permissionFile) ? permissionFile : null,
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
