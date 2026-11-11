/**
 * `est dev`: the dev host as a subcommand of the `est` command (stream 4-A's CLI).
 *
 * The seam: a subcommand is a module exporting `name`, `summary`, `usage` and
 * `run(argv: string[], io?: { stdout, stderr, stdin }) → Promise<number>` (the exit code). `est`
 * registers it through `sdk/packages/cli/src/commands/dev.ts`, which loads this file when `est dev`
 * runs; `node sdk/devhost/bin/est-dev.mjs …` (or `npm run est:dev -- …`) runs it alone.
 *
 *   est dev [dir | file.est] [--port 4430] [--files-port 4431] [--no-watch] [--open] [--cyber [origin]]
 *   est dev [dir | file.est] --json [--seconds N] [--play 60,64,67]
 *   est dev <folder with ui/> --ui-preview params.json
 */
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { DEFAULT_FILES_PORT, DEFAULT_HOST_PORT, startDevHost } from '../server.mjs';
import { CYBER_LIVE_ORIGIN, cyberOriginOf } from '../follow.mjs';
import { runHeadless, startMessage } from '../headless.mjs';

export const name = 'dev';
export const summary = 'play a plugin in the dev host while you build it (http://localhost:4430)';
export const usage = `est dev [dir | file.est] [options]

  Builds the plugin on every change (a folder with est.json and a Cargo.toml or asconfig.json),
  serves the dev host on http://localhost:4430 and the bundle's files on http://localhost:4431
  (a second origin, so the custom UI's frame is cross-origin as in Cyber), and runs the plugin in
  Cyber's own runtime, metered and checked exactly as an install.

  --port <n>           the host's port (default ${DEFAULT_HOST_PORT})
  --files-port <n>     the bundle files' port (default ${DEFAULT_FILES_PORT})
  --no-watch           build once; do not rebuild on change
  --open               open the page in the default browser
  --json               headless (Playwright's Chromium): print the meters, the events and the
                       custom UI's (ui lines) as JSON lines; read commands as JSON lines on stdin,
                       run one at a time, in order, as they arrive (see sdk/docs/dev-host.md)
  --seconds <n>        with --json: stop n seconds after the instance started (this alone then
                       decides the run's length)
  --play <keys>        with --json: play these MIDI notes one after another (an instrument), then
                       stop 1 s after the last (without --seconds; without either, stop 1 s after
                       stdin closes and its commands have run)

  A port in use stops it (EADDRINUSE): pass free ones, or --port 0 --files-port 0 for any.
  --ui-preview <file>  the custom UI against the parameters in <file> (no DSP: for a UI whose DSP
                       is not written yet)
  --cyber [origin]     let Cyber follow this plugin (Settings → Plugins → Developer tools → Follow
                       est dev; an admin's or a verified developer's): every good build is installed
                       in Cyber, checked and metered, and its slots and tracks swap to it under a
                       crossfade from their state. [origin] is the Cyber site (default
                       ${CYBER_LIVE_ORIGIN}); give --cyber again for another (a local Cyber).
                       Prints the steps and a link that opens Cyber with Follow offered; says when
                       Cyber attaches (with --json, a { "type": "cyber", "event": "attached" } line)
`;

/** @param {string[]} argv */
export function parseArgs(argv) {
  /** @type {{ target: string, port: number, filesPort: number, watch: boolean, open: boolean, json: boolean, seconds: number | null, play: number[], uiPreview: string | null, help: boolean, cyber: string[] }} */
  const o = { target: '.', port: DEFAULT_HOST_PORT, filesPort: DEFAULT_FILES_PORT, watch: true, open: false, json: false, seconds: null, play: [], uiPreview: null, help: false, cyber: [] };
  const num = (v, flag) => {
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0) throw new Error(`${flag} needs a number`);
    return n;
  };
  let positional = 0;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => { const v = argv[++i]; if (v === undefined) throw new Error(`${a} needs a value`); return v; };
    if (a === '--port') o.port = num(next(), a);
    else if (a === '--files-port') o.filesPort = num(next(), a);
    else if (a === '--no-watch') o.watch = false;
    else if (a === '--open') o.open = true;
    else if (a === '--json') o.json = true;
    else if (a === '--seconds') o.seconds = num(next(), a);
    else if (a === '--play') o.play = next().split(',').map((k) => Math.round(num(k, a))).filter((k) => k >= 0 && k <= 127);
    else if (a === '--ui-preview') o.uiPreview = next();
    else if (a === '--cyber') {
      // EST Phase 5a (5-C): an origin may follow; without one, Cyber's live site.
      const v = argv[i + 1];
      if (v !== undefined && /^https?:\/\//.test(v)) {
        const c = cyberOriginOf(v);
        if (!c) throw new Error(`--cyber takes a site's origin (scheme://host[:port]), not ${v}`);
        o.cyber.push(c);
        i++;
      } else o.cyber.push(CYBER_LIVE_ORIGIN);
    }
    else if (a === '-h' || a === '--help') o.help = true;
    else if (a.startsWith('-')) throw new Error(`unknown option ${a}`);
    else if (positional++ === 0) o.target = a;
    else throw new Error(`one plugin at a time (${a})`);
  }
  return o;
}

/**
 * EST Phase 5a (5-C): what `--cyber` prints: the setting to paste into Cyber. DEV-E (1.325): the exact
 * steps, a link per Cyber origin that opens it with Follow offered (`?est-follow=`: the switch is
 * still yours to click), and that a listed site can see `est dev` is running on this machine.
 * @param {string} filesOrigin @param {readonly string[]} cyber
 */
export function followMessage(filesOrigin, cyber) {
  const links = cyber.map((c) => `    ${followLink(c, filesOrigin)}`).join('\n');
  return `\nFollow this plugin from Cyber (${cyber.join(', ')}):

  1. Sign in to Cyber as an admin or a verified developer (a developer account with a key and a published plugin).
  2. Open your own project (not a live session, not someone else's: Follow never reloads into those).
  3. Settings → Plugins → Developer tools: turn on Developer mode, then Follow est dev, with

    ${filesOrigin}

     The page reloads once, so its policy may reach this computer.

Or open this link, which goes to that page with the address filled in (you still turn it on):

${links}

Each good build is installed there (checked and metered, as any install) and its inserts and tracks swap to it under a short crossfade, from their saved state.
Note: while this runs, a site in that list (${cyber.join(', ')}) can see that est dev is running on this machine.
`;
}

/** DEV-E (1.325): the link that opens `cyber` with Follow offered for `filesOrigin`. @param {string} cyber @param {string} filesOrigin */
export function followLink(cyber, filesOrigin) {
  return `${cyber}/?est-follow=${encodeURIComponent(filesOrigin)}`;
}

const opener = () => (process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open');

/**
 * @param {string[]} argv
 * @param {{ stdout?: NodeJS.WritableStream, stderr?: NodeJS.WritableStream, stdin?: NodeJS.ReadableStream }} [io]
 */
export async function run(argv, io = {}) {
  const stdout = io.stdout ?? process.stdout;
  const stderr = io.stderr ?? process.stderr;
  let o;
  try {
    o = parseArgs(argv);
  } catch (err) {
    stderr.write(`est dev: ${err instanceof Error ? err.message : err}\n\n${usage}`);
    return 2;
  }
  if (o.help) { stdout.write(usage); return 0; }
  if (o.json) return runHeadless(o, { stdout, stderr, stdin: io.stdin ?? process.stdin });

  let host;
  try {
    host = await startDevHost({ target: o.target, hostPort: o.port, filesPort: o.filesPort, watch: o.watch, uiPreview: o.uiPreview ?? undefined, cyber: o.cyber, log: (l) => stdout.write(`${l}\n`) });
  } catch (err) {
    stderr.write(`est dev: ${startMessage(err)}\n`);
    return 1;
  }
  stdout.write(`EST dev host: ${host.url}  (the bundle's files: ${host.filesOrigin})\nPress Ctrl+C to stop; type r and Enter to rebuild.\n`);
  if (o.cyber.length) stdout.write(followMessage(host.filesOrigin, o.cyber));
  if (o.open) spawn(opener(), [host.url], { stdio: 'ignore', detached: true, shell: process.platform === 'win32' }).unref();
  const rl = createInterface({ input: io.stdin ?? process.stdin });
  rl.on('line', (line) => { if (line.trim() === 'r') void host.reload(); });
  await new Promise((resolve) => {
    const stop = () => resolve(undefined);
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
    rl.once('close', () => { if (!process.stdin.isTTY) return; stop(); });
  });
  rl.close();
  await host.close();
  return 0;
}
