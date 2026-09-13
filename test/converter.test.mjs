import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { pathToFileURL, fileURLToPath } from "node:url";
import { convertFiles, describeSource } from "../lib/convert.mjs";
import { buildBundle } from "../lib/bundle.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const BIN = path.join(here, "..", "bin", "claude-plugin-to-codex.mjs");
const FIXTURE = path.join(here, "fixtures", "demo-plugin");
const fwd = (p) => p.replace(/\\/g, "/");

function run(args) {
  return execFileSync(process.execPath, [BIN, ...args], { encoding: "utf8" });
}
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "cp2c-"));
const read = (...p) => fs.readFileSync(path.join(...p), "utf8");
function fixtureFiles() {
  const out = [];
  const walk = (abs, rel) => {
    for (const ent of fs.readdirSync(abs, { withFileTypes: true })) {
      const a = path.join(abs, ent.name);
      const r = rel ? `${rel}/${ent.name}` : ent.name;
      if (ent.isDirectory()) walk(a, r); else out.push({ path: r, content: fs.readFileSync(a, "utf8") });
    }
  };
  walk(FIXTURE, "");
  return out;
}
async function loadGuard(file, tag = "") {
  const { Guard } = await import(pathToFileURL(file).href + (tag ? `?${tag}` : ""));
  return Guard({ directory: os.tmpdir(), project: {}, worktree: os.tmpdir() });
}

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

  assert.equal(read(root, "hooks", "hooks.json"), read(FIXTURE, "hooks", "hooks.json"), "hooks.json is byte-identical: Codex provides ${CLAUDE_PLUGIN_ROOT}");
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

test("opencode: install tree and a plugin that runs the hooks and injects mcp + permissions", async () => {
  const t = tmp();
  const cfgDir = path.join(t, "oc");
  fs.mkdirSync(cfgDir, { recursive: true });
  const userConfig = JSON.stringify({ $schema: "https://opencode.ai/config.json", model: "openai/gpt-x", permission: { bash: "allow" } }, null, 2);
  fs.writeFileSync(path.join(cfgDir, "opencode.json"), userConfig);
  const out = run(["--source", FIXTURE, "--target", "opencode", "--opencode-dir", cfgDir, "--rules-file", "agents"]);
  const root = path.join(cfgDir, "skills", "demo-plugin");
  const r = fwd(root);

  const skill = read(root, "skills", "hello", "SKILL.md");
  assert.ok(skill.includes(`node "${r}/scripts/hello.mjs" --template "${r}/templates/note.txt"`));
  assert.ok(skill.includes("Run the helper from OpenCode:"));
  assert.ok(skill.includes("use the `question` tool with two options"));
  assert.ok(skill.includes("project AGENTS.md and the global ~/.config/opencode/AGENTS.md"));
  assert.ok(read(root, "scripts", "hello.mjs").includes(`path.join(os.homedir(), ".config", "opencode", "AGENTS.md")`));
  assert.ok(fs.existsSync(path.join(root, "hooks", "guard.mjs")));
  assert.equal(read(cfgDir, "opencode.json"), userConfig, "opencode.json is left alone by default");

  const guardFile = path.join(cfgDir, "plugins", "demo-plugin-guard.js");
  const guardSrc = read(guardFile);
  assert.ok(guardSrc.includes(`const ROOT = ${JSON.stringify(r)};`));
  assert.ok(guardSrc.includes('const ASK_MODE = "pass";'), "a permission fragment exists, so ask is left to OpenCode");
  assert.match(out, /No warnings\./);

  const hooks = await loadGuard(guardFile);
  // config injection: mcp servers and permission rules added, user keys kept, bare string widened
  const cfg = { model: "openai/gpt-x", permission: { bash: "allow" }, mcp: { context7: { type: "remote", url: "https://mine" } } };
  await hooks.config(cfg);
  assert.equal(cfg.model, "openai/gpt-x");
  assert.deepEqual(cfg.mcp.context7, { type: "remote", url: "https://mine" }, "an existing server is never replaced");
  assert.deepEqual(cfg.mcp["local-tool"], { type: "local", command: ["npx", "-y", "some-mcp"], environment: { TOKEN: "x" }, enabled: true });
  assert.deepEqual(cfg.permission.bash, { "*": "allow", "git push*": "ask", "git push*--dry-run*": "allow" });
  // the plugin really runs the Claude hook and blocks on deny
  const call = (command) => hooks["tool.execute.before"]({ tool: "bash", sessionID: "s1", callID: "c1" }, { args: { command } });
  await call("ls -la");
  await assert.rejects(call("rm -rf /"), /\[demo-plugin\] Refused: rm -rf \/ \(root=set\)/);
  await call("git push origin main"); // ask, pass mode
  await hooks["tool.execute.before"]({ tool: "read", sessionID: "s1", callID: "c2" }, { args: { filePath: "x" } }); // matcher Bash|Monitor: ignored
});

test("opencode: --write-config merges into opencode.json too, idempotently", () => {
  const t = tmp();
  const cfgDir = path.join(t, "oc");
  fs.mkdirSync(cfgDir, { recursive: true });
  fs.writeFileSync(path.join(cfgDir, "opencode.jsonc"), `{\n  // my comment\n  "model": "openai/gpt-x",\n}\n`);
  const out = run(["--source", FIXTURE, "--target", "opencode", "--opencode-dir", cfgDir, "--rules-file", "agents", "--write-config"]);
  assert.equal(read(cfgDir, "opencode.jsonc"), `{\n  // my comment\n  "model": "openai/gpt-x",\n}\n`, "a commented file is untouched");
  const sibling = JSON.parse(read(cfgDir, "opencode.json"));
  assert.ok(sibling.mcp.context7);
  assert.deepEqual(sibling.permission.bash, { "git push*": "ask", "git push*--dry-run*": "allow" });
  assert.match(out, /has comments, so it was left as is/);
  const before = read(cfgDir, "opencode.json");
  run(["--source", FIXTURE, "--target", "opencode", "--opencode-dir", cfgDir, "--rules-file", "agents", "--write-config"]);
  assert.equal(read(cfgDir, "opencode.json"), before);
});

test("opencode: soft ask mode blocks once, then lets the identical command through", async () => {
  const t = tmp();
  const cfgDir = path.join(t, "oc");
  run(["--source", FIXTURE, "--target", "opencode", "--opencode-dir", cfgDir, "--rules-file", "agents", "--ask-mode", "soft"]);
  const hooks = await loadGuard(path.join(cfgDir, "plugins", "demo-plugin-guard.js"), "soft");
  const call = (sessionID, command) => hooks["tool.execute.before"]({ tool: "bash", sessionID, callID: "c" }, { args: { command } });
  await assert.rejects(call("s1", "git push"), /A push publishes\.[\s\S]*explicit confirmation/);
  await call("s1", "git push"); // second identical attempt in the same session passes
  await assert.rejects(call("s2", "git push"), /A push publishes/); // another session asks again
});

test("opencode: --rules-file claude keeps CLAUDE.md everywhere; --out must not be the config dir", () => {
  const t = tmp();
  const cfgDir = path.join(t, "oc");
  run(["--source", FIXTURE, "--target", "opencode", "--opencode-dir", cfgDir, "--rules-file", "claude"]);
  const skill = read(cfgDir, "skills", "demo-plugin", "skills", "hello", "SKILL.md");
  assert.ok(skill.includes("project CLAUDE.md and the global ~/.claude/CLAUDE.md"));
  assert.ok(read(cfgDir, "skills", "demo-plugin", "scripts", "hello.mjs").includes(`".claude", "CLAUDE.md"`));
  assert.throws(() => run(["--source", FIXTURE, "--target", "opencode", "--opencode-dir", t, "--out", t]), /folder of its own/);
});

// ---------------------------------------------------------------- bundles

test("bundle: portable layouts with $HOME anchors, for both hosts", async () => {
  const files = fixtureFiles();
  const codex = buildBundle(files, { target: "codex", generator: "test" });
  const paths = codex.files.map((f) => f.path);
  assert.ok(paths.includes("plugins/demo-plugin/.codex-plugin/plugin.json"));
  assert.ok(paths.includes("plugins/demo-plugin/hooks/hooks.json"));
  assert.ok(paths.includes(".agents/plugins/marketplace.json"));
  assert.equal(codex.unzipInto, "$HOME");
  const skill = codex.files.find((f) => f.path === "plugins/demo-plugin/skills/hello/SKILL.md").content;
  assert.ok(skill.includes('node "$HOME/plugins/demo-plugin/scripts/hello.mjs" --template "$HOME/plugins/demo-plugin/templates/note.txt"'), "anchors are $HOME-relative");
  assert.ok(skill.includes('cat "$HOME/plugins/demo-plugin/skills/hello/README.md"'));
  const mk = JSON.parse(codex.files.find((f) => f.path === ".agents/plugins/marketplace.json").content);
  assert.equal(mk.plugins[0].source.path, "./plugins/demo-plugin");
  assert.match(JSON.parse(codex.files.find((f) => f.path === "plugins/demo-plugin/.codex-plugin/plugin.json").content).version, /^1\.2\.3\+codex\.bundle-/);

  const oc = buildBundle(files, { target: "opencode", generator: "test" });
  const ocPaths = oc.files.map((f) => f.path);
  assert.ok(ocPaths.includes("skills/demo-plugin/skills/hello/SKILL.md"));
  assert.ok(ocPaths.includes("plugins/demo-plugin-guard.js"));
  assert.equal(oc.unzipInto, "$HOME/.config/opencode");
  const ocSkill = oc.files.find((f) => f.path === "skills/demo-plugin/skills/hello/SKILL.md").content;
  assert.ok(ocSkill.includes('node "$HOME/.config/opencode/skills/demo-plugin/scripts/hello.mjs"'));
  const guardSrc = oc.files.find((f) => f.path === "plugins/demo-plugin-guard.js").content;
  assert.ok(guardSrc.includes('const ROOT = path.join(os.homedir(), ...[".config","opencode","skills","demo-plugin"]);'), "root resolved at load time");
  // the bundled plugin resolves its root from the real home and still runs the hook
  const t = tmp();
  const guardFile = path.join(t, "demo-plugin-guard.js");
  fs.writeFileSync(guardFile, guardSrc);
  const home = path.join(os.homedir(), ".config", "opencode", "skills", "demo-plugin", "hooks");
  const hadHook = fs.existsSync(home);
  if (!hadHook) { fs.mkdirSync(home, { recursive: true }); fs.copyFileSync(path.join(FIXTURE, "hooks", "guard.mjs"), path.join(home, "guard.mjs")); }
  try {
    const hooks = await loadGuard(guardFile, "bundle");
    await assert.rejects(hooks["tool.execute.before"]({ tool: "bash", sessionID: "s", callID: "c" }, { args: { command: "rm -rf /" } }), /Refused: rm -rf \/ \(root=set\)/);
  } finally {
    if (!hadHook) fs.rmSync(path.join(os.homedir(), ".config", "opencode", "skills", "demo-plugin"), { recursive: true, force: true });
  }
  assert.equal(codex.warnings.length + oc.warnings.length, 0);
});

test("bundle: the CLI writes the layout to a directory", () => {
  const t = tmp();
  const out = run(["--source", FIXTURE, "--target", "codex", "--bundle", path.join(t, "b")]);
  assert.ok(fs.existsSync(path.join(t, "b", "plugins", "demo-plugin", "skills", "hello", "SKILL.md")));
  assert.ok(fs.existsSync(path.join(t, "b", ".agents", "plugins", "marketplace.json")));
  assert.match(out, /unzip into:\s+\$HOME/);
});

// -------------------------------------------------------------- in memory

test("convertFiles: pure and binary-safe", () => {
  const files = [...fixtureFiles(), { path: "assets/logo.png", content: Buffer.from([0x89, 0x50, 0x4e, 0x47]) }];
  const src = describeSource(files);
  assert.equal(src.name, "demo-plugin");
  assert.deepEqual(src.skillNames.sort(), ["_internal", "hello"]);
  assert.equal(src.permission.bash["git push*"], "ask");
  const { files: out, warnings } = convertFiles(files, { target: "opencode", root: "/opt/x", name: "demo-plugin" });
  assert.equal(warnings.length, 0);
  assert.ok(Buffer.isBuffer(out.find((f) => f.path === "assets/logo.png").content));
  assert.ok(out.find((f) => f.path === "skills/hello/SKILL.md").content.includes('"/opt/x/scripts/hello.mjs"'));
  assert.equal(out.find((f) => f.path === "templates/note.txt").content, files.find((f) => f.path === "templates/note.txt").content);
});

// ------------------------------------------------- real plugin, when present

const HYPERVIBE = path.join(os.homedir(), ".claude", "plugins", "marketplaces", "local-desktop-app-uploads", "hypervibe");
test("hypervibe (local only): both targets and both bundles build, and the guard denies a sweeping stage", { skip: !fs.existsSync(HYPERVIBE) }, async () => {
  const t = tmp();
  const outCodex = run(["--source", HYPERVIBE, "--target", "codex", "--plugins-dir", t, "--marketplace-file", path.join(t, "mk.json"), "--no-install", "--no-validate"]);
  assert.ok(!/residual/.test(outCodex), outCodex);
  const cfgDir = path.join(t, "oc");
  const outOc = run(["--source", HYPERVIBE, "--target", "opencode", "--opencode-dir", cfgDir, "--rules-file", "agents"]);
  assert.ok(!/residual/.test(outOc), outOc);
  const hooks = await loadGuard(path.join(cfgDir, "plugins", "hypervibe-guard.js"), "hv");
  const call = (command) => hooks["tool.execute.before"]({ tool: "bash", sessionID: "s", callID: "c" }, { args: { command } });
  await assert.rejects(call("git add -A && git commit -m x"), /^Error: \[Hypervibe\] Sweeping stage refused/, "the hook's own signature is kept, not doubled");
  await assert.rejects(call("git push --no-verify"), /pre-push recette/);
  await call("git add src/index.ts");
  for (const target of ["codex", "opencode"]) {
    const out = run(["--source", HYPERVIBE, "--target", target, "--bundle", path.join(t, `bundle-${target}`)]);
    assert.ok(!/residual/.test(out), out);
  }
  const bundled = read(t, "bundle-codex", "plugins", "hypervibe", "skills", "start", "SKILL.md");
  assert.ok(bundled.includes('PLUGIN_DIR="$HOME/plugins/hypervibe/skills/start/../.."'));
});
