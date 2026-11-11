/**
 * `est dev`: 4-C's dev host (`sdk/devhost/cli/dev.mjs`, which exports `name`, `summary`, `usage`
 * and `run(argv, io?)`) as one of `est`'s commands (EST Phase 4, 4-D; work order §6, "a subcommand
 * registered with 4-A's CLI").
 *
 * The dev host is loaded at run time, never bundled into `est`: it starts Vite and a server over
 * Cyber's own runtime, and every other command stays as quick to start as it was. The flags `est`
 * parsed are given back to it as the argv it parses itself.
 */
import { resolve } from 'node:path';
import type { EstCommand, ParsedArgs } from '../command';

/** The flags of `est dev` that take a value (the rest are switches). */
const VALUE_FLAGS = ['port', 'files-port', 'seconds', 'play', 'ui-preview'];

/** The devhost's own subcommand module, from this file's place in the repository. */
const DEV_MODULE = new URL('../../../../devhost/cli/dev.mjs', import.meta.url);

interface DevModule {
  summary: string;
  usage: string;
  run(argv: string[], io?: { stdout?: { write(text: string): boolean }; stderr?: { write(text: string): boolean } }): Promise<number>;
}

/** `ParsedArgs` back to an argv (`--name value` for a value flag, `--name` for a switch). */
export function devArgv(args: ParsedArgs): string[] {
  const argv: string[] = [...args.positional];
  for (const [name, v] of Object.entries(args.flags)) {
    if (name === 'help') continue;
    if (typeof v === 'string') argv.push(`--${name}`, v);
    else if (v) argv.push(`--${name}`);
  }
  return argv;
}

/** A stream for the dev host's writes that ends in `est`'s own output lines. */
const lines = (emit: (text: string) => void) => ({
  write(text: string) {
    emit(text.endsWith('\n') ? text.slice(0, -1) : text);
    return true;
  },
});

const command: EstCommand = {
  name: 'dev',
  summary: 'Play a plugin in the dev host while you build it (http://localhost:4430; --json headless)',
  usage: [
    'est dev [dir | file.est] [--port 4430] [--files-port 4431] [--no-watch] [--open]',
    'est dev [dir | file.est] --json [--seconds N] [--play 60,64,67]',
    'est dev <folder with ui/> --ui-preview params.json',
    '',
    '  Builds the plugin on every change, serves the dev host on http://localhost:4430 and the',
    "  bundle's files on http://localhost:4431 (a second origin, as in Cyber), and runs the plugin",
    "  in Cyber's own runtime, metered and checked exactly as an install. sdk/docs/dev-host.md.",
    '',
    "  --port <n>           the host's port (default 4430)",
    "  --files-port <n>     the bundle files' port (default 4431)",
    '  --no-watch           build once; do not rebuild on change',
    '  --open               open the page in the default browser',
    "  --json               headless (Playwright's Chromium): meters, events and the custom UI's as",
    '                       JSON lines; commands on stdin as JSON lines, run in order as they arrive',
    '  --seconds <n>        with --json: stop n seconds after the instance started (it alone decides)',
    '  --play <keys>        with --json: play these MIDI notes one after another, then stop 1 s after',
    '                       the last (without either flag: 1 s after stdin closes and its commands ran)',
    '',
    '  A port in use stops it (EADDRINUSE): pass free ones, or --port 0 --files-port 0 for any.',
    '  --ui-preview <file>  the custom UI against the parameters in <file> (no DSP)',
  ].join('\n'),
  valueFlags: VALUE_FLAGS,
  async run(args, ctx) {
    const dev = (await import(DEV_MODULE.href)) as DevModule;
    const argv = devArgv(args);
    if (!args.positional.length) argv.unshift(ctx.cwd);
    else argv[0] = resolve(ctx.cwd, argv[0]!);
    return dev.run(argv, { stdout: lines(ctx.out), stderr: lines(ctx.err) });
  },
};
export default command;
