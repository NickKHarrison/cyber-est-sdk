/**
 * `est`: the shape of a subcommand. Every file in `src/commands/` exports one as its default; the
 * launcher (`bin/est.mjs`) bundles them all, so a new command (4-C's `est dev`) is a new file there
 * and nothing else.
 */
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface ParsedArgs {
  positional: string[];
  flags: Record<string, string | boolean>;
}

export interface CommandContext {
  cwd: string;
  /** Standard output (the report; JSON with `--json`). */
  out(text: string): void;
  /** Standard error (progress, build output, problems). */
  err(text: string): void;
}

export interface EstCommand {
  name: string;
  /** One line for `est help`. */
  summary: string;
  /**
   * 1.400 (P3): the registry owner's mode of this command (Cyber's own registry, the clone only),
   * in one line: `est help` lists it apart from what a plugin developer runs.
   */
  owner?: string;
  /** 1.400 (P3): only the owner's (the clone's `keygen`): left out of the developer's list. */
  ownerOnly?: boolean;
  /** The usage line(s), shown by `est help <name>` and on a usage error. */
  usage: string;
  /** Flags that take a value (`--id <id>`); every other `--flag` is a boolean. */
  valueFlags?: string[];
  run(args: ParsedArgs, ctx: CommandContext): Promise<number>;
}

export class UsageError extends Error {}

/** `argv` as positionals and flags (`--a b`, `--a=b`, `--flag`; `--` ends the flags). */
export function parseArgs(argv: string[], valueFlags: readonly string[] = []): ParsedArgs {
  const positional: string[] = [];
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--') { positional.push(...argv.slice(i + 1)); break; }
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      const name = eq > 0 ? a.slice(2, eq) : a.slice(2);
      if (eq > 0) { flags[name] = a.slice(eq + 1); continue; }
      if (valueFlags.includes(name)) {
        const v = argv[i + 1];
        if (v === undefined || v.startsWith('--')) throw new UsageError(`--${name} needs a value`);
        flags[name] = v;
        i++;
        continue;
      }
      flags[name] = true;
      continue;
    }
    if (a.startsWith('-') && a.length > 1 && !/^-\d/.test(a)) {
      for (const ch of a.slice(1)) flags[ch === 'h' ? 'help' : ch] = true;
      continue;
    }
    positional.push(a);
  }
  return { positional, flags };
}

/** The SDK's folder in this repository (`sdk/`). */
export const SDK_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
/** The repository's root (D-37: the SDK lives in Cyber's repository until Phase 7). */
export const REPO_DIR = resolve(SDK_DIR, '..');
export const TEMPLATES_DIR = resolve(SDK_DIR, 'templates');
/** DEV-F (1.321): the cookbook's recipes, which `est new` takes by name as it does a template. */
export const COOKBOOK_DIR = resolve(SDK_DIR, 'cookbook');

export const flagString = (a: ParsedArgs, name: string): string | undefined => (typeof a.flags[name] === 'string' ? a.flags[name] as string : undefined);
