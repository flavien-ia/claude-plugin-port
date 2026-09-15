---
name: hello
description: Say hello: politely, in the user's language. Use when the user greets you or asks for a greeting. A second sentence that should disappear with --short-descriptions.
user-invocable: true
allowed-tools: Bash, Read, AskUserQuestion
argument-hint: [name]
compatibility: "Agent Skills standard (Claude Code or Codex). Requires Node.js 18+."
---

# Hello

Run the helper from Claude Code:

```bash
node "${CLAUDE_SKILL_DIR}/../../scripts/hello.mjs" --template "${CLAUDE_PLUGIN_ROOT}/templates/note.txt"
cat "${CLAUDE_SKILL_DIR}/README.md"
node "$CLAUDE_SKILL_DIR/../../scripts/hello.mjs" --help
```

If the name is unknown, use `AskUserQuestion` with two options. Then note the
greeting in the project CLAUDE.md and the global ~/.claude/CLAUDE.md.

Delegate the rest to `_internal` (its instructions: `${CLAUDE_SKILL_DIR}/../_internal/SKILL.md`).
Never confuse it with `_internal-notes` or my_internal.
