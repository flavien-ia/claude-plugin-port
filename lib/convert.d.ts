export type Target = "codex" | "opencode";

export interface PluginFile {
  /** Plugin-root-relative path with forward slashes. */
  path: string;
  /** Text files as strings; anything else passes through untouched. */
  content: string | Uint8Array;
}

export interface ConvertOptions {
  target: Target;
  /** What the anchors become: an absolute path, or "$HOME/<rel>". */
  root: string;
  name: string;
  rulesMode?: "agents" | "claude";
  rebrand?: boolean;
  shortDescriptions?: boolean;
}

export interface ConvertResult {
  files: PluginFile[];
  warnings: string[];
}

export interface SourceInfo {
  manifest: Record<string, unknown>;
  name: string;
  displayName: string;
  description: string;
  version: string;
  author: string;
  license: string | null;
  hooks: unknown | null;
  mcp: unknown | null;
  permission: Record<string, unknown> | null;
  skillNames: string[];
  has: { skills: boolean; hooks: boolean; mcp: boolean; scripts: boolean; templates: boolean };
}

export interface PreToolUseHook {
  matcher: string;
  command: string;
  timeout: number;
}

export const HOSTS: Record<Target, { hostName: string; askPhrase: string }>;
export const CLAUDE_ONLY_FRONTMATTER: string[];
export function convertFiles(files: PluginFile[], options: ConvertOptions): ConvertResult;
export function describeSource(files: PluginFile[]): SourceInfo;
export function preToolUseHooks(hooks: unknown): PreToolUseHook[];
export function codexManifest(
  src: SourceInfo,
  options?: { category?: string; defaultPrompt?: string[]; version?: string },
): Record<string, unknown>;
export function mcpFromClaude(mcpJson: unknown): Record<string, unknown>;
export function marketplaceEntry(name: string, category?: string): Record<string, unknown>;
