/**
 * 1.803 (the loop): a **key for the sidechain** in the golden spec, `est test`, `est demo` and the
 * free render. Before, every tool of the kit fed a sidechain silence, so a ducker whose sidechain
 * did nothing still passed its own test. `test/golden.json` takes an optional `key` in the input's
 * own vocabulary (`noise`, `none`, and `bursts`, a kick-like pattern); a plugin with a sidechain
 * (EST 1.1's `{ "role": "sidechain" }`) hears it on its second input, and one without ignores it,
 * said in words. Played here on the committed EST 1.1 fixture with a sidechain (the Key Duck,
 * `src/audio/est/fixtures/keyduck.wasm`): no toolchain needed.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseManifest } from '../../src/audio/est/install/bundle';
import { meter } from '../../src/audio/est/install/estMeter';
import { packBundle } from '../../scripts/est-pack.mjs';
import { render } from '../packages/tools/src/render';
import { goldenInput, goldenKeyOf, goldenSignal, renderGoldenFull, type GoldenSpec } from '../testing/golden';
import { repo } from './helpers';

const H = 'a'.repeat(64);
const DUCK = {
  est: 1, id: 'org.cyber.est.keyduck', version: '1.1.0', name: 'EST Key Duck', vendor: 'Cyber', license: 'MIT', kind: 'effect', features: ['audio-effect'],
  abi: { est: '1.1', clap: '1.2' }, module: { path: 'module.wasm', sha256: H, bytes: 1024 },
  audio: { inputs: [{ channels: 2 }, { role: 'sidechain', channels: 2 }], outputs: [{ channels: 2 }] },
  parameters: [{ id: 0, name: 'Gain', unit: 'dB', modulatable: true }],
};
const wasm = new Uint8Array(readFileSync(repo('src/audio/est/fixtures/keyduck.wasm')));
const module = new WebAssembly.Module(meter(wasm).bytes as BufferSource);
const manifest = parseManifest(DUCK);

const SPEC: GoldenSpec = { sampleRate: 48000, frames: 48000 - (48000 % 128), input: { kind: 'noise', seed: 1, level: 0.5 }, events: [], tolerance: 1e-6, render: 'golden.f32' };
const rms = (x: Float32Array, from: number, to: number) => { let s = 0; for (let i = from; i < to; i++) s += x[i]! * x[i]!; return Math.sqrt(s / (to - from)); };
const same = (a: Float32Array, b: Float32Array) => a.length === b.length && a.every((v, i) => v === b[i]);

describe('the golden spec\'s signals', () => {
  it('bursts: a square on for the first quarter of each period, silent for the rest, exact on any block size', () => {
    const sr = 48000;
    const all = goldenSignal({ kind: 'bursts', level: 0.5 }, sr, 0, 0, sr);
    // Two periods a second: on for 6000 frames of each 24000.
    expect(Math.abs(all[0]!)).toBe(0.5);
    expect(Math.abs(all[5999]!)).toBe(0.5);
    expect(all[6000]).toBe(0);
    expect(all[23999]).toBe(0);
    expect(Math.abs(all[24000]!)).toBe(0.5);
    expect(all[30000]).toBe(0);
    // The same samples whatever the block it is asked in, and on both channels.
    expect([...goldenSignal({ kind: 'bursts', level: 0.5 }, sr, 0, 5990, 20)]).toEqual([...all.slice(5990, 6010)]);
    expect(same(goldenSignal({ kind: 'bursts', level: 0.5 }, sr, 1, 0, sr), all)).toBe(true);
    // A rate of its own.
    const fast = goldenSignal({ kind: 'bursts', rate: 8 }, sr, 0, 0, 6000);
    expect(Math.abs(fast[1499]!)).toBe(0.5);
    expect(fast[1500]).toBe(0);
  });

  it('noise is the input it always was (sdk/tests/templates.test.ts holds every stored render to it)', () => {
    const a = goldenInput(SPEC, 0, 0, 256);
    expect(same(a, goldenSignal(SPEC.input, 48000, 0, 0, 256))).toBe(true);
    // The two channels are different noise over the same square; a block asked later is the same samples.
    expect(same(a, goldenInput(SPEC, 1, 0, 256))).toBe(false);
    expect(same(goldenInput(SPEC, 0, 128, 128), a.slice(128))).toBe(true);
    expect(goldenSignal({ kind: 'none' }, 48000, 0, 0, 8).every(v => v === 0)).toBe(true);
  });

  it('says what becomes of a key: fed, ignored or none', () => {
    expect(goldenKeyOf({}, manifest)).toBe('none');
    expect(goldenKeyOf({ key: { kind: 'none' } }, manifest)).toBe('none');
    expect(goldenKeyOf({ key: { kind: 'bursts' } }, manifest)).toBe('fed');
    // No sidechain, or an EST 1.0 bundle (which can have none): ignored.
    expect(goldenKeyOf({ key: { kind: 'bursts' } }, { sidechain: 0, edition: '1.1' })).toBe('ignored');
    expect(goldenKeyOf({ key: { kind: 'bursts' } }, {})).toBe('ignored');
  });
});

describe('a key reaches the sidechain', () => {
  it('the golden render: the Key Duck ducks while the key sounds, and only then', () => {
    const dry = renderGoldenFull(module, manifest, SPEC);
    expect(dry.key).toBe('none');
    const keyed = renderGoldenFull(module, manifest, { ...SPEC, key: { kind: 'bursts', level: 0.9 } });
    expect(keyed.key).toBe('fed');
    // While the burst sounds (the first quarter of each half second) the output is quieter than with no key…
    expect(rms(keyed.audio, 2000, 5000)).toBeLessThan(0.9 * rms(dry.audio, 2000, 5000));
    // …and with the key silent again (well after the burst) it is back.
    expect(rms(keyed.audio, 20000, 23000)).toBeGreaterThan(0.9 * rms(dry.audio, 20000, 23000));
    // A key of "none" is exactly the render without one: an existing spec's stored render does not move.
    expect(same(renderGoldenFull(module, manifest, { ...SPEC, key: { kind: 'none' } }).audio, dry.audio)).toBe(true);
    // The same key twice gives the same bits.
    expect(same(renderGoldenFull(module, manifest, { ...SPEC, key: { kind: 'bursts', level: 0.9 } }).audio, keyed.audio)).toBe(true);
  });

  it('a plugin without a sidechain ignores the key, and its render is unchanged', () => {
    const plain = parseManifest({ ...DUCK, audio: { inputs: [{ channels: 2 }], outputs: [{ channels: 2 }] } });
    // The Key Duck's module reports a sidechain port, so play a plugin that has none: the effect template.
    const fx = new WebAssembly.Module(meter(new Uint8Array(readFileSync(repo('sdk/fixtures/templates/effect-as.wasm')))).bytes as BufferSource);
    const m = parseManifest({ ...(JSON.parse(readFileSync(repo('sdk/templates/effect-as/est.json'), 'utf8')) as Record<string, unknown>), module: { path: 'module.wasm', sha256: H, bytes: 1024 } });
    const without = renderGoldenFull(fx, m, SPEC);
    const withKey = renderGoldenFull(fx, m, { ...SPEC, key: { kind: 'bursts' } });
    expect(withKey.key).toBe('ignored');
    expect(same(withKey.audio, without.audio)).toBe(true);
    expect(plain.sidechain).toBe(0);
  });

  it('the free render (est demo, est compare): the same routing', async () => {
    const bytes = packBundle({ ...DUCK, module: { path: 'module.wasm' } }, { 'module.wasm': wasm }).bytes;
    const input = { kind: 'noise', amp: 0.25, seed: 3 } as const;
    const dry = await render(bytes, { seconds: 0.5, input });
    expect(dry.error).toBeNull();
    expect(dry.key).toBe('none');
    const keyed = await render(bytes, { seconds: 0.5, input, key: { kind: 'sine', freq: 110, amp: 0.9 } });
    expect(keyed.key).toBe('fed');
    expect(rms(keyed.left, 4000, 20000)).toBeLessThan(0.9 * rms(dry.left, 4000, 20000));
    expect((await render(bytes, { seconds: 0.5, input, key: { kind: 'silence' } })).key).toBe('none');
  });
});
