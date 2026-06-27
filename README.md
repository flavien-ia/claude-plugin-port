# claude-plugin-to-codex

Convert a **Claude Code plugin** into a native **OpenAI Codex plugin** - not just copy its skills.

Codex adopted the open `SKILL.md` standard, so standalone skills mostly carry over on their own. But a real **plugin** (a `.claude-plugin/plugin.json` with shared `scripts/`, a marketplace, internal helper skills) does **not** - and the existing community tools stop at copying loose skill files. This tool does the **plugin-level** work that nothing else does:

- translates `.claude-plugin/plugin.json` → Codex `.codex-plugin/plugin.json` (with the required `interface` / `defaultPrompt` block, dropping the unsupported `hooks` field)
- registers the plugin in your Codex personal marketplace (`~/.agents/plugins/marketplace.json`) and runs `codex plugin add`
- rewrites the bundled-shared-scripts anchor `${CLAUDE_SKILL_DIR}/../../scripts/…` to an **absolute path** - Codex runs skill commands with cwd = your project and exposes **no** skill/plugin-dir env var, so a relative anchor cannot work
- `CLAUDE.md` → `AGENTS.md`
- normalizes `SKILL.md` frontmatter for Codex's strict YAML parser (e.g. an unquoted `description:` containing `": "`, which Codex rejects but Claude Code tolerates)
- strips the non-spec `user-invocable:` field; keeps `_`-prefixed internal skill names (Codex's loader tolerates them)

## Usage

```bash
# point it at a downloaded/cloned Claude Code plugin (a dir with .claude-plugin/plugin.json)
npx claude-plugin-to-codex --source /path/to/the/plugin

# or, from a clone of this repo:
node bin/claude-plugin-to-codex.mjs --source /path/to/the/plugin
```

Then **start a new Codex thread** so it picks up the plugin's skills and MCP servers.

### Flags

| Flag | Effect |
|---|---|
| `--source <dir>` | the Claude Code plugin root (default: cwd if it has `.claude-plugin/`) |
| `--dry-run` | preview, no writes, no install |
| `--no-install` | build + register, but skip `codex plugin add` |
| `--no-validate` | skip the official `validate_plugin.py` check |
| `--default-prompt <s>` | a starter prompt for the Codex UI (repeatable, max 3 used) |
| `--category <c>` | plugin category (default: `Engineering`) |
| `--plugins-dir <dir>` | where to build (default: `~/plugins`) |
| `--help` | full help |

## How it works

It builds the Codex plugin at `~/plugins/<name>/`, upserts an entry in the personal marketplace, validates it, and installs it. Each run stamps a version cachebuster so re-running is an idempotent rebuild + reinstall - handy while iterating on the source plugin.

## Limitations

- **Shell-heavy plugins**: run Codex with trusted / full access, or its sandbox may block the plugin's commands.
- The generated Codex build bakes **absolute paths for your machine**, so it is produced locally per machine and is not a committable artifact - which is exactly why this conversion must run on each user's machine rather than ship prebuilt.
- The Codex ecosystem moves fast; OpenAI could ship a first-party plugin importer that supersedes this.

## License

MIT © 2026 Flavien Chervet
