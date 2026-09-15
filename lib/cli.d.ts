import type { Target } from "./convert";

/** The command published for each host. */
export const HOST_COMMANDS: Record<Target, string>;

/** The help text: one host's when `host` is given, both otherwise. */
export function usage(options?: { program?: string; host?: Target | null }): string;

/**
 * Runs the command line and resolves to the exit code.
 * `host` binds the command to one host (any other `--target` is refused);
 * `program` is the command's name in messages.
 */
export function main(argv: string[], options?: { host?: Target | null; program?: string }): Promise<number>;
