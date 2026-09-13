// The text transforms shared by every target. A Claude Code plugin is mostly
// Markdown read by a model plus scripts run by a shell, so porting it is
// mostly a matter of rewriting the few things that only Claude Code knows:
// its path anchors, its rules file, its tool names, and its own name.

/** Text files that may carry ${CLAUDE_*} anchors or rules-file paths. Anything
 *  else is copied byte for byte so binary assets are never corrupted. */
export const TEXT_EXT = new Set([
  ".md", ".sh", ".bash", ".mjs", ".cjs", ".js", ".ts", ".mts", ".cts",
  ".py", ".txt", ".yaml", ".yml", ".toml", ".json",
]);

/** Frontmatter keys that mean nothing outside Claude Code. */
export const CLAUDE_ONLY_FRONTMATTER = ["user-invocable", "allowed-tools", "argument-hint"];

// ---------------------------------------------------------------- frontmatter

// Codex and OpenCode use strict YAML parsers; Claude Code is lenient. Quote any
// unquoted scalar that strict YAML would misread (most commonly a "colon +
// space" inside a description, which YAML reads as a nested mapping).
function needsQuote(v) {
  if (v === "") return false;
  if (/^["'\[{>|]/.test(v)) return false; // already quoted / flow / block scalar
  if (/:(\s|$)/.test(v)) return true; // colon followed by space or end -> nested map
  if (/\s#/.test(v)) return true; // inline comment
  if (/^[!&*?@`%>|-]/.test(v)) return true; // YAML indicator at start
  if (/["']/.test(v)) return true; // stray quote -> wrap + escape to be safe
  return false;
}
const quote = (v) => '"' + v.replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';

function unquote(v) {
  const m = v.match(/^"((?:[^"\\]|\\.)*)"$/) || v.match(/^'((?:[^'\\]|\\.)*)'$/);
  if (!m) return v;
  return m[1].replace(/\\(["'\\])/g, "$1");
}

/** First sentence of a description, for hosts that budget the skill catalog. */
export function firstSentence(s, max = 160) {
  const text = s.trim();
  const m = text.match(/^[\s\S]*?[.!?](?=\s|$)/);
  let out = m && m[0].length >= 40 ? m[0] : text;
  if (out.length > max) {
    const cut = out.slice(0, max);
    out = (cut.lastIndexOf(" ") > max * 0.6 ? cut.slice(0, cut.lastIndexOf(" ")) : cut).replace(/[,;:\s]+$/, "") + "...";
  }
  return out;
}

/**
 * Normalises the `---` frontmatter block: drops the Claude-only keys (and their
 * indented continuation lines), optionally shortens the description, and
 * quotes the scalars a strict parser would choke on. Body untouched.
 */
export function normalizeFrontmatter(text, { strip = CLAUDE_ONLY_FRONTMATTER, shortDescriptions = false } = {}) {
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const lines = text.split(/\r?\n/);
  if (lines[0]?.trim() !== "---") return text;
  let close = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === "---") { close = i; break; }
  }
  if (close === -1) return text;

  const head = [];
  let skipping = false;
  for (let i = 1; i < close; i++) {
    const line = lines[i];
    const m = line.match(/^([A-Za-z][\w-]*):[ \t]*(.*)$/);
    if (m) {
      skipping = strip.includes(m[1]);
      if (skipping) continue;
      let value = m[2];
      if (m[1] === "description" && shortDescriptions && value !== "") value = firstSentence(unquote(value));
      head.push(needsQuote(value) ? `${m[1]}: ${quote(value)}` : (value === m[2] ? line : `${m[1]}: ${value}`));
      continue;
    }
    if (skipping && /^[ \t]+\S/.test(line)) continue; // continuation of a stripped key
    skipping = false;
    head.push(line);
  }
  return [lines[0], ...head, ...lines.slice(close)].join(eol);
}

// -------------------------------------------------------------------- anchors

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Claude Code exposes ${CLAUDE_SKILL_DIR} and ${CLAUDE_PLUGIN_ROOT} to skill
 * commands. Neither Codex nor OpenCode does: their shells run with cwd = the
 * user's project and no plugin variable at all, so the anchors become the
 * absolute install paths. Idempotent: a text without anchors is returned as is.
 */
export function rewriteAnchors(text, { root, skillDir, name, rel, warnings }) {
  let t = text;
  t = t.split("${CLAUDE_SKILL_DIR}/../../").join(root + "/");
  if (skillDir) {
    t = t.split("${CLAUDE_SKILL_DIR}/").join(skillDir + "/");
    t = t.split("${CLAUDE_SKILL_DIR}").join(skillDir);
  }
  t = t.split("${CLAUDE_PLUGIN_ROOT}/").join(root + "/");
  t = t.split("${CLAUDE_PLUGIN_ROOT}").join(root);
  // A plugin path typed by hand (the author's own marketplace) is an anchor
  // too, just a fragile one. Rewrite it and say so: it is a bug upstream.
  if (name) {
    const hardcoded = new RegExp(`(?:\\$HOME|~|\\$\\{HOME\\})/\\.claude/plugins/marketplaces/[^/\\s"'\`]+/${escapeRe(name)}(?=[/\\s"'\`)]|$)`, "g");
    if (hardcoded.test(t)) {
      warnings?.push(`${rel}: hard-coded plugin path rewritten to the install dir (prefer \${CLAUDE_PLUGIN_ROOT} upstream)`);
      t = t.replace(hardcoded, root);
    }
  }
  return t;
}

// ---------------------------------------------------------------- rules files

/**
 * The host's rules file. Claude Code reads CLAUDE.md; Codex reads AGENTS.md
 * only; OpenCode reads AGENTS.md first and CLAUDE.md as a fallback.
 *   mode "agents": rewrite the project file and the global path.
 *   mode "claude": leave everything (for OpenCode users who also use Claude
 *                  Code and want both tools to share one rules file).
 */
export function rewriteRulesFiles(text, rules) {
  if (!rules || rules.mode === "claude") return text;
  let t = text;
  // Code that builds the global path from segments, e.g.
  //   path.join(os.homedir(), ".claude", "CLAUDE.md")
  const segs = rules.globalSegments;
  t = t.replace(/(["'])\.claude\1\s*,\s*(["'])CLAUDE\.md\2/g, (m, q) => segs.map((s) => `${q}${s}${q}`).join(", "));
  // Prose and shell: ~/.claude/CLAUDE.md, $HOME/.claude/CLAUDE.md
  t = t.replace(/(~|\$HOME|\$\{HOME\})\/\.claude\/CLAUDE\.md/g, (m, h) => `${h}/${rules.globalTail}`);
  // Everything else: the project file.
  t = t.split("CLAUDE.md").join(rules.projectFile);
  return t;
}

// ------------------------------------------------------------------- wording

/** "Claude Code" -> the host's name. Only in prose read by the model. */
export function rebrand(text, hostName) {
  return text.replace(/\bClaude Code\b/g, hostName);
}

/** AskUserQuestion is a Claude Code tool. Point the model at the host's way. */
export function mapAskUser(text, phrase) {
  return text.replace(/`AskUserQuestion`/g, phrase).replace(/\bAskUserQuestion\b/g, phrase);
}

// ------------------------------------------------------------------ pipeline

/**
 * The full pass for a skill Markdown file.
 * ctx: { root, skillDir, name, rel, warnings, rules, hostName, askPhrase,
 *        rebrand: bool, shortDescriptions: bool }
 */
export function transformSkillMd(text, ctx) {
  let t = rewriteAnchors(text, ctx);
  t = rewriteRulesFiles(t, ctx.rules);
  if (ctx.askPhrase) t = mapAskUser(t, ctx.askPhrase);
  if (ctx.rebrand && ctx.hostName) t = rebrand(t, ctx.hostName);
  t = normalizeFrontmatter(t, { shortDescriptions: ctx.shortDescriptions });
  return t;
}

/** The pass for scripts and other text payload: paths only, never wording. */
export function transformScript(text, ctx) {
  let t = rewriteAnchors(text, ctx);
  t = rewriteRulesFiles(t, ctx.rules);
  return t;
}

/** What the transforms should have removed, reported per file. */
export function scanResidual(rel, text, warnings, rules) {
  if (/\$\{CLAUDE_[A-Z_]+\}/.test(text)) warnings.push(`${rel}: residual \${CLAUDE_*} token`);
  if (rules && rules.mode !== "claude" && /\bCLAUDE\.md\b/.test(text)) warnings.push(`${rel}: residual CLAUDE.md`);
}
