import os from "node:os";
import path from "node:path";

// Writes a line to the project rules file and to the global one.
const project = path.join(process.cwd(), "CLAUDE.md");
const global = path.join(os.homedir(), ".claude", "CLAUDE.md");
console.log(project, global, "hello");
