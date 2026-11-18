/**
 * `est port`'s writing half (1.805): from a scan (`port.ts`) to a new plugin folder. The folder is
 * `est new cpp-clap`'s (the same `scaffold`), changed so that it **builds and validates at once**:
 * the parameters that were found are declared (in est.json and in `kParams`, the two the validator
 * holds equal), the sound passes through `src/adapter.hpp` unchanged, and the original's files sit
 * in `src/original/`, compiled only once the adapter includes them. So the first `est validate` is
 * green, and what is left, the adapter, is written down in `PORT_PLAN.md`.
 *
 * The source tree is only read: files are copied out of it (each checked again to be a plain file,
 * never a link), nothing is written into it, and the new folder may not be inside it.
 */
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from 'node:path';
import { cString } from '../../../cpp/build.mjs';
import { PORT_CAPS, PORT_KINDS, cComment, md, mdCode, plainName, safeSegment, wordsOf, type PortKind, type PortParameter, type PortScan } from './port';
import { scaffold } from './scaffold';

/** The template a port starts from. */
export const PORT_TEMPLATE = 'cpp-clap';
/** Where the original's files land in the new folder. */
export const ORIGINAL_DIR = 'src/original';

/**
 * The maths a ported source may name (est/runtime.hpp and the freestanding `<cmath>`, `<math.h>`),
 * and what is missing: PORT_PLAN.md says both, because a port's first compile error is a missing
 * maths function. `sdk/tests/port.test.ts` holds the first list to the headers.
 */
export const PORT_MATHS = Object.freeze({
  has: ['sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'atan2', 'sinh', 'cosh', 'tanh', 'exp', 'exp2', 'log', 'log2', 'log10', 'pow', 'sqrt', 'cbrt', 'hypot', 'fabs', 'abs', 'floor', 'ceil', 'trunc', 'round', 'fmod', 'fmin', 'fmax', 'copysign', 'isnan', 'isinf', 'isfinite'],
  hasNot: ['long double', 'erf', 'tgamma', 'lgamma', 'frexp', 'ldexp', 'modf', 'remainder', 'nextafter', 'fma', 'lround', 'lrint'],
});

export interface PortOptions {
  /** The source folder or file, as the person named it. */
  source: string; dest: string; id?: string; name?: string; templatesDir: string;
  schema?: string; extras?: string[];
  /** 1.808: the kit to pin in the new folder's package.json, as `est new` does. */
  kit?: { name: string; version: string };
}
export interface Ported {
  dir: string; id: string; name: string; files: number;
  /** Each copied file: its path in the tree and in the new folder. */
  copied: { from: string; to: string; renamed: boolean }[];
  /** The original's C and C++ source files (not headers), as est-build.json's `port.sources` lists them. */
  sources: string[];
  parameters: PortParameter[];
}

const posix = (p: string) => p.split('\\').join('/');
const inside = (root: string, p: string) => { const r = relative(root, p); return r === '' || (!r.startsWith('..') && !isAbsolute(r)); };
/** A number as a C++ double literal. */
const lit = (n: number) => (Number.isInteger(n) ? n.toFixed(1) : String(n));
/** A number as the plan shows it. */
const shown = (n: number | null) => (n === null ? 'TODO' : String(n));

/** `text` with `from` replaced by `to`; throws unless `from` is there exactly `times` times (the template changed). */
function swap(text: string, from: string, to: string, times = 1): string {
  const n = text.split(from).length - 1;
  if (n !== times) throw new Error(`est port: the ${PORT_TEMPLATE} template's src/plugin.cpp no longer has "${from}" ${times === 1 ? 'once' : `${times} times`} (it has it ${n} times): portWrite.ts needs the same change`);
  return text.split(from).join(to);
}

/** The parameters the new folder declares: what was found, or one placeholder (a CLAP side with none is not the template's). */
export function declared(scan: PortScan): PortParameter[] {
  if (scan.parameters.length) return scan.parameters;
  return [{ id: 0, name: 'Amount', min: null, max: null, default: null, unit: '', setter: null, seen: [], todo: ['range', 'default', 'unit'] }];
}
/** The range and default written where none was found: 0 to 1, starting at the bottom. */
const rangeOf = (p: PortParameter) => { const min = p.min ?? 0, max = p.max ?? 1; return { min, max, def: p.default ?? (min <= 0 && max >= 0 ? 0 : min) }; };

/** `src/plugin.cpp` from the template's: the found parameters in `kParams`, the adapter in the gain's place. */
export function portedPluginCpp(template: string, params: PortParameter[]): string {
  let t = template;
  t = swap(t, '#include "gain.hpp"', '#include "adapter.hpp" // written by est port: the one class this file calls (PORT_PLAN.md)');
  t = swap(t, 'enum : clap_id { kParamGain = 0 };\n\n', '');
  const rows = params.map(p => { const r = rangeOf(p); return `   { ${p.id}, ${cString(p.name)}, "", ${lit(r.min)}, ${lit(r.max)}, ${lit(r.def)}, CLAP_PARAM_IS_AUTOMATABLE, ${cString(p.unit)} },${p.todo.length ? ` // TODO(port): check the ${p.todo.join(', ')} (PORT_PLAN.md)` : ''}`; });
  t = swap(t, '   { kParamGain, "Gain", "", dsp::Gain::kMinDb, dsp::Gain::kMaxDb, dsp::Gain::kDefaultDb, CLAP_PARAM_IS_AUTOMATABLE, "dB" },', rows.join('\n'));
  t = swap(t, '   dsp::Gain gain;', '   port::Adapter dsp;');
  t = swap(t, '      if (id == kParamGain) gain.setGainDb(v);', '      dsp.setParam(id, v);');
  t = swap(t, 'gain.process(in.data32, out.data32, channels, at, until);', 'dsp.process(in.data32, out.data32, channels, at, until);');
  t = swap(t, 'self(plugin)->gain.prepare(sampleRate);', 'self(plugin)->dsp.prepare(sampleRate);');
  t = swap(t, 'self(plugin)->gain.reset();', 'self(plugin)->dsp.reset();');
  // The opening comment, where it still says what the template was filled with.
  t = t.replace('filled in with a gain. A CLAP plugin you already', 'filled in by est port with your parameters and an adapter (src/adapter.hpp). A CLAP plugin you already');
  return t;
}

/** `src/adapter.hpp`: the class between the CLAP side and the original, passing the sound through until it is wired. */
export function adapterHpp(scan: PortScan, params: PortParameter[], copied: Ported['copied']): string {
  const cls = scan.classes[0];
  const header = cls ? copied.find(c => c.from === cls.file) : undefined;
  const includeLine = header && /\.(h|hh|hpp|hxx|h\+\+|inc)$/i.test(header.to) ? `#include "${posix(relative('src', header.to))}"` : '#include "original/YourDsp.h"';
  const prep = cls?.prepare.map(m => cComment(m.text, 120)) ?? [];
  const proc = cls?.process.map(m => cComment(m.text, 120)) ?? [];
  return [
    '// The adapter (written by est port; PORT_PLAN.md has the steps). src/plugin.cpp, the CLAP side, calls',
    '// only this class: prepare, reset, setParam and process. Your job is to make each of the four call',
    '// the original DSP in src/original/. Until then the sound passes through unchanged, so the folder',
    '// builds and validates from the first minute.',
    '//',
    '// The rules of an EST module: allocate only in prepare (never in process or setParam), read no',
    '// clock and no random numbers, no threads, no files. The maths: <cmath> and <math.h> are there',
    '// (PORT_PLAN.md lists what they have); exp, tanh and the trigonometry are cheap, log and pow cost',
    '// about 20 divisions, so call those when a knob moves, not for every sample.',
    '#pragma once',
    '',
    '#include <stdint.h>',
    '',
    `// TODO(port) 1: include the original (and list its .cpp files in est-build.json's "sources"):`,
    `//   ${cComment(includeLine, 140)}`,
    '',
    'namespace port {',
    '',
    'class Adapter {',
    'public:',
    '   /// The sample rate is known: size and allocate everything here.',
    '   void prepare(double sampleRate) {',
    '      sampleRate_ = sampleRate;',
    `      // TODO(port) 2: call the original's set-up.${prep.length ? ' Found:' : ''}`,
    ...prep.map(p => `      //   ${p}`),
    '   }',
    '',
    '   /// Forget what is ringing (a transport jump, a reset).',
    '   void reset() {',
    '      // TODO(port) 3: clear the original\'s delay lines and filter states.',
    '   }',
    '',
    '   /// A parameter moved. `v` is in the parameter\'s own unit, inside its range, never NaN.',
    '   void setParam(uint32_t id, double v) {',
    '      switch (id) {',
    ...params.map(p => `         case ${p.id}: /* ${cComment(p.name, 60).replace(/\*/g, ' ')} */ ${p.setter ? `/* TODO(port) 4: ${p.setter}((float)v); */` : '/* TODO(port) 4: pass v to the original */'} break;`),
    '         default: break;',
    '      }',
    '      (void)v;',
    '   }',
    '',
    '   /// Frames [from, to) of `channels` channels; `in` and `out` may be the same buffers. plugin.cpp',
    '   /// calls this for the audio between two parameter changes, so automation lands on its own sample.',
    `   // TODO(port) 5: call the original's audio method on these frames.${proc.length ? ' Found:' : ''}`,
    ...proc.map(p => `   //   ${p}`),
    '   void process(const float *const *in, float *const *out, uint32_t channels, uint32_t from, uint32_t to) {',
    '      for (uint32_t c = 0; c < channels; c++)',
    '         for (uint32_t n = from; n < to; n++) out[c][n] = in[c][n];',
    '   }',
    '',
    'private:',
    '   double sampleRate_ = 48000.0;',
    '};',
    '',
    '} // namespace port',
    '',
  ].join('\n');
}

const where = (f: string, line: number) => mdCode(`${f}:${line}`);

/** PORT_PLAN.md: what was found, the steps, the maths, what does not port, the checks. No date and no path of this machine. */
export function portPlan(scan: PortScan, p: Ported): string {
  const out: string[] = [];
  const params = p.parameters;
  const add = (...l: string[]) => out.push(...l);
  add(
    `# Port plan: ${md(p.name, 60)}`,
    '',
    `\`est port\` wrote this folder from the source in ${mdCode(scan.name, 80)}: ${scan.files.length} source file${scan.files.length === 1 ? '' : 's'} read, ${p.copied.length} copied into \`${ORIGINAL_DIR}/\`. Nothing in the original folder was changed, built or run. Every find below is a text pattern, so check each one against the source.`,
    '',
    '**Where this folder stands.** It builds and passes `npx est validate` as it is. It is the kit\'s C++ template with the parameters below declared and the sound passing through unchanged (`src/adapter.hpp`). The original is not compiled yet. The work left is the adapter: the steps below, in order.',
    '',
    'Port only code you wrote, or code whose licence lets you (MIT, BSD, zlib, Apache-2.0, ISC, public domain). Never port a commercial plugin\'s code or use its name.',
    scan.licences.length ? `Licences seen in the original: ${scan.licences.slice(0, 8).map(l => mdCode(l, 80)).join(', ')}. Read them.` : 'No licence file was seen in the original: make sure the code is yours to port.',
    '',
    '## What was found',
    '',
    '### Files',
    '',
  );
  if (p.copied.length) {
    add('| In this folder | From the original | Kind |', '|---|---|---|');
    for (const c of p.copied) add(`| ${mdCode(c.to)} | ${mdCode(c.from)}${c.renamed ? ' (renamed: fix the `#include` lines that name it)' : ''} | ${/\.(c|cc|cpp|cxx|c\+\+)$/i.test(c.to) ? 'source' : 'header'} |`);
  } else add('No file was copied: every source file read uses a native window or sits in a folder named for one. Copy the DSP out by hand.');
  const leftOut = scan.files.filter(f => !p.copied.some(c => c.from === f.path));
  if (leftOut.length) {
    add('', 'Not copied:', '');
    for (const f of leftOut.slice(0, 40)) add(`- ${mdCode(f.path)}: ${f.blocked ? `${PORT_KINDS[f.blocked].title.toLowerCase()} (see "What does not port")` : scan.classes.length ? 'not reached from a class that processes audio' : 'past the copy limit'}`);
    if (leftOut.length > 40) add(`- and ${leftOut.length - 40} more`);
  }
  if (scan.skipped.length || scan.unread) {
    add('', 'Not read:', '');
    for (const s of scan.skipped.slice(0, 20)) add(`- ${mdCode(s.path)}: ${s.why}`);
    if (scan.skipped.length > 20) add(`- and ${scan.skipped.length - 20} more`);
    if (scan.unread) add(`- ${scan.unread} more entries past the limits (${PORT_CAPS.files} source files, ${PORT_CAPS.entries} entries, ${PORT_CAPS.totalBytes >> 20} MiB)`);
  }
  add('', '### Classes that process audio', '');
  if (scan.classes.length) {
    for (const c of scan.classes.slice(0, 12)) {
      add(`- **${md(c.name, 60)}** at ${where(c.file, c.line)}`);
      for (const m of c.prepare) add(`  - set-up, \`${m.name.replace(/\W/g, '')}\` at line ${m.line}: ${mdCode(m.text, 140)}`);
      for (const m of c.process) add(`  - audio, \`${m.name.replace(/\W/g, '')}\` at line ${m.line}: ${mdCode(m.text, 140)}`);
    }
    if (scan.classes.length > 12) add(`- and ${scan.classes.length - 12} more`);
  } else add('None was recognised (a class with a `process…`, `render…` or `tick` method). Find the function that fills the output buffer and treat it as the audio method below.');
  add('', '### Parameters', '');
  if (scan.parameters.length) {
    add('The ids are final once you share the plugin: never reuse or renumber one. `TODO` means it was not found in the source: the folder uses 0 to 1, starting at 0, until you set it.', '');
    add('| Id | Name | Range | Default | Unit | Setter | Seen at |', '|---|---|---|---|---|---|---|');
    for (const q of params) {
      const seen = q.seen.map(s => `${where(s.file, s.line)} (${s.how === 'layout' ? 'a parameter layout declaration' : s.how === 'table' ? 'a table row' : s.how === 'setter' ? 'a setter' : s.how === 'enum' ? 'an enum' : s.how === 'comment' ? `a comment: ${mdCode(s.text, 60)}` : `a field: ${mdCode(s.text, 60)}, a hint for the default, in the DSP's own unit`})`).join('; ');
      add(`| ${q.id} | ${md(q.name, 60)} | ${q.min === null || q.max === null ? 'TODO' : `${shown(q.min)} to ${shown(q.max)}`} | ${shown(q.default)} | ${q.unit ? md(q.unit, 16) : 'TODO'} | ${q.setter ? mdCode(q.setter, 60) : ''} | ${seen} |`);
    }
    if (scan.moreParameters) add('', `${scan.moreParameters} more were found past the first ${PORT_CAPS.parameters} and are not declared: add the ones you need by hand.`);
  } else add('None was found (a setter such as `setDrive(float)`, a parameter table, an enum of parameters, a parameter layout declaration). The folder declares one placeholder, `Amount`: replace it with the plugin\'s real knobs.');
  add(
    '',
    '## The steps',
    '',
    `1. **Read** \`src/adapter.hpp\` (the class to fill in), \`src/plugin.cpp\` (the CLAP side: it calls only the adapter) and the original's audio class${scan.classes[0] ? ` (${md(scan.classes[0].name, 60)})` : ''} in \`${ORIGINAL_DIR}/\`.`,
    `2. **Bring the original in.** Include its header in \`src/adapter.hpp\` and give \`Adapter\` a member of its class. Each original \`.cpp\` file the header needs goes into \`est-build.json\`'s \`"sources"\`${p.sources.length ? ` (they are listed under \`"port"\` there: ${p.sources.slice(0, 6).map(s => mdCode(s, 100)).join(', ')}${p.sources.length > 6 ? ' …' : ''})` : ' (this original is headers only: nothing to add)'}. Build with \`npx est validate\` and fix what the compiler says: see "What does not port" and "The maths you have".`,
    '3. **Set-up.** `Adapter::prepare(sampleRate)` calls the original\'s set-up; size every delay line and buffer from that rate, and allocate only here. `Adapter::reset()` clears what rings.',
    '4. **Audio.** `Adapter::process(in, out, channels, from, to)` calls the original\'s audio method on frames `from` to `to` of each channel (`in[c] + from`, `to - from` frames). If the original wants interleaved samples or a fixed block size, copy through a buffer taken in `prepare`.',
    '5. **Parameters.** `Adapter::setParam(id, v)` calls the original\'s setter for each id, converting the unit if the knob\'s unit is not the DSP\'s. Then make the table above true in **both** places, which must agree: `kParams` in `src/plugin.cpp` (range, default, unit) and `"parameters"` in `est.json` (id, name, unit; add `"scale": "log"` for a frequency). Remove each `TODO(port)` as you go.',
    '6. **State, tail, latency.** State: the template saves every parameter; change `kStateMagic` in `src/plugin.cpp` to four letters of your own. Tail: a reverb, a delay or anything that rings after the input stops needs `clap.tail` and `est.json`\'s `limits.tailSeconds` (the validator fails a plugin that sounds past what it reports, EST-C028). Latency: a look-ahead or a linear-phase filter reports its frames in `latencyGet` and in `limits.maxLatencyFrames`. Silence: set a filter or feedback state below 1e-20 to 0 (EST-C027).',
    '7. **The golden test.** `test/golden.json` holds an input and a few parameter changes; make its events exercise your knobs, then `npx est test --update` once the sound is right.',
    '',
    '## The maths you have',
    '',
    'A module links no C library, but `<cmath>` and `<math.h>` are there (the kit\'s own, in plain arithmetic, the same result in every browser), so `std::tanh(x)` and `powf(a, b)` compile as they are. Results are within a few 1e-16 of a desktop library, not bit-identical to it.',
    '',
    `- **There:** ${PORT_MATHS.has.map(f => `\`${f}\``).join(' ')}, each for \`float\` and \`double\` (\`sinf\`, \`std::sin\`), and \`M_PI\` and friends. Also \`<cstring>\`'s \`memset\`, \`memcpy\`, \`memmove\`, \`memcmp\`, and \`malloc\`, \`free\`, \`new\`, \`delete\`.`,
    `- **Not there:** ${PORT_MATHS.hasNot.map(f => `\`${f}\``).join(' ')}. A missing one shows as a compile error naming it: write it from the ones above.`,
    '- **Cost:** `exp`, `exp2`, `tanh`, `sinh`, `cosh` are about 15 multiplications; `sin`, `cos`, `atan` about 20 operations; `log`, `log2`, `log10` and `pow` about 20 divisions. Call `log` and `pow` when a knob moves, not for every sample. `npx est validate` warns when a block costs too much (EST-P001; it depends on the machine and is a warning, not a failure).',
    '',
    '## What does not port',
    '',
    'An EST plugin is sound code in a sandbox: one thread, no window of its own, no files, no network. These parts of the original stay behind. Each line is where the pattern was seen.',
    '',
  );
  const always: PortKind[] = ['window', 'threads', 'files'];
  const kinds = (Object.keys(PORT_KINDS) as PortKind[]).filter(k => always.includes(k) || scan.findings.some(f => f.kind === k));
  for (const k of kinds) {
    const list = scan.findings.filter(f => f.kind === k);
    add(`### ${PORT_KINDS[k].title}`, '', PORT_KINDS[k].instead, '');
    if (!list.length) add('None seen.', '');
    else {
      for (const f of list) add(`- ${where(f.file, f.line)}: ${mdCode(f.text, 120)}`);
      if (scan.moreFindings[k]) add(`- and ${scan.moreFindings[k]} more`);
      add('');
    }
  }
  add(
    `The build is \`${scan.std}\`${scan.stdSeen ? ` (read at ${where(scan.stdSeen.file, scan.stdSeen.line)})` : ' (nothing in the original says which standard: the template\'s)'}, without exceptions or run-time type information, with no C++ standard library unless your clang brings one for wasm32.`,
    '',
    '## The checks',
    '',
    '```sh',
    'npx est validate          # builds, packs, runs every check Cyber\'s install runs: read dist/validation.json',
    'npx est test --update     # once the sound is right: writes the golden render',
    'npx est test              # from then on: the golden render and the conformance run',
    'npx est dev               # play it',
    '```',
    '',
    'To prove the port against the original, when you have a build of the original that can render a WAV:',
    '',
    '```sh',
    'npx est compare dist/<id>-1.0.0.est dist/<id>-1.0.0.est --seconds 3 --write-input build/in.wav --no-build',
    '# render build/in.wav through the original, at the same rate, into build/original.wav, then:',
    'npx est compare dist/<id>-1.0.0.est build/original.wav --input build/in.wav --tolerance -100 --no-build',
    '```',
    '',
    '## Done when',
    '',
    '- no `TODO(port)` is left in `src/`;',
    '- `npx est validate` says PASS and `npx est test` passes;',
    '- the parameter table above matches `kParams` and `est.json`;',
    '- you have listened to it (`npx est dev`), or compared it with the original.',
    '',
    'Then add `dist/<id>-<version>.est` to Cyber: Home, EST PLUGINS, Add a plugin (where adding your own plugins is open; `npx est dev` plays it on your computer either way).',
    '',
  );
  return out.join('\n');
}

/** Write the new folder for a scan. Throws before writing anything when the folder may not be made. */
export function writePort(scan: PortScan, opts: PortOptions): Ported {
  const real = realpathSync(opts.source);
  const root = lstatSync(real).isDirectory() ? real : dirname(real);
  const dest = resolve(opts.dest);
  const destReal = existsSync(dest) ? realpathSync(dest) : join(existsSync(dirname(dest)) ? realpathSync(dirname(dest)) : dirname(dest), basename(dest));
  if (inside(root, destReal)) throw new Error(`${opts.dest} is inside the source folder: est port never writes there (name another folder with --out)`);
  if (inside(destReal, root)) throw new Error(`${opts.dest} holds the source folder: name another folder with --out`);

  const single = scan.classes.length === 1 ? wordsOf(scan.classes[0]!.name) : wordsOf(scan.name);
  const name = opts.name ?? plainName(single, 'Ported Plugin');
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'ported-plugin';
  const made = scaffold({ template: PORT_TEMPLATE, dest, id: opts.id ?? `org.example.${slug}`, name, templatesDir: opts.templatesDir, schema: opts.schema, extras: opts.extras, kit: opts.kit });

  // The original's files, each under a safe name.
  const copied: Ported['copied'] = [];
  const taken = new Set<string>();
  for (const from of scan.copy) {
    const abs = join(root, ...from.split('/'));
    const st = lstatSync(abs);
    if (!st.isFile() || st.size > PORT_CAPS.fileBytes) continue; // changed since the scan: left out
    const segs = from.split('/').map(safeSegment);
    let to = `${ORIGINAL_DIR}/${segs.join('/')}`;
    for (let n = 2; taken.has(to.toLowerCase()); n++) { const e = extname(to); to = `${to.slice(0, to.length - e.length).replace(/-\d+$/, '')}-${n}${e}`; }
    taken.add(to.toLowerCase());
    mkdirSync(dirname(join(dest, to)), { recursive: true });
    writeFileSync(join(dest, to), readFileSync(abs));
    copied.push({ from, to, renamed: segs.join('/') !== from });
  }
  const sources = copied.filter(c => /\.(c|cc|cpp|cxx|c\+\+)$/i.test(c.to)).map(c => c.to);
  const params = declared(scan);
  const ported: Ported = { dir: dest, id: made.id, name: made.name, files: 0, copied, sources, parameters: params };

  // The CLAP side and the adapter.
  writeFileSync(join(dest, 'src', 'plugin.cpp'), portedPluginCpp(readFileSync(join(dest, 'src', 'plugin.cpp'), 'utf8'), params));
  rmSync(join(dest, 'src', 'gain.hpp'), { force: true });
  writeFileSync(join(dest, 'src', 'adapter.hpp'), adapterHpp(scan, params, copied));

  // est.json: the parameters, and what the folder is for now.
  const manifest = JSON.parse(readFileSync(join(dest, 'est.json'), 'utf8')) as Record<string, unknown>;
  manifest.description = 'A port in progress: the sound passes through until src/adapter.hpp calls the original (PORT_PLAN.md).';
  manifest.parameters = params.map(q => ({ id: q.id, name: q.name, ...(q.unit ? { unit: q.unit } : {}) }));
  writeFileSync(join(dest, 'est.json'), `${JSON.stringify(manifest, null, 2)}\n`);

  // est-build.json: the include folders now, and est port's record of the original's sources.
  const buildFile = join(dest, 'est-build.json');
  const build = JSON.parse(readFileSync(buildFile, 'utf8')) as Record<string, unknown>;
  const includeDirs = [...new Set(copied.filter(c => !sources.includes(c.to)).map(c => posix(dirname(c.to))))].filter(d => d !== ORIGINAL_DIR).slice(0, 16);
  build.$comment = `${String(build.$comment ?? '')} Written by est port: "sources" is what is compiled now (the adapter passes the sound through); "port" records the original's files, copied into ${ORIGINAL_DIR}/. Move each of "port"."sources" into "sources" when src/adapter.hpp includes its header (PORT_PLAN.md, step 2).`.trim();
  build.sources = ['src/plugin.cpp'];
  build.include = ['src', ...(copied.length ? [ORIGINAL_DIR, ...includeDirs] : [])];
  build.std = scan.std;
  build.port = { from: plainName(scan.name, 'original'), sources, files: Object.fromEntries(copied.map(c => [c.to, c.from])) };
  writeFileSync(buildFile, `${JSON.stringify(build, null, 2)}\n`);

  // The golden test: the gain's render is not this plugin's; the first `est test` writes a new one.
  const goldenFile = join(dest, 'test', 'golden.json');
  if (existsSync(goldenFile)) {
    const golden = JSON.parse(readFileSync(goldenFile, 'utf8')) as Record<string, unknown>;
    golden.$comment = `${String(golden.$comment ?? '')} Written by est port: the events move the first parameters across their ranges; change them to exercise your knobs.`.trim();
    golden.events = params.slice(0, 4).map((q, i) => { const r = rangeOf(q); return { type: 'param', time: Number((0.02 + 0.06 * i).toFixed(2)), id: q.id, value: i % 2 ? r.min + (r.max - r.min) * 0.25 : r.min + (r.max - r.min) * 0.75 }; });
    writeFileSync(goldenFile, `${JSON.stringify(golden, null, 2)}\n`);
    rmSync(join(dest, 'test', String(golden.render ?? 'golden.f32')), { force: true });
  }

  // The folder's instructions point at the plan first.
  const agents = join(dest, 'AGENTS.md');
  if (existsSync(agents)) {
    const text = readFileSync(agents, 'utf8');
    const note = '> **This folder is a port in progress**, made by `est port`. Read `PORT_PLAN.md` first and follow it. Where this file says `src/gain.hpp`, read `src/adapter.hpp`: the one class `src/plugin.cpp` calls. It passes the sound through until you wire the original (in `src/original/`) into it.';
    const lines = text.split('\n');
    const at = lines.findIndex(l => /^# /.test(l));
    lines.splice(at < 0 ? 0 : at + 1, 0, '', note);
    writeFileSync(agents, lines.join('\n'));
  }
  writeFileSync(join(dest, 'PORT_PLAN.md'), portPlan(scan, ported));
  ported.files = made.files + copied.length + 1;
  return ported;
}
