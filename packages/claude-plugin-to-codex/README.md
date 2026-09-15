# claude-plugin-to-codex

Port a [Claude Code](https://docs.anthropic.com/en/docs/claude-code) plugin to **OpenAI Codex**, as a plugin, not as a pile of copied skills.

A Claude Code plugin is a directory with `.claude-plugin/plugin.json`, `skills/`, and often `scripts/`, `templates/`, `hooks/` and `.mcp.json`. Codex reads the same `SKILL.md` format, but knows nothing of Claude Code's path anchors, its rules file, its tool names or its hook wiring. This command rewrites exactly those, and nothing else.

```bash
# builds ~/plugins/<name>, registers it in your personal marketplace,
# validates it, installs it with `codex plugin add`
npx claude-plugin-to-codex --source ./my-plugin

# portable bundle: a folder that installs by being unzipped in your home folder
npx claude-plugin-to-codex --source ./my-plugin --bundle ./out

npx claude-plugin-to-codex --source ./my-plugin --dry-run   # preview, writes nothing
```

Idempotent: re-run it after each plugin update. Zero dependencies beyond its engine, Node 18+. For OpenCode, use [`claude-plugin-to-opencode`](https://www.npmjs.com/package/claude-plugin-to-opencode).

## What you get

Builds `~/plugins/<name>/`:

- `.codex-plugin/plugin.json`: translated manifest with the `interface` block Codex requires; the version gets a `+codex.local-<timestamp>` suffix so a rebuild is seen as an update.
- `skills/`: every `SKILL.md` with its path anchors rewritten to the install path, only the frontmatter keys Codex's skill validator accepts (`name`, `description`, `license`, `metadata`), skill names Codex accepts (a leading `_` becomes the internal prefix, `<plugin name>-` by default, and every mention follows), `AskUserQuestion` mapped to a direct question, the words "Claude Code" replaced by "Codex" (`--no-rebrand` to keep them).
- `scripts/`, `templates/`, `.mcp.json`: scripts get the same anchor and rules-file rewrites; templates stay byte for byte; MCP servers are carried by the plugin.
- `CLAUDE.md` becomes `AGENTS.md`, `~/.claude/CLAUDE.md` becomes `~/.codex/AGENTS.md`, in skills and scripts alike.
- `hooks/`: **verbatim**. Codex runs a plugin's `hooks/hooks.json` natively, sets `CLAUDE_PLUGIN_ROOT` for the hook commands, and speaks the same stdin/stdout JSON as Claude Code. `permissionDecision: "deny"` blocks the call; `"ask"` is parsed but not supported by Codex yet, so it falls back to Codex's own approval policy. The manifest deliberately carries no `hooks` key: Codex's validator rejects it, and the default location is discovered without it.
- Registers the plugin in `~/.agents/plugins/marketplace.json` (created if missing), runs the official `validate_plugin.py` when the plugin-creator skill is installed, then `codex plugin add <name>@personal`.

On first use Codex asks you to review and trust each hook (it records the hash). A shell-heavy plugin needs Codex to run with trusted or full access, or the sandbox blocks its commands. Start a new Codex thread after installing.

A plugin with more than about forty skills hits Codex's 2% skill-catalog budget: `--short-descriptions` keeps the first sentence of each description.

## Bundles

`--bundle <dir>` writes a **portable** layout instead of installing: anchors are `$HOME`-relative (bash and PowerShell both expand it), and unzipping the folder in the home folder installs the plugin, with no command to type. It contains `plugins/<name>/` (the plugin) and `.agents/plugins/marketplace.json` (a personal marketplace listing it; keep yours and add the entry if you already have one). Then install it from Codex's plugin browser, or `codex plugin add <name>@personal`.

Every bundle carries a standalone installer, `plugins/<name>/.claude-plugin-to-codex.install.mjs`, so an installed plugin can update itself from a newer bundle with nothing but Node:

```bash
node <unpacked>/plugins/<name>/.claude-plugin-to-codex.install.mjs --from <unpacked>
```

It moves the installed copy to `~/.claude-plugin-to-codex/backups/` (outside the folders Codex scans), puts the new copy in its place, brings the old one back if any step fails, keeps the plugin's marketplace entry in step without touching the others, then runs `codex plugin add` so Codex's cache follows (`--no-refresh` to skip).

## Flags

```
--source <dir>           Claude plugin root (default: cwd if it has .claude-plugin/plugin.json)
--bundle <dir>           portable bundle instead of an install
--dry-run                preview, no writes / no install
--short-descriptions     keep the first sentence of each skill description
--no-rebrand             keep the words "Claude Code" in skill texts
--internal-prefix <p>    what a leading "_" in a skill name becomes (default: ports.json, else "<plugin name>-")
--keep-skill-names       keep names such as "_helper" as they are
--exclude-skill <name>   leave a skill out of the port (repeatable, or comma-separated)
--ports <file>           port settings to use instead of the plugin's own ports.json
--plugins-dir <dir>      where to install (default: ~/plugins) - keep aligned with the marketplace
--marketplace <name>     marketplace name for a NEW file (default: personal)
--marketplace-file <p>   default: ~/.agents/plugins/marketplace.json
--category <c>           interface category (default: Engineering)
--default-prompt <s>     starter prompt (repeatable, max 3 used)
--no-validate            skip validate_plugin.py
--no-install             build + register, but skip `codex plugin add`
```

## The plugin's own settings, and the engine

A plugin can state once what its ports need, in a `ports.json` at its root (`internalPrefix`, `exclude`, `keepSkillNames`), and give a skill a text of its own for Codex (`SKILL.codex.md` next to `SKILL.md`). Both are documented in the engine, [`claude-plugin-port`](https://www.npmjs.com/package/claude-plugin-port), along with the full table of what gets rewritten, the library API (`convertFiles`, `buildBundle`) and the limitations. This command is that engine with the host set to Codex.

Tested with Codex CLI 0.154.

## License

MIT © 2026 Flavien Chervet
