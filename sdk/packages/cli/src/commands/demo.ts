import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { render, type RenderInput } from '../../../tools/src/index';
import { UsageError, flagString, type EstCommand } from '../command';
import { buildAndPack, shown } from '../build';
import { readBundle } from '../../../../../src/audio/est/install/bundle';
import { fillLoop, phraseEvents, loopSeconds, LOOP_BPM } from '../../../../../src/audio/est/testLoop';

/**
 * `est demo` (1.788, order V: every builder of the vibe-coder run made the store's demo clip by hand,
 * through `est compare --write-a` or a golden render, then a converter of their own): a demo clip of
 * the plugin in one command. An effect plays Cyber's test loop (kick, hats, a chord: the plugin page's
 * own); an instrument (or a note effect's synth) plays the test phrase, repeated. The render is the
 * conformance host's, as `est compare` renders. The clip is normalised to -1 dBFS peak and written as
 * a 16-bit WAV at 44.1 kHz, at most `DEMO_MAX_SECONDS` so it is under the store's 3 MB (`DEMO_LIMITS`).
 */

/** The store's demo limit in bytes (shared/storeDevPage.mjs `DEMO_LIMITS.bytes`, held equal by the test). */
export const DEMO_MAX_BYTES = 3 * 1024 * 1024;
const RATE = 44100;
/** The longest 16-bit stereo WAV at 44.1 kHz within it: (3 MiB − 44) / 176400 → 17 s (the store takes 30 s of a smaller MP3). */
export const DEMO_MAX_SECONDS = Math.floor((DEMO_MAX_BYTES - 44) / (RATE * 4));

/** Stereo float to a 16-bit PCM WAV, normalised to `peakDb` (never raised past +24 dB). */
export function demoWav(left: Float32Array, right: Float32Array, rate: number, peakDb = -1): Uint8Array {
  const frames = Math.min(left.length, right.length);
  let peak = 0;
  for (let i = 0; i < frames; i++) peak = Math.max(peak, Math.abs(left[i]!), Math.abs(right[i]!));
  const gain = peak > 1e-9 ? Math.min(10 ** (peakDb / 20) / peak, 10 ** (24 / 20)) : 1;
  const out = new Uint8Array(44 + frames * 4);
  const v = new DataView(out.buffer);
  const put = (at: number, t: string) => { for (let i = 0; i < 4; i++) out[at + i] = t.charCodeAt(i); };
  put(0, 'RIFF'); v.setUint32(4, 36 + frames * 4, true); put(8, 'WAVE');
  put(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 2, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * 4, true); v.setUint16(32, 4, true); v.setUint16(34, 16, true);
  put(36, 'data'); v.setUint32(40, frames * 4, true);
  const q = (x: number) => Math.max(-32768, Math.min(32767, Math.round(x * gain * 32767)));
  for (let f = 0; f < frames; f++) { v.setInt16(44 + f * 4, q(left[f]!), true); v.setInt16(46 + f * 4, q(right[f]!), true); }
  return out;
}

const command: EstCommand = {
  name: 'demo',
  summary: 'Render a demo clip for the store page (a 16-bit WAV within its 3 MB limit)',
  usage: [
    'est demo [dir|bundle.est] [--out <file.wav>] [--seconds <n>] [--events <json|file>] [--key kick|sine] [--no-phrase] [--no-build]',
    '',
    '  dir         a plugin folder (built and packed first; default .) or a .est bundle',
    '  --out       the WAV (default dist/demo.wav)',
    '  --seconds   the length, at most 17 (16-bit WAV within the store\'s 3 MB; default 12)',
    '  --events    extra events, inline or a JSON file, as est compare takes them (a parameter moving, say):',
    '              [{"type":"param","time":4,"id":0,"value":0.8}], time in seconds',
    '',
    '  --key       what feeds an effect\'s sidechain (EST 1.1): kick (the test loop\'s drums) or sine (110 Hz);',
    '              without it the sidechain hears silence, as in Cyber with no key chosen',
    '  --no-phrase an instrument without the test phrase (a sequencer that plays by itself)',
    '',
    'An effect plays Cyber\'s test loop (the plugin page\'s); an instrument plays the test phrase,',
    'repeated, with the transport playing at 110 BPM in 4/4 from beat 0 (so a step sequencer runs).',
    'Normalised to -1 dBFS peak. Upload it on your plugin\'s Store page, Demo clip.',
  ].join('\n'),
  valueFlags: ['out', 'seconds', 'events', 'key'],
  async run(args, ctx) {
    const secondsFlag = flagString(args, 'seconds');
    const seconds = secondsFlag === undefined ? 12 : Number(secondsFlag);
    if (!Number.isFinite(seconds) || seconds <= 0 || seconds > DEMO_MAX_SECONDS) throw new UsageError(`--seconds: more than 0 and at most ${DEMO_MAX_SECONDS} (a 16-bit WAV that long is the store's 3 MB; for up to 30 s, make an MP3 of a longer render)`);
    const spec = args.positional[0] ?? '.';
    const p = resolve(ctx.cwd, spec);
    let bytes: Uint8Array;
    let defaultOut: string;
    if (/\.est$/i.test(p)) {
      const { readFileSync } = await import('node:fs');
      bytes = new Uint8Array(readFileSync(p));
      defaultOut = resolve(dirname(p), 'demo.wav');
    } else {
      const packed = buildAndPack(p, ctx, { noBuild: args.flags['no-build'] === true });
      bytes = packed.bytes;
      defaultOut = resolve(dirname(packed.file), 'demo.wav');
    }
    let extra: { type: string; time?: number }[] = [];
    const ev = flagString(args, 'events');
    if (ev) {
      // 1.789 (V5b): a file too, as est compare takes one.
      const file = resolve(ctx.cwd, ev);
      const { existsSync, readFileSync } = await import('node:fs');
      const text = !ev.trim().startsWith('[') && existsSync(file) ? readFileSync(file, 'utf8') : ev;
      try { const parsed = JSON.parse(text) as unknown; extra = (Array.isArray(parsed) ? parsed : (parsed as { events?: unknown })?.events) as typeof extra; } catch { throw new UsageError('--events: a JSON list or a JSON file of one (or a golden.json), e.g. [{"type":"param","time":4,"id":0,"value":0.8}]'); }
      if (!Array.isArray(extra)) throw new UsageError('--events: a JSON list');
    }
    const kind = (await readBundle(bytes)).manifest.kind;
    const frames = Math.round(seconds * RATE);
    let input: RenderInput = { kind: 'silence' };
    const events: { type: string; time?: number; [k: string]: unknown }[] = [];
    if (kind === 'effect') {
      const left = new Float32Array(frames), right = new Float32Array(frames);
      fillLoop(left, right, RATE, LOOP_BPM);
      input = { kind: 'samples', left, right };
    } else {
      const pass = loopSeconds(LOOP_BPM);
      let id = 1;
      // 1.789 (V5b): the transport plays, so a plugin that follows it (a step sequencer) is heard.
      events.push({ type: 'transport', time: 0, tempo: LOOP_BPM, beat: 0, seconds: 0, num: 4, den: 4, barStart: 0, barNumber: 0, playing: true });
      for (let t = 0.05; args.flags['no-phrase'] !== true && t < seconds - 0.5; t += pass) {
        for (const e of phraseEvents(t, id)) if (e.time < seconds - 0.25) events.push({ type: e.type, time: e.time, key: e.key, channel: 0, port: 0, noteId: e.noteId, velocity: e.velocity });
        id += 100;
      }
      // Every note still held at the end is let go just before it.
      const on = new Map<number, { key: number }>();
      for (const e of events) { if (e.type === 'noteOn') on.set(e.noteId as number, { key: e.key as number }); else on.delete(e.noteId as number); }
      for (const [noteId, n] of on) events.push({ type: 'noteOff', time: seconds - 0.25, key: n.key, channel: 0, port: 0, noteId, velocity: 0 });
      events.sort((a, b) => (a.time ?? 0) - (b.time ?? 0));
    }
    // 1.803: a key for the sidechain, so a ducker's demo ducks.
    const keyFlag = flagString(args, 'key');
    if (keyFlag !== undefined && keyFlag !== 'kick' && keyFlag !== 'sine') throw new UsageError('--key is kick (the test loop\'s drums) or sine');
    let key: RenderInput | undefined;
    if (keyFlag === 'kick') {
      const left = new Float32Array(frames), right = new Float32Array(frames);
      fillLoop(left, right, RATE, LOOP_BPM, 'drums');
      key = { kind: 'samples', left, right };
    } else if (keyFlag === 'sine') key = { kind: 'sine', freq: 110, amp: 0.5 };
    const r = await render(bytes, { seconds, sampleRate: RATE, input, events: [...events, ...extra], ...(key ? { key } : {}) });
    if (r.error) throw new Error(`the plugin stopped while rendering: ${r.error}`);
    if (r.key === 'ignored') ctx.err('est demo: --key ignored: this plugin has no sidechain input (EST 1.1, est.json\'s second audio input with "role": "sidechain")');
    const wav = demoWav(r.left, r.right, r.sampleRate);
    const out = resolve(ctx.cwd, flagString(args, 'out') ?? defaultOut);
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, wav);
    ctx.out(`wrote ${shown(ctx.cwd, out)} (${seconds} s, ${Math.round(wav.length / 1024)} KB, 16-bit, ${RATE} Hz)\nNext: your plugin's Store page, Demo clip`);
    return 0;
  },
};
export default command;
