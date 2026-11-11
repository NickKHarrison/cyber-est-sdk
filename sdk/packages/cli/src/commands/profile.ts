import { existsSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { readProject, type GoldenSpec } from '../../../tools/src/index';
import { formatProfile, functionLabel, profile } from '../../../tools/src/profile';
import { UsageError, flagString, type EstCommand, type ParsedArgs } from '../command';
import { buildAndPack, buildWithNames, isBundleFile, shown } from '../build';

/**
 * `est profile <dir|bundle>` (1.334, R-C; sdk/docs/dev-host.md, "Profiling"): where a block's fuel
 * goes. The conformance run's signal (or the golden spec) on a profiling build of the metered
 * module (`profile` in @est/tools: the same rewrite plus a fuel and a call counter per function,
 * never installed), the functions by fuel with their share of the block and their calls, named
 * from the module's name section when the build kept one; the budget in EST-P001's words.
 */

const num = (args: ParsedArgs, flag: string): number | undefined => {
  const v = flagString(args, flag);
  if (v === undefined) return undefined;
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) throw new UsageError(`--${flag} takes a positive number`);
  return n;
};

const command: EstCommand = {
  name: 'profile',
  summary: 'Show where a block\'s fuel goes, function by function (the functions by fuel, share and calls)',
  usage: [
    'est profile [dir|bundle] [--debug] [--seconds <n>] [--notes] [--golden] [--top <n>] [--no-build] [--json]',
    '',
    '  dir|bundle     a plugin folder (default .; built and packed first) or a .est bundle',
    '  --seconds <n>  seconds of the conformance run (default 10, as at install)',
    '  --notes        play the conformance run\'s notes into an effect too (a note effect); an',
    '                 instrument always gets them',
    '  --golden       render the folder\'s golden spec (test/golden.json) instead of the conformance signal',
    '  --debug        a plugin folder only: build it once more with its function names kept (asc',
    '                 --debug; Rust strip = false) and profile that, so functions show by name;',
    '                 dist/ and the bundle you install are not touched (AssemblyScript and Rust)',
    '  --top <n>      how many functions to list (default 10)',
    '  --no-build     use the module the last build wrote',
    '  --json         print the whole table as JSON',
    '',
    'Each function\'s fuel is its own points (what it calls is counted on the callee), its share of',
    'all the fuel the blocks spent, its calls a block, and its estimated part of the block\'s time on',
    'this machine. The profiling build is made here and never installed; its fuel equals the plain',
    'build\'s exactly. Without names in the build functions show by index: add --debug, or keep the',
    'name section in the build yourself (asc --debug; Rust: strip = false; clang: -g).',
  ].join('\n'),
  valueFlags: ['seconds', 'top'],
  async run(args, ctx) {
    const spec = args.positional[0] ?? '.';
    const p = resolve(ctx.cwd, spec);
    let bytes: Uint8Array;
    let dir: string | null = null;
    if (isBundleFile(p)) bytes = new Uint8Array(readFileSync(p));
    else if (existsSync(p) && statSync(p).isDirectory() && existsSync(join(p, 'est.json'))) {
      dir = p;
      bytes = args.flags.debug === true ? buildWithNames(p, ctx) : buildAndPack(p, ctx, { noBuild: args.flags['no-build'] === true }).bytes;
    } else throw new UsageError(`${spec} is not a .est bundle or a plugin folder`);
    if (args.flags.debug === true && !dir) throw new UsageError('--debug builds a plugin folder (a bundle has the names it was built with)');

    let golden: GoldenSpec | undefined;
    if (args.flags.golden) {
      if (!dir) throw new UsageError('--golden takes a plugin folder (its test/golden.json)');
      const file = readProject(dir).golden;
      if (!existsSync(file)) throw new UsageError(`--golden: ${shown(ctx.cwd, file)} is not there`);
      golden = JSON.parse(readFileSync(file, 'utf8')) as GoldenSpec;
    }
    const top = num(args, 'top');
    const report = await profile(bytes, { seconds: num(args, 'seconds'), notes: args.flags.notes === true, golden });
    if (args.flags.json) ctx.out(JSON.stringify({ ...report, functions: report.functions.map(f => ({ ...f, label: functionLabel(f) })) }, null, 2));
    else ctx.out(formatProfile(report, { top: top === undefined ? undefined : Math.floor(top) }));
    return report.error ? 1 : 0;
  },
};
export default command;
