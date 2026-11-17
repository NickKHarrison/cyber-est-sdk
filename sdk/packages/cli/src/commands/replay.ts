import { existsSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseCapture } from '../../../../../src/audio/est/crashCapture';
import { formatReplay, frameLabel, replay } from '../../../tools/src/replay';
import { UsageError, type EstCommand } from '../command';
import { buildAndPack, buildWithNames, isBundleFile, shown } from '../build';

/**
 * `est replay <dir|bundle> <capture>` (1.669; sdk/docs/dev-host.md, "Replaying a crash"): a crash
 * capture saved in Cyber (the plugin's card or Diagnostics, with "Keep crash captures" on) played
 * again in the headless host until the plugin traps; the trapping function by name when the build
 * kept its names (`--debug` builds the folder once more with them, as `est profile --debug` does).
 */
const command: EstCommand = {
  name: 'replay',
  summary: 'Replay a crash capture saved in Cyber and name the function the plugin trapped in',
  usage: [
    'est replay [dir|bundle] <capture> [--debug] [--no-build] [--json]',
    '',
    '  dir|bundle     a plugin folder (default .; built and packed first) or a .est bundle',
    '  capture        the .estcapture.json file saved from the plugin\'s card or Diagnostics in Cyber',
    '  --debug        a plugin folder only: build it once more with its function names kept (asc',
    '                 --debug; Rust strip = false) and replay that, so the trap shows by name;',
    '                 dist/ and the bundle you install are not touched (AssemblyScript and Rust)',
    '  --no-build     use the module the last build wrote',
    '  --json         print the report as JSON',
    '',
    'The capture holds the last blocks the plugin was given before it trapped (their input, the',
    'parameters as the first began, the notes and parameter changes at their frames); the replay',
    'starts a fresh instance with those parameters and plays the blocks as Cyber did. It exits 1',
    'when the plugin traps (the crash reproduced), 0 when it does not. Without names in the build',
    'functions show by index: add --debug, or keep the name section yourself (asc --debug; Rust:',
    'strip = false; clang: no --strip-all).',
  ].join('\n'),
  async run(args, ctx) {
    const [first, second] = args.positional;
    if (!first) throw new UsageError('est replay takes a capture file (and a plugin folder or bundle before it)');
    const spec = second === undefined ? '.' : first;
    const capFile = resolve(ctx.cwd, second === undefined ? first : second);
    if (!existsSync(capFile) || !statSync(capFile).isFile()) throw new UsageError(`${shown(ctx.cwd, capFile)} is not a capture file`);
    let capture;
    try { capture = parseCapture(readFileSync(capFile, 'utf8')); } catch (err) {
      throw new UsageError(`${shown(ctx.cwd, capFile)}: ${err instanceof Error ? err.message : String(err)}`);
    }
    const p = resolve(ctx.cwd, spec);
    let bytes: Uint8Array;
    let dir = false;
    if (isBundleFile(p)) bytes = new Uint8Array(readFileSync(p));
    else if (existsSync(p) && statSync(p).isDirectory() && existsSync(join(p, 'est.json'))) {
      dir = true;
      bytes = args.flags.debug === true ? buildWithNames(p, ctx, 'replay') : buildAndPack(p, ctx, { noBuild: args.flags['no-build'] === true }).bytes;
    } else throw new UsageError(`${spec} is not a .est bundle or a plugin folder`);
    if (args.flags.debug === true && !dir) throw new UsageError('--debug builds a plugin folder (a bundle has the names it was built with)');
    const report = await replay(bytes, capture);
    if (args.flags.json) ctx.out(JSON.stringify({ ...report, function: report.function ? { ...report.function, label: frameLabel(report.function) } : null }, null, 2));
    else ctx.out(formatReplay(report));
    return report.trapped ? 1 : 0;
  },
};
export default command;
