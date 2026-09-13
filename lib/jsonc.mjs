// A lenient reader for opencode.json / opencode.jsonc: comments and trailing
// commas are stripped before JSON.parse. Rewriting a file that had comments
// would lose them, so the reader also reports whether it saw any.

export function stripJsonc(text) {
  let out = "";
  let i = 0;
  let hadComments = false;
  while (i < text.length) {
    const c = text[i];
    const n = text[i + 1];
    if (c === '"') {
      let j = i + 1;
      while (j < text.length && text[j] !== '"') {
        if (text[j] === "\\") j++;
        j++;
      }
      out += text.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    if (c === "/" && n === "/") {
      hadComments = true;
      while (i < text.length && text[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && n === "*") {
      hadComments = true;
      const end = text.indexOf("*/", i + 2);
      i = end === -1 ? text.length : end + 2;
      continue;
    }
    out += c;
    i++;
  }
  // trailing commas before } or ]
  out = out.replace(/,(\s*[}\]])/g, "$1");
  return { text: out, hadComments };
}

export function parseJsonc(text) {
  const { text: clean, hadComments } = stripJsonc(text);
  const value = clean.trim() === "" ? {} : JSON.parse(clean);
  return { value, hadComments };
}
