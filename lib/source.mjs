import fs from "node:fs";
import path from "node:path";
import { TEXT_EXT } from "./text.mjs";
import { describeSource } from "./convert.mjs";

/** Files the conversion reads as text; everything else passes through as bytes. */
const TEXT_LIKE = new Set([...TEXT_EXT, ".mdx", ".css", ".html", ".svg", ".env", ".gitignore", ".txt"]);
const TEXT_NAMES = new Set(["LICENSE", "README", "CHANGELOG", ".gitignore", ".gitattributes"]);

function isTextFile(rel) {
  const base = rel.split("/").pop();
  const ext = path.extname(base).toLowerCase();
  return TEXT_LIKE.has(ext) || TEXT_NAMES.has(base) || (ext === "" && /^[A-Z]+$/.test(base));
}

/** Reads a Claude Code plugin directory into the file list convertFiles() takes. */
export function readSourceDir(sourceArg) {
  let dir = sourceArg;
  if (!dir && fs.existsSync(path.join(process.cwd(), ".claude-plugin", "plugin.json"))) dir = process.cwd();
  if (!dir || !fs.existsSync(path.join(dir, ".claude-plugin", "plugin.json"))) {
    throw new Error("--source must point to a Claude Code plugin (a dir containing .claude-plugin/plugin.json).");
  }
  dir = path.resolve(dir);
  const files = [];
  const walk = (abs, rel) => {
    for (const ent of fs.readdirSync(abs, { withFileTypes: true })) {
      if (ent.name === ".git" || ent.name === "node_modules") continue;
      const a = path.join(abs, ent.name);
      const r = rel ? `${rel}/${ent.name}` : ent.name;
      if (ent.isDirectory()) walk(a, r);
      else if (ent.isFile()) files.push({ path: r, content: isTextFile(r) ? fs.readFileSync(a, "utf8") : fs.readFileSync(a) });
    }
  };
  walk(dir, "");
  const src = describeSource(files);
  return { dir, files, src };
}
