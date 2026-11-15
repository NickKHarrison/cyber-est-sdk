/**
 * 1.604: the catalogue instruments' quality fixes, each held to the measurement that found it (`est quality`,
 * sdk/packages/tools/src/quality.ts), on the bundles `est-plugins/registry/catalogue.json` lists:
 *
 * - WINDSONG: a chord in Legato (its notes ended by the glide, their slots reused) no longer holds forever;
 * - NEON CAUSEWAY, HONEYCROFT, FIELD DAY, HAZE CHOIR: no subnormal store in the 40 s after the notes (smoothers
 *   and layer gains gliding to 0, a filter after the notes, now flushed);
 * - a DC blocker before Level on ten instruments: the presets that measured worst under -50 dBFS;
 * - REDLINE: the bass string's loop gain glides from Ring to Mute, so a note-off does not click;
 * - PALM DEMBOW: Radio's hiss follows the music, so an idle instrument is silent.
 *
 * Slow (a few seconds a preset): in scripts/slow-tests.json.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { render } from '../packages/tools/src/render';
import { BOUNDS, qualityOf, stateValues, type QualityProfile } from '../packages/tools/src/quality';
import { readBundle } from '../../src/audio/est/install/bundle';

const repo = (p: string) => fileURLToPath(new URL(`../../${p}`, import.meta.url));
const catalogue = JSON.parse(readFileSync(repo('est-plugins/registry/catalogue.json'), 'utf8')) as { id: string; hash: string }[];
const profiles = JSON.parse(readFileSync(repo('est-plugins/quality/profiles.json'), 'utf8')) as Record<string, QualityProfile>;
const bundleOf = (name: string) => {
  const id = `org.nickkharrison.${name}`;
  const row = catalogue.filter(r => r.id === id).at(-1)!;
  return { id, bytes: new Uint8Array(readFileSync(repo(`est-plugins/dist/${row.hash}/bundle.est`))) };
};
const measure = async (name: string, preset: string) => {
  const { id, bytes } = bundleOf(name);
  const r = await qualityOf(bytes, profiles[id] ?? {}, { only: [preset] });
  expect(r.presets).toHaveLength(1);
  return r.presets[0]!;
};
const CASE_MS = 300_000;

describe('1.604: the catalogue instruments\' quality fixes', () => {
  it('WINDSONG: a three-note chord in Legato, its notes started together, ends after its release (it held at -19 dBFS before)', async () => {
    const { bytes } = bundleOf('windsong');
    const b = await readBundle(bytes);
    const values = stateValues(b.presets.find(p => p.name === 'Temple Flute')!.bytes)!;
    const events = [
      ...values.map(([id, value]) => ({ type: 'param', time: 0, id, value })),
      ...[48, 55, 64].flatMap((key, i) => [
        { type: 'noteOn', time: 0.1, key, velocity: 0.8, noteId: i + 1, channel: 0, port: 0 },
        { type: 'noteOff', time: 1, key, velocity: 0, noteId: i + 1, channel: 0, port: 0 },
      ]),
    ].sort((x, y) => x.time - y.time);
    const r = await render(bytes, { seconds: 8, sampleRate: 48000, events });
    let e = 0;
    for (let i = r.frames - 24000; i < r.frames; i++) e += r.left[i]! ** 2 + r.right[i]! ** 2;
    expect(10 * Math.log10(e / 48000 + 1e-20)).toBeLessThan(-80);
    const p = await measure('windsong', 'Temple Flute');
    expect(p.flags).not.toContain('stuck');
  }, CASE_MS);

  it.each([
    ['neon-causeway', 'Sunset Bass'],
    ['neon-causeway', 'Midnight Pad'],
    ['honeycroft', 'Meadow Flute'],
    ['field-day', 'Far Field'],
    ['haze-choir', 'Thrift Store Cassette'],
  ])('%s, %s: no subnormal store in the 10 s after the notes or in the last 10 s of 40', async (name, preset) => {
    const p = await measure(name, preset);
    expect([p.denormals, p.denormalsLate]).toEqual([0, 0]);
  }, CASE_MS);

  it.each([
    ['fogbound', 'Music Box in the Fog'],
    ['honeycroft', 'Harvest Festival Strum'],
    ['pursuit', 'Overpass Sprint'],
    ['bossfight', 'Crimson Fanfare'],
    ['arcade-fm', 'Pixel Saw Lead'],
    ['cartridge', 'Airship Horns'],
    ['neon-causeway', 'Low Tide Toms'],
    ['palm-dembow', 'Growl Sub'],
    ['redline', 'Rain Mirror Keys'],
    ['gator-808', 'Neon Causeway'],
  ])('%s, %s: its DC under -50 dBFS (the DC blocker before Level)', async (name, preset) => {
    const p = await measure(name, preset);
    expect(p.dc).toBeLessThan(BOUNDS.dcDb);
  }, CASE_MS);

  it.each(['Slap-Bass Cruise', 'Sunset Split', 'Thumb Funk Bass'])('REDLINE, %s: no click at a note-off (the loop gain glides from Ring to Mute)', async preset => {
    const p = await measure('redline', preset);
    expect(p.clicks.noteOff).toBeLessThan(BOUNDS.clickRatio);
  }, CASE_MS);

  it.each(['Sunset Radio Intro', 'Lo-Fi Porch Radio'])('PALM DEMBOW, %s: silent 40 s after the notes (Radio\'s hiss follows the music)', async preset => {
    const p = await measure('palm-dembow', preset);
    expect(p.stuck.after40).toBeLessThan(BOUNDS.stuckDb);
    expect(p.flags).not.toContain('stuck');
  }, CASE_MS);
});
