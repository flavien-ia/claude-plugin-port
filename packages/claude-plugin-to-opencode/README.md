# claude-plugin-to-opencode

Port a [Claude Code](https://docs.anthropic.com/en/docs/claude-code) plugin to **OpenCode**, as a plugin, not as a pile of copied skills.

A Claude Code plugin is a directory with `.claude-plugin/plugin.json`, `skills/`, and often `scripts/`, `templates/`, `hooks/` and `.mcp.json`. OpenCode reads the same `SKILL.md` format, but knows nothing of Claude Code's path anchors, its rules file, its tool names or its hook wiring. This command rewrites exactly those, and generates the one OpenCode plugin that carries the rest.

```bash
# installs under ~/.config/opencode/skills/<name> and generates the plugin
# that runs the guardrail hooks and carries the MCP servers and permission rules
npx claude-plugin-to-opencode --source ./my-plugin

# portable bundle: a folder that installs by being unzipped in ~/.config/opencode
npx claude-plugin-to-opencode --source ./my-plugin --bundle ./out

npx claude-plugin-to-opencode --source ./my-plugin --dry-run   # preview, writes nothing
```

Idempotent: re-run it after each plugin update. Zero dependencies beyond its engine, Node 18+. For OpenAI Codex, use [`claude-plugin-to-codex`](https://www.npmjs.com/package/claude-plugin-to-codex).

## What you get

Installs under `~/.config/opencode/skills/<name>/` (OpenCode discovers `skills/**/SKILL.md`, so the plugin keeps its own layout: `skills/`, `scripts/`, `templates/`, `hooks/`). Every skill is loaded by the `skill` tool and also answers to `/<skill-name>` as a command, with no wrapper to generate.

- `skills/`: every `SKILL.md` with its path anchors rewritten to the install path, only the frontmatter keys both hosts read (`name`, `description`, `license`, `metadata`), skill names OpenCode documents (a leading `_` becomes the internal prefix, `<plugin name>-` by default, and every mention follows), `AskUserQuestion` mapped to the `question` tool, the words "Claude Code" replaced by "OpenCode" (`--no-rebrand` to keep them).
- `scripts/`, `templates/`: scripts get the same anchor and rules-file rewrites; templates stay byte for byte.

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

Uninstall: delete the install dir and the plugin file; nothing else was written. Start a new OpenCode session after installing.

## Bundles

`--bundle <dir>` writes a **portable** layout instead of installing: anchors are `$HOME`-relative (bash and PowerShell both expand it), and unzipping the folder in `~/.config/opencode` installs the plugin, with no command to type. It contains `skills/<name>/` (the plugin) and `plugins/<name>-guard.js` (hooks, MCP servers and permission rules, root resolved from the home folder when it loads). Bundles use `AGENTS.md` and `--ask-mode pass` when a permission fragment exists.

Every bundle carries a standalone installer, `skills/<name>/.claude-plugin-to-codex.install.mjs`, so an installed plugin can update itself from a newer bundle with nothing but Node:

```bash
node <unpacked>/skills/<name>/.claude-plugin-to-codex.install.mjs --from <unpacked>
```

It moves the installed copy to `~/.claude-plugin-to-codex/backups/` (outside the folders OpenCode scans, so the old skills are never loaded twice), puts the new copy in its place, replaces the generated plugin along with the skills, and brings the old copy back if any step fails.

## Flags

```
--source <dir>           Claude plugin root (default: cwd if it has .claude-plugin/plugin.json)
--bundle <dir>           portable bundle instead of an install
--dry-run                preview, no writes
--short-descriptions     keep the first sentence of each skill description
--no-rebrand             keep the words "Claude Code" in skill texts
--internal-prefix <p>    what a leading "_" in a skill name becomes (default: ports.json, else "<plugin name>-")
--keep-skill-names       keep names such as "_helper" as they are
--exclude-skill <name>   leave a skill out of the port (repeatable, or comma-separated)
--ports <file>           port settings to use instead of the plugin's own ports.json
--opencode-dir <dir>     OpenCode config dir (default: ~/.config/opencode)
--out <dir>              install root (default: <opencode-dir>/skills/<name>)
--rules-file <m>         auto (default) | agents | claude
--permissions <file>     permission fragment carried by the plugin
--ask-mode <m>           soft | pass
--no-guard               do not generate the plugin (hooks, mcp and permissions are then not ported)
--write-config           also merge mcp + permission rules into opencode.json
```

## The plugin's own settings, and the engine

A plugin can state once what its ports need, in a `ports.json` at its root (`internalPrefix`, `exclude`, `keepSkillNames`), and give a skill a text of its own for OpenCode (`SKILL.opencode.md` next to `SKILL.md`). Both are documented in the engine, [`claude-plugin-port`](https://www.npmjs.com/package/claude-plugin-port), along with the full table of what gets rewritten, the library API (`convertFiles`, `buildBundle`) and the limitations. This command is that engine with the host set to OpenCode.

Tested with OpenCode 1.18.30.

## License

MIT © 2026 Flavien Chervet
