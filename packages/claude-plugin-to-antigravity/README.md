# claude-plugin-to-antigravity

Port a [Claude Code](https://docs.anthropic.com/en/docs/claude-code) plugin to **Google Antigravity**, as a native Antigravity plugin, not as a pile of copied skills.

A Claude Code plugin is a directory with `.claude-plugin/plugin.json`, `skills/`, and often `scripts/`, `templates/`, `hooks/` and `.mcp.json`. Antigravity has a plugin format of its own, close to Claude Code's: a folder with `plugin.json`, `skills/`, `hooks.json` and `mcp_config.json`. It reads the same `SKILL.md` format, but knows nothing of Claude Code's path anchors, its rules file, its tool names or its hook payloads. This command rewrites exactly those.

```bash
# installs under ~/.gemini/config/plugins/<name>, where the desktop app
# and the agy CLI both discover it at startup
npx claude-plugin-to-antigravity --source ./my-plugin

# portable bundle: a folder that installs by being unzipped in ~/.gemini/config
npx claude-plugin-to-antigravity --source ./my-plugin --bundle ./out

npx claude-plugin-to-antigravity --source ./my-plugin --dry-run   # preview, writes nothing
```

Then quit Antigravity completely and open it again: it discovers a new plugin folder only at startup. Idempotent: re-run it after each plugin update. Zero dependencies beyond its engine, Node 18+. For OpenAI Codex, use [`claude-plugin-to-codex`](https://www.npmjs.com/package/claude-plugin-to-codex); for OpenCode, [`claude-plugin-to-opencode`](https://www.npmjs.com/package/claude-plugin-to-opencode).

## What you get

`~/.gemini/config/plugins/<name>/`:

- `plugin.json`: the fields Antigravity reads (`name`, `displayName`, `version`, `description`, and `suggestedPrompts` from `--default-prompt`, three at most).
- `skills/`: every `SKILL.md` with its path anchors rewritten to the install path (Antigravity gives a skill no variable for its own folder), only the frontmatter keys every host reads, skill names Antigravity accepts (lowercase and hyphenated: a leading `_` becomes the internal prefix, `<plugin name>-` by default, and every mention follows), `AskUserQuestion` mapped to the `ask_question` tool, `CLAUDE.md` rewritten to `AGENTS.md` (Antigravity never reads `CLAUDE.md`), and the words "Claude Code" replaced by "Antigravity" (`--no-rebrand` to keep them). Every skill also answers to `/<skill-name>`.
- `scripts/`, `templates/`, `hooks/`: scripts get the same anchor and rules-file rewrites; templates stay byte for byte.
- `mcp_config.json`: the plugin's MCP servers (a remote server becomes a `serverUrl` entry). Antigravity names them `<plugin>_<server>`.
- `hooks.json` and `hooks/antigravity-guard.mjs`: see below.

The files nothing reads there (`.mcp.json`, `hooks/hooks.json`) stay out of the port. `.claude-plugin/plugin.json` stays: a plugin's scripts may read their own name or version in it, and Antigravity ignores the folder.

### The guardrail hooks

The Claude Code `PreToolUse` command hooks become one Antigravity hook on the matching tools (`Bash` is `run_command`, `Read` is `view_file`, `Write` is `write_to_file`; Claude-only tools such as `Monitor` are left out). Its adapter translates Antigravity's payload into the one Claude Code feeds its hooks, runs your hook commands unchanged, with `CLAUDE_PLUGIN_ROOT` set, and answers in Antigravity's terms:

- `deny` blocks the command, and the model reads the reason;
- `ask` opens Antigravity's own permission dialog, showing the hook's reason;
- no opinion prints nothing at all (Antigravity reads an empty `{}` as a refusal).

Verified on Windows with the Antigravity desktop app and the `agy` CLI 1.2.17: the hooks run in both, and a `deny` holds even under `agy --dangerously-skip-permissions`.

### Updating in place

A running Antigravity holds its plugin folders open, and Windows then refuses to move or delete them. So an update never recreates the folder: new files are written, files gone from the new version are removed. A bundle's own installer (`.claude-plugin-to-codex.install.mjs`) copies the previous version to `~/.claude-plugin-to-codex/backups/` first, and copies it back if a step fails.

## Flags

```
Common flags:
  --source <dir>           Claude plugin root (default: cwd if it has .claude-plugin/plugin.json)
  --bundle <dir>           portable bundle with $HOME-relative anchors, to unzip in ~/.gemini/config
  --dry-run                preview, no writes
  --short-descriptions     keep the first sentence of each skill description
  --no-rebrand             keep the words "Claude Code" in skill texts
  --internal-prefix <p>    what a leading "_" in a skill name becomes
  --keep-skill-names       keep names such as "_helper" as they are
  --exclude-skill <name>   leave a skill out of the port (repeatable, or comma-separated)
  --ports <file>           port settings to use instead of the plugin's own ports.json

Antigravity:
  --plugins-dir <dir>      where to install (default: ~/.gemini/config/plugins)
  --default-prompt <s>     suggested prompt shown on the plugin card (repeatable, max 3 used)
  --no-validate            skip the plugin check
```

A plugin can state its port settings once in a `ports.json` at its root (internal prefix, skills left out per target, `"antigravity": [...]` included); a skill can carry its own text for this host in `SKILL.antigravity.md`. See the [engine's README](https://github.com/flavien-ia/claude-plugin-port#readme).

## License

MIT
