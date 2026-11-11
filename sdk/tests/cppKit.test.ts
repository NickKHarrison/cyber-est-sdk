/**
 * EST-DEV-3, DEV-G (1.326): the C++ porting kit and `est compare`'s measuring.
 *
 * Always (no toolchain needed): the cpp-clap template's and the JUCE kit's EST modules (committed
 * under sdk/fixtures/, built by scripts/est-cpp-fixtures.sh) pass Cyber's conformance run, metered
 * as at install; the template renders its golden; the JUCE kit's wrapper renders what the template
 * renders (the same DSP through the same CLAP side); neither allocates while processing; the kit's
 * CLAP headers are the fixtures' (one copy of CLAP 1.2.2, never drifting); the template carries what
 * an agent reads and names the plugin only in est.json; the committed modules' `.sources.json`
 * match the sources now (a source edited without rebuilding fails here, with no toolchain); a NaN
 * parameter never reaches the DSP; the build's generated header, its refused flags and module
 * paths, and its guard against `wasm-opt`; the WAV reader and writer; `compareRenders` on known
 * differences and on NaN and infinities; the report escapes what it shows.
 *
 * Where a clang for wasm32 is found (`findWasmClang`, the same search `est` makes; skipped with the
 * reason otherwise, never failed): both modules rebuild from source and pass conformance, and with
 * the LLVM major the fixtures were built with (18) they are byte for byte the committed ones.
 *
 * `EST_GOLDEN_WRITE=1 npx vitest run sdk/tests/cppKit.test.ts` rewrites the template's golden.
 */
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { standInInstance } from '../../src/audio/est/install/conformance';
import { buildCpp, cString, flagRefusal, pluginHeader, readBuildConfig } from '../cpp/build.mjs';
import { sourcesDigest } from '../cpp/sources.mjs';
import { CODEGEN, LINK_CODEGEN, clangEnv, findWasmClang } from '../cpp/toolchain.mjs';
import { compareRenders, htmlReport, readWav, writeWav, type Stereo } from '../packages/tools/src/compare';
import { compareGolden, estShim, goldenBytes, goldenFromBytes, renderGolden, type GoldenSpec } from '../testing/golden';
import { bytes, conform, json, packed, repo, type Packed } from './helpers';

const WRITE = process.env.EST_GOLDEN_WRITE === '1';
const TEMPLATE = 'sdk/templates/cpp-clap';
const KIT = 'sdk/kits/juce-shared-dsp/est';
const toolchain = findWasmClang();
const skipBuild = !toolchain.clang;
if (skipBuild) console.log(`EST-DEVG-SKIP no clang for wasm32 (the rebuild tests are skipped): ${toolchain.tried.join('; ') || 'none found'}`);
const tmp = mkdtempSync(join(tmpdir(), 'est-cpp-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

const cache = new Map<string, Promise<Packed>>();
const plugin = (dir: string, wasm: string) => {
  if (!cache.has(dir)) cache.set(dir, packed(dir, bytes(wasm)));
  return cache.get(dir)!;
};
const template = () => plugin(TEMPLATE, 'sdk/fixtures/templates/cpp-clap.wasm');
const kit = () => plugin(KIT, 'sdk/fixtures/kits/juce-shared-dsp.wasm');
const spec = () => json<GoldenSpec>(`${TEMPLATE}/test/golden.json`);

function files(dir: string, base = dir): string[] {
  return readdirSync(dir).sort().flatMap(n => {
    const p = join(dir, n);
    if (['build', 'dist', 'node_modules'].includes(n)) return [];
    return statSync(p).isDirectory() ? files(p, base) : [p.slice(base.length + 1)];
  });
}

describe('the cpp-clap template and the JUCE kit\'s EST half', () => {
  for (const [name, get] of [['cpp-clap', template], ['juce-shared-dsp/est', kit]] as const) {
    it(`${name} passes the conformance run, metered, as Cyber installs it`, async () => {
      const p = await get();
      const r = conform(p, 10);
      expect(r.problem).toBeNull();
      expect(r).toMatchObject({ ok: true, metered: true, deterministic: true, latency: 0 });
    }, 60_000);

    it(`${name} allocates nothing while processing`, async () => {
      const p = await get();
      const inst = standInInstance({ module: p.module, shim: estShim(), manifest: p.bundle.manifest }, 48000);
      const proc = inst.proc as unknown as { malloc: (n: number) => number };
      const x = Float32Array.from({ length: 128 }, (_, i) => Math.sin(i / 5) * 0.5);
      inst.block(x, x, 0);
      const a = proc.malloc(8), b = proc.malloc(8);
      inst.send({ type: 'events', events: spec().events.map(e => ({ ...e, time: (e.time ?? 0) / 4 })) });
      for (let k = 1; k < 400; k++) inst.block(x, x, k * 128);
      expect(proc.malloc(8)).toBe(b + (b - a));
      inst.send({ type: 'dispose' });
    });
  }

  it('a NaN parameter never reaches the DSP: the output stays finite (setParam\'s clamp)', async () => {
    for (const p of [await template(), await kit()]) {
      const inst = standInInstance({ module: p.module, shim: estShim(), manifest: p.bundle.manifest }, 48000);
      const x = Float32Array.from({ length: 128 }, (_, i) => Math.sin(i / 5) * 0.5);
      inst.block(x, x, 0);
      inst.send({ type: 'events', events: [{ type: 'param', time: 0, id: 0, value: Number.NaN }] });
      for (let k = 1; k < 40; k++) {
        const { out } = inst.block(x, x, k * 128);
        expect([...out[0], ...out[1]].every(Number.isFinite), `block ${k}`).toBe(true);
      }
      inst.send({ type: 'dispose' });
    }
  });

  it('cpp-clap renders its golden spec to its stored render', async () => {
    const p = await template();
    const s = spec();
    const out = renderGolden(p.module, p.bundle.manifest, s);
    const stored = `${TEMPLATE}/test/${s.render}`;
    if (WRITE) writeFileSync(repo(stored), goldenBytes(out));
    const { maxDiff, at } = compareGolden(out, goldenFromBytes(bytes(stored)));
    expect(maxDiff, `at sample ${at}`).toBeLessThanOrEqual(s.tolerance);
    // The events are heard: -24 dB at 0.1 s is quieter than the start.
    const frames = s.frames, sr = s.sampleRate;
    const rms = (from: number, to: number) => Math.sqrt(out.slice(from, to).reduce((t, v) => t + v * v, 0) / (to - from));
    expect(20 * Math.log10(rms(Math.round(0.12 * sr), Math.round(0.15 * sr)) / rms(0, Math.round(0.02 * sr)))).toBeLessThan(-20);
    expect(out.length).toBe(frames * 2);
  }, 60_000);

  it('the JUCE kit\'s wrapper renders what the template renders (the same DSP, the same CLAP side)', async () => {
    const [a, b] = [await template(), await kit()];
    const s = spec();
    const { maxDiff } = compareGolden(renderGolden(a.module, a.bundle.manifest, s), renderGolden(b.module, b.bundle.manifest, s));
    expect(maxDiff).toBe(0);
  }, 60_000);

  it('carries one copy of CLAP 1.2.2: the kit\'s headers are the fixtures\', file for file', () => {
    const kitHeaders = files(repo('sdk/cpp/include/clap')).filter(f => f !== 'LICENSE');
    const fixture = files(repo('src/audio/est/fixtures/clap/include/clap'));
    expect(kitHeaders).toEqual(fixture);
    for (const f of fixture) expect(readFileSync(repo(`sdk/cpp/include/clap/${f}`), 'utf8'), f).toBe(readFileSync(repo(`src/audio/est/fixtures/clap/include/clap/${f}`), 'utf8'));
    expect(readFileSync(repo('sdk/cpp/include/clap/LICENSE'), 'utf8')).toBe(readFileSync(repo('src/audio/est/fixtures/clap/LICENSE'), 'utf8'));
  });

  it('the template carries AGENTS.md, a one-line CLAUDE.md, llms.txt, $schema and its build file, and names the plugin only in est.json', () => {
    const all = files(repo(TEMPLATE));
    for (const f of ['AGENTS.md', 'CLAUDE.md', 'llms.txt', 'est.json', 'est-build.json', '.gitignore', 'test/golden.json', 'test/golden.f32', 'src/plugin.cpp', 'src/gain.hpp']) expect(all, f).toContain(f);
    expect(readFileSync(repo(`${TEMPLATE}/CLAUDE.md`), 'utf8').trim().split('\n')).toHaveLength(1);
    const agents = readFileSync(repo(`${TEMPLATE}/AGENTS.md`), 'utf8');
    for (const must of ['est validate', 'validation.json', 'est pack', 'est test', 'est compare', 'EST-M', 'EST-W', 'EST-C', 'allocat', 'activate', 'emcc', 'EST_CLANG']) expect(agents, must).toContain(must);
    const m = json(`${TEMPLATE}/est.json`);
    expect(m.$schema).toBe('../../../src/audio/est/abi/est-manifest-1.schema.json');
    for (const f of all.filter(f => !f.endsWith('.f32'))) {
      const t = readFileSync(repo(`${TEMPLATE}/${f}`), 'utf8');
      expect(t.includes(String(m.id)), `${f} names the id`).toBe(f === 'est.json');
      expect(t, f).not.toMatch(/\/home\/|est-plugins\//);
    }
  });
});

describe('the C++ build (sdk/cpp/build.mjs)', () => {
  it('writes est.json\'s identity as C string literals, escaped', () => {
    expect(cString('a"b\\c?d')).toBe('"a\\"b\\\\c\\?d"');
    expect(cString('é\n')).toBe('"\\303\\251\\012"');
    const h = pluginHeader({ id: 'com.example.x', name: 'X', vendor: 'V', version: '1.0.0', description: 'd', kind: 'instrument', features: ['instrument', 'synthesizer'], limits: { memoryPagesMax: 32 } });
    expect(h).toContain('#define EST_PLUGIN_ID "com.example.x"');
    expect(h).toContain('#define EST_PLUGIN_FEATURES "instrument", "synthesizer",');
    expect(h).toContain('#define EST_PLUGIN_IS_INSTRUMENT 1');
    expect(h).toContain('#define EST_MEMORY_PAGES_MAX 32');
  });

  it('the committed modules are built from the sources as they are now (their .sources.json; no toolchain needed)', () => {
    for (const [dir, digest] of [[TEMPLATE, 'sdk/fixtures/templates/cpp-clap.sources.json'], [KIT, 'sdk/fixtures/kits/juce-shared-dsp.sources.json']] as const) {
      expect(sourcesDigest(repo(dir)), `${dir} changed since its module was built: run bash scripts/est-cpp-fixtures.sh`).toEqual(json(digest));
    }
    expect(Object.keys(json<{ files: Record<string, string> }>('sdk/fixtures/kits/juce-shared-dsp.sources.json').files)).toEqual(expect.arrayContaining(['sdk/kits/juce-shared-dsp/dsp/SharedGain.h', 'sdk/cpp/include/est/runtime.hpp', 'sdk/kits/juce-shared-dsp/est/src/plugin.cpp']));
  });

  it('est-build.json may not pass a flag that runs or loads a program, names the output or leaves the folder; the module stays inside', () => {
    for (const f of ['-fuse-ld=./ld.sh', '--ld-path=x', '-fplugin=a.so', '-fpass-plugin=a.so', '-Xclang', '-Xlinker', '-B.', '-load', '-mllvm', '@flags.txt', '-o', '-ofoo', '--sysroot=x', '-I/usr/include', '-isystem/opt', '-I../x', '-Wl,../x', 'C:/x', '~/x']) expect(flagRefusal(f), f).not.toBeNull();
    for (const f of ['-msimd128', '-O3', '-DX=1', '-fno-builtin', '-std=c++20', '-Wl,-z,stack-size=131072', '-Isrc/inc', '-Wall']) expect(flagRefusal(f), f).toBeNull();
    const dir = join(tmp, 'refuse');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'est.json'), '{}');
    for (const [cfg, why] of [[{ flags: ['-fuse-ld=./x'] }, /may not pass/], [{ linkFlags: ['@r'] }, /may not pass/], [{ module: '../out.wasm' }, /inside the folder/], [{ module: '/tmp/out.wasm' }, /inside the folder/], [{ defines: { 'A -fplugin': 1 } }, /not a C identifier/]] as const) {
      writeFileSync(join(dir, 'est-build.json'), JSON.stringify(cfg));
      expect(() => readBuildConfig(dir), JSON.stringify(cfg)).toThrow(why);
    }
    writeFileSync(join(dir, 'est-build.json'), JSON.stringify({ module: 'out/m.wasm', flags: ['-msimd128'] }));
    expect(readBuildConfig(dir)).toMatchObject({ module: 'out/m.wasm', flags: ['-msimd128'] });
  });

  it('clang never runs a wasm-opt: the link has no -O level, and PATH loses relative folders and those holding wasm-opt', () => {
    expect(CODEGEN).toContain('-O2');
    expect(LINK_CODEGEN.some(f => /^-O/.test(f))).toBe(false);
    const withOpt = join(tmp, 'opt-bin');
    mkdirSync(withOpt, { recursive: true });
    writeFileSync(join(withOpt, process.platform === 'win32' ? 'wasm-opt.exe' : 'wasm-opt'), '');
    const sep = process.platform === 'win32' ? ';' : ':';
    const before = process.env.PATH;
    process.env.PATH = ['.', 'relative/bin', withOpt, '/usr/bin'].join(sep);
    try {
      const path = clangEnv('/usr/bin/clang++').PATH!.split(sep);
      expect(path).toEqual(['/usr/bin']);
      // The clang's own folder is kept even if it holds a wasm-opt (its wasm-ld is there): the -O-free link covers it.
      expect(clangEnv(join(withOpt, 'clang++')).PATH!.split(sep)).toEqual([withOpt, '/usr/bin']);
    } finally {
      process.env.PATH = before;
    }
  });

  for (const [dir, fixture] of [[TEMPLATE, 'sdk/fixtures/templates/cpp-clap.wasm'], [KIT, 'sdk/fixtures/kits/juce-shared-dsp.wasm']] as const) {
    it.skipIf(skipBuild)(`${dir} builds from source with the clang est finds, and passes conformance (skipped without a clang for wasm32)`, async () => {
      // A copy of the folder (the JUCE kit's est/ needs ../dsp beside it).
      const root = join(tmp, dir.replace(/\W+/g, '-'));
      const from = dir === KIT ? repo('sdk/kits/juce-shared-dsp') : repo(dir);
      cpSync(from, root, { recursive: true, filter: s => !/[\\/](build|dist)$/.test(s) });
      const where = dir === KIT ? join(root, 'est') : root;
      const plan = buildCpp(where, { log: () => {} });
      const built = new Uint8Array(readFileSync(plan.wasm));
      const m = new WebAssembly.Module(built);
      expect(WebAssembly.Module.imports(m)).toEqual([]);
      expect(WebAssembly.Module.exports(m).map(e => e.name).sort()).toEqual(['__indirect_function_table', '_initialize', 'clap_entry', 'free', 'malloc', 'memory']);
      const r = conform(await packed(dir, built), 4);
      expect(r.problem).toBeNull();
      // The committed module was built with LLVM 18: the same major gives the same bytes.
      if (/clang version 18\./.test(toolchain.version ?? '')) expect(Buffer.from(built).equals(Buffer.from(bytes(fixture))), 'run bash scripts/est-cpp-fixtures.sh').toBe(true);
      else console.log(`EST-DEVG-BYTES not compared: ${toolchain.version} is not LLVM 18`);
    }, 120_000);
  }
});

const sine = (sr: number, frames: number, amp: number, f = 440): Stereo => {
  const l = Float32Array.from({ length: frames }, (_, i) => amp * Math.sin((2 * Math.PI * f * i) / sr));
  return { sampleRate: sr, left: l, right: l.slice() };
};

describe('est compare\'s measuring (compareRenders, readWav, writeWav, htmlReport)', () => {
  it('reads back the float WAV it writes, and reads 16- and 24-bit PCM and mono', () => {
    const s = sine(44100, 1000, 0.5);
    s.right = s.right.map(v => -v);
    const back = readWav(writeWav(s));
    expect(back.sampleRate).toBe(44100);
    expect(Array.from(back.left)).toEqual(Array.from(s.left));
    expect(Array.from(back.right)).toEqual(Array.from(s.right));
    // 16-bit mono and 24-bit stereo, by hand.
    const pcm = (bits: number, ch: number, values: number[]) => {
      const w = bits / 8, data = values.length * w, out = new Uint8Array(44 + data), v = new DataView(out.buffer);
      out.set(new TextEncoder().encode('RIFF'), 0); v.setUint32(4, 36 + data, true); out.set(new TextEncoder().encode('WAVEfmt '), 8);
      v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, ch, true); v.setUint32(24, 48000, true);
      v.setUint32(28, 48000 * w * ch, true); v.setUint16(32, w * ch, true); v.setUint16(34, bits, true);
      out.set(new TextEncoder().encode('data'), 36); v.setUint32(40, data, true);
      values.forEach((x, i) => { if (bits === 16) v.setInt16(44 + i * 2, x, true); else { out[44 + i * 3] = x & 255; out[45 + i * 3] = (x >> 8) & 255; out[46 + i * 3] = (x >> 16) & 255; } });
      return out;
    };
    const mono = readWav(pcm(16, 1, [16384, -32768]));
    expect(Array.from(mono.left)).toEqual([0.5, -1]);
    expect(Array.from(mono.right)).toEqual([0.5, -1]);
    const deep = readWav(pcm(24, 2, [4194304, -8388608]));
    expect([deep.left[0], deep.right[0]]).toEqual([0.5, -1]);
    expect(() => readWav(new Uint8Array(20))).toThrow(/not a WAV/);
  });

  it('identical renders: no difference, ok; a gain of -6 dB: -6.0 dB in every band and in level, not ok', () => {
    const a = sine(48000, 48000, 0.25, 1000);
    const same = compareRenders(a, { ...a, left: a.left.slice(), right: a.right.slice() });
    expect(same).toMatchObject({ ok: true, worstDiffDb: null, lengths: null });
    expect(same.channels.every(c => c.diffPeakDb === null && c.firstDivergence === null && c.levelDiffDb === 0)).toBe(true);
    const g = 10 ** (-6 / 20);
    const noise = (n: number) => { let s = 1; return Float32Array.from({ length: n }, () => { s = (s * 1103515245 + 12345) >>> 0; return (s / 2 ** 32 - 0.5) * 0.5; }); };
    const x = noise(48000);
    const quieter = compareRenders({ sampleRate: 48000, left: x, right: x }, { sampleRate: 48000, left: x.map(v => v * g), right: x.map(v => v * g) });
    expect(quieter.ok).toBe(false);
    for (const c of quieter.channels) {
      expect(c.levelDiffDb!).toBeCloseTo(-6, 5);
      for (const b of c.bands) expect(b.diffDb!, `${b.hz} Hz`).toBeCloseTo(-6, 5);
      expect(c.firstDivergence?.frame).toBe(0);
    }
  });

  it('reports the first frame where they part, a length difference, a tolerance, and a rate mismatch', () => {
    const a = sine(48000, 4800, 0.5);
    const b = { ...a, left: a.left.slice(), right: a.right.slice() };
    b.left[1234] = b.left[1234]! + 0.01; // -40 dBFS
    const r = compareRenders(a, b, { toleranceDb: -60 });
    expect(r.ok).toBe(false);
    expect(r.channels[0]!.firstDivergence?.frame).toBe(1234);
    expect(r.channels[0]!.diffPeakDb!).toBeCloseTo(-40, 1);
    expect(r.channels[1]!.firstDivergence).toBeNull();
    expect(compareRenders(a, b, { toleranceDb: -30 }).ok).toBe(true);
    const short = compareRenders(a, { ...a, left: a.left.slice(0, 4000), right: a.right.slice(0, 4000) });
    expect(short).toMatchObject({ ok: false, lengths: { a: 4800, b: 4000 }, frames: 4000 });
    expect(() => compareRenders(a, { ...a, sampleRate: 44100 })).toThrow(/different sample rates/);
  });

  it('a NaN or an infinity in A or in B is a divergence at its frame and never "the same" (M1)', () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      for (const side of ['a', 'b'] as const) {
        const a = sine(48000, 4800, 0.5);
        const b = { ...a, left: a.left.slice(), right: a.right.slice() };
        (side === 'a' ? a : b).right[777] = bad;
        const r = compareRenders(a, b);
        expect(r, `${bad} in ${side}`).toMatchObject({ ok: false, nonFinite: true });
        expect(r.channels[1]!.firstDivergence?.frame).toBe(777);
        expect(r.channels[1]!.nonFinite).toEqual(side === 'a' ? { a: 1, b: 0 } : { a: 0, b: 1 });
        expect(r.channels[0]!).toMatchObject({ nonFinite: { a: 0, b: 0 }, firstDivergence: null });
        // Even with a tolerance nothing finite could fail.
        expect(compareRenders(a, b, { toleranceDb: 100 }).ok).toBe(false);
        const page = htmlReport(r, a, b, { a: 'a', b: 'b' }, 's');
        expect(page).toContain('Not finite');
        expect(page).not.toMatch(/ d="[^"]*(NaN|Infinity)/); // the drawing takes no NaN
      }
    }
    // A whole render of NaN (a desktop build that blew up) against a good one.
    const good = sine(48000, 2000, 0.5);
    const nan = { sampleRate: 48000, left: new Float32Array(2000).fill(Number.NaN), right: new Float32Array(2000).fill(Number.NaN) };
    const r = compareRenders(good, nan);
    expect(r.ok).toBe(false);
    expect(r.channels.map(c => c.firstDivergence?.frame)).toEqual([0, 0]);
    expect(r.channels.map(c => c.nonFinite.b)).toEqual([2000, 2000]);
  });

  it('the HTML report is self-contained, scriptless and escapes the names it shows', () => {
    const a = sine(48000, 2000, 0.5);
    const r = compareRenders(a, a);
    const page = htmlReport(r, a, a, { a: '<img src=x onerror=alert(1)>.est', b: 'b"&.wav' }, 'setup <b>');
    expect(page).not.toContain('<img');
    expect(page).not.toMatch(/<script|https?:\/\//);
    expect(page).toContain('&#60;img src=x onerror=alert(1)&#62;.est');
    expect(page).toContain('b&#34;&#38;.wav');
    expect(page).toContain('setup &#60;b&#62;');
    expect(page.match(/<svg /g)).toHaveLength(4); // two channels, each the waveforms and the difference
  });
});
