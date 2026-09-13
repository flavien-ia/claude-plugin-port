import type { PreToolUseHook } from "./convert";

export interface GuardOptions {
  name: string;
  root: { kind: "absolute"; path: string } | { kind: "home"; rel: string };
  hooks: PreToolUseHook[];
  askMode: "soft" | "pass";
  mcp?: Record<string, unknown>;
  permission?: Record<string, unknown> | null;
  generator: string;
}

/** Source of the OpenCode plugin (an ES module) that runs the hooks and injects the configuration. */
export function renderGuardPlugin(options: GuardOptions): string;
