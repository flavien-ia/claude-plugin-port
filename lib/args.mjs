// Minimal argv helpers. No dependency: this tool is meant to run through npx
// in a fresh environment, so it stays a single Node program with zero installs.

export function parseArgs(argv) {
  const has = (name) => argv.includes(name);
  const get = (name, fallback) => {
    const i = argv.indexOf(name);
    return i >= 0 && i + 1 < argv.length ? argv[i + 1] : fallback;
  };
  const all = (name) => {
    const out = [];
    argv.forEach((a, i) => {
      if (a === name && argv[i + 1] !== undefined) out.push(argv[i + 1]);
    });
    return out;
  };
  return { argv, has, get, all };
}
