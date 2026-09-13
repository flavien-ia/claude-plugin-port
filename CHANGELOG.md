# Changelog

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
