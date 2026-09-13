// Minimal Claude Code PreToolUse hook, in the shape the converter must honour.
let raw = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (c) => (raw += c));
process.stdin.on("end", () => {
  const payload = JSON.parse(raw || "{}");
  const command = payload?.tool_input?.command ?? "";
  const reply = (permissionDecision, permissionDecisionReason) =>
    process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision, permissionDecisionReason } }));
  if (/rm\s+-rf\s+\//.test(command)) reply("deny", `Refused: ${command} (root=${process.env.CLAUDE_PLUGIN_ROOT ? "set" : "unset"})`);
  else if (/^git\s+push\b/.test(command)) reply("ask", "A push publishes.");
  process.exit(0);
});
