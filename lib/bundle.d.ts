import type { PluginFile, PortsConfig, Target } from "./convert";

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
  /** What a leading "_" in a skill name becomes. Wins over ports.json. */
  internalPrefix?: string;
  /** Keep names such as "_helper". Wins over ports.json. */
  keepSkillNames?: boolean;
  /** Skills left out, on top of the ones ports.json excludes. */
  excludeSkills?: string[];
  /** Port settings. Undefined: read `ports.json` from the files. Null: ignore it. */
  ports?: PortsConfig | null;
}

export interface BundleResult {
  files: PluginFile[];
  warnings: string[];
  name: string;
  version: string;
  /** Where the bundle expects to be unzipped ("$HOME" or "$HOME/.config/opencode"). */
  unzipInto: string;
  skillCount: number;
  /** Old skill name -> new name, for the names that had to change. */
  renamedSkills: Record<string, string>;
  /** Skills left out of the port. */
  excludedSkills: string[];
}

export const BUNDLE_LAYOUT: Record<Target, { unzipInto: string; pluginRel: (name: string) => string }>;
/** File name of the installer each bundle carries at the root of the plugin folder. */
export const INSTALLER_FILE: string;
export function buildBundle(files: PluginFile[], options: BundleOptions): BundleResult;
