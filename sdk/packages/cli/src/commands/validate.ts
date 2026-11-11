import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { formatReport, validate } from '../../../tools/src/index';
import { flagString, type EstCommand } from '../command';
import { buildAndPack, isBundleFile } from '../build';

/**
 * `est validate [dir | file.est] [--json] [--no-build] [--seconds N] [--verbose]`: the full
 * validator (Cyber's install check plus the validator's own), a readable report, and
 * `validation.json` next to the bundle; exit 1 on any failure.
 */
const command: EstCommand = {
  name: 'validate',
  summary: 'Validate a plugin folder (built and packed first) or a .est; writes validation.json',
  usage: [
    'est validate [dir | file.est] [--json] [--no-build] [--seconds <n>] [--verbose]',
    '',
    '  dir         a plugin folder (default .): built with its template\'s build, packed to dist/<id>-<version>.est, then validated',
    '  file.est    a bundle, validated as it is',
    '  --json      print validation.json instead of the readable report',
    '  --no-build  pack the module the last build wrote',
    '  --seconds   seconds of conformance signal (default 10, as Cyber\'s install)',
    '  --verbose   list the rules that passed and were skipped too',
    '',
    'validation.json is written next to the bundle (dist/validation.json for a folder). Exit 1 when a check fails.',
  ].join('\n'),
  valueFlags: ['seconds'],
  async run(args, ctx) {
    const target = resolve(ctx.cwd, args.positional[0] ?? '.');
    const seconds = flagString(args, 'seconds') ? Number(flagString(args, 'seconds')) : undefined;
    if (seconds !== undefined && !(seconds > 0 && seconds <= 60)) throw new Error('--seconds is a number from 0 to 60');
    let bytes: Uint8Array;
    let file: string;
    if (isBundleFile(target)) {
      bytes = new Uint8Array(readFileSync(target));
      file = target;
    } else {
      const p = buildAndPack(target, ctx, { noBuild: args.flags['no-build'] === true });
      bytes = p.bytes;
      file = p.file;
    }
    const v = await validate(bytes, { seconds });
    const json = `${JSON.stringify(v, null, 2)}\n`;
    const out = join(dirname(file), 'validation.json');
    writeFileSync(out, json);
    if (args.flags.json) ctx.out(json.trimEnd());
    else {
      ctx.out(formatReport(v, { verbose: args.flags.verbose === true }));
      ctx.out(`  bundle ${file}\n  report ${out}`);
    }
    return v.ok ? 0 : 1;
  },
};
export default command;
