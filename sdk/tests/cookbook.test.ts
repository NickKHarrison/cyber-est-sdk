/**
 * DEV-F (1.321, Cyber_EST_Developers_Work_Order.md §F): the EST cookbook, sdk/cookbook/. Ten short
 * AssemblyScript plugins, each a folder `est new` can start from (`est new <entry> <dir>`). Each
 * entry's module (built by scripts/est-sdk-fixtures.sh into sdk/fixtures/cookbook/; the suite
 * needs no toolchain):
 * - passes `est validate` (`@est/tools`' `validate`: the install's checks, metered, 10 s);
 * - renders its golden spec (test/golden.json) to its stored render (test/golden.f32), and a note
 *   effect its stored notes (golden-notes.json), every note it starts ended;
 * - allocates nothing while processing;
 * - carries a README.md with its paragraph and its prompt ("Ask for: …"), is on the cookbook page
 *   (sdk/docs/cookbook.md) with that prompt, and in the kit's llms.txt;
 * - names its id only in est.json and assembly/index.ts.
 *
 * `EST_GOLDEN_WRITE=1 npx vitest run sdk/tests/cookbook.test.ts` rewrites the stored renders.
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { standInInstance } from '../../src/audio/est/install/conformance';
import { compareGolden, compareNotes, estShim, goldenBytes, goldenFromBytes, notesJson, renderGoldenFull, type GoldenNote, type GoldenSpec } from '../testing/golden';
import { validate } from '../packages/tools/src/index';
import { bytes, json, packed, repo } from './helpers';

const ENTRIES = readdirSync(repo('sdk/cookbook'), { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name).sort();
const WRITE = process.env.EST_GOLDEN_WRITE === '1';
const page = readFileSync(repo('sdk/docs/cookbook.md'), 'utf8');
const llms = readFileSync(repo('sdk/llms.txt'), 'utf8');

it('has the ten recipes the order names', () => {
  expect(ENTRIES).toEqual(['auto-wah', 'bitcrusher', 'chorus', 'compressor', 'drum-synth', 'ring-mod', 'schroeder-reverb', 'step-sequencer', 'wavetable', 'widener']);
});

describe.each(ENTRIES)('the cookbook\'s %s', entry => {
  const dir = `sdk/cookbook/${entry}`;
  const wasm = `sdk/fixtures/cookbook/${entry}.wasm`;
  const spec = json<GoldenSpec>(`${dir}/test/golden.json`);

  it('passes est validate', async () => {
    const v = await validate({ dir: repo(dir) }, { module: repo(wasm) });
    // EST-P001, the timing budget, is a warning that a loaded machine can raise (as the reference plugins' test does).
    expect(v.checks.filter(c => c.status === 'fail' || (c.status === 'warn' && c.rule !== 'EST-P001')), entry).toEqual([]);
    expect(v.ok).toBe(true);
  }, 60_000);

  it('renders its golden spec to its stored render (and a note effect its stored notes)', async () => {
    const p = await packed(dir, bytes(wasm));
    const { audio, notes } = renderGoldenFull(p.module, p.bundle.manifest, spec);
    const stored = `${dir}/test/${spec.render}`;
    if (WRITE) writeFileSync(repo(stored), goldenBytes(audio));
    if (spec.input.kind === 'none') expect(Math.max(...audio.map(Math.abs))).toBeGreaterThan(0.01);
    const { maxDiff, at } = compareGolden(audio, goldenFromBytes(bytes(stored)));
    expect(maxDiff, `${entry}: ${maxDiff} at sample ${at}`).toBeLessThanOrEqual(spec.tolerance);
    if (spec.notes) {
      const file = `${dir}/test/${spec.notes}`;
      if (WRITE) writeFileSync(repo(file), notesJson(notes));
      expect(notes.length).toBeGreaterThan(0);
      expect(compareNotes(notes, json<GoldenNote[]>(file))).toBeNull();
      const on = new Map<number, number>();
      for (const n of notes) on.set(n.key, (on.get(n.key) ?? 0) + (n.type === 'noteOn' ? 1 : -1));
      expect([...on.values()].every(v => v === 0)).toBe(true);
    }
  }, 60_000);

  it('allocates nothing while processing', async () => {
    const p = await packed(dir, bytes(wasm));
    const inst = standInInstance({ module: p.module, shim: estShim(), manifest: p.bundle.manifest }, 48000);
    const proc = inst.proc as unknown as { malloc: (n: number) => number };
    const x = Float32Array.from({ length: 128 }, (_, i) => Math.sin(i / 5) * 0.5);
    inst.block(x, x, 0);
    const a = proc.malloc(8), b = proc.malloc(8);
    inst.send({ type: 'events', events: spec.events.map(e => ({ ...e, time: (e.time ?? 0) / 4 })) });
    for (let k = 1; k < 400; k++) inst.block(x, x, k * 128);
    expect(proc.malloc(8)).toBe(b + (b - a));
    inst.send({ type: 'dispose' });
  });

  it('carries its README (a paragraph and its prompt), is on the cookbook page and in llms.txt, and names its id only where est new renames it', () => {
    const readme = readFileSync(repo(`${dir}/README.md`), 'utf8');
    const ask = /\*\*Ask for:\*\* "([^"]+)"/.exec(readme)?.[1];
    expect(ask, 'README.md has **Ask for:** "…"').toBeTruthy();
    expect(page).toContain(`(../cookbook/${entry}/)`);
    expect(page).toContain(ask!);
    expect(llms).toContain(`cookbook/${entry}/`);
    const manifest = json<{ id: string; $schema: string }>(`${dir}/est.json`);
    expect(manifest.id).toBe(`org.example.cookbook-${entry}`);
    expect(manifest.$schema).toBe('../../../src/audio/est/abi/est-manifest-1.schema.json');
    for (const f of ['README.md', 'asconfig.json', 'test/golden.json']) expect(readFileSync(repo(`${dir}/${f}`), 'utf8').includes(manifest.id), f).toBe(false);
    expect(readFileSync(repo(`${dir}/assembly/index.ts`), 'utf8')).toContain(manifest.id);
    const asc = json<{ est: Record<string, unknown> }>(`${dir}/asconfig.json`);
    expect(asc.est).toMatchObject({ module: 'build/module.wasm', library: '../../as/est', golden: 'test/golden.json', identity: ['est.json', 'assembly/index.ts'] });
  });
});
