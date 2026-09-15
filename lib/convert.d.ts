export type Target = "codex" | "opencode";

export interface PluginFile {
  /** Plugin-root-relative path with forward slashes. */
  path: string;
  /** Text files as strings; anything else passes through untouched. */
  content: string | Uint8Array;
}

/** A plugin's own `ports.json`: what every port of it needs. Claude Code ignores the file. */
export interface PortsConfig {
  /** What a leading "_" in a skill name becomes, joined by a hyphen. Default: "<plugin name>-". */
  internalPrefix?: string;
  /** Keep the skill names the hosts' validators refuse. */
  keepSkillNames?: boolean;
  /** Skills left out of the port: one list for every target, or lists keyed by target. */
  exclude?: string[] | Partial<Record<Target, string[]>>;
}

export interface ConvertOptions {
  target: Target;
  /** What the anchors become: an absolute path, or "$HOME/<rel>". */
  root: string;
  name: string;
  rulesMode?: "agents" | "claude";
  rebrand?: boolean;
  shortDescriptions?: boolean;
  /** What a leading "_" in a skill name becomes. Wins over ports.json. */
  internalPrefix?: string;
  /** Keep names such as "_helper". Wins over ports.json. */
  keepSkillNames?: boolean;
  /** Skills left out, on top of the ones ports.json excludes. */
  excludeSkills?: string[];
  /** Port settings. Undefined: read `ports.json` from the files. Null: ignore it. */
  ports?: PortsConfig | null;
}

export interface ConvertResult {
  files: PluginFile[];
  warnings: string[];
  /** Old skill name -> new name, for the names that had to change. */
  renamedSkills: Record<string, string>;
  /** Skills left out of the port. */
  excludedSkills: string[];
  /** Skills in the port. */
  skillCount: number;
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
  ports: PortsConfig | null;
  skillNames: string[];
  has: { skills: boolean; hooks: boolean; mcp: boolean; scripts: boolean; templates: boolean };
}

export interface PreToolUseHook {
  matcher: string;
  command: string;
  timeout: number;
}

export const HOSTS: Record<Target, { hostName: string; askPhrase: string }>;
/** Frontmatter keys that mean nothing outside Claude Code. */
export const CLAUDE_ONLY_FRONTMATTER: string[];
/** The only frontmatter keys a ported SKILL.md keeps. */
export const PORTABLE_FRONTMATTER: string[];
/** "ports.json": read at the plugin root. */
export const PORTS_FILE: string;
/** Skill names both hosts accept. */
export const STRICT_SKILL_NAME: RegExp;
export function planSkillNames(skillNames: string[], options: { prefix: string }): Map<string, string>;
export function convertFiles(files: PluginFile[], options: ConvertOptions): ConvertResult;
export function describeSource(files: PluginFile[]): SourceInfo;
export function preToolUseHooks(hooks: unknown): PreToolUseHook[];
export function codexManifest(
  src: SourceInfo,
  options?: { category?: string; defaultPrompt?: string[]; version?: string },
): Record<string, unknown>;
export function mcpFromClaude(mcpJson: unknown): Record<string, unknown>;
export function marketplaceEntry(name: string, category?: string): Record<string, unknown>;
