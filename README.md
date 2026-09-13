# claude-plugin-to-codex

Port a [Claude Code](https://docs.anthropic.com/en/docs/claude-code) plugin to **OpenAI Codex** or to **OpenCode**, as a plugin, not as a pile of copied skills.

A Claude Code plugin is a directory with `.claude-plugin/plugin.json`, `skills/`, and often `scripts/`, `templates/`, `hooks/` and `.mcp.json`. Codex and OpenCode both read the same `SKILL.md` format, but neither knows Claude Code's path anchors, its rules file, its tool names or its hook wiring. This tool rewrites exactly those, and nothing else.

```bash
# Codex (default target): builds ~/plugins/<name>, registers it in your personal
# marketplace, validates it, installs it with `codex plugin add`
npx claude-plugin-to-codex --source ./my-plugin

# OpenCode: installs under ~/.config/opencode/skills/<name> and generates the plugin
# that runs the guardrail hooks and carries the MCP servers and permission rules
npx claude-plugin-to-codex --source ./my-plugin --target opencode
npx claude-plugin-to-opencode --source ./my-plugin          # same thing, target preset

# Portable bundle: a folder that installs by being unzipped in one known place
npx claude-plugin-to-codex --source ./my-plugin --target opencode --bundle ./out

npx claude-plugin-to-codex --source ./my-plugin --dry-run   # preview, writes nothing
```

Idempotent: re-run it after each plugin update. Zero dependencies, Node 18+.

## What gets rewritten

| In the plugin | Why | Codex | OpenCode |
|---|---|---|---|
| `${CLAUDE_SKILL_DIR}`, `${CLAUDE_PLUGIN_ROOT}` in skills and scripts | both hosts run skill commands with `cwd` = the user's project and no plugin variable | install path | install path |
| a hand-typed `~/.claude/plugins/marketplaces/<x>/<name>` | same anchor, fragile form; reported as a warning | install path | install path |
| `CLAUDE.md` in skills and scripts, `~/.claude/CLAUDE.md` and `path.join(homedir, ".claude", "CLAUDE.md")` | the host's rules file | `AGENTS.md`, `~/.codex/AGENTS.md` | `AGENTS.md`, `~/.config/opencode/AGENTS.md`, or kept as `CLAUDE.md` (see below) |
| frontmatter `user-invocable`, `allowed-tools`, `argument-hint` | Claude Code only | dropped | dropped |
| unquoted frontmatter scalars with `: ` etc. | strict YAML parsers | quoted | quoted |
| `AskUserQuestion` | a Claude Code tool | "a direct question to the user" | "the `question` tool" |
| the words "Claude Code" in skill texts | the model should not be told it runs somewhere else (`--no-rebrand` to keep) | "Codex" | "OpenCode" |
| skill descriptions (`--short-descriptions`) | Codex budgets its skill catalog to 2% of the context and shortens past that | first sentence | first sentence |

The install path is absolute for a local install and `$HOME/<path>` in a bundle (bash and PowerShell both expand it inside double quotes). `templates/` is project payload and stays byte for byte. `_`-prefixed skill names are kept: both loaders accept them.

## Codex

Builds `~/plugins/<name>/`:

- `.codex-plugin/plugin.json`: translated manifest with the `interface` block Codex requires; the version gets a `+codex.local-<timestamp>` suffix so a rebuild is seen as an update.
- `skills/`, `scripts/`, `templates/`, `.mcp.json`: as described above.
- `hooks/`: **verbatim**. Codex runs a plugin's `hooks/hooks.json` natively, sets `CLAUDE_PLUGIN_ROOT` for the hook commands, and speaks the same stdin/stdout JSON as Claude Code. `permissionDecision: "deny"` blocks the call; `"ask"` is parsed but not supported by Codex yet, so it falls back to Codex's own approval policy. The manifest deliberately carries no `hooks` key: Codex's validator rejects it, and the default location is discovered without it.
- Registers the plugin in `~/.agents/plugins/marketplace.json` (created if missing), runs the official `validate_plugin.py` when the plugin-creator skill is installed, then `codex plugin add <name>@personal`.

On first use Codex asks you to review and trust each hook (it records the hash). A shell-heavy plugin needs Codex to run with trusted or full access, or the sandbox blocks its commands. Start a new Codex thread after installing.

Flags: `--plugins-dir`, `--marketplace`, `--marketplace-file`, `--category`, `--default-prompt` (repeatable), `--no-validate`, `--no-install`.

## OpenCode

Installs under `~/.config/opencode/skills/<name>/` (OpenCode discovers `skills/**/SKILL.md`, so the plugin keeps its own layout: `skills/`, `scripts/`, `templates/`, `hooks/`). Every skill is loaded by the `skill` tool and also answers to `/<skill-name>` as a command, with no wrapper to generate.

### The generated plugin

One file, `~/.config/opencode/plugins/<name>-guard.js`, does the rest when OpenCode starts:

- **Hooks.** Its `tool.execute.before` hook runs **the same PreToolUse hook commands** as Claude Code, fed the same JSON (`tool_name`, `tool_input.command`, `cwd`, ...), with `CLAUDE_PLUGIN_ROOT` set. A `deny` decision (or exit code 2) throws, which blocks the tool call and hands the reason to the model. The plugin author keeps one decision function for every host.
- **Configuration.** Its `config` hook adds the plugin's MCP servers (from `.mcp.json`) and permission rules (see below) to OpenCode's live configuration, never replacing what the user already wrote. `opencode.json` is left alone; `--write-config` also merges them into the file, for those who want them visible there.

### Asking the user

OpenCode plugins cannot open a confirmation prompt, so an `ask` decision is handled one of two ways:

- **Permission rules** (recommended). Put a fragment next to your hooks, `hooks/opencode.permission.json`, mirroring your `ask` rules as OpenCode wildcard patterns (or pass any file with `--permissions`); the plugin carries it, and OpenCode shows its native prompt. Example:

  ```json
  { "permission": { "bash": { "git push*": "ask", "git push*--dry-run*": "allow" } } }
  ```

  OpenCode applies the **last matching rule**, so order your patterns from general to specific. A rule the user already wrote for a pattern is never overwritten; a plain `"bash": "allow"` is widened to `{"*": "allow", ...}` first.
- **Soft mode** (`--ask-mode soft`, the default when no fragment exists). The plugin blocks the call once with the hook's reason and asks the model to get the user's explicit agreement, then lets the identical command through on its next attempt in the same session. It is a nudge, not a gate: prefer permission rules for anything that matters.

### Rules file

OpenCode reads `AGENTS.md`, and `CLAUDE.md` as a fallback (project, and `~/.claude/CLAUDE.md` globally). `--rules-file`:

- `agents`: the port writes `AGENTS.md` (project) and `~/.config/opencode/AGENTS.md` (global).
- `claude`: the port keeps `CLAUDE.md` everywhere, so a machine that also runs Claude Code has one rules file for both tools instead of two that drift. OpenCode reads it as long as no `AGENTS.md` sits next to it.
- `auto` (default): `claude` when `~/.claude/CLAUDE.md` exists on the machine, `agents` otherwise.

Flags: `--opencode-dir`, `--out`, `--rules-file`, `--permissions`, `--ask-mode`, `--no-guard`, `--write-config`.

Uninstall: delete the install dir and the plugin file; nothing else was written.

## Bundles

`--bundle <dir>` writes a **portable** layout instead of installing: anchors are `$HOME`-relative, and unzipping the folder in one known place installs the plugin, with no command to type.

| Target | Unzip into | Contents |
|---|---|---|
| codex | the home folder | `plugins/<name>/` (the plugin) and `.agents/plugins/marketplace.json` (a personal marketplace listing it; keep yours and add the entry if you already have one). Then install it from Codex's plugin browser, or `codex plugin add <name>@personal`. |
| opencode | `~/.config/opencode` | `skills/<name>/` (the plugin) and `plugins/<name>-guard.js` (hooks, MCP servers and permission rules, root resolved from the home folder when it loads). Start a new session. |

Bundles use `AGENTS.md` and `--ask-mode pass` when a permission fragment exists.

## As a library

```js
import { convertFiles, describeSource } from "claude-plugin-to-codex/convert";
import { buildBundle } from "claude-plugin-to-codex/bundle";

// files: [{ path: "skills/x/SKILL.md", content: "..." }, ...], plugin-root-relative
const { files, warnings } = buildBundle(files, { target: "opencode", generator: "my-site" });
// zip `files` yourself (JSZip, archiver...). Binary contents pass through untouched.
```

No disk, no environment lookups: a web server can convert an archive on download.

## Limitations

- Skills that spell out Claude Code specifics beyond what is rewritten (settings files, slash-command menus) keep saying them; read the port once.
- Hooks other than PreToolUse are carried to Codex (which runs them) but not to OpenCode.
- OpenCode's permission patterns are wildcards on the parsed command, less precise than a hook's regexes: the fragment mirrors, the hook decides.
- Both hosts move fast. Tested with Codex CLI 0.154 and OpenCode 1.18.30.

## Development

```bash
node --test test/converter.test.mjs
```

## License

MIT © 2026 Flavien Chervet
