/**
 * `est` (EST Phase 4, docs/est/EST_Phase4_Work_Order.md §1): the EST developer kit's command line
 * over @cyber-est/tools. Since 1.305 (Phase 5b) also `keygen`, `sign` and `publish` (Cyber's own
 * registry, D-26; the clone's only, `entry.mjs`); `yank` is not here yet. Since 1.319 (DEV-A, D-50)
 * it is packaged as `@cyber-est/cli` (`scripts/sdk-build.mjs`; not yet published: gate 3).
 */
import { TOOL_VERSION } from '../../tools/src/index';
import { parseArgs, UsageError, type CommandContext, type EstCommand } from './command';

/** The CLI's version (semver of its own, D-50; the same as @cyber-est/tools' and @cyber-est/ui's). */
export const CLI_VERSION = TOOL_VERSION;
/**
 * The oldest Cyber this kit's bundles are made for: the release whose install check is the one
 * bundled here (the rules, the meter, the ABI). An older Cyber may refuse what this one passes.
 */
export const CYBER_TARGET = '1.319.0';
/** `est version`'s line: the version and the Cyber it targets. */
export const versionLine = (): string => `est ${CLI_VERSION} (EST 1.0, for Cyber ${CYBER_TARGET} or newer)`;

/**
 * `est help`: the developer's commands, then (1.400, P3) the registry owner's apart, so a plugin
 * developer never mistakes `keygen`'s registry key or `publish`'s registry build for their own.
 */
export function help(commands: EstCommand[]): string {
  const w = Math.max(...commands.map(c => c.name.length));
  const owner = commands.filter(c => c.owner);
  return [
    `est ${CLI_VERSION}: the EST plugin developer kit (for Cyber ${CYBER_TARGET} or newer)`,
    '',
    'Usage: est <command> [options]',
    '',
    ...commands.filter(c => !c.ownerOnly).map(c => `  ${c.name.padEnd(w)}  ${c.summary}`),
    ...(owner.length ? ['', 'Cyber\'s own registry (the owner\'s key, from a clone of Cyber\'s repository; not for your plugins):', ...owner.map(c => `  ${c.name.padEnd(w)}  ${c.owner}`)] : []),
    '',
    'est help <command> shows a command\'s options. The loop: est new, est validate, read validation.json, fix, est test, est dev.',
    'New to this? BUILD_AN_EST_PLUGIN.md (beside est in @cyber-est/cli, and in the kit\'s docs) walks through a first plugin;',
    'PROMPT_KIT.md beside it has a prompt for an AI assistant for every template and recipe, and SHARING.md says how to share what you made.',
  ].join('\n');
}

/** Run `est` with `argv` (without the program); the exit code. */
export async function main(commands: EstCommand[], argv: string[], ctx?: Partial<CommandContext>): Promise<number> {
  const c: CommandContext = {
    cwd: ctx?.cwd ?? process.cwd(),
    out: ctx?.out ?? (t => process.stdout.write(`${t}\n`)),
    err: ctx?.err ?? (t => process.stderr.write(`${t}\n`)),
  };
  const sorted = [...commands].sort((a, b) => a.name.localeCompare(b.name));
  const [name, ...rest] = argv;
  if (!name || name === 'help' || name === '--help' || name === '-h') {
    const which = name === 'help' ? sorted.find(x => x.name === rest[0]) : undefined;
    c.out(which ? `${which.summary}\n\n${which.usage}` : help(sorted));
    return 0;
  }
  if (name === '--version' || name === '-v') { c.out(CLI_VERSION); return 0; }
  if (name === 'version') { c.out(versionLine()); return 0; }
  const cmd = sorted.find(x => x.name === name);
  if (!cmd) {
    c.err(`est: no command "${name}"\n\n${help(sorted)}`);
    return 2;
  }
  try {
    const args = parseArgs(rest, cmd.valueFlags);
    if (args.flags.help) { c.out(`${cmd.summary}\n\n${cmd.usage}`); return 0; }
    return await cmd.run(args, c);
  } catch (err) {
    if (err instanceof UsageError) { c.err(`est ${cmd.name}: ${err.message}\n\n${cmd.usage}`); return 2; }
    c.err(`est ${cmd.name}: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }
}
