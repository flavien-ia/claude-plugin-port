# claude-plugin-port

The engine that ports a [Claude Code](https://docs.anthropic.com/en/docs/claude-code) plugin to another host, as a plugin, not as a pile of copied skills. It has one command per host, published on its own:

```bash
npx claude-plugin-to-codex --source ./my-plugin       # OpenAI Codex
npx claude-plugin-to-opencode --source ./my-plugin    # OpenCode
```

Each command speaks its host only: its help, its flags, its README ([Codex](packages/claude-plugin-to-codex/README.md), [OpenCode](packages/claude-plugin-to-opencode/README.md)). This package is what they share: the conversion, the bundles, the installer, the library API, and a generic command for scripts that serve both hosts:

```bash
npx claude-plugin-port --source ./my-plugin --target codex|opencode [--bundle <dir>] [--dry-run]
```

A Claude Code plugin is a directory with `.claude-plugin/plugin.json`, `skills/`, and often `scripts/`, `templates/`, `hooks/` and `.mcp.json`. Codex and OpenCode both read the same `SKILL.md` format, but neither knows Claude Code's path anchors, its rules file, its tool names or its hook wiring. The engine rewrites exactly those, and nothing else. Idempotent, zero dependencies, Node 18+.

## What gets rewritten

| In the plugin | Why | Codex | OpenCode |
|---|---|---|---|
| `${CLAUDE_SKILL_DIR}`, `${CLAUDE_PLUGIN_ROOT}` in skills and scripts, braced or bare (`$CLAUDE_SKILL_DIR`) | both hosts run skill commands with `cwd` = the user's project and no plugin variable | install path | install path |
| a hand-typed `~/.claude/plugins/marketplaces/<x>/<name>` | same anchor, fragile form; reported as a warning | install path | install path |
| `CLAUDE.md` in skills and scripts, `~/.claude/CLAUDE.md` and `path.join(homedir, ".claude", "CLAUDE.md")` | the host's rules file | `AGENTS.md`, `~/.codex/AGENTS.md` | `AGENTS.md`, `~/.config/opencode/AGENTS.md`, or kept as `CLAUDE.md` (see the OpenCode README) |
| frontmatter keys other than `name`, `description`, `license`, `metadata` (`user-invocable`, `allowed-tools`, `argument-hint`, `compatibility`...) | Codex's skill validator accepts only those, and `compatibility` describes Claude Code | dropped | dropped |
| skill names outside lowercase letters, digits and single hyphens (typically `_helper`) | the naming rule of both hosts | renamed, every mention rewritten | renamed, every mention rewritten |
| unquoted frontmatter scalars with `: ` etc. | strict YAML parsers | quoted | quoted |
| `AskUserQuestion` | a Claude Code tool | "a direct question to the user" | "the `question` tool" |
| the words "Claude Code" in skill texts | the model should not be told it runs somewhere else (`--no-rebrand` to keep) | "Codex" | "OpenCode" |
| skill descriptions (`--short-descriptions`) | Codex budgets its skill catalog to 2% of the context and shortens past that | first sentence | first sentence |

The install path is absolute for a local install and `$HOME/<path>` in a bundle (bash and PowerShell both expand it inside double quotes). `templates/` is project payload and stays byte for byte, apart from the names of renamed skills. `hooks/` is carried verbatim: Codex runs `hooks/hooks.json` natively; on OpenCode a generated plugin runs the same PreToolUse hook commands.

### Skill names

Codex's skill validator and OpenCode's documentation both ask for names made of lowercase letters, digits and single hyphens. A leading `_`, the usual mark of an internal helper in a Claude Code plugin, becomes the internal prefix, `<plugin name>-` by default: `_helper` becomes `my-plugin-helper`. The folder, the `name:` line and every mention of the skill follow (paths, `plugin:skill` references, `/commands`, templates, scripts), matched as whole names only, so `_helper` is never rewritten inside `_helper-extra`. A rename that would collide with another skill stops the conversion.

`--internal-prefix hv` gives `hv-helper`. `--keep-skill-names` keeps the names as they are: both loaders accept them today, only the validators refuse them.

## The plugin's own settings: `ports.json`

A plugin can state once what each of its ports needs, in a `ports.json` at its root. Claude Code ignores the file, and it does not ship in the port.

```json
{
  "internalPrefix": "hv-",
  "exclude": { "opencode": ["add-routine", "_create-routine"] }
}
```

- `internalPrefix`: what a leading `_` becomes (see above).
- `exclude`: skills left out of the port, as one list for every target or as lists keyed by target. For a skill built on something the host does not have. Mentions of it left in other skills are reported, so their wording can say what to do when the skill is absent.
- `keepSkillNames`: `true` keeps the original names.

Command-line flags win over the file: `--internal-prefix`, `--keep-skill-names`, `--exclude-skill <name>` (added to the file's list, repeatable) and `--ports <file>` (another settings file).

### A text per host

When a skill works differently on one host, give it a variant next to its `SKILL.md`: `SKILL.codex.md` replaces `SKILL.md` in the Codex port, `SKILL.opencode.md` in the OpenCode port. Any `<file>.codex.md` or `<file>.opencode.md` inside a skill folder works the same way. The variant goes through the same rewrites, and no variant file ships in any port. Claude Code reads `SKILL.md` only.

## Bundles

`--bundle <dir>` writes a **portable** layout instead of installing: anchors are `$HOME`-relative, and unzipping the folder in one known place installs the plugin, with no command to type.

| Target | Unzip into | Contents |
|---|---|---|
| codex | the home folder | `plugins/<name>/` (the plugin) and `.agents/plugins/marketplace.json` (a personal marketplace listing it; keep yours and add the entry if you already have one). Then install it from Codex's plugin browser, or `codex plugin add <name>@personal`. |
| opencode | `~/.config/opencode` | `skills/<name>/` (the plugin) and `plugins/<name>-guard.js` (hooks, MCP servers and permission rules, root resolved from the home folder when it loads). Start a new session. |

Bundles use `AGENTS.md` and `--ask-mode pass` when a permission fragment exists.

### Updating from a newer bundle

Every bundle carries a standalone installer at the root of its plugin folder, `.claude-plugin-to-codex.install.mjs`, so a converted plugin can update itself from inside the host with nothing but Node. Unpack the newer bundle anywhere, then run the installer it contains:

```bash
node <unpacked>/plugins/<name>/.claude-plugin-to-codex.install.mjs --from <unpacked>    # Codex
node <unpacked>/skills/<name>/.claude-plugin-to-codex.install.mjs --from <unpacked>     # OpenCode
```

It moves the installed copy to `~/.claude-plugin-to-codex/backups/` (outside the folders the host scans, so the old skills are never loaded twice; the last three are kept), puts the new copy in its place, and brings the old one back if any step fails. On Codex it keeps the plugin's entry in `~/.agents/plugins/marketplace.json` without touching the other entries, then runs `codex plugin add <name>@<marketplace>` so Codex's cache follows (`--no-refresh` to skip). On OpenCode it replaces the generated plugin along with the skills. It prints one JSON line; start a new thread or session afterwards. A plugin's own update command can do the same: download the bundle, unpack it, run the installer.

The marker each port carries (`.claude-plugin-to-codex.json`, with `target`, `sourceVersion` and `generator`), the installer's file name and the backups folder keep the engine's historical name: installed ports and update flows rely on them.

## As a library

```js
import { convertFiles, describeSource } from "claude-plugin-port/convert";
import { buildBundle } from "claude-plugin-port/bundle";

// files: [{ path: "skills/x/SKILL.md", content: "..." }, ...], plugin-root-relative
const { files, warnings, renamedSkills, excludedSkills } = buildBundle(files, { target: "opencode", generator: "my-site" });
// zip `files` yourself (JSZip, archiver...). Binary contents pass through untouched.
```

No disk, no environment lookups: a web server can convert an archive on download. `ports.json` is read from the files; the options `internalPrefix`, `keepSkillNames`, `excludeSkills` and `ports` (an object, or `null` to ignore the file) do what the flags do. `claude-plugin-port/cli` exposes `main(argv, { host, program })`, which the two commands call with their host set.

## Limitations

- Skills that spell out Claude Code specifics beyond what is rewritten (settings files, slash-command menus) keep saying them; read the port once, and write a host variant where the difference matters.
- A skill name assembled at run time (`"_" + name`) is not seen by the rename.
- Hooks other than PreToolUse are carried to Codex (which runs them) but not to OpenCode.
- OpenCode's permission patterns are wildcards on the parsed command, less precise than a hook's regexes: the fragment mirrors, the hook decides.
- Both hosts move fast. Tested with Codex CLI 0.154 and OpenCode 1.18.30.

## Development

```bash
node --test test/converter.test.mjs
```

The repository holds the engine at its root and the two commands under `packages/`; each command is a few lines that call the engine with its host set. Releases publish the three packages together, the commands pinned to the engine's minor version.

## License

MIT © 2026 Flavien Chervet
