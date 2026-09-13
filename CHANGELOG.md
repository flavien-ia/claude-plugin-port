# Changelog

## 0.3.0 - 2026-09-13

- Portable bundles (`--bundle <dir>`, and `buildBundle()` for servers): the converted plugin laid out so that unzipping it in one known folder installs it. Anchors are written as `$HOME/<path>`, which bash and PowerShell both expand. Codex: unzip in the home folder (`plugins/<name>/` + `.agents/plugins/marketplace.json`). OpenCode: unzip in `~/.config/opencode` (`skills/<name>/` + `plugins/<name>-guard.js`).
- In-memory API: `convertFiles()`, `describeSource()`, `codexManifest()`, `mcpFromClaude()` in `claude-plugin-to-codex/convert`; `buildBundle()` in `claude-plugin-to-codex/bundle`. No disk, no environment: a web server can convert an archive on download.
- OpenCode: the generated plugin now carries the MCP servers and permission rules into OpenCode's configuration through its `config` hook when it loads. `opencode.json` is left alone by default; `--write-config` also merges them into the file.
- OpenCode: the plugin resolves its root from the home folder in bundles, from a baked path in local installs.

## 0.2.0 - 2026-09-13

- New target: OpenCode (`--target opencode`, or the `claude-plugin-to-opencode` bin). Installs the plugin under `~/.config/opencode/skills/<name>/`, generates a guard plugin that runs the Claude Code PreToolUse hooks, merges MCP servers and an optional permission fragment (`hooks/opencode.permission.json`) into `opencode.json`, and picks the rules file (`--rules-file auto|agents|claude`).
- Codex: `hooks/` is now carried verbatim. Codex runs a plugin's `hooks/hooks.json` natively and sets `CLAUDE_PLUGIN_ROOT`; `deny` works, `ask` is not supported by Codex yet.
- Rules-file paths are rewritten in scripts too (`path.join(homedir, ".claude", "CLAUDE.md")`, `~/.claude/CLAUDE.md`), not only in skill texts.
- Frontmatter: `allowed-tools` and `argument-hint` are dropped along with `user-invocable`.
- `--short-descriptions` keeps the first sentence of each skill description (Codex budgets its catalog to 2% of the context).
- `AskUserQuestion` is mapped to the host's way of asking; "Claude Code" becomes the host's name in skill texts (`--no-rebrand` to keep).
- A hand-typed `~/.claude/plugins/marketplaces/<x>/<name>` path is rewritten like an anchor, with a warning.
- Codex install: finds the CLI binary when it is not on PATH (Windows app), reinstalls when the plugin is already present.
- Tests (`node --test`), fixture plugin, split into `lib/` modules.

## 0.1.1 - 2026-06-28

- Rewrite `${CLAUDE_PLUGIN_ROOT}`, guard string `defaultPrompt`, transform text assets.

## 0.1.0 - 2026-06-27

- First release: convert a Claude Code plugin into a native Codex plugin.
