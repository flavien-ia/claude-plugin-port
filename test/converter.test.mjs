import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { pathToFileURL, fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const BIN = path.join(here, "..", "bin", "claude-plugin-to-codex.mjs");
const FIXTURE = path.join(here, "fixtures", "demo-plugin");
const fwd = (p) => p.replace(/\\/g, "/");

function run(args) {
  return execFileSync(process.execPath, [BIN, ...args], { encoding: "utf8" });
}
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "cp2c-"));
const read = (...p) => fs.readFileSync(path.join(...p), "utf8");

// ------------------------------------------------------------------ codex

test("codex: builds a validator-shaped plugin with hooks carried verbatim", () => {
  const t = tmp();
  const out = run(["--source", FIXTURE, "--target", "codex", "--plugins-dir", t, "--marketplace-file", path.join(t, "mk.json"), "--no-install", "--no-validate"]);
  const root = path.join(t, "demo-plugin");
  const manifest = JSON.parse(read(root, ".codex-plugin", "plugin.json"));
  assert.equal(manifest.name, "demo-plugin");
  assert.match(manifest.version, /^1\.2\.3\+codex\.local-\d{14}$/);
  assert.equal(manifest.skills, "./skills/");
  assert.equal(manifest.mcpServers, "./.mcp.json");
  assert.equal(manifest.license, "MIT");
  assert.ok(!("hooks" in manifest), "the hooks key is rejected by Codex's validator; discovery is by default location");
  assert.deepEqual(manifest.interface.defaultPrompt, ["Use the Demo Plugin plugin"]);

  const hooks = read(root, "hooks", "hooks.json");
  assert.equal(hooks, read(FIXTURE, "hooks", "hooks.json"), "hooks.json is byte-identical: Codex provides ${CLAUDE_PLUGIN_ROOT}");
  assert.ok(fs.existsSync(path.join(root, "hooks", "guard.mjs")));

  const skill = read(root, "skills", "hello", "SKILL.md");
  const r = fwd(root);
  assert.ok(skill.includes(`node "${r}/scripts/hello.mjs" --template "${r}/templates/note.txt"`), "anchors become absolute install paths");
  assert.ok(skill.includes(`cat "${r}/skills/hello/README.md"`));
  assert.ok(!skill.includes("${CLAUDE_"), "no residual anchor");
  assert.ok(!/^user-invocable:|^allowed-tools:|^argument-hint:/m.test(skill), "Claude-only frontmatter keys are dropped");
  assert.match(skill, /^description: "Say hello: politely, .*"$/m, "colon inside the description gets quoted for strict YAML");
  assert.ok(skill.includes("Run the helper from Codex:"), "rebranded");
  assert.ok(skill.includes("use a direct question to the user with two options"), "AskUserQuestion mapped");
  assert.ok(skill.includes("project AGENTS.md and the global ~/.codex/AGENTS.md"), "rules files mapped, global path included");
  assert.ok(!skill.includes("CLAUDE.md"));

  const script = read(root, "scripts", "hello.mjs");
  assert.ok(script.includes(`path.join(process.cwd(), "AGENTS.md")`));
  assert.ok(script.includes(`path.join(os.homedir(), ".codex", "AGENTS.md")`), "segment-built global path rewritten");
  assert.equal(read(root, "templates", "note.txt"), read(FIXTURE, "templates", "note.txt"), "templates stay verbatim");
  assert.equal(read(root, ".mcp.json"), read(FIXTURE, ".mcp.json"));

  const mk = JSON.parse(read(t, "mk.json"));
  assert.equal(mk.plugins[0].name, "demo-plugin");
  assert.equal(mk.plugins[0].source.path, "./plugins/demo-plugin");
  assert.match(out, /No warnings\./);
});

test("codex: --short-descriptions keeps the first sentence, --no-rebrand keeps Claude Code", () => {
  const t = tmp();
  run(["--source", FIXTURE, "--plugins-dir", t, "--marketplace-file", path.join(t, "mk.json"), "--no-install", "--no-validate", "--short-descriptions", "--no-rebrand"]);
  const skill = read(t, "demo-plugin", "skills", "hello", "SKILL.md");
  assert.match(skill, /^description: "Say hello: politely, in the user's language\."$/m);
  assert.ok(skill.includes("Run the helper from Claude Code:"));
  const internal = read(t, "demo-plugin", "skills", "_internal", "SKILL.md");
  assert.match(internal, /^name: _internal$/m, "underscore names are kept");
  assert.ok(!/^user-invocable/m.test(internal));
});

test("codex: dry-run writes nothing", () => {
  const t = tmp();
  const out = run(["--source", FIXTURE, "--plugins-dir", t, "--marketplace-file", path.join(t, "mk.json"), "--dry-run"]);
  assert.ok(!fs.existsSync(path.join(t, "demo-plugin")));
  assert.ok(!fs.existsSync(path.join(t, "mk.json")));
  assert.match(out, /DRY-RUN/);
});

// --------------------------------------------------------------- opencode

test("opencode: install tree, guard plugin, config merge (mcp + permission fragment)", async () => {
  const t = tmp();
  const cfgDir = path.join(t, "oc");
  fs.mkdirSync(cfgDir, { recursive: true });
  fs.writeFileSync(path.join(cfgDir, "opencode.json"), JSON.stringify({ $schema: "https://opencode.ai/config.json", model: "openai/gpt-x", permission: { bash: "allow" } }, null, 2));
  const out = run(["--source", FIXTURE, "--target", "opencode", "--opencode-dir", cfgDir, "--rules-file", "agents"]);
  const root = path.join(cfgDir, "skills", "demo-plugin");
  const r = fwd(root);

  const skill = read(root, "skills", "hello", "SKILL.md");
  assert.ok(skill.includes(`node "${r}/scripts/hello.mjs" --template "${r}/templates/note.txt"`));
  assert.ok(skill.includes("Run the helper from OpenCode:"));
  assert.ok(skill.includes("use the `question` tool with two options"));
  assert.ok(skill.includes("project AGENTS.md and the global ~/.config/opencode/AGENTS.md"));
  const script = read(root, "scripts", "hello.mjs");
  assert.ok(script.includes(`path.join(os.homedir(), ".config", "opencode", "AGENTS.md")`));
  assert.ok(fs.existsSync(path.join(root, "hooks", "guard.mjs")));

  const guardFile = path.join(cfgDir, "plugins", "demo-plugin-guard.js");
  assert.ok(fs.existsSync(guardFile), "guard plugin generated in <config>/plugins/");
  const guardSrc = read(guardFile);
  assert.ok(guardSrc.includes(`const ROOT = ${JSON.stringify(r)};`));
  assert.ok(guardSrc.includes('const ASK_MODE = "pass";'), "a permission fragment was merged, so ask is left to OpenCode");

  const cfg = JSON.parse(read(cfgDir, "opencode.json"));
  assert.equal(cfg.model, "openai/gpt-x", "user keys kept");
  assert.deepEqual(cfg.mcp.context7, { type: "remote", url: "https://mcp.context7.com/mcp", enabled: true });
  assert.deepEqual(cfg.mcp["local-tool"], { type: "local", command: ["npx", "-y", "some-mcp"], environment: { TOKEN: "x" }, enabled: true });
  assert.deepEqual(cfg.permission.bash, { "*": "allow", "git push*": "ask", "git push*--dry-run*": "allow" }, "string rule widened to an object, fragment appended after it");
  assert.ok(fs.readdirSync(cfgDir).some((f) => f.startsWith("opencode.json.bak-")), "backup written");

  // idempotent: a second run changes nothing in the config
  const before = read(cfgDir, "opencode.json");
  const out2 = run(["--source", FIXTURE, "--target", "opencode", "--opencode-dir", cfgDir, "--rules-file", "agents"]);
  assert.equal(read(cfgDir, "opencode.json"), before);
  assert.match(out2, /already up to date/);
  assert.match(out, /No warnings\./);

  // the generated plugin really runs the Claude hook and blocks on deny
  const { Guard } = await import(pathToFileURL(guardFile).href);
  const hooks = await Guard({ directory: t, project: {}, worktree: t });
  const call = (command) => hooks["tool.execute.before"]({ tool: "bash", sessionID: "s1", callID: "c1" }, { args: { command } });
  await call("ls -la"); // no decision: passes
  await assert.rejects(call("rm -rf /"), /\[demo-plugin\] Refused: rm -rf \/ \(root=set\)/);
  await call("git push origin main"); // ask, pass mode: the plugin lets OpenCode's permission rules decide
  await hooks["tool.execute.before"]({ tool: "read", sessionID: "s1", callID: "c2" }, { args: { filePath: "x" } }); // matcher Bash|Monitor: ignored
});

test("opencode: soft ask mode blocks once, then lets the identical command through", async () => {
  const t = tmp();
  const cfgDir = path.join(t, "oc");
  run(["--source", FIXTURE, "--target", "opencode", "--opencode-dir", cfgDir, "--rules-file", "agents", "--ask-mode", "soft", "--no-config"]);
  assert.ok(!fs.existsSync(path.join(cfgDir, "opencode.json")), "--no-config leaves the config alone");
  const { Guard } = await import(pathToFileURL(path.join(cfgDir, "plugins", "demo-plugin-guard.js")).href + "?soft");
  const hooks = await Guard({ directory: t, project: {}, worktree: t });
  const call = (sessionID, command) => hooks["tool.execute.before"]({ tool: "bash", sessionID, callID: "c" }, { args: { command } });
  await assert.rejects(call("s1", "git push"), /A push publishes\.[\s\S]*explicit confirmation/);
  await call("s1", "git push"); // second identical attempt in the same session passes
  await assert.rejects(call("s2", "git push"), /A push publishes/); // another session asks again
});

test("opencode: --rules-file claude keeps CLAUDE.md everywhere; a commented jsonc is not rewritten", () => {
  const t = tmp();
  const cfgDir = path.join(t, "oc");
  fs.mkdirSync(cfgDir, { recursive: true });
  fs.writeFileSync(path.join(cfgDir, "opencode.jsonc"), `{\n  // my comment\n  "model": "openai/gpt-x",\n}\n`);
  const out = run(["--source", FIXTURE, "--target", "opencode", "--opencode-dir", cfgDir, "--rules-file", "claude"]);
  const skill = read(cfgDir, "skills", "demo-plugin", "skills", "hello", "SKILL.md");
  assert.ok(skill.includes("project CLAUDE.md and the global ~/.claude/CLAUDE.md"));
  assert.ok(read(cfgDir, "skills", "demo-plugin", "scripts", "hello.mjs").includes(`".claude", "CLAUDE.md"`));
  assert.equal(read(cfgDir, "opencode.jsonc"), `{\n  // my comment\n  "model": "openai/gpt-x",\n}\n`, "the commented file is untouched");
  const sibling = JSON.parse(read(cfgDir, "opencode.json"));
  assert.ok(sibling.mcp.context7);
  assert.match(out, /has comments, so it was left as is/);
});

test("opencode: --out must not be the config dir", () => {
  const t = tmp();
  assert.throws(() => run(["--source", FIXTURE, "--target", "opencode", "--opencode-dir", t, "--out", t]), /folder of its own/);
});

// ------------------------------------------------- real plugin, when present

const HYPERVIBE = path.join(os.homedir(), ".claude", "plugins", "marketplaces", "local-desktop-app-uploads", "hypervibe");
test("hypervibe (local only): both targets build without warnings and the guard denies a sweeping stage", { skip: !fs.existsSync(HYPERVIBE) }, async () => {
  const t = tmp();
  const outCodex = run(["--source", HYPERVIBE, "--target", "codex", "--plugins-dir", t, "--marketplace-file", path.join(t, "mk.json"), "--no-install", "--no-validate"]);
  assert.match(outCodex, /No warnings\.|hard-coded plugin path rewritten/);
  assert.ok(!/residual/.test(outCodex), outCodex);
  const cfgDir = path.join(t, "oc");
  const outOc = run(["--source", HYPERVIBE, "--target", "opencode", "--opencode-dir", cfgDir, "--rules-file", "agents"]);
  assert.ok(!/residual/.test(outOc), outOc);
  const { Guard } = await import(pathToFileURL(path.join(cfgDir, "plugins", "hypervibe-guard.js")).href);
  const hooks = await Guard({ directory: t, project: {}, worktree: t });
  const call = (command) => hooks["tool.execute.before"]({ tool: "bash", sessionID: "s", callID: "c" }, { args: { command } });
  await assert.rejects(call("git add -A && git commit -m x"), /^Error: \[Hypervibe\] Sweeping stage refused/, "the hook's own signature is kept, not doubled");
  await assert.rejects(call("git push --no-verify"), /pre-push recette/);
  await call("git add src/index.ts"); // passes
});
