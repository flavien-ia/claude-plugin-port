import fs from "node:fs";
import path from "node:path";
import { parseJsonc } from "./jsonc.mjs";
import { exists } from "./fsutil.mjs";

/**
 * Claude Code's .mcp.json  ->  OpenCode's `mcp` key.
 *   {type:"http"|"sse", url, headers}   -> {type:"remote", url, headers}
 *   {command, args, env}                -> {type:"local", command:[...], environment}
 */
export function mcpFromClaude(mcpJson) {
  const out = {};
  for (const [name, s] of Object.entries(mcpJson?.mcpServers ?? {})) {
    if (!s || typeof s !== "object") continue;
    if (s.url) {
      out[name] = { type: "remote", url: s.url, ...(s.headers ? { headers: s.headers } : {}), enabled: true };
    } else if (s.command) {
      out[name] = { type: "local", command: [s.command, ...(s.args ?? [])], ...(s.env ? { environment: s.env } : {}), enabled: true };
    }
  }
  return out;
}

function pickConfigFile(configDir) {
  for (const f of ["opencode.jsonc", "opencode.json"]) {
    if (exists(path.join(configDir, f))) return path.join(configDir, f);
  }
  return path.join(configDir, "opencode.json");
}

/**
 * Merges what the plugin needs into the user's OpenCode config, additively:
 *   - mcp servers that are not already declared
 *   - a permission fragment ({permission: {bash: {...}, ...}}) whose rules are
 *     appended after the user's own (OpenCode: the last matching rule wins),
 *     never replacing a rule the user already wrote for the same pattern.
 * A file that carries comments is never rewritten (they would be lost): the
 * additions go to the sibling opencode.json instead, which OpenCode merges.
 * Idempotent, and a backup is written before any change.
 */
export function mergeOpencodeConfig({ fsx, configDir, mcp = {}, permission = null, log, warnings }) {
  let file = pickConfigFile(configDir);
  let current = {};
  let hadComments = false;
  if (exists(file)) {
    try {
      ({ value: current, hadComments } = parseJsonc(fs.readFileSync(file, "utf8")));
    } catch (e) {
      warnings.push(`could not parse ${file}: ${e.message}; config left untouched`);
      return { file, changed: false };
    }
  }
  if (hadComments) {
    const sibling = path.join(configDir, file.endsWith(".jsonc") ? "opencode.json" : "opencode.jsonc");
    warnings.push(`${path.basename(file)} has comments, so it was left as is; additions written to ${path.basename(sibling)} (OpenCode merges both)`);
    file = sibling;
    current = exists(file) ? parseJsonc(fs.readFileSync(file, "utf8")).value : {};
  }

  const before = JSON.stringify(current);
  const next = structuredClone(current);
  const added = { mcp: [], permission: [] };

  if (Object.keys(mcp).length) {
    next.mcp ??= {};
    for (const [name, def] of Object.entries(mcp)) {
      if (!(name in next.mcp)) { next.mcp[name] = def; added.mcp.push(name); }
    }
  }

  if (permission && typeof permission === "object") {
    next.permission ??= {};
    for (const [tool, rules] of Object.entries(permission)) {
      if (typeof rules === "string") {
        if (!(tool in next.permission)) { next.permission[tool] = rules; added.permission.push(tool); }
        continue;
      }
      let existing = next.permission[tool];
      if (typeof existing === "string") existing = { "*": existing };
      if (!existing || typeof existing !== "object") existing = {};
      for (const [pattern, action] of Object.entries(rules)) {
        if (!(pattern in existing)) { existing[pattern] = action; added.permission.push(`${tool}: ${pattern}`); }
      }
      next.permission[tool] = existing;
    }
  }

  if (!next.$schema && !current.$schema) next.$schema = "https://opencode.ai/config.json";

  const changed = JSON.stringify(next) !== before;
  if (changed && !fsx.dry) {
    if (exists(file)) {
      const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
      fs.copyFileSync(file, `${file}.bak-${stamp}`);
    }
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(next, null, 2) + "\n", "utf8");
  }
  log(`- config ${path.basename(file)}: ${changed ? `updated (+${added.mcp.length} mcp, +${added.permission.length} permission rules)` : "already up to date"}`);
  return { file, changed, added };
}
