import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { compareRenders, compareWarnings, formatCompare, htmlReport, inputSamples, readWav, render, writeWav, type RenderEvent, type RenderInput, type Stereo } from '../../../tools/src/index';
import { UsageError, flagString, type CommandContext, type EstCommand, type ParsedArgs } from '../command';
import { buildAndPack, isBundleFile, shown } from '../build';
import { readBundle } from '../../../../../src/audio/est/install/bundle';

/**
 * `est compare <a> <b>` (EST-DEV-3, DEV-G 1.326; sdk/docs/porting-cpp.md, "Checking a port"): the
 * same input and events through two bundles (or a bundle and the WAV a desktop build rendered from
 * the same input), measured against each other (`compareRenders` in @est/tools). A bundle renders
 * on `render`: Cyber's own `est-plugin` processor, metered as at install, on the conformance host,
 * block by block, so the render is what Cyber plays and the same bits on every run.
 */

type Side = { kind: 'bundle'; bytes: Uint8Array; name: string } | { kind: 'wav'; audio: Stereo; name: string };

function sideOf(spec: string, ctx: CommandContext, noBuild: boolean): Side {
  const p = resolve(ctx.cwd, spec);
  if (/\.wav$/i.test(p)) {
    if (!existsSync(p)) throw new Error(`${spec}: no such file`);
    return { kind: 'wav', audio: readWav(new Uint8Array(readFileSync(p))), name: shown(ctx.cwd, p) };
  }
  if (isBundleFile(p)) return { kind: 'bundle', bytes: new Uint8Array(readFileSync(p)), name: shown(ctx.cwd, p) };
  if (existsSync(p) && statSync(p).isDirectory() && existsSync(join(p, 'est.json'))) {
    const packed = buildAndPack(p, ctx, { noBuild });
    return { kind: 'bundle', bytes: packed.bytes, name: `${shown(ctx.cwd, p)} (${packed.id} ${packed.version})` };
  }
  throw new UsageError(`${spec} is not a .est bundle, a plugin folder or a .wav`);
}

/** Events from a flag: a JSON file, or JSON written inline. */
function eventsOf(args: ParsedArgs, flag: string, ctx: CommandContext): RenderEvent[] {
  const v = flagString(args, flag);
  if (!v) return [];
  const p = resolve(ctx.cwd, v);
  let parsed: unknown;
  try { parsed = JSON.parse(existsSync(p) && !v.trim().startsWith('[') ? readFileSync(p, 'utf8') : v); } catch (err) {
    throw new UsageError(`--${flag}: not JSON (${err instanceof Error ? err.message : String(err)})`);
  }
  const list = Array.isArray(parsed) ? parsed : (parsed as { events?: unknown })?.events;
  if (!Array.isArray(list) || !list.every(e => e && typeof e === 'object' && typeof (e as RenderEvent).type === 'string')) {
    throw new UsageError(`--${flag}: a list of events ([{ "type": "param", "time": 0.5, "id": 0, "value": -6 }, …], or a golden.json's "events")`);
  }
  return list as RenderEvent[];
}

const num = (args: ParsedArgs, flag: string): number | undefined => {
  const v = flagString(args, flag);
  if (v === undefined) return undefined;
  const n = Number(v.replace(/db$/i, ''));
  if (!Number.isFinite(n)) throw new UsageError(`--${flag} takes a number`);
  return n;
};

const command: EstCommand = {
  name: 'compare',
  summary: 'Render the same input through two bundles (or a bundle and a desktop WAV) and report how they differ',
  usage: [
    'est compare <a> <b> [--input <kind|file.wav>] [--events <json>] [--events-a <json>] [--events-b <json>]',
    '            [--seconds <n>] [--sample-rate <hz>] [--tolerance <dB>] [--threshold <dB>]',
    '            [--report <file.html>] [--write-input <file.wav>] [--write-a <file.wav>] [--write-b <file.wav>]',
    '            [--no-build] [--json]',
    '',
    '  a, b             a .est bundle, a plugin folder (built and packed first), or a .wav: a render',
    '                   the desktop build of the same DSP made from the same input (--write-input)',
    '  --input          sine (440 Hz, -6 dBFS), noise (seeded), impulse, silence (an instrument), or a',
    '                   .wav played into both (default noise)',
    '  --events         events for both, as Cyber\'s processor takes them, time in seconds: a JSON file',
    '                   or inline ([{"type":"param","time":0.5,"id":0,"value":-6}], noteOn, noteOff …);',
    '                   --events-a / --events-b add events to one side only (a parameter that maps',
    '                   differently in the port)',
    '  --seconds        the length (default: the input WAV\'s, else a reference WAV\'s, else 2)',
    '  --sample-rate    default: the input WAV\'s, else a reference WAV\'s, else 48000',
    '  --tolerance      the largest allowed peak of the difference B − A, dBFS (default -80): past it,',
    '                   when the lengths differ, or when either side has a NaN or an infinity, exit 1',
    '  --threshold      where "they part" is reported from, dBFS (default: the tolerance)',
    '  --report         the HTML report (default est-compare.html here): the waveforms overlaid',
    '  --write-input    write the input as a 32-bit float WAV, for the desktop build to process',
    '  --write-a/-b     write a side\'s render as a WAV',
    '',
    'Reports per channel: each side\'s peak and RMS, the level difference, the difference\'s peak and',
    'RMS, octave bands B − A, and the first frame where they part. Exit 0 when the same within the',
    'tolerance, 1 when not, 2 on a usage error.',
  ].join('\n'),
  valueFlags: ['input', 'events', 'events-a', 'events-b', 'seconds', 'sample-rate', 'tolerance', 'threshold', 'report', 'write-input', 'write-a', 'write-b'],
  async run(args, ctx) {
    const [sa, sb] = args.positional;
    if (!sa || !sb) throw new UsageError('name two things to compare');
    const noBuild = args.flags['no-build'] === true;
    const a = sideOf(sa, ctx, noBuild), b = sideOf(sb, ctx, noBuild);

    const inputFlag = flagString(args, 'input') ?? 'noise';
    let inputWav: Stereo | null = null;
    if (/\.wav$/i.test(inputFlag)) inputWav = readWav(new Uint8Array(readFileSync(resolve(ctx.cwd, inputFlag))));
    else if (!['sine', 'noise', 'impulse', 'silence'].includes(inputFlag)) throw new UsageError(`--input ${inputFlag}: sine, noise, impulse, silence or a .wav`);
    const reference = a.kind === 'wav' ? a.audio : b.kind === 'wav' ? b.audio : null;
    const sampleRate = num(args, 'sample-rate') ?? inputWav?.sampleRate ?? reference?.sampleRate ?? 48000;
    const seconds = num(args, 'seconds') ?? (inputWav ? inputWav.left.length / inputWav.sampleRate : reference ? reference.left.length / reference.sampleRate : 2);
    if (inputWav && inputWav.sampleRate !== sampleRate) throw new UsageError(`--input is at ${inputWav.sampleRate} Hz, --sample-rate ${sampleRate}`);
    const input: RenderInput = inputWav ? { kind: 'samples', left: inputWav.left, right: inputWav.right }
      : inputFlag === 'sine' ? { kind: 'sine', freq: 440, amp: 0.5 }
        : inputFlag === 'impulse' ? { kind: 'impulse', amp: 1 }
          : inputFlag === 'silence' ? { kind: 'silence' } : { kind: 'noise', amp: 0.25, seed: 1 };
    const events = eventsOf(args, 'events', ctx);
    const per = { a: eventsOf(args, 'events-a', ctx), b: eventsOf(args, 'events-b', ctx) };
    const frames = Math.round(seconds * sampleRate);

    if (flagString(args, 'write-input')) {
      // The input exactly as the bundles get it, sample for sample.
      const { left: l, right: r } = inputSamples(input, frames, sampleRate);
      const out = resolve(ctx.cwd, flagString(args, 'write-input')!);
      mkdirSync(dirname(out), { recursive: true });
      writeFileSync(out, writeWav({ sampleRate, left: l, right: r }));
      ctx.err(`est compare: the input written to ${shown(ctx.cwd, out)}`);
    }

    const audioOf = async (s: Side, which: 'a' | 'b'): Promise<Stereo> => {
      if (s.kind === 'wav') return s.audio;
      const r = await render(s.bytes, { seconds, sampleRate, input, events: [...events, ...per[which]] });
      if (r.error) throw new Error(`${which.toUpperCase()} (${s.name}) stopped: ${r.error}`);
      return { sampleRate: r.sampleRate, left: r.left, right: r.right };
    };
    // 1.400 (P3): say first when the two cannot be compared usefully (an effect against an instrument).
    const kindOf = async (s: Side): Promise<string | null> => {
      if (s.kind === 'wav') return null;
      try { return (await readBundle(s.bytes)).manifest.kind; } catch { return null; }
    };
    const warnings = compareWarnings(await kindOf(a), await kindOf(b), inputWav ? 'a file' : inputFlag, [...events, ...per.a, ...per.b].some(e => e.type === 'noteOn'));
    for (const w of warnings) ctx.err(`est compare: warning: ${w}`);
    const [ra, rb] = [await audioOf(a, 'a'), await audioOf(b, 'b')];
    for (const [flag, audio] of [['write-a', ra], ['write-b', rb]] as const) {
      const f = flagString(args, flag);
      if (f) { const out = resolve(ctx.cwd, f); mkdirSync(dirname(out), { recursive: true }); writeFileSync(out, writeWav(audio)); }
    }
    const result = compareRenders(ra, rb, { toleranceDb: num(args, 'tolerance'), thresholdDb: num(args, 'threshold') });
    const names = { a: a.name, b: b.name };
    const setup = `Input: ${inputWav ? inputFlag : inputFlag === 'sine' ? 'a 440 Hz sine at -6 dBFS' : inputFlag === 'noise' ? 'seeded noise at -12 dBFS' : inputFlag}; ${events.length + per.a.length + per.b.length} event${events.length + per.a.length + per.b.length === 1 ? '' : 's'} (${events.length} to both, ${per.a.length} to A only, ${per.b.length} to B only)`;
    const report = resolve(ctx.cwd, flagString(args, 'report') ?? 'est-compare.html');
    mkdirSync(dirname(report), { recursive: true });
    writeFileSync(report, htmlReport(result, ra, rb, names, setup));
    if (args.flags.json) ctx.out(JSON.stringify({ ...result, a: names.a, b: names.b, report, warnings }, null, 2));
    else ctx.out(`${formatCompare(result, names)}${warnings.map(w => `\n  ! ${w}`).join('')}\n  report ${shown(ctx.cwd, report)}`);
    return result.ok ? 0 : 1;
  },
};
export default command;
