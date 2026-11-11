/**
 * EST Phase 4 (4-B, docs/est/EST_Phase4_Work_Order.md §2): the four SDK templates
 * (sdk/templates/effect-rust, instrument-rust, effect-as, instrument-as). Each template's module
 * (built by scripts/est-sdk-fixtures.sh into sdk/fixtures/templates/; the suite needs no
 * toolchain) is packed with its est.json and:
 * - passes Cyber's conformance run (10 s, metered, as at install);
 * - renders its golden spec (test/golden.json) to its stored render (test/golden.f32) within the
 *   spec's tolerance, on Cyber's host code (sdk/testing/golden.ts, what `est test` runs);
 * - renders the same as its twin in the other language, to within 1e-5 (the same algorithms on
 *   the same maths: in practice bit for bit).
 * Each template also carries what an agent needs (AGENTS.md; CLAUDE.md, one line pointing at it,
 * never a symlink; llms.txt), `$schema` in its est.json, and the build block `est` reads, and
 * names nothing outside the SDK but the paths `est new` rewrites.
 *
 * DEV-F (1.321) adds three pairs: `sampler-*` (an instrument whose samples are in the module, from
 * samples.json and assets/ through tools/embed-samples.mjs: the source must be up to date),
 * `midi-effect-*` (a note effect: its golden also holds the notes it sends, golden-notes.json,
 * compared exactly) and `visualiser-*` (an effect with its own page in ui/: validated with it, the
 * EST-U rules included). Every template also passes `est validate` (`@est/tools`' `validate` on the
 * folder, packed as `est pack` packs it).
 *
 * `EST_GOLDEN_WRITE=1 npx vitest run sdk/tests/templates.test.ts` rewrites the stored renders (only
 * after changing a template's sound on purpose).
 */
import { lstatSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { standInInstance } from '../../src/audio/est/install/conformance';
import { compareGolden, compareNotes, estShim, notesJson, goldenBytes, goldenFromBytes, renderGoldenFull, type GoldenNote, type GoldenSpec } from '../testing/golden';
import { validate } from '../packages/tools/src/index';
import { bytes, conform, json, packed, repo, type Packed } from './helpers';

const TEMPLATES = [
  { name: 'effect-rust', twin: 'effect-as', lang: 'rust', kind: 'effect' },
  { name: 'instrument-rust', twin: 'instrument-as', lang: 'rust', kind: 'instrument' },
  { name: 'effect-as', twin: 'effect-rust', lang: 'as', kind: 'effect' },
  { name: 'instrument-as', twin: 'instrument-rust', lang: 'as', kind: 'instrument' },
  { name: 'sampler-rust', twin: 'sampler-as', lang: 'rust', kind: 'instrument' },
  { name: 'sampler-as', twin: 'sampler-rust', lang: 'as', kind: 'instrument' },
  { name: 'midi-effect-rust', twin: 'midi-effect-as', lang: 'rust', kind: 'effect' },
  { name: 'midi-effect-as', twin: 'midi-effect-rust', lang: 'as', kind: 'effect' },
  { name: 'visualiser-rust', twin: 'visualiser-as', lang: 'rust', kind: 'effect' },
  { name: 'visualiser-as', twin: 'visualiser-rust', lang: 'as', kind: 'effect' },
] as const;
/** The DEV-F templates' magic words, and the folders' names (`sdk/templates/<name>` may be named in a template's own docs). */
const NAMES = TEMPLATES.map(t => t.name.replace(/-(as|rust)$/, '')).join('|');
const WRITE = process.env.EST_GOLDEN_WRITE === '1';

const cache = new Map<string, Promise<Packed>>();
const plugin = (name: string) => {
  if (!cache.has(name)) cache.set(name, packed(`sdk/templates/${name}`, bytes(`sdk/fixtures/templates/${name}.wasm`)));
  return cache.get(name)!;
};
const specOf = (name: string) => json<GoldenSpec>(`sdk/templates/${name}/test/golden.json`);
const render = async (name: string, spec: GoldenSpec) => (await renderFull(name, spec)).audio;
const renderFull = async (name: string, spec: GoldenSpec) => { const p = await plugin(name); return renderGoldenFull(p.module, p.bundle.manifest, spec); };

/** Every file of a template (what `est new` copies). */
function files(dir: string, base = dir): string[] {
  return readdirSync(dir).sort().flatMap(n => {
    const p = join(dir, n);
    if (n === 'target' || n === 'build' || n === 'dist' || n === 'node_modules') return [];
    return statSync(p).isDirectory() ? files(p, base) : [p.slice(base.length + 1)];
  });
}

describe.each(TEMPLATES)('the $name template', ({ name, twin, lang, kind }) => {
  const dir = `sdk/templates/${name}`;

  it('passes the conformance run, metered, as Cyber installs it', async () => {
    const p = await plugin(name);
    expect(p.bundle.manifest.kind).toBe(kind);
    const r = conform(p, 10);
    expect(r.problem).toBeNull();
    expect(r).toMatchObject({ ok: true, metered: true, deterministic: true, latency: 0 });
    if (kind === 'instrument') {
      expect(r).toMatchObject({ notePorts: 1, tailChecked: true });
      expect(r.noteEnds).toBe(r.notesSent);
    }
  }, 60_000);

  it('renders its golden spec to its stored render (and a note effect its stored notes)', async () => {
    const spec = specOf(name);
    const { audio: out, notes } = await renderFull(name, spec);
    if (spec.notes) {
      const file = `${dir}/test/${spec.notes}`;
      if (WRITE) writeFileSync(repo(file), notesJson(notes));
      expect(notes.length).toBeGreaterThan(0);
      expect(compareNotes(notes, json<GoldenNote[]>(file))).toBeNull();
      // Every note it starts it ends.
      const on = new Map<number, number>();
      for (const n of notes) on.set(n.key, (on.get(n.key) ?? 0) + (n.type === 'noteOn' ? 1 : -1));
      expect([...on.values()].every(v => v === 0)).toBe(true);
    }
    if (spec.input.kind === 'none') expect(Math.max(...out.map(Math.abs))).toBeGreaterThan(0.01); // it sounds
    const stored = `${dir}/test/${spec.render}`;
    if (WRITE) writeFileSync(repo(stored), goldenBytes(out));
    const { maxDiff, at } = compareGolden(out, goldenFromBytes(bytes(stored)));
    expect(maxDiff, `${name}: ${maxDiff} at sample ${at}`).toBeLessThanOrEqual(spec.tolerance);
  }, 60_000);

  it(`renders what its twin in the other language (${twin}) renders, to within 1e-5`, async () => {
    expect(specOf(twin)).toEqual(specOf(name));
    const [a, b] = [await renderFull(name, specOf(name)), await renderFull(twin, specOf(twin))];
    expect(compareNotes(a.notes, b.notes)).toBeNull();
    const { maxDiff } = compareGolden(a.audio, b.audio);
    console.log(`EST-4B-TWIN ${name} ${twin} ${maxDiff}`);
    expect(maxDiff).toBeLessThanOrEqual(1e-5);
  }, 60_000);

  it('allocates nothing while processing (its heap\'s next block is where it was before)', async () => {
    const p = await plugin(name);
    const inst = standInInstance({ module: p.module, shim: estShim(), manifest: p.bundle.manifest }, 48000);
    const proc = inst.proc as unknown as { malloc: (n: number) => number };
    const x = Float32Array.from({ length: 128 }, (_, i) => Math.sin(i / 5) * 0.5);
    inst.block(x, x, 0);
    const a = proc.malloc(8), b = proc.malloc(8);
    const events = specOf(name).events.map(e => ({ ...e, time: (e.time ?? 0) / 4 }));
    inst.send({ type: 'events', events });
    for (let k = 1; k < 400; k++) inst.block(x, x, k * 128);
    expect(proc.malloc(8)).toBe(b + (b - a));
    inst.send({ type: 'dispose' });
  });

  it('carries AGENTS.md, a one-line CLAUDE.md pointing at it (not a symlink), llms.txt, $schema and its build block', () => {
    const all = files(repo(dir));
    for (const f of ['AGENTS.md', 'CLAUDE.md', 'llms.txt', 'est.json', '.gitignore', 'test/golden.json', 'test/golden.f32']) expect(all, f).toContain(f);
    if (specOf(name).notes) expect(all).toContain('test/golden-notes.json');
    const claude = repo(`${dir}/CLAUDE.md`);
    expect(lstatSync(claude).isSymbolicLink()).toBe(false);
    const text = readFileSync(claude, 'utf8');
    expect(text.trim().split('\n')).toHaveLength(1);
    expect(text).toContain('AGENTS.md');
    const agents = readFileSync(repo(`${dir}/AGENTS.md`), 'utf8');
    for (const must of ['est validate', 'validation.json', 'est pack', 'est test', 'EST-M', 'EST-W', 'EST-C', 'allocat', 'activate']) expect(agents, must).toContain(must);
    const llms = readFileSync(repo(`${dir}/llms.txt`), 'utf8');
    for (const must of ['est-abi-1.0.json', 'est-manifest-1.schema.json', 'est-validator-rules.json', 'EST_SPECIFICATION_DRAFT.md', 'AGENTS.md']) expect(llms, must).toContain(must);
    const manifest = json(`${dir}/est.json`);
    expect(manifest.$schema).toBe('../../../src/audio/est/abi/est-manifest-1.schema.json');
    // The build block `est pack` reads: Cargo.toml's [package.metadata.est] or asconfig.json's "est".
    if (lang === 'rust') {
      const cargo = readFileSync(repo(`${dir}/Cargo.toml`), 'utf8');
      expect(cargo).toMatch(/\[package\.metadata\.est\]\nbuild = "cargo build --release"\nmodule = "target\/wasm32-unknown-unknown\/release\/\w+\.wasm"\nlibrary = "\.\.\/\.\.\/rust\/est"\ngolden = "test\/golden\.json"\n# [^\n]+\nidentity = \["est\.json", "src\/lib\.rs"\]/);
      expect(cargo).toContain('est = { path = "../../rust/est" }');
    } else {
      const asc = json<{ options: Record<string, unknown>; est: Record<string, string> }>(`${dir}/asconfig.json`);
      expect(asc.est).toEqual({ build: 'asc assembly/index.ts --config asconfig.json --target release', module: 'build/module.wasm', library: '../../as/est', golden: 'test/golden.json', identity: ['est.json', 'assembly/index.ts'] });
      expect(asc.options).toMatchObject({ path: ['../../as'], runtime: '../../as/est/runtime' });
    }
    // The id and the name are in exactly the files the build block lists.
    const identity = lang === 'rust' ? ['est.json', 'src/lib.rs'] : ['est.json', 'assembly/index.ts'];
    for (const f of all.filter(f => /\.(rs|ts|json|toml)$/.test(f))) {
      const t = readFileSync(repo(`${dir}/${f}`), 'utf8');
      expect(t.includes(String(manifest.id)), `${f} names the id`).toBe(identity.includes(f));
    }
    // Nothing names a Cyber path but those (the source, the docs it carries, the build files).
    for (const f of all.filter(f => !/\.(f32|wav)$/.test(f))) {
      const t = readFileSync(repo(`${dir}/${f}`), 'utf8');
      expect(t, f).not.toMatch(new RegExp(`/home/|est-plugins/|sdk/templates/(?!(${NAMES})-)|\\.claude`));
    }
  });

  it('passes est validate: the install\'s checks on the folder packed as est pack packs it', async () => {
    const v = await validate({ dir: repo(dir) }, { module: repo(`sdk/fixtures/templates/${name}.wasm`) });
    // EST-P001, the timing budget, is a warning that a loaded machine can raise (as the reference plugins' test does).
    expect(v.checks.filter(c => c.status === 'fail' || (c.status === 'warn' && c.rule !== 'EST-P001')), name).toEqual([]);
    expect(v.ok).toBe(true);
  }, 60_000);
});

describe('DEV-F (1.321): what the three new kinds of template show', () => {
  it('the samplers\' sample tables are up to date with samples.json and assets/ (tools/embed-samples.mjs --check)', async () => {
    for (const name of ['sampler-as', 'sampler-rust']) {
      const tool = await import(`../templates/${name}/tools/embed-samples.mjs`) as { generated: (dir: string) => { file: string; text: string } };
      const { file, text } = tool.generated(repo(`sdk/templates/${name}`));
      expect(file).toBe(name.endsWith('-as') ? 'assembly/samples.ts' : 'src/samples.rs');
      expect(readFileSync(repo(`sdk/templates/${name}/${file}`), 'utf8'), `${name}: run node tools/embed-samples.mjs`).toBe(text);
    }
    expect(readFileSync(repo('sdk/templates/sampler-as/tools/embed-samples.mjs'), 'utf8')).toBe(readFileSync(repo('sdk/templates/sampler-rust/tools/embed-samples.mjs'), 'utf8'));
  });

  it('the sampler plays its velocity layers: a soft and a hard note of the same key sound different samples', async () => {
    const spec = (vel: number): GoldenSpec => ({ sampleRate: 48000, frames: 4864, input: { kind: 'none' }, tolerance: 0, render: '',
      events: [{ type: 'noteOn', time: 0, key: 60, channel: 0, port: 0, noteId: 1, velocity: vel }] });
    const [soft, hard] = [await render('sampler-as', spec(0.3)), await render('sampler-as', spec(0.9))];
    // The same key: had the layer not changed, the hard note would be the soft one ×3.
    const ratio = soft.map((x, i) => (Math.abs(x) > 1e-3 ? hard[i]! / x : 3));
    expect(ratio.some(r => Math.abs(r - 3) > 0.1)).toBe(true);
  }, 60_000);

  it('the note effect\'s arpeggiator follows the transport\'s tempo and grid while it plays', async () => {
    const at = (bpm: number): GoldenSpec => ({ sampleRate: 48000, frames: 48000, input: { kind: 'none' }, tolerance: 0, render: '',
      events: [
        { type: 'transport', time: 0, tempo: bpm, playing: true, beat: 0, barStart: 0, num: 4, den: 4 } as unknown as GoldenSpec['events'][number],
        { type: 'noteOn', time: 0.001, key: 60, channel: 0, port: 0, noteId: 1, velocity: 1 },
        { type: 'noteOn', time: 0.001, key: 64, channel: 0, port: 0, noteId: 2, velocity: 1 },
      ] });
    for (const name of ['midi-effect-as', 'midi-effect-rust']) {
      const ons = async (bpm: number) => (await renderFull(name, at(bpm))).notes.filter(n => n.type === 'noteOn');
      const [slow, fast] = [await ons(60), await ons(120)];
      expect(fast.length, name).toBeGreaterThan(slow.length * 1.8);
    }
  }, 60_000);

  it('the visualiser\'s page draws from est:meter and reaches nothing outside the bundle', () => {
    for (const name of ['visualiser-as', 'visualiser-rust']) {
      const js = readFileSync(repo(`sdk/templates/${name}/ui/ui.js`), 'utf8');
      expect(js).toContain('est.onMeter(');
      expect(js).not.toMatch(/fetch\(|XMLHttpRequest|https?:/);
      expect(json<{ ui: { path: string } }>(`sdk/templates/${name}/est.json`).ui.path).toBe('ui/index.html');
    }
    expect(readFileSync(repo('sdk/templates/visualiser-as/ui/ui.js'), 'utf8')).toBe(readFileSync(repo('sdk/templates/visualiser-rust/ui/ui.js'), 'utf8'));
  });
});
