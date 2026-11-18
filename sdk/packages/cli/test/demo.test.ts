/**
 * 1.788 (order V): `est demo`, the store's demo clip in one command: an effect plays the test loop, an
 * instrument the phrase; a 16-bit WAV normalised to -1 dBFS, within the store's limits (DEMO_LIMITS).
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { DEMO_MAX_BYTES, DEMO_MAX_SECONDS, demoWav } from '../src/commands/demo';

const BIN = fileURLToPath(new URL('../bin/est.mjs', import.meta.url));
const REPO = resolve(fileURLToPath(new URL('../../../../', import.meta.url)));
const tmp = mkdtempSync(join(tmpdir(), 'est-demo-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));
const est = (args: string[], cwd: string) => spawnSync(process.execPath, [BIN, ...args], { cwd, encoding: 'utf8', timeout: 240_000 });

/** The 16-bit samples' peak of a WAV demoWav wrote. */
function peakOf(wav: Uint8Array): number {
  const v = new DataView(wav.buffer, wav.byteOffset);
  let p = 0;
  for (let i = 44; i < wav.length; i += 2) p = Math.max(p, Math.abs(v.getInt16(i, true)));
  return p;
}

describe('est demo', () => {
  // Held equal to the store's DEMO_LIMITS by src/audio/est/estDemoLimits.test.ts (the kit's mirror carries no shared/storeDevPage.mjs).
  it('the longest clip it writes fits its byte limit', () => {
    expect(44 + DEMO_MAX_SECONDS * 44100 * 4).toBeLessThanOrEqual(DEMO_MAX_BYTES);
    expect(DEMO_MAX_SECONDS).toBeLessThanOrEqual(30);
  });

  it('demoWav: 16-bit PCM normalised to -1 dBFS; silence stays silence', () => {
    const l = new Float32Array(100).map((_, i) => Math.sin(i / 5) * 0.1), r = l.slice();
    const w = demoWav(l, r, 44100);
    expect(new DataView(w.buffer).getUint16(34, true)).toBe(16);
    expect(peakOf(w) / 32767).toBeCloseTo(10 ** (-1 / 20), 2);
    expect(peakOf(demoWav(new Float32Array(10), new Float32Array(10), 44100))).toBe(0);
  });

  for (const t of ['effect-as', 'instrument-as']) {
    it(`a new ${t}: a clip that sounds, under 3 MB`, () => {
      const dir = join(tmp, t);
      expect(est(['new', t, dir, '--no-install'], tmp).status).toBe(0);
      symlinkSync(join(REPO, 'node_modules'), join(dir, 'node_modules'));
      const r = est(['demo', '--seconds', '4'], dir);
      expect(r.status, r.stderr).toBe(0);
      const wav = new Uint8Array(readFileSync(join(dir, 'dist', 'demo.wav')));
      expect(wav.length).toBe(44 + 4 * 44100 * 4);
      expect(peakOf(wav)).toBeGreaterThan(20000);
    }, 240_000);
  }

  // 1.789 (V5b): --events takes a file; --no-phrase leaves the phrase out (the transport still plays).
  it('--events from a file, and --no-phrase', () => {
    const dir = join(tmp, 'instrument-as');
    writeFileSync(join(dir, 'ev.json'), JSON.stringify([{ type: 'param', time: 1, id: 0, value: 0 }]));
    const r = est(['demo', '--seconds', '2', '--events', 'ev.json', '--no-build'], dir);
    expect(r.status, r.stderr).toBe(0);
    const q = est(['demo', '--seconds', '2', '--no-phrase', '--no-build', '--out', 'dist/quiet.wav'], dir);
    expect(q.status, q.stderr).toBe(0);
    expect(peakOf(new Uint8Array(readFileSync(join(dir, 'dist', 'quiet.wav'))))).toBe(0);
  }, 240_000);

  it('refuses a clip past the store\'s limit, in words', () => {
    const r = est(['demo', 'nowhere.est', '--seconds', '25'], tmp);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/at most 17/);
  });
});
