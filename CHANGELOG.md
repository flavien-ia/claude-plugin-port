# Changelog

## 0.4.0 - 2026-09-15

- Skill names: a name outside lowercase letters, digits and single hyphens is renamed to what Codex's skill validator and OpenCode ask for. A leading `_` becomes the internal prefix (`<plugin name>-` by default, `--internal-prefix` to choose), and every mention of the skill follows: folder, `name:` line, paths, `plugin:skill` references, commands, templates and scripts, matched as whole names only. A rename that would collide with another skill stops the conversion. `--keep-skill-names` keeps the names as they are.
- Frontmatter: a ported `SKILL.md` keeps only `name`, `description`, `license` and `metadata`, the keys Codex's skill validator accepts. `compatibility` goes with the Claude Code keys: it describes Claude Code, and rebranding it produced "Codex or Codex". Any unexpected key is dropped with a warning.
- Anchors: the bare forms `$CLAUDE_SKILL_DIR` and `$CLAUDE_PLUGIN_ROOT` are rewritten like the braced ones, and reported when left over.
- `ports.json` at the plugin root states what every port needs: `internalPrefix`, `exclude` (one list, or lists keyed by target) and `keepSkillNames`. It does not ship in the port. On the command line, `--exclude-skill` adds to its list and `--ports` points to another file; in the API, `excludeSkills` and `ports` do the same. Mentions of an excluded skill left in other files are reported.
- Host variants: `SKILL.codex.md` or `SKILL.opencode.md` next to a `SKILL.md` replaces it in that host's port (any `<file>.<host>.md` in a skill folder), and no variant file ships.
- Bundles carry `.claude-plugin-to-codex.install.mjs`, a standalone installer that updates the plugin from an unpacked newer bundle: backup outside the folders the host scans, swap with rollback, Codex marketplace entry kept in step with the other entries untouched, `codex plugin add` to refresh Codex's cache, OpenCode's generated plugin replaced along with the skills.
- The marker file records `renamedSkills` and `excludedSkills` (and `installer` in bundles); `convertFiles()` and `buildBundle()` return them with `skillCount`.

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
