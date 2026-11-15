/**
 * 1.604: `est quality`'s measures (sdk/packages/tools/src/qualityMeasures.ts) against signals whose
 * answers are known, its preset kinds and phrases, and the command on a catalogue instrument.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { clickAt, correlation, dcDb, inharmonicDb, integratedLufs, spectrum, truePeakDb } from '../packages/tools/src/qualityMeasures';
import { kindOf, phraseFor, qualityOf, stateValues, TARGETS } from '../packages/tools/src/quality';

const SR = 48000;
const sine = (freq: number, amp: number, seconds: number, phase = 0, sr = SR) => {
  const x = new Float32Array(Math.round(seconds * sr));
  for (let i = 0; i < x.length; i++) x[i] = amp * Math.sin((2 * Math.PI * freq * i) / sr + phase);
  return x;
};

describe('the measures', () => {
  it('reads a 997 Hz sine at -20 dBFS in both channels as -20 LUFS (BS.1770: 0 dBFS in both is 0 LUFS), and silence as -Infinity', () => {
    const x = sine(997, 0.1, 5);
    expect(integratedLufs(x, x, SR)).toBeCloseTo(-20, 0);
    expect(Math.abs(integratedLufs(x, x, SR) + 20)).toBeLessThan(0.15);
    // One channel alone is 3 dB down.
    expect(integratedLufs(x, new Float32Array(x.length), SR)).toBeCloseTo(-23, 0);
    // The same at 96 kHz (the filters are made for the rate).
    const y = sine(997, 0.1, 5, 0, 96000);
    expect(Math.abs(integratedLufs(y, y, 96000) + 20)).toBeLessThan(0.15);
    expect(integratedLufs(new Float32Array(SR * 2), new Float32Array(SR * 2), SR)).toBe(-Infinity);
  });

  it('finds the true peak between the samples: a full-scale sine at a quarter of the rate sampled at 45° reads 0 dBTP, its samples -3 dB', () => {
    const x = sine(SR / 4, 1, 0.1, Math.PI / 4);
    let sample = 0;
    for (const v of x) sample = Math.max(sample, Math.abs(v));
    expect(20 * Math.log10(sample)).toBeCloseTo(-3.01, 1);
    expect(Math.abs(truePeakDb(x))).toBeLessThan(0.3);
  });

  it('reads a mean as DC and an inverted channel as a correlation of -1', () => {
    const x = sine(220, 0.5, 1);
    const off = x.map(v => v + 0.01);
    expect(dcDb(off)).toBeCloseTo(-40, 0);
    expect(dcDb(x)).toBeLessThan(-80);
    expect(correlation(x, x.map(v => -v))).toBeCloseTo(-1, 5);
    expect(correlation(x, x)).toBeCloseTo(1, 5);
  });

  it('tells a click (a step in a sine) from a smooth attack and from a loud steady sound', () => {
    const at = SR / 2;
    // A 5 ms raised-cosine fade-in: no click.
    const smooth = sine(200, 0.5, 1);
    for (let i = 0; i < at; i++) smooth[i] = 0;
    for (let i = 0; i < 240; i++) smooth[at + i]! *= 0.5 - 0.5 * Math.cos((Math.PI * i) / 240);
    expect(clickAt(smooth, smooth, at, SR).ratio).toBeLessThan(4);
    // The same tone switched on at its peak: a step from 0 to 0.5.
    const hard = sine(200, 0.5, 1, Math.PI / 2);
    for (let i = 0; i < at; i++) hard[i] = 0;
    expect(clickAt(hard, hard, at, SR).ratio).toBeGreaterThan(20);
    // A step of 0.2 under a steady tone.
    const stepped = sine(200, 0.5, 1);
    for (let i = at; i < stepped.length; i++) stepped[i]! += 0.2;
    expect(clickAt(stepped, stepped, at, SR).ratio).toBeGreaterThan(8);
    // A steady bright tone with nothing at the moment: about 1.
    const steady = sine(3000, 0.8, 1);
    expect(clickAt(steady, steady, at, SR).ratio).toBeLessThan(2);
  });

  it('measures the power between a held note\'s harmonics: a harmonic tone reads low, a tone between its harmonics at -20 dB reads about -20', () => {
    const f0 = 440 * 2 ** ((96 - 69) / 12);
    const n = SR;
    const harm = new Float32Array(n), mixed = new Float32Array(n);
    for (let k = 1; k * f0 < 18000; k++) {
      const h = sine(k * f0, 0.5 / k, 1);
      for (let i = 0; i < n; i++) { harm[i]! += h[i]!; mixed[i]! += h[i]!; }
    }
    let p = 0;
    for (let k = 1; k * f0 < 18000; k++) p += (0.5 / k) ** 2;
    const alias = sine(f0 * 1.5, Math.sqrt(p) * 0.1, 1);
    for (let i = 0; i < n; i++) mixed[i]! += alias[i]!;
    expect(inharmonicDb(spectrum(harm, harm, 4096, 16384), SR, f0)).toBeLessThan(-50);
    expect(Math.abs(inharmonicDb(spectrum(mixed, mixed, 4096, 16384), SR, f0) + 20)).toBeLessThan(1.5);
  });
});

describe('the presets', () => {
  it('reads the SDK state format (magic, version, count, then id and value pairs) and refuses another', () => {
    const b = new Uint8Array(12 + 2 * 12);
    const v = new DataView(b.buffer);
    b.set([69, 83, 84, 49]);
    v.setUint32(4, 1, true);
    v.setUint32(8, 2, true);
    v.setUint32(12, 0, true); v.setFloat64(16, -6, true);
    v.setUint32(24, 3, true); v.setFloat64(28, 50, true);
    expect(stateValues(b)).toEqual([[0, -6], [3, 50]]);
    expect(stateValues(b.subarray(0, 30))).toBeNull();
  });

  it('gives a kind from the tags (drums, then bass, then a chord, else a melody), a profile first, and a phrase each', () => {
    expect(kindOf('A', ['kit', 'bass'])).toBe('drums');
    expect(kindOf('A', ['808', 'slide'])).toBe('bass');
    expect(kindOf('A', ['pad', 'warm'])).toBe('chord');
    expect(kindOf('A', ['lead'])).toBe('melody');
    expect(kindOf('A', ['ostinato', 'bass'], { tags: { ostinato: 'chord' } })).toBe('chord');
    expect(kindOf('A', ['lead'], { kinds: { A: 'bass' } })).toBe('bass');
    expect(TARGETS).toEqual({ chord: -16, melody: -16, bass: -14, drums: -14 });
    for (const kind of ['chord', 'melody', 'bass', 'drums'] as const) {
      const { notes, end } = phraseFor(kind, { kick: 60, snare: 62, hat: 66, open: 69 });
      expect(notes.length).toBeGreaterThan(5);
      expect(end).toBeLessThan(4.5);
      if (kind === 'drums') expect(new Set(notes.map(n => n[1]))).toEqual(new Set([60, 62, 66, 69]));
    }
  });
});

describe('est quality on a catalogue instrument', () => {
  it('measures one of FILMSTRIP\'s presets: every reading finite, the stated targets, no click, denormal or stuck note', async () => {
    const catalogue = JSON.parse(readFileSync(fileURLToPath(new URL('../../est-plugins/registry/catalogue.json', import.meta.url)), 'utf8')) as { id: string; hash: string }[];
    const row = catalogue.filter(r => r.id === 'org.nickkharrison.filmstrip').at(-1)!;
    const bytes = new Uint8Array(readFileSync(fileURLToPath(new URL(`../../est-plugins/dist/${row.hash}/bundle.est`, import.meta.url))));
    const r = await qualityOf(bytes, {}, { only: ['Optical Bass'] });
    expect(r.presets).toHaveLength(1);
    const p = r.presets[0]!;
    expect(p.kind).toBe('bass');
    expect(p.error).toBeNull();
    expect(Number.isFinite(p.lufs) && Number.isFinite(p.truePeak)).toBe(true);
    expect(p.flags.filter(f => !f.startsWith('level '))).toEqual([]);
    expect(p.denormals).toBe(0);
    expect(p.fuel).toBeGreaterThan(0);
    expect(p.fuel).toBeLessThan(0.75);
  }, 120_000);
});
