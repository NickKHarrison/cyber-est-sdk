/**
 * 1.805 ("Bring your plugin"): `est port` and the worked port.
 *
 * Always (no toolchain needed):
 * - the scan of the fixture trees under fixtures/port/ (original code, never built): the classes
 *   that process audio, the parameters and where each was seen, what does not port by file and
 *   line, the C++ standard, what is copied and what is left behind;
 * - a hostile tree made here in a temporary folder (file names with a backtick, a pipe, a line
 *   break, a leading dash; a symbolic link out of the tree; a 10 MiB file; more files than the cap):
 *   nothing outside the tree is read, nothing in it is run or changed, every copied path is safe,
 *   and the report's Markdown and the generated C++ stay well formed;
 * - what `est port` writes: the template with the found parameters declared in est.json and in
 *   kParams alike, the adapter, est-build.json's record, the plan; the lists of maths the plan and
 *   the headers name are the same;
 * - the worked example (sdk/examples/port-overdrive): its plan is what `est port` writes today from
 *   its original; its committed module (sdk/fixtures/examples/, built by
 *   scripts/est-cpp-fixtures.sh) is built from the sources as they are now, passes the conformance
 *   run, renders its golden, and **is the original's maths**: a reference of the same arithmetic,
 *   written here, agrees with it within the stated tolerance.
 *
 * Where a clang for wasm32 is found (the same search `est` makes; skipped with the reason
 * otherwise, never failed, as cppKit.test.ts): the folder `est port` writes builds and passes the
 * conformance run **untouched**, passing its input through bit for bit; the hostile tree's folder
 * builds too; the example rebuilds to the committed bytes (LLVM 18).
 *
 * `EST_GOLDEN_WRITE=1 npx vitest run sdk/tests/port.test.ts` rewrites the example's golden.
 */
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { buildCpp } from '../cpp/build.mjs';
import { sourcesDigest } from '../cpp/sources.mjs';
import { findWasmClang } from '../cpp/toolchain.mjs';
import { TEMPLATES_DIR } from '../packages/cli/src/command';
import { PORT_CAPS, PORT_KINDS, cComment, layers, md, mdCode, oneLine, plainName, safeSegment, scanPort, wordsOf } from '../packages/cli/src/port';
import { ORIGINAL_DIR, PORT_MATHS, declared, portedPluginCpp, writePort } from '../packages/cli/src/portWrite';
import { SPEC_FILES } from '../packages/tools/src/index';
import { standInInstance } from '../../src/audio/est/install/conformance';
import { compareGolden, estShim, goldenBytes, goldenFromBytes, goldenInput, renderGolden, type GoldenSpec } from '../testing/golden';
import { bytes, conform, json, packed, repo } from './helpers';

const WRITE = process.env.EST_GOLDEN_WRITE === '1';
const FIX = 'sdk/tests/fixtures/port';
const EXAMPLE = 'sdk/examples/port-overdrive';
const EXAMPLE_EST = `${EXAMPLE}/overdrive-est`;
const EXAMPLE_WASM = 'sdk/fixtures/examples/port-overdrive.wasm';
const toolchain = findWasmClang();
const skipBuild = !toolchain.clang;
if (skipBuild) console.log(`EST-PORT-SKIP no clang for wasm32 (the build tests are skipped): ${toolchain.tried.join('; ') || 'none found'}`);
const tmp = mkdtempSync(join(tmpdir(), 'est-port-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

const scan = (name: string) => scanPort(repo(`${FIX}/${name}`));
let made = 0;
/** `est port`'s write for a source, into a new temporary folder. */
function port(source: string, o: { id?: string; name?: string } = {}) {
  const dest = join(tmp, `out-${made++}`);
  const s = scanPort(source);
  return { scan: s, dest, ported: writePort(s, { source, dest, templatesDir: TEMPLATES_DIR, schema: SPEC_FILES.schema, extras: [SPEC_FILES.rules], ...o }) };
}
const read = (dir: string, f: string) => readFileSync(join(dir, f), 'utf8');
function files(dir: string, base = dir): string[] {
  return readdirSync(dir).sort().flatMap(n => {
    const p = join(dir, n);
    return lstatSync(p).isDirectory() ? files(p, base) : [p.slice(base.length + 1)];
  });
}

describe('est port: the scan (text only)', () => {
  it('a plain class: its audio and set-up methods, setters with ranges from comments, an enum of parameters', () => {
    const s = scan('plain');
    expect(s.name).toBe('plain');
    expect(s.classes).toHaveLength(1);
    expect(s.classes[0]).toMatchObject({ name: 'Chorus', file: 'Chorus.h', line: 9 });
    expect(s.classes[0]!.process.map(m => m.name)).toEqual(['processBlock']);
    expect(s.classes[0]!.prepare.map(m => m.name)).toEqual(['setSampleRate', 'reset']);
    // setBlockSize and setSampleRate are not knobs; kParamCount is not a parameter.
    expect(s.parameters.map(p => [p.id, p.name, p.min, p.max, p.default, p.unit, p.setter, p.todo.join(',')])).toEqual([
      [0, 'Rate', 0.05, 8, null, 'Hz', 'setRate', 'default'],
      [1, 'Depth', 0, 12, null, 'ms', 'setDepth', 'default'],
      [2, 'Mix', null, null, null, '', 'setMix', 'range,default,unit'],
    ]);
    // Each fact with where it was seen: the setter, the enum, and the field as a hint.
    expect(s.parameters[0]!.seen.map(x => `${x.how}@${x.file}:${x.line}`)).toEqual(['setter@Chorus.h:14', 'enum@Chorus.h:7', 'field@Chorus.h:23']);
    expect(s.copy).toEqual(['Chorus.cpp', 'Chorus.h']);
    expect(s.findings).toEqual([]);
    expect(s.std).toBe('c++17');
    expect(s.stdSeen).toBeNull();
    expect(s.licences).toEqual(['Chorus.cpp (SPDX MIT)', 'Chorus.h (SPDX MIT)']);
  });

  it('a tree with a window folder, a thread and a file read: the window stays behind, the rest is listed by file and line', () => {
    const s = scan('with-window');
    expect(s.classes.map(c => c.name)).toEqual(['Echo']); // the editor is not a class to port
    expect(s.copy).toEqual(['dsp/Echo.cpp', 'dsp/Echo.h', 'dsp/Loader.cpp', 'dsp/Loader.h']);
    expect(s.files.filter(f => f.blocked).map(f => [f.path, f.blocked])).toEqual([['gui/EchoEditor.cpp', 'window'], ['gui/EchoEditor.h', 'window']]);
    const at = (kind: string) => s.findings.filter(f => f.kind === kind).map(f => `${f.file}:${f.line}`);
    expect(at('window')).toEqual(['gui/EchoEditor.cpp:1', 'gui/EchoEditor.h:1', 'gui/EchoEditor.h:6', 'gui/EchoEditor.h:9']);
    expect(at('threads')).toEqual(['dsp/Echo.h:3', 'dsp/Echo.h:16', 'dsp/Echo.h:17', 'dsp/Loader.cpp:6', 'dsp/Loader.cpp:7', 'dsp/Loader.h:3', 'dsp/Loader.h:4', 'dsp/Loader.h:12', 'dsp/Loader.h:13']);
    expect(at('files')).toEqual(['dsp/Loader.cpp:3', 'dsp/Loader.cpp:8', 'dsp/Loader.cpp:10', 'dsp/Loader.cpp:11']);
    expect(at('exceptions')).toEqual(['dsp/Echo.cpp:3', 'dsp/Echo.cpp:7']);
    expect(at('random')).toEqual(['dsp/Echo.cpp:16']);
    expect(at('library')).toEqual(['dsp/Echo.cpp:4', 'dsp/Echo.h:4']);
    expect(at('outside')).toEqual(['gui/EchoEditor.h:3']); // a header that is not in the tree
    // The window's own setter (setTint) is no parameter; the DSP's two are, with ranges from a comment.
    expect(s.parameters.map(p => [p.name, p.min, p.max, p.unit, p.setter])).toEqual([['Time', 10, 2000, 'ms', 'setTime'], ['Feedback', 0, 0.95, '', 'setFeedback']]);
    expect(s.std).toBe('c++20');
    expect(s.stdSeen).toMatchObject({ file: 'CMakeLists.txt', line: 4 });
    expect(s.licences).toEqual(['LICENSE']);
  });

  it('a parameter layout declaration and a table: id, name, range and default, across lines, with a step and a skew', () => {
    const s = scan('layout');
    expect(s.parameters.map(p => [p.name, p.min, p.max, p.default, p.unit, p.seen[0]!.how, p.seen[0]!.line])).toEqual([
      ['Cutoff', 20, 20000, 1000, '', 'layout', 9],
      ['Resonance', 0.1, 10, 0.707, '', 'layout', 10],
      ['Output Gain', -24, 24, 0, '', 'layout', 13],
      ['Mode', 0, 3, 1, '', 'layout', 14],
      ['Drive', 0, 30, 6, 'dB', 'table', 21],
      ['Width', 0, 100, 100, '%', 'table', 22],
    ]);
    expect(s.parameters.every(p => !p.todo.includes('range') && !p.todo.includes('default'))).toBe(true);
    expect(s.classes.map(c => [c.name, c.process.map(m => m.name)])).toEqual([['Filter', ['tick']]]);
    expect(s.findings.map(f => `${f.kind}@${f.file}:${f.line}`)).toEqual(['outside@Filter.h:3']);
  });

  it('one file is a tree of one; a folder with no C or C++ says so', () => {
    const s = scanPort(repo(`${FIX}/plain/Chorus.h`));
    expect(s.name).toBe('Chorus');
    expect(s.files.map(f => f.path)).toEqual(['Chorus.h']);
    expect(s.findings.map(f => f.kind)).toEqual([]);
    const empty = join(tmp, 'empty');
    mkdirSync(empty);
    writeFileSync(join(empty, 'notes.txt'), 'nothing here');
    expect(() => scanPort(empty)).toThrow(/no C or C\+\+ source/);
  });

  it('comments and strings are not code: a word in one is no finding, and line numbers hold', () => {
    const src = 'int a; // std::thread in a comment\nconst char* s = "fopen( \\" std::mutex";\n/* throw x;\n rand() */ int b = rand();\n';
    const l = layers(src);
    expect(l.code.split('\n').length).toBe(src.split('\n').length);
    expect(l.code).not.toMatch(/thread|fopen|mutex|throw/);
    expect(l.code.split('\n')[3]).toContain('rand()');
    expect(l.strings).toContain('fopen(');
    expect(l.comments).toContain('std::thread');
    expect(l.comments).not.toContain('int a');
    const dir = join(tmp, 'quiet');
    mkdirSync(dir);
    writeFileSync(join(dir, 'q.h'), src);
    expect(scanPort(dir).findings.map(f => `${f.kind}:${f.line}`)).toEqual(['random:4']);
  });
});

describe('est port: untrusted text', () => {
  it('escapes Markdown, code spans and C++ comments, and cuts long lines', () => {
    expect(md('a|b `c` <script> [x](y) *z* _w_ #h')).toBe('a\\|b \\`c\\` &lt;script&gt; \\[x\\]\\(y\\) \\*z\\* \\_w\\_ \\#h');
    expect(md('- item')).toBe('\\- item');
    expect(md('1. item')).toBe('\\1. item');
    expect(mdCode('a|b `c`\nd')).toBe('`a\\|b \'c\' d`');
    expect(mdCode('')).toBe('');
    expect(cComment('x */ y ??/ z \\')).toBe('x * / y ? ?/ z');
    expect([...oneLine('x'.repeat(1000))]).toHaveLength(PORT_CAPS.line);
    expect(oneLine('a\u0000b\r\nc d‮e')).toBe('a b c d e');
    expect(plainName('Na"me\\ `x`\né', 'P')).toBe('Na me x');
    expect(plainName('"""', 'Parameter 1')).toBe('Parameter 1');
    expect(plainName('x'.repeat(200), 'P')).toHaveLength(60);
    for (const [from, to] of [['a b`c|d.h', 'a_b_c_d.h'], ['..', '_'], ['.', '_'], ['-rf.h', '_rf.h'], ['.hidden.h', '_hidden.h'], ['', '_'], ['ok-Name_1.2+x.hpp', 'ok-Name_1.2+x.hpp'], ['a\nb.h', 'a_b.h'], ['$(touch x).cpp', '__touch_x_.cpp']] as const) expect(safeSegment(from), JSON.stringify(from)).toBe(to);
    expect(wordsOf('CutoffFreq')).toBe('Cutoff Freq');
    expect(wordsOf('OUTPUT_GAIN')).toBe('Output Gain');
    expect(wordsOf('LFORate')).toBe('LFO Rate');
  });

  it('hostile text in a source: the plan stays well-formed Markdown, the generated C++ and JSON stay valid', () => {
    const { dest, ported } = port(repo(`${FIX}/hostile`));
    const plan = read(dest, 'PORT_PLAN.md');
    // Markup from the source is text: escaped, or inside a code span (where Markdown reads nothing).
    expect(plan.replace(/`[^`\n]*`/g, '')).not.toMatch(/<script|<b>|\]\(http/);
    expect(plan).not.toMatch(/x{200}/); // the 900-character line was cut
    for (const line of plan.split('\n')) {
      expect(line.length, line.slice(0, 80)).toBeLessThan(1200);
      // No stray backtick from the source: outside fenced blocks every line's code spans are closed.
      if (!line.startsWith('```')) expect((line.match(/`/g) ?? []).length % 2, line.slice(0, 120)).toBe(0);
    }
    // The parameters table: every row has exactly its seven cells, whatever the names hold.
    const rows = plan.split('\n').filter(l => /^\| \d+ \|/.test(l));
    expect(rows).toHaveLength(3);
    for (const r of rows) expect(r.replace(/\\\|/g, '').split('|')).toHaveLength(9);
    expect(plan).toContain('Na\\|me tick &lt;b&gt;\\*x\\*&lt;/b&gt;');
    // est.json is JSON, and the name in it is what kParams holds (the validator holds the two equal).
    const m = JSON.parse(read(dest, 'est.json')) as { parameters: { id: number; name: string }[] };
    expect(m.parameters.map(p => p.name)).toEqual(['Na|me tick <b>*x*</b>', 'Gain', 'Tone']);
    expect(ported.parameters.map(p => p.name)).toEqual(m.parameters.map(p => p.name));
    expect(read(dest, 'src/plugin.cpp')).toContain('{ 0, "Na|me tick <b>*x*</b>", "", 0.0, 1.0, 0.5, CLAP_PARAM_IS_AUTOMATABLE, "" },');
    // The adapter quotes source lines only in // comments, with no comment end and no line splice.
    const adapter = read(dest, 'src/adapter.hpp');
    for (const line of adapter.split('\n')) {
      expect(line.endsWith('\\'), line).toBe(false);
      if (line.includes('Found') || /^\s*\/\/ {3}/.test(line)) expect(line).not.toContain('*/');
    }
  });
});

describe('est port: a hostile tree', () => {
  const tree = join(tmp, 'hostile-tree');
  const outside = join(tmp, 'outside');
  const SECRET = 'TOP-SECRET-OUTSIDE-THE-TREE';
  mkdirSync(join(tree, 'gui'), { recursive: true });
  mkdirSync(outside);
  writeFileSync(join(outside, 'secret.h'), `// ${SECRET}\nclass Secret { void process(float* x, int n); void setLeak(float v); };\n`);
  const dsp = 'class Fuzz {\npublic:\n  void prepare(double sr);\n  void process(float* io, int n);\n  void setAmount(float v); // 0..10\n};\n';
  writeFileSync(join(tree, 'Fuzz.h'), dsp);
  const names = ['we`ird|na<me>.h', 'line\nbreak.h', '-rf.h', '..dots.h', '$(touch pwned).cpp', 'sp ace.hpp'];
  for (const n of names) writeFileSync(join(tree, n), `// ${n.replace(/\n/g, ' ')}\n#include "Fuzz.h"\nstatic int marker = 1;\n`);
  writeFileSync(join(tree, 'gui', 'Panel.h'), 'class Panel { void paint(); };\n');
  // 10 MiB of source-looking text: past the per-file cap, so never read.
  writeFileSync(join(tree, 'big.cpp'), Buffer.alloc(10 << 20, 'int x; // setHuge(float)\n'));
  let links = true;
  try {
    symlinkSync(join(outside, 'secret.h'), join(tree, 'link.h'));
    symlinkSync(outside, join(tree, 'linked-dir'));
  } catch { links = false; console.log('EST-PORT-SKIP this file system makes no symbolic links: the link cases are skipped'); }
  const snapshot = () => files(tree).map(f => { const st = lstatSync(join(tree, f)); return `${f}\t${st.size}\t${st.mtimeMs}\t${st.mode}`; });

  it('reads no link and no file past the cap, runs nothing, changes nothing, and copies only under safe names', () => {
    const before = snapshot();
    const { scan: s, dest, ported } = port(tree);
    expect(snapshot()).toEqual(before); // the source tree is as it was
    expect(existsSync(join(tree, 'pwned')) || existsSync(join(process.cwd(), 'pwned')) || existsSync(join(dest, 'pwned'))).toBe(false);
    const why = Object.fromEntries(s.skipped.map(x => [x.path, x.why]));
    expect(why['big.cpp']).toMatch(/larger than 1 MiB/);
    if (links) {
      expect(why['link.h']).toMatch(/symbolic link/);
      expect(why['linked-dir']).toMatch(/symbolic link/);
    }
    expect(s.files.map(f => f.path)).not.toContain('big.cpp');
    expect(s.classes.map(c => c.name)).toEqual(['Fuzz']); // never Secret
    expect(s.parameters.map(p => p.name)).toEqual(['Amount']); // never Leak or Huge
    // Every copied path: under src/original/, plain characters, no hidden or parent segment, inside the folder.
    expect(ported.copied.map(c => c.to).sort()).toEqual([`${ORIGINAL_DIR}/Fuzz.h`]);
    const all = files(dest);
    for (const f of all) {
      expect(f, f).toMatch(/^[A-Za-z0-9._+\-/]+$/);
      expect(f.split('/').some(seg => seg === '..' || seg === '.'), f).toBe(false);
      expect(lstatSync(join(dest, f)).isSymbolicLink(), f).toBe(false);
      if (!/\.f32$/.test(f)) expect(readFileSync(join(dest, f), 'utf8'), f).not.toContain(SECRET);
    }
    // The odd names are in the plan as text, escaped, on one line each.
    const plan = read(dest, 'PORT_PLAN.md');
    expect(plan).toContain('`we\'ird\\|na<me>.h`');
    expect(plan).toContain('`line break.h`');
    expect(plan).not.toContain('line\nbreak');
  });

  it('a file reached from the audio class under an unsafe name is copied under a safe one, and the plan says it was renamed', () => {
    const t = join(tmp, 'renamed-tree');
    mkdirSync(join(t, 'my dsp'), { recursive: true });
    writeFileSync(join(t, 'my dsp', 'Fuzz core.h'), 'struct Core { float z; };\n');
    writeFileSync(join(t, 'Fuzz.h'), '#include "my dsp/Fuzz core.h"\nclass Fuzz { public: void process(float* io, int n); Core c; };\n');
    const { dest, ported } = port(t);
    expect(ported.copied).toEqual([
      { from: 'Fuzz.h', to: 'src/original/Fuzz.h', renamed: false },
      { from: 'my dsp/Fuzz core.h', to: 'src/original/my_dsp/Fuzz_core.h', renamed: true },
    ]);
    expect(read(dest, 'PORT_PLAN.md')).toContain('| `src/original/my_dsp/Fuzz_core.h` | `my dsp/Fuzz core.h` (renamed: fix the `#include` lines that name it) | header |');
    expect((JSON.parse(read(dest, 'est-build.json')) as { include: string[] }).include).toEqual(['src', 'src/original', 'src/original/my_dsp']);
  });

  it('never writes into the source tree, nor into a folder that is not empty', () => {
    const s = scanPort(tree);
    expect(() => writePort(s, { source: tree, dest: join(tree, 'out'), templatesDir: TEMPLATES_DIR })).toThrow(/inside the source folder/);
    expect(() => writePort(s, { source: tree, dest: tmp, templatesDir: TEMPLATES_DIR })).toThrow(/holds the source folder/);
    const full = join(tmp, 'full');
    mkdirSync(full);
    writeFileSync(join(full, 'x'), 'x');
    expect(() => writePort(s, { source: tree, dest: full, templatesDir: TEMPLATES_DIR })).toThrow(/not empty/);
    expect(existsSync(join(tree, 'out'))).toBe(false);
  });

  it('stops at the caps and says how much it left unread', () => {
    const many = join(tmp, 'many');
    mkdirSync(many);
    for (let i = 0; i < PORT_CAPS.files + 10; i++) writeFileSync(join(many, `f${String(i).padStart(4, '0')}.h`), `// ${i}\n`);
    let deep = many;
    for (let i = 0; i < PORT_CAPS.depth + 2; i++) { deep = join(deep, 'd'); mkdirSync(deep); }
    writeFileSync(join(deep, 'too-deep.h'), 'class Deep { void process(); };\n');
    const s = scanPort(many);
    expect(s.files).toHaveLength(PORT_CAPS.files);
    expect(s.unread).toBe(10);
    expect(s.skipped.some(x => /folders deep/.test(x.why))).toBe(true);
    expect(s.classes).toEqual([]);
    expect(s.copy.length).toBeLessThanOrEqual(PORT_CAPS.copyFiles);
    // More findings of a kind than the cap: the rest is counted, not listed.
    const noisy = join(tmp, 'noisy');
    mkdirSync(noisy);
    for (let i = 0; i < 12; i++) writeFileSync(join(noisy, `n${i}.cpp`), Array.from({ length: 9 }, () => 'std::mutex m;').join('\n'));
    const n = scanPort(noisy);
    expect(n.findings.filter(f => f.kind === 'threads')).toHaveLength(PORT_CAPS.findings);
    expect(n.findings.filter(f => f.file === 'n0.cpp')).toHaveLength(PORT_CAPS.findingsPerFile);
    expect(n.moreFindings.threads).toBe(12 * 9 - PORT_CAPS.findings);
  });
});

describe('est port: a tree written to be slow', () => {
  /*
   * Text patterns can be made to crawl. Each file here is just under the 1 MiB cap and is the
   * worst input for one pattern: a megabyte of one word in a comment, of `class a` with no brace,
   * of unclosed calls, of table rows, of digits. The scan is linear in the text, so all of them
   * together take a few seconds; the bound is 30 s, a hang guard for a slow machine (a quadratic
   * pattern on a megabyte would take hours, so the bound need not be tight to catch one).
   */
  it('scans a megabyte of the worst text for each pattern in seconds, and still reports', () => {
    const dir = join(tmp, 'slow');
    mkdirSync(dir);
    const fill = (unit: string, part = 1) => unit.repeat(Math.floor((PORT_CAPS.fileBytes - 64) / part / unit.length));
    writeFileSync(join(dir, 'word.h'), `// ${fill('x')}\n`);
    writeFileSync(join(dir, 'classes.h'), fill('class a '));
    writeFileSync(join(dir, 'calls.h'), `class C {\n${fill('a(')}\n};\n`);
    writeFileSync(join(dir, 'rows.cpp'), `static const Row rows[] = {\n${fill('{ "Gain", 0.0, 1.0, 0.5, "dB" },\n')}};\n`);
    writeFileSync(join(dir, 'digits.cpp'), `// gain (${fill('1', 3)}\nint x = ${fill('1', 3)};\nf("a", "b", ${fill('1', 3)}`);
    writeFileSync(join(dir, 'setters.h'), `class S {\npublic:\n void process();\n${fill(' void setGain(float v); // 0..1\n')}};\n`);
    writeFileSync(join(dir, 'strings.cpp'), fill('"a", "b", '));
    writeFileSync(join(dir, 'mutex.cpp'), fill('std::mutex m;\n'));
    const t0 = Date.now();
    const s = scanPort(dir);
    const ms = Date.now() - t0;
    console.log(`EST-PORT-SLOW 8 files of 1 MiB scanned in ${ms} ms`);
    expect(ms).toBeLessThan(30_000);
    expect(s.files).toHaveLength(8);
    expect(s.parameters.map(p => p.name)).toEqual(['Gain']);
    expect(s.findings.filter(f => f.kind === 'threads')).toHaveLength(PORT_CAPS.findingsPerFile);
    expect(s.moreFindings.threads).toBeGreaterThan(70_000);
  }, 120_000);
});

describe('est port: the folder it writes', () => {
  it('is the cpp-clap template with the found parameters in est.json and kParams alike, the adapter, the record and the plan', () => {
    const { dest, ported, scan: s } = port(repo(`${FIX}/with-window`), { id: 'com.example.echo', name: 'Echo' });
    const all = files(dest);
    for (const f of ['AGENTS.md', 'CLAUDE.md', 'llms.txt', 'est.json', 'est-build.json', '.gitignore', 'PORT_PLAN.md', 'src/plugin.cpp', 'src/adapter.hpp', 'test/golden.json', 'est-manifest-1.schema.json', 'est-validator-rules.json', 'src/original/dsp/Echo.h', 'src/original/dsp/Echo.cpp', 'src/original/dsp/Loader.h', 'src/original/dsp/Loader.cpp']) expect(all, f).toContain(f);
    // Not the template's gain, not its render, and nothing of the window.
    for (const f of ['src/gain.hpp', 'test/golden.f32']) expect(all, f).not.toContain(f);
    expect(all.some(f => /EchoEditor/.test(f))).toBe(false);
    for (const c of ported.copied) expect(read(dest, c.to)).toBe(readFileSync(repo(`${FIX}/with-window/${c.from}`), 'utf8'));

    const m = JSON.parse(read(dest, 'est.json')) as { id: string; name: string; parameters: unknown[]; $schema: string };
    expect(m).toMatchObject({ id: 'com.example.echo', name: 'Echo', $schema: './est-manifest-1.schema.json' });
    expect(m.parameters).toEqual([{ id: 0, name: 'Time', unit: 'ms' }, { id: 1, name: 'Feedback' }]);
    const cpp = read(dest, 'src/plugin.cpp');
    expect(cpp).toContain('   { 0, "Time", "", 10.0, 2000.0, 10.0, CLAP_PARAM_IS_AUTOMATABLE, "ms" }, // TODO(port): check the default (PORT_PLAN.md)\n   { 1, "Feedback", "", 0.0, 0.95, 0.0, CLAP_PARAM_IS_AUTOMATABLE, "" }, // TODO(port): check the default, unit (PORT_PLAN.md)\n};');
    expect(cpp).toContain('#include "adapter.hpp"');
    expect(cpp).not.toMatch(/\bgain\.|kParamGain|gain\.hpp|dsp::Gain/);
    const adapter = read(dest, 'src/adapter.hpp');
    for (const must of ['#include "original/dsp/Echo.h"', 'case 0: /* Time */ /* TODO(port) 4: setTime((float)v); */ break;', 'void prepare(double sampleRate, int maxFrames);', 'void render(const float* in, float* out, int frames);', 'out[c][n] = in[c][n];']) expect(adapter, must).toContain(must);

    const build = JSON.parse(read(dest, 'est-build.json')) as Record<string, unknown>;
    expect(build).toMatchObject({
      sources: ['src/plugin.cpp'], include: ['src', 'src/original', 'src/original/dsp'], std: 'c++20', module: 'build/module.wasm',
      port: { from: 'with-window', sources: ['src/original/dsp/Echo.cpp', 'src/original/dsp/Loader.cpp'], files: { 'src/original/dsp/Echo.h': 'dsp/Echo.h' } },
    });
    const golden = JSON.parse(read(dest, 'test/golden.json')) as GoldenSpec;
    expect(golden.events).toEqual([{ type: 'param', time: 0.02, id: 0, value: 1502.5 }, { type: 'param', time: 0.08, id: 1, value: 0.2375 }]);
    expect(read(dest, 'AGENTS.md').split('\n').slice(0, 3).join('\n')).toMatch(/^# .*\n\n> \*\*This folder is a port in progress\*\*.*PORT_PLAN\.md/);

    const plan = read(dest, 'PORT_PLAN.md');
    for (const must of [
      '# Port plan: Echo', 'It builds and passes `npx est validate` as it is', 'Licences seen in the original: `LICENSE`',
      '| `src/original/dsp/Echo.h` | `dsp/Echo.h` | header |', '- `gui/EchoEditor.h`: a native window, or gui classes (see "What does not port")',
      '- **Echo** at `dsp/Echo.h:8`', '| 0 | Time | 10 to 2000 | TODO | ms | `setTime` |',
      '## What does not port', '### A native window, or GUI classes', '### Threads, locks, atomics and timers', '### Files and printing',
      '- `dsp/Loader.cpp:6`: `worker = std::thread([this, path] {`', '- `dsp/Loader.cpp:8`: `FILE* f = fopen(path, "rb");`', '- `gui/EchoEditor.h:9`: `void paint(toolkit::Painter& p) override;`',
      'The build is `c++20` (read at `CMakeLists.txt:4`)', 'npx est validate', 'npx est test --update', 'npx est compare', 'no `TODO(port)` is left',
    ]) expect(plan, must).toContain(must);
    // Every kind found has its sentence on what to do instead; a window, threads and files are always said.
    for (const k of new Set(s.findings.map(f => f.kind))) expect(plan, k).toContain(PORT_KINDS[k].instead);
    // No date and no path of this machine: the same source gives the same plan anywhere.
    expect(plan).not.toMatch(/\/tmp\/|\/home\/|20\d\d-\d\d-\d\d/);
    expect(plan).toBe(read(port(repo(`${FIX}/with-window`), { id: 'com.example.echo', name: 'Echo' }).dest, 'PORT_PLAN.md'));
  });

  it('with no parameter found: one placeholder, so the CLAP side still has a table; a window, threads and files are named all the same', () => {
    const t = join(tmp, 'bare');
    mkdirSync(t);
    writeFileSync(join(t, 'tone.c'), 'void tone_process(float* io, int n) { for (int i = 0; i < n; i++) io[i] *= 0.5f; }\n');
    const { dest, scan: s } = port(t);
    expect(s.parameters).toEqual([]);
    expect(s.classes).toEqual([]);
    expect(declared(s).map(p => p.name)).toEqual(['Amount']);
    expect((JSON.parse(read(dest, 'est.json')) as { parameters: unknown[] }).parameters).toEqual([{ id: 0, name: 'Amount' }]);
    const plan = read(dest, 'PORT_PLAN.md');
    expect(plan).toContain('None was found');
    expect(plan).toContain('None was recognised');
    expect(plan.match(/None seen\./g)).toHaveLength(3);
    expect((JSON.parse(read(dest, 'est-build.json')) as { port: { sources: string[] } }).port.sources).toEqual(['src/original/tone.c']);
  });

  it('follows the template: every line of src/plugin.cpp it replaces is still there (a changed template fails here, not in a user\'s folder)', () => {
    const template = readFileSync(join(TEMPLATES_DIR, 'cpp-clap', 'src', 'plugin.cpp'), 'utf8');
    expect(() => portedPluginCpp(template, declared(scan('plain')))).not.toThrow();
    expect(() => portedPluginCpp(template.replace('dsp::Gain gain;', 'dsp::Gain g;'), declared(scan('plain')))).toThrow(/no longer has/);
  });

  it('the maths the plan names is the maths the kit\'s headers have', () => {
    const mathH = readFileSync(repo('sdk/cpp/freestanding/math.h'), 'utf8'), cmath = readFileSync(repo('sdk/cpp/freestanding/cmath'), 'utf8');
    for (const f of PORT_MATHS.has) {
      const inC = new RegExp(`\\b${f}\\(|EST_MATH_F[12]_\\(${f}\\)|#define ${f}\\(`).test(mathH);
      const inCpp = new RegExp(`EST_CMATH_[12]_\\(${f}\\)|\\b${f}\\(`).test(cmath);
      expect(inC || inCpp, f).toBe(true);
      expect(mathH.slice(0, mathH.indexOf('#ifndef')), `math.h's comment names ${f}`).toMatch(new RegExp(`\\b${f}\\b`));
    }
    const runtime = readFileSync(repo('sdk/cpp/include/est/runtime.hpp'), 'utf8');
    const doc = runtime.slice(0, runtime.indexOf('#pragma once'));
    for (const f of [...PORT_MATHS.has, ...PORT_MATHS.hasNot]) expect(doc, `runtime.hpp's comment names ${f}`).toMatch(new RegExp(`\\b${f.replace(/ /g, '\\s+')}\\b`));
    for (const f of PORT_MATHS.hasNot.filter(x => x !== 'long double')) expect(mathH.slice(mathH.indexOf('#ifndef')), f).not.toMatch(new RegExp(`\\b${f}f?\\(`));
  });

  it.skipIf(skipBuild)('builds and passes the conformance run untouched, passing its input through bit for bit (skipped without a clang for wasm32)', async () => {
    for (const src of ['with-window', 'hostile', 'layout']) {
      const { dest } = port(repo(`${FIX}/${src}`));
      const plan = buildCpp(dest, { log: () => {} });
      const p = await packedAt(dest, new Uint8Array(readFileSync(plan.wasm)));
      const r = conform(p, 2);
      expect(r.problem, src).toBeNull();
      expect(r, src).toMatchObject({ ok: true, deterministic: true, latency: 0 });
      const spec = JSON.parse(read(dest, 'test/golden.json')) as GoldenSpec;
      const out = renderGolden(p.module, p.bundle.manifest, spec);
      expect(Array.from(out.subarray(0, spec.frames))).toEqual(Array.from(goldenInput(spec, 0, 0, spec.frames)));
      expect(Array.from(out.subarray(spec.frames))).toEqual(Array.from(goldenInput(spec, 1, 0, spec.frames)));
    }
  }, 240_000);
});

/** `packed` for a folder outside the repository. */
async function packedAt(dir: string, wasm: Uint8Array) {
  const { packBundle } = await import('../../scripts/est-pack.mjs');
  const { readBundle } = await import('../../src/audio/est/install/bundle');
  const { meter } = await import('../../src/audio/est/install/estMeter');
  const bundle = await readBundle(packBundle(JSON.parse(read(dir, 'est.json')), { 'module.wasm': wasm }).bytes);
  return { bundle, module: new WebAssembly.Module(meter(bundle.module).bytes as BufferSource) };
}

// ---- The worked example ----

const f32 = Math.fround;
/**
 * The original's arithmetic (sdk/examples/port-overdrive/original/Overdrive.h), operation for
 * operation in single precision: what a desktop build of that class computes, written again here.
 */
function reference(inL: Float32Array, inR: Float32Array, sr: number, knobs: { drive: number; tone: number; level: number; mix: number }): Float32Array {
  const drive = f32(Math.pow(10, f32(f32(knobs.drive) / 20)));
  const level = f32(Math.pow(10, f32(f32(knobs.level) / 20)));
  const m = f32(knobs.mix), mix = m < 0 ? 0 : m > 1 ? 1 : m;
  const a = f32(1 - f32(Math.exp(f32(f32(f32(-2 * f32(3.14159265)) * f32(knobs.tone)) / f32(sr)))));
  const shape = (x: number) => (x >= 0 ? f32(Math.tanh(x)) : f32(f32(0.8) * f32(Math.tanh(f32(f32(1.25) * x)))));
  const n = inL.length, out = new Float32Array(n * 2);
  [inL, inR].forEach((x, c) => {
    let s = 0;
    for (let i = 0; i < n; i++) {
      const y = shape(f32(x[i]! * drive));
      s = f32(s + f32(a * f32(y - s)));
      out[c * n + i] = f32(f32(f32(x[i]! * f32(1 - mix)) + f32(s * mix)) * level);
    }
  });
  return out;
}

describe('the worked port (sdk/examples/port-overdrive)', () => {
  const spec = () => json<GoldenSpec>(`${EXAMPLE_EST}/test/golden.json`);
  const example = () => packed(EXAMPLE_EST, bytes(EXAMPLE_WASM));

  it('keeps the original untouched: the copy the module is built from is the original, byte for byte, and the adapter calls it', () => {
    expect(readFileSync(repo(`${EXAMPLE_EST}/src/original/Overdrive.h`), 'utf8')).toBe(readFileSync(repo(`${EXAMPLE}/original/Overdrive.h`), 'utf8'));
    const adapter = readFileSync(repo(`${EXAMPLE_EST}/src/adapter.hpp`), 'utf8');
    for (const must of ['#include "original/Overdrive.h"', 'Overdrive overdrive_;', 'overdrive_.prepare(sampleRate)', 'overdrive_.setDrive((float)v)', 'overdrive_.process(i2, o2, (int)(to - from))']) expect(adapter, must).toContain(must);
    // The original knows nothing of EST: it names <cmath> and std::, which the kit's freestanding headers answer.
    const original = readFileSync(repo(`${EXAMPLE}/original/Overdrive.h`), 'utf8');
    expect(original).toContain('#include <cmath>');
    expect(original).not.toMatch(/est::|est\/runtime|<clap|__wasm__/);
    for (const f of ['src/plugin.cpp', 'src/adapter.hpp']) expect(readFileSync(repo(`${EXAMPLE_EST}/${f}`), 'utf8'), f).not.toContain('TODO(port)');
  });

  it('its plan and its build file are what est port writes from the original today; the finished est.json keeps the ids and names', () => {
    const { dest } = port(repo(`${EXAMPLE}/original`), { id: 'org.example.port-overdrive', name: 'Overdrive' });
    expect(readFileSync(repo(`${EXAMPLE_EST}/PORT_PLAN.md`), 'utf8')).toBe(read(dest, 'PORT_PLAN.md'));
    expect(readFileSync(repo(`${EXAMPLE_EST}/est-build.json`), 'utf8')).toBe(read(dest, 'est-build.json'));
    const fresh = JSON.parse(read(dest, 'est.json')) as { id: string; parameters: { id: number; name: string }[] };
    const done = json<{ id: string; parameters: { id: number; name: string }[] }>(`${EXAMPLE_EST}/est.json`);
    expect(done.id).toBe(fresh.id);
    expect(done.parameters.map(p => [p.id, p.name])).toEqual(fresh.parameters.map(p => [p.id, p.name]));
    // The prompt that finishes it is one sentence plus the plan, and says what a builder measured without est port.
    const prompt = readFileSync(repo(`${EXAMPLE}/PROMPT.md`), 'utf8');
    for (const must of ['Follow PORT_PLAN.md', '1.1 minutes', '3.9 minutes', 'npx est validate', 'npx est test --update']) expect(prompt, must).toContain(must);
  });

  it('the committed module is built from the sources as they are now (its .sources.json; no toolchain needed)', () => {
    expect(sourcesDigest(repo(EXAMPLE_EST)), 'the example changed since its module was built: run bash scripts/est-cpp-fixtures.sh').toEqual(json('sdk/fixtures/examples/port-overdrive.sources.json'));
    expect(Object.keys(json<{ files: Record<string, string> }>('sdk/fixtures/examples/port-overdrive.sources.json').files)).toEqual(expect.arrayContaining([`${EXAMPLE_EST}/src/original/Overdrive.h`, `${EXAMPLE_EST}/src/adapter.hpp`, 'sdk/cpp/freestanding/cmath', 'sdk/cpp/freestanding/math.h', 'sdk/cpp/include/est/runtime.hpp']));
  });

  it('passes the conformance run, metered, as Cyber installs it, and renders its golden', async () => {
    const p = await example();
    const r = conform(p, 10);
    expect(r.problem).toBeNull();
    expect(r).toMatchObject({ ok: true, metered: true, deterministic: true, latency: 0 });
    const s = spec();
    const out = renderGolden(p.module, p.bundle.manifest, s);
    const stored = `${EXAMPLE_EST}/test/${s.render}`;
    if (WRITE) writeFileSync(repo(stored), goldenBytes(out));
    const { maxDiff, at } = compareGolden(out, goldenFromBytes(bytes(stored)));
    expect(maxDiff, `at sample ${at}`).toBeLessThanOrEqual(s.tolerance);
    // Every knob is in the events, and the sound is not the input.
    expect(new Set(s.events.map(e => ('id' in e ? e.id : -1)))).toEqual(new Set([0, 1, 2, 3]));
    expect(compareGolden(out.subarray(0, s.frames), goldenInput(s, 0, 0, s.frames)).maxDiff).toBeGreaterThan(0.05);
  }, 60_000);

  /*
   * The proof of the port. The module holds the original class unchanged; here the same arithmetic,
   * written again in single precision, must give the same samples. The two may differ only where
   * the kit's maths and JavaScript's round a float differently, by one unit in the last place:
   *   - tanh: one float step of a value up to 1, 2^-24 = 6e-8, and the same again where drive
   *     (10^(dB/20)) differs by one step: |d tanh(u)| <= 1.2e-7 * max|u sech^2 u| = 1.2e-7 * 0.45
   *     = 5.4e-8. Together under 1.2e-7 at the clipper's output.
   *   - the low-pass s += a (y - s) passes that on with gain at most 1, adds 2.4e-7 where its
   *     coefficient a differs by one step (1.2e-7 * a * |y - s| / a, |y - s| <= 2), and a rounding
   *     of 6e-8 a sample that settles to 6e-8 / a: at 1 kHz and 48 kHz (a = 0.123, the lowest tone
   *     used below) 4.9e-7. Together 8.5e-7.
   *   - the output gain is at most 2 (+6 dB): 1.7e-6, plus one step of the gain itself, 2.4e-7.
   * So 2e-6 at worst; the tolerance is 1e-5, five times that. What is measured is printed.
   */
  it('is the original\'s maths: a reference of the same arithmetic agrees within 1e-5 (the arithmetic is above)', async () => {
    const TOLERANCE = 1e-5;
    const p = await example();
    const base = spec();
    const cases = [
      { drive: 0, tone: 6000, level: 0, mix: 1 }, // the defaults
      { drive: 18, tone: 1500, level: -3, mix: 0.7 },
      { drive: 36, tone: 12000, level: 6, mix: 1 }, // everything up
      { drive: 9, tone: 1000, level: -24, mix: 0.25 },
    ];
    for (const sampleRate of [44100, 48000]) {
      for (const k of cases) {
        const s: GoldenSpec = { ...base, sampleRate, events: [{ type: 'param', time: 0, id: 0, value: k.drive }, { type: 'param', time: 0, id: 1, value: k.tone }, { type: 'param', time: 0, id: 2, value: k.level }, { type: 'param', time: 0, id: 3, value: k.mix }] };
        const got = renderGolden(p.module, p.bundle.manifest, s);
        const want = reference(goldenInput(s, 0, 0, s.frames), goldenInput(s, 1, 0, s.frames), sampleRate, k);
        const { maxDiff, at } = compareGolden(got, want);
        console.log(`EST-PORT-REFERENCE ${sampleRate} Hz ${JSON.stringify(k)}: worst difference ${maxDiff.toExponential(2)}`);
        expect(maxDiff, `${sampleRate} Hz ${JSON.stringify(k)} at sample ${at}`).toBeLessThanOrEqual(TOLERANCE);
        expect(Math.max(...want.map(Math.abs))).toBeGreaterThan(0.01); // a real signal, not silence agreeing with silence
      }
    }
  }, 60_000);

  /*
   * What a desktop build never needed: WebAssembly has no flush-to-zero. The original's low-pass
   * state, decaying in silence, stops just above zero at a low Tone and stays there (measured on
   * this module without the adapter's rule: 750 subnormal stores a second at 200 Hz, EST-C027).
   * The adapter clears the original's state after a quarter second of digital silence, so the
   * output is exactly 0 from then on, at the lowest Tone and at the highest.
   */
  it('in silence the original\'s filter state is cleared: the output reaches exactly 0, not a number stuck near it', async () => {
    const p = await example();
    for (const tone of [200, 12000]) {
      const inst = standInInstance({ module: p.module, shim: estShim(), manifest: p.bundle.manifest }, 48000);
      inst.send({ type: 'events', events: [{ type: 'param', time: 0, id: 1, value: tone }, { type: 'param', time: 0, id: 0, value: 24 }] });
      const loud = Float32Array.from({ length: 128 }, (_, i) => Math.sin(i / 3) * 0.8), zero = new Float32Array(128);
      let frame = 0;
      for (let k = 0; k < 40; k++, frame += 128) inst.block(loud, loud, frame);
      // The tail right after the input stops is the filter ringing down: not zero yet.
      const first = inst.block(zero, zero, frame).out;
      frame += 128;
      expect(Math.max(...first[0].map(Math.abs)), `${tone} Hz`).toBeGreaterThan(0);
      // Half a second later (a quarter second is the rule): exactly zero, both channels, every sample.
      let last = first;
      for (let k = 0; k < 188; k++, frame += 128) last = inst.block(zero, zero, frame).out;
      expect([...last[0], ...last[1]].every(v => v === 0), `${tone} Hz`).toBe(true);
      // And it comes back at once when the input does.
      const back = inst.block(loud, loud, frame).out;
      expect(Math.max(...back[0].map(Math.abs)), `${tone} Hz`).toBeGreaterThan(0.1);
      inst.send({ type: 'dispose' });
    }
  });

  it.skipIf(skipBuild)('rebuilds from source to the committed module (skipped without a clang for wasm32)', async () => {
    const root = join(tmp, 'example');
    cpSync(repo(EXAMPLE_EST), root, { recursive: true, filter: s => !/[\\/](build|dist)$/.test(s) });
    const plan = buildCpp(root, { log: () => {} });
    const built = new Uint8Array(readFileSync(plan.wasm));
    const m = new WebAssembly.Module(built);
    expect(WebAssembly.Module.imports(m)).toEqual([]);
    expect(WebAssembly.Module.exports(m).map(e => e.name).sort()).toEqual(['__indirect_function_table', '_initialize', 'clap_entry', 'free', 'malloc', 'memory']);
    expect(conform(await packed(EXAMPLE_EST, built), 4).problem).toBeNull();
    if (/clang version 18\./.test(toolchain.version ?? '')) expect(Buffer.from(built).equals(Buffer.from(bytes(EXAMPLE_WASM))), 'run bash scripts/est-cpp-fixtures.sh').toBe(true);
    else console.log(`EST-PORT-BYTES not compared: ${toolchain.version} is not LLVM 18`);
  }, 120_000);
});

describe('est port: the command', () => {
  const BIN = fileURLToPath(new URL('../packages/cli/bin/est.mjs', import.meta.url));
  const est = (args: string[], cwd: string) => { const r = spawnSync(process.execPath, [BIN, ...args], { cwd, encoding: 'utf8', timeout: 240_000 }); return { code: r.status, out: r.stdout, err: r.stderr }; };

  it('writes <folder>-est beside the source, prints what it found and the next command; --json --dry-run only reports; help lists it', () => {
    const work = join(tmp, 'cli');
    mkdirSync(work);
    cpSync(repo(`${EXAMPLE}/original`), join(work, 'original'), { recursive: true });
    const dry = est(['port', 'original', '--json', '--dry-run'], work);
    expect(dry.code, dry.err).toBe(0);
    const j = JSON.parse(dry.out) as { from: string; out: null; classes: { name: string }[]; parameters: { name: string; min: number; max: number; unit: string }[]; doesNotPort: unknown[]; caps: { files: number } };
    expect(j).toMatchObject({ from: 'original', out: null, template: 'cpp-clap', doesNotPort: [], std: 'c++17', caps: { files: PORT_CAPS.files } });
    expect(j.classes.map(c => c.name)).toEqual(['Overdrive']);
    expect(j.parameters.map(p => [p.name, p.min, p.max, p.unit])).toEqual([['Drive', 0, 36, 'dB'], ['Tone', 200, 12000, 'Hz'], ['Level', -24, 6, 'dB'], ['Mix', 0, 1, '']]);
    expect(readdirSync(work)).toEqual(['original']);

    const r = est(['port', 'original'], work);
    expect(r.code, r.err).toBe(0);
    expect(r.out).toContain('read 1 source file in original (nothing run, nothing changed)');
    expect(r.out).toContain('made original-est: Overdrive (org.example.overdrive)');
    expect(r.out).toContain('npx est validate');
    expect(r.out).toContain('Follow PORT_PLAN.md.');
    expect(statSync(join(work, 'original-est', 'PORT_PLAN.md')).size).toBeGreaterThan(2000);
    // A second run does not overwrite; a missing folder and no argument are said.
    expect(est(['port', 'original'], work)).toMatchObject({ code: 1 });
    expect(est(['port', 'nowhere'], work).err).toContain('nowhere is not there');
    expect(est(['port'], work).code).toBe(2);
    const help = est(['help'], work).out;
    expect(help).toMatch(/^ {2}port\s+Start a port/m);
    expect(help).toContain('PORT_YOUR_VST.md');
  }, 240_000);
});
