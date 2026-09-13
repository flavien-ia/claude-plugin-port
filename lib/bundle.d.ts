import type { PluginFile, Target } from "./convert";

export interface BundleOptions {
  target: Target;
  /** Tool name written in generated headers (default: "claude-plugin-to-codex"). */
  generator?: string;
  /** Codex interface category (default: "Engineering"). */
  category?: string;
  /** Codex starter prompts (max 3 used). */
  defaultPrompt?: string[];
  shortDescriptions?: boolean;
  rebrand?: boolean;
  /** What the OpenCode plugin does with an `ask` decision (default: pass when a permission fragment exists, soft otherwise). */
  askMode?: "soft" | "pass";
  /** An extra file dropped at the bundle root, typically an install notice. */
  install?: { path: string; content: string };
}

export interface BundleResult {
  files: PluginFile[];
  warnings: string[];
  name: string;
  version: string;
  /** Where the bundle expects to be unzipped ("$HOME" or "$HOME/.config/opencode"). */
  unzipInto: string;
  skillCount: number;
}

export const BUNDLE_LAYOUT: Record<Target, { unzipInto: string; pluginRel: (name: string) => string }>;
export function buildBundle(files: PluginFile[], options: BundleOptions): BundleResult;
