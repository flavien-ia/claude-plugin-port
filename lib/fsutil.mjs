import fs from "node:fs";
import path from "node:path";

/** Forward slashes everywhere: the rewritten anchors end up inside bash
 *  commands, where a Windows backslash is an escape character. */
export const fwd = (p) => p.replace(/\\/g, "/");

/** Writers that honour --dry-run: every mutation goes through here. */
export function makeFs(dry) {
  return {
    dry,
    mkdir(p) {
      if (!dry) fs.mkdirSync(p, { recursive: true });
    },
    write(p, content) {
      if (dry) return;
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, content, "utf8");
    },
    copy(src, dst) {
      if (dry) return;
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      fs.copyFileSync(src, dst);
    },
    rm(p) {
      if (!dry) fs.rmSync(p, { recursive: true, force: true });
    },
  };
}

/** Yields every file under `dir` as { abs, rel } with a forward-slash `rel`. */
export function* walkFiles(dir, rel = "") {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, ent.name);
    const r = rel ? `${rel}/${ent.name}` : ent.name;
    if (ent.isDirectory()) yield* walkFiles(abs, r);
    else if (ent.isFile()) yield { abs, rel: r };
  }
}

/**
 * Copies a tree, transforming the files `pick` selects.
 *   pick(rel, ext) -> ((text) => text) | null   (null = copy the bytes verbatim)
 * Returns the counts, for the summary line.
 */
export function copyTree(fsx, srcDir, dstDir, pick) {
  let transformed = 0;
  let copied = 0;
  for (const { abs, rel } of walkFiles(srcDir)) {
    const dst = path.join(dstDir, ...rel.split("/"));
    const fn = pick(rel, path.extname(rel).toLowerCase());
    if (fn) {
      fsx.write(dst, fn(fs.readFileSync(abs, "utf8")));
      transformed++;
    } else {
      fsx.copy(abs, dst);
      copied++;
    }
  }
  return { transformed, copied };
}

export function readJson(p) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

export function exists(p) {
  return fs.existsSync(p);
}
