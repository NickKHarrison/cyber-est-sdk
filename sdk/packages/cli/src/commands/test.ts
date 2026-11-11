import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { compareGolden, compareNotes, formatReport, notesJson, goldenBytes, goldenFromBytes, readProject, renderGoldenBundleFull, validate, type GoldenNote, type GoldenSpec } from '../../../tools/src/index';
import { flagString, type EstCommand } from '../command';
import { buildAndPack, shown } from '../build';

/**
 * `est test [dir] [--update] [--no-build]`: the plugin's golden render (4-B's format, the
 * templates': `test/golden.json`, or the build block's `golden`, played on Cyber's host code by
 * `sdk/testing/golden.ts` and compared with its stored render within its tolerance; `--update`
 * writes the render), then the conformance run (the validator). Exit 1 on any failure.
 */
const command: EstCommand = {
  name: 'test',
  summary: 'Run the plugin\'s golden render (test/golden.json) and the conformance run',
  usage: [
    'est test [dir] [--update] [--no-build] [--seconds <n>]',
    '',
    '  dir            a plugin folder (default .): built and packed first',
    '  --update       write the stored render from this build instead of comparing (after changing',
    '                 the sound on purpose: listen to it first)',
    '  --no-build     use the module the last build wrote',
    '  --seconds <n>  seconds of the conformance run (default 10, as at install)',
    '',
    'The golden spec, test/golden.json (every template has one; the build block\'s `golden` names',
    'another): { "sampleRate": 48000, "frames": 12288 (a multiple of 128),',
    '  "input": { "kind": "noise", "seed": 1, "level": 0.5 } (an effect; "none" for an instrument),',
    '  "events": [{ "type": "param", "time": 0.1, "id": 0, "value": -6 },',
    '             { "type": "noteOn", "time": 0, "key": 60, "velocity": 0.8, "noteId": 1, "channel": 0, "port": 0 }],',
    '  "tolerance": 1e-6, "render": "golden.f32" }',
    'Events are the EST processor\'s own (param, noteOn, noteOff, choke, expression, transport), time',
    'in seconds. The stored render (beside the spec) is little-endian float32, the left channel\'s',
    'frames, then the right\'s.',
  ].join('\n'),
  valueFlags: ['seconds'],
  async run(args, ctx) {
    const dir = resolve(ctx.cwd, args.positional[0] ?? '.');
    const p = buildAndPack(dir, ctx, { noBuild: args.flags['no-build'] === true });
    let failed = 0;
    const specFile = readProject(dir).golden;
    if (!existsSync(specFile)) ctx.out(`golden render: none (${shown(ctx.cwd, specFile)} is not there; a template has one)`);
    else {
      const spec = JSON.parse(readFileSync(specFile, 'utf8')) as GoldenSpec;
      const file = join(dirname(specFile), spec.render ?? 'golden.f32');
      try {
        const full = await renderGoldenBundleFull(p.bytes, spec);
        const out = full.audio;
        // DEV-F (1.321): a note effect's notes, compared exactly with the stored list.
        if (spec.notes) {
          const notesFile = join(dirname(specFile), spec.notes);
          if (args.flags.update || !existsSync(notesFile)) {
            writeFileSync(notesFile, notesJson(full.notes));
            ctx.out(`  + golden notes: ${shown(ctx.cwd, notesFile)} written (${full.notes.length} notes)`);
          } else {
            const diff = compareNotes(full.notes, JSON.parse(readFileSync(notesFile, 'utf8')) as GoldenNote[]);
            if (diff) { failed++; ctx.out(`  x golden notes: ${diff} (est test --update writes the new list)`); }
            else ctx.out(`  . golden notes: the same ${full.notes.length} notes`);
          }
        }
        if (args.flags.update || !existsSync(file)) {
          writeFileSync(file, goldenBytes(out));
          ctx.out(`  + golden: ${shown(ctx.cwd, file)} written (${out.length / 2} frames)${args.flags.update ? '' : ' (there was none)'}`);
        } else {
          const tolerance = spec.tolerance ?? 1e-6;
          const c = compareGolden(out, goldenFromBytes(new Uint8Array(readFileSync(file))));
          if (c.maxDiff <= tolerance) ctx.out(`  . golden: within ${tolerance} (largest difference ${c.maxDiff.toExponential(2)})`);
          else {
            failed++;
            const frames = out.length / 2;
            const where = c.at < 0 ? 'a different length' : `differs by ${c.maxDiff.toExponential(2)} at frame ${c.at % frames} (${c.at < frames ? 'left' : 'right'})`;
            ctx.out(`  x golden: ${where} (est test --update writes the new render)`);
          }
        }
      } catch (err) {
        failed++;
        ctx.out(`  x golden: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    const seconds = flagString(args, 'seconds') ? Number(flagString(args, 'seconds')) : undefined;
    const v = await validate(p.bytes, { seconds });
    ctx.out(formatReport(v));
    if (!v.ok) failed++;
    ctx.out(failed ? `est test: ${failed} failed` : 'est test: all passed');
    return failed ? 1 : 0;
  },
};
export default command;
