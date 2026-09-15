import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { pathToFileURL, fileURLToPath } from "node:url";
import { convertFiles, describeSource, planSkillNames } from "../lib/convert.mjs";
import { buildBundle, INSTALLER_FILE } from "../lib/bundle.mjs";
import { rewriteSkillNames } from "../lib/ports.mjs";

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
/** Writes a bundle to a folder, as unzipping it would. */
function unpack(bundle, dir) {
  for (const f of bundle.files) {
    const p = path.join(dir, ...f.path.split("/"));
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, f.content);
  }
  return dir;
}
const withVersion = (files, version) =>
  files.map((f) => (f.path === ".claude-plugin/plugin.json" ? { ...f, content: JSON.stringify({ ...JSON.parse(f.content), version }) } : f));
/** Runs the installer a bundle carries; never asks a real Codex to reinstall. */
function install(target, from, home) {
  const installer = path.join(from, target === "codex" ? "plugins" : "skills", "demo-plugin", INSTALLER_FILE);
  try {
    return { code: 0, out: JSON.parse(execFileSync(process.execPath, [installer, "--from", from, "--home", home, "--no-refresh"], { encoding: "utf8" })) };
  } catch (e) {
    return { code: e.status, out: JSON.parse(e.stdout) };
  }
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
  assert.ok(skill.includes(`node "${r}/scripts/hello.mjs" --help`), "the bare $CLAUDE_SKILL_DIR form is rewritten too");
  assert.ok(!skill.includes("${CLAUDE_") && !skill.includes("$CLAUDE_"), "no residual anchor");
  assert.ok(!/^(user-invocable|allowed-tools|argument-hint|compatibility):/m.test(skill), "only the portable frontmatter keys remain");
  assert.ok(!skill.includes("Codex or Codex"), "the compatibility line is gone, not rebranded");
  assert.match(skill, /^description: "Say hello: politely, .*"$/m, "colon inside the description gets quoted for strict YAML");
  assert.ok(skill.includes("Run the helper from Codex:"), "rebranded");
  assert.ok(skill.includes("use a direct question to the user with two options"), "AskUserQuestion mapped");
  assert.ok(skill.includes("project AGENTS.md and the global ~/.codex/AGENTS.md"), "rules files mapped, global path included");
  assert.ok(!skill.includes("CLAUDE.md"));
  assert.ok(skill.includes(`Delegate the rest to \`demo-plugin-internal\` (its instructions: \`${r}/skills/hello/../demo-plugin-internal/SKILL.md\`).`), "mentions follow the renamed skill");
  assert.ok(skill.includes("Never confuse it with `_internal-notes` or my_internal."), "only whole names are rewritten");

  assert.ok(!fs.existsSync(path.join(root, "skills", "_internal")), "the underscore folder is renamed");
  const internal = read(root, "skills", "demo-plugin-internal", "SKILL.md");
  assert.match(internal, /^name: demo-plugin-internal$/m);
  assert.ok(internal.includes(`Path: ${r}/skills/demo-plugin-internal`), "the anchor points at the renamed folder");
  assert.ok(!internal.includes("OpenCode edition"), "a variant written for another host never leaks");
  assert.ok(!fs.readdirSync(path.join(root, "skills", "demo-plugin-internal")).some((n) => /\.(codex|opencode)\.md$/.test(n)), "no variant file ships");
  assert.ok(read(root, "templates", "skills.txt").includes("Ask the `demo-plugin-internal` skill"), "templates follow the rename");

  const script = read(root, "scripts", "hello.mjs");
  assert.ok(script.includes(`path.join(process.cwd(), "AGENTS.md")`));
  assert.ok(script.includes(`path.join(os.homedir(), ".codex", "AGENTS.md")`), "segment-built global path rewritten");
  assert.equal(read(root, "templates", "note.txt"), read(FIXTURE, "templates", "note.txt"), "templates stay verbatim");
  assert.equal(read(root, ".mcp.json"), read(FIXTURE, ".mcp.json"));
  assert.deepEqual(JSON.parse(read(root, ".claude-plugin-to-codex.json")).renamedSkills, { _internal: "demo-plugin-internal" });

  const mk = JSON.parse(read(t, "mk.json"));
  assert.equal(mk.plugins[0].name, "demo-plugin");
  assert.equal(mk.plugins[0].source.path, "./plugins/demo-plugin");
  assert.match(out, /1 skill name\(s\) changed to what both hosts accept \(_internal -> demo-plugin-internal\)/);
  assert.match(out, /No warnings\./);
});

test("codex: --short-descriptions keeps the first sentence, --no-rebrand keeps Claude Code", () => {
  const t = tmp();
  run(["--source", FIXTURE, "--plugins-dir", t, "--marketplace-file", path.join(t, "mk.json"), "--no-install", "--no-validate", "--short-descriptions", "--no-rebrand"]);
  const skill = read(t, "demo-plugin", "skills", "hello", "SKILL.md");
  assert.match(skill, /^description: "Say hello: politely, in the user's language\."$/m);
  assert.ok(skill.includes("Run the helper from Claude Code:"));
  const internal = read(t, "demo-plugin", "skills", "demo-plugin-internal", "SKILL.md");
  assert.ok(!/^user-invocable/m.test(internal));
});

test("codex: --keep-skill-names, --internal-prefix and --exclude-skill shape the port", () => {
  const t = tmp();
  run(["--source", FIXTURE, "--plugins-dir", t, "--marketplace-file", path.join(t, "mk.json"), "--no-install", "--no-validate", "--keep-skill-names"]);
  assert.match(read(t, "demo-plugin", "skills", "_internal", "SKILL.md"), /^name: _internal$/m);
  assert.ok(read(t, "demo-plugin", "skills", "hello", "SKILL.md").includes("Delegate the rest to `_internal`"));

  const t2 = tmp();
  const out = run(["--source", FIXTURE, "--plugins-dir", t2, "--marketplace-file", path.join(t2, "mk.json"), "--no-install", "--no-validate", "--internal-prefix", "dp", "--exclude-skill", "hello"]);
  assert.ok(fs.existsSync(path.join(t2, "demo-plugin", "skills", "dp-internal", "SKILL.md")), "the prefix is joined by a hyphen");
  assert.ok(!fs.existsSync(path.join(t2, "demo-plugin", "skills", "hello")));
  assert.match(out, /left out of the port: hello/);
  assert.match(out, /excluded skill "hello" is still mentioned in \d+ file\(s\): .*templates\/skills\.txt/, "a dangling mention is reported");
  const marker = JSON.parse(read(t2, "demo-plugin", ".claude-plugin-to-codex.json"));
  assert.deepEqual(marker.renamedSkills, { _internal: "dp-internal" });
  assert.deepEqual(marker.excludedSkills, ["hello"]);
});

test("codex: dry-run writes nothing", () => {
  const t = tmp();
  const out = run(["--source", FIXTURE, "--plugins-dir", t, "--marketplace-file", path.join(t, "mk.json"), "--dry-run"]);
  assert.ok(!fs.existsSync(path.join(t, "demo-plugin")));
  assert.ok(!fs.existsSync(path.join(t, "mk.json")));
  assert.match(out, /DRY-RUN/);
});

// ------------------------------------------------------------ ports.json

test("ports.json: the plugin states its prefix and per-target exclusions once; flags win", () => {
  const t = tmp();
  const source = path.join(t, "src");
  fs.cpSync(FIXTURE, source, { recursive: true });
  fs.writeFileSync(path.join(source, "ports.json"), JSON.stringify({ internalPrefix: "dp-", exclude: { opencode: ["_internal"] } }));

  const codexOut = run(["--source", source, "--target", "codex", "--bundle", path.join(t, "codex")]);
  assert.ok(fs.existsSync(path.join(t, "codex", "plugins", "demo-plugin", "skills", "dp-internal", "SKILL.md")));
  assert.ok(!fs.existsSync(path.join(t, "codex", "plugins", "demo-plugin", "ports.json")), "the settings file is not shipped");
  assert.match(codexOut, /No warnings\./);

  const ocOut = run(["--source", source, "--target", "opencode", "--bundle", path.join(t, "oc")]);
  const ocSkills = path.join(t, "oc", "skills", "demo-plugin", "skills");
  assert.deepEqual(fs.readdirSync(ocSkills), ["hello"], "left out of OpenCode only");
  assert.match(ocOut, /excluded skill "_internal" is still mentioned in 2 file\(s\)/);

  run(["--source", source, "--target", "codex", "--bundle", path.join(t, "flag"), "--internal-prefix", "zz"]);
  assert.ok(fs.existsSync(path.join(t, "flag", "plugins", "demo-plugin", "skills", "zz-internal")));
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
  assert.ok(!/^compatibility:/m.test(skill));
  const ocInternal = read(root, "skills", "demo-plugin-internal", "SKILL.md");
  assert.ok(ocInternal.includes("Internal, as OpenCode runs it."), "SKILL.opencode.md replaces SKILL.md in the OpenCode port");
  assert.match(ocInternal, /^name: demo-plugin-internal$/m, "the variant is renamed like the original");
  assert.deepEqual(fs.readdirSync(path.join(root, "skills", "demo-plugin-internal")), ["SKILL.md"], "the variant file itself does not ship");
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
  assert.ok(paths.includes(`plugins/demo-plugin/${INSTALLER_FILE}`), "the bundle carries its installer");
  assert.equal(codex.unzipInto, "$HOME");
  assert.equal(codex.skillCount, 2);
  const skill = codex.files.find((f) => f.path === "plugins/demo-plugin/skills/hello/SKILL.md").content;
  assert.ok(skill.includes('node "$HOME/plugins/demo-plugin/scripts/hello.mjs" --template "$HOME/plugins/demo-plugin/templates/note.txt"'), "anchors are $HOME-relative");
  assert.ok(skill.includes('cat "$HOME/plugins/demo-plugin/skills/hello/README.md"'));
  const mk = JSON.parse(codex.files.find((f) => f.path === ".agents/plugins/marketplace.json").content);
  assert.equal(mk.plugins[0].source.path, "./plugins/demo-plugin");
  assert.match(JSON.parse(codex.files.find((f) => f.path === "plugins/demo-plugin/.codex-plugin/plugin.json").content).version, /^1\.2\.3\+codex\.bundle-/);
  const marker = JSON.parse(codex.files.find((f) => f.path === "plugins/demo-plugin/.claude-plugin-to-codex.json").content);
  assert.equal(marker.installer, INSTALLER_FILE);
  assert.equal(marker.target, "codex");

  const oc = buildBundle(files, { target: "opencode", generator: "test" });
  const ocPaths = oc.files.map((f) => f.path);
  assert.ok(ocPaths.includes("skills/demo-plugin/skills/hello/SKILL.md"));
  assert.ok(ocPaths.includes("plugins/demo-plugin-guard.js"));
  assert.ok(ocPaths.includes(`skills/demo-plugin/${INSTALLER_FILE}`));
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

// -------------------------------------------------------------- installer

test("installer (codex): installs, updates with a backup outside ~/plugins, keeps other marketplace entries, refuses a broken bundle", () => {
  const files = fixtureFiles();
  const home = tmp();
  fs.mkdirSync(path.join(home, ".agents", "plugins"), { recursive: true });
  fs.writeFileSync(path.join(home, ".agents", "plugins", "marketplace.json"), JSON.stringify({ name: "mine", plugins: [{ name: "other", source: { source: "local", path: "./plugins/other" } }] }));
  const pluginDir = path.join(home, "plugins", "demo-plugin");

  const first = install("codex", unpack(buildBundle(files, { target: "codex", generator: "test" }), tmp()), home);
  assert.equal(first.code, 0, JSON.stringify(first.out));
  assert.equal(first.out.previousVersion, null);
  assert.equal(first.out.backup, null);
  assert.equal(first.out.refresh, null, "--no-refresh leaves Codex alone");
  assert.ok(fs.existsSync(path.join(pluginDir, "skills", "demo-plugin-internal", "SKILL.md")));
  let mk = JSON.parse(read(home, ".agents", "plugins", "marketplace.json"));
  assert.equal(mk.name, "mine", "the user's marketplace keeps its name");
  assert.deepEqual(mk.plugins.map((p) => p.name), ["other", "demo-plugin"]);

  const second = install("codex", unpack(buildBundle(withVersion(files, "1.2.4"), { target: "codex", generator: "test" }), tmp()), home);
  assert.equal(second.code, 0, JSON.stringify(second.out));
  assert.equal(second.out.previousVersion, "1.2.3");
  assert.equal(second.out.version, "1.2.4");
  assert.ok(fs.existsSync(path.join(second.out.backup, ".codex-plugin", "plugin.json")), "the previous version is kept aside");
  assert.ok(!path.resolve(second.out.backup).startsWith(path.join(home, "plugins")), "never where Codex looks for plugins");
  assert.equal(JSON.parse(read(pluginDir, ".claude-plugin-to-codex.json")).sourceVersion, "1.2.4");
  mk = JSON.parse(read(home, ".agents", "plugins", "marketplace.json"));
  assert.deepEqual(mk.plugins.map((p) => p.name), ["other", "demo-plugin"]);

  const broken = unpack(buildBundle(withVersion(files, "1.2.5"), { target: "codex", generator: "test" }), tmp());
  fs.rmSync(path.join(broken, "plugins", "demo-plugin", ".codex-plugin"), { recursive: true });
  const refused = install("codex", broken, home);
  assert.equal(refused.code, 1);
  assert.match(refused.out.error, /codex-plugin/);
  assert.equal(JSON.parse(read(pluginDir, ".claude-plugin-to-codex.json")).sourceVersion, "1.2.4", "the installed version is untouched");

  const inPlaceHome = tmp();
  unpack(buildBundle(files, { target: "codex", generator: "test" }), inPlaceHome); // unzipped straight into the home folder
  const inPlace = install("codex", inPlaceHome, inPlaceHome);
  assert.equal(inPlace.code, 0, JSON.stringify(inPlace.out));
  assert.equal(inPlace.out.backup, null, "nothing to move when the bundle already sits in place");
});

test("installer (opencode): the skills folder and the generated plugin move together, backups stay out of scanned folders", () => {
  const files = fixtureFiles();
  const home = tmp();
  const first = install("opencode", unpack(buildBundle(files, { target: "opencode", generator: "test" }), tmp()), home);
  assert.equal(first.code, 0, JSON.stringify(first.out));
  const guard = path.join(home, ".config", "opencode", "plugins", "demo-plugin-guard.js");
  assert.ok(fs.existsSync(guard));
  fs.writeFileSync(guard, "// edited by hand\n");

  const second = install("opencode", unpack(buildBundle(withVersion(files, "2.0.0"), { target: "opencode", generator: "test" }), tmp()), home);
  assert.equal(second.code, 0, JSON.stringify(second.out));
  assert.ok(!read(guard).includes("edited by hand"), "the generated plugin follows the new version");
  assert.equal(read(path.dirname(second.out.backup), "guard.js"), "// edited by hand\n");
  assert.ok(!path.resolve(second.out.backup).startsWith(path.join(home, ".config")), "OpenCode never loads the backup's skills");
  assert.equal(JSON.parse(read(home, ".config", "opencode", "skills", "demo-plugin", ".claude-plugin-to-codex.json")).sourceVersion, "2.0.0");
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

test("convertFiles: settings given in memory, and unexpected frontmatter reported", () => {
  const res = convertFiles(fixtureFiles(), { target: "codex", root: "/opt/x", name: "demo-plugin", ports: { internalPrefix: "dp", exclude: ["hello"] } });
  assert.deepEqual(res.renamedSkills, { _internal: "dp-internal" });
  assert.deepEqual(res.excludedSkills, ["hello"]);
  assert.equal(res.skillCount, 1);
  assert.ok(!res.files.some((f) => f.path.startsWith("skills/hello/")));

  const odd = convertFiles([
    { path: ".claude-plugin/plugin.json", content: '{"name":"x"}' },
    { path: "skills/a/SKILL.md", content: "---\nname: a\ndescription: A skill.\nversion: 2\nmetadata:\n  owner: me\n---\nBody\n" },
  ], { target: "opencode", root: "/r", name: "x", excludeSkills: ["nope"] });
  assert.equal(odd.files.find((f) => f.path === "skills/a/SKILL.md").content, "---\nname: a\ndescription: A skill.\nmetadata:\n  owner: me\n---\nBody\n");
  assert.deepEqual(odd.warnings, ['exclude: no skill named "nope"', 'frontmatter key "version" dropped from 1 skill(s): OpenCode does not read it']);
});

test("skill names: whole tokens only, and never a collision", () => {
  const renames = planSkillNames(["_setup-auth", "_setup-auth-admin", "deploy", "Big_Name"], { prefix: "hv-" });
  assert.deepEqual(Object.fromEntries(renames), { "_setup-auth": "hv-setup-auth", "_setup-auth-admin": "hv-setup-auth-admin", "Big_Name": "big-name" });
  const text = "Run `_setup-auth-admin`, then _setup-auth; skills/_setup-auth/SKILL.md, hypervibe:_setup-auth. Not my_setup-auth nor _setup-authx.";
  assert.equal(rewriteSkillNames(text, renames), "Run `hv-setup-auth-admin`, then hv-setup-auth; skills/hv-setup-auth/SKILL.md, hypervibe:hv-setup-auth. Not my_setup-auth nor _setup-authx.");
  assert.throws(() => planSkillNames(["_deploy", "hv-deploy"], { prefix: "hv-" }), /already uses/);
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
