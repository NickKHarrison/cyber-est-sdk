/**
 * `est port` (1.805, "Bring your plugin"): reads a C or C++ source tree and reports what a port to
 * EST will meet. `scanPort` only reads; `commands/port.ts` writes the new folder from what it found.
 *
 * It **reads text and nothing else**: no file of the tree is run, compiled or included, no symbolic
 * link is followed (a link is listed as skipped, so nothing leads out of the tree), and every find
 * is a text pattern, so a find can be wrong. Each one is reported with its file and line for the
 * person, or their assistant, to check.
 *
 * The caps (`PORT_CAPS`), and why:
 * - `files` 2000 source files read and `entries` 20000 directory entries looked at: a plugin's DSP
 *   is tens of files; past this the tree is a framework checkout, and reading on only makes the
 *   report longer than anyone reads. What was left unread is counted and said.
 * - `fileBytes` 1 MiB a file: hand-written DSP source is a few hundred KiB at most; a larger file
 *   is generated data (a table, an embedded sample), and a pattern search of it finds nothing useful.
 * - `totalBytes` 32 MiB read in all, `copyBytes` 8 MiB and `copyFiles` 200 copied: the new folder
 *   stays small enough to read and to pack.
 * - `depth` 16 folders deep: deeper is a vendored dependency tree.
 * - `parameters` 64 found, `findings` 40 lines a kind (5 a file): the plan stays readable; the
 *   counts past the cap are said.
 * - `line` 160 characters of any source text quoted: one line of a report.
 *
 * Everything quoted from the tree (file names, lines, names) is untrusted text: `md` escapes it for
 * Markdown, `cComment` for a C++ comment, and names that reach est.json go through `plainName`.
 */
import { lstatSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { basename, dirname, extname, join } from 'node:path';

export const PORT_CAPS = Object.freeze({
  files: 2000, entries: 20000, fileBytes: 1 << 20, totalBytes: 32 << 20, copyBytes: 8 << 20, copyFiles: 200,
  depth: 16, parameters: 64, findings: 40, findingsPerFile: 5, line: 160,
});

const SOURCE_EXT = new Set(['.c', '.cc', '.cpp', '.cxx', '.c++']);
const HEADER_EXT = new Set(['.h', '.hh', '.hpp', '.hxx', '.h++', '.inc', '.ipp', '.tpp']);
/** Folders never read: build output, installs, version control. */
const SKIP_DIRS = new Set(['.git', '.hg', '.svn', 'node_modules', 'build', 'dist', 'out', 'bin', 'obj', 'target', '.vs', '.vscode', '.idea', 'cmake-build-debug', 'cmake-build-release', 'DerivedData']);
/** A folder named for the window: its files are not copied. */
const WINDOW_DIR = /^(gui|ui|editor|editors|views?|widgets?|windows?|graphics|skins?|resources?)$/i;
/** Files that say how the tree is built (read for the C++ standard only). */
const BUILD_FILE = /^(CMakeLists\.txt|Makefile|makefile|GNUmakefile|meson\.build|compile_flags\.txt|.*\.(cmake|mk|pro|vcxproj))$/;
const LICENCE_FILE = /^(LICEN[CS]E|COPYING|UNLICENSE|NOTICE)(\.[A-Za-z]+)?$/i;

/** What does not port, by kind: what it is, and what to do instead (PORT_PLAN.md's sentences). */
export const PORT_KINDS = Object.freeze({
  window: { title: 'A native window, or GUI classes', instead: 'Leave it out. Cyber draws knobs from the parameters in est.json; for your own look, write a page in `ui/` (ui.md in the kit\'s docs).', blocks: true },
  threads: { title: 'Threads, locks, atomics and timers', instead: 'An EST module has one thread. Do the work in the audio callback, spread a heavy job over several blocks, or work it out once when a knob moves. A `std::atomic` becomes a plain variable; a lock goes away.', blocks: false },
  files: { title: 'Files and printing', instead: 'There is no file system. Compile the data in (a table in a header), or keep it in the plugin\'s state or its presets. Remove printing.', blocks: false },
  network: { title: 'The network', instead: 'A plugin talks to nothing. Remove it.', blocks: false },
  loading: { title: 'Loading code at run time', instead: 'Nothing is loaded at run time: compile what you need into the module.', blocks: false },
  simd: { title: 'Processor-specific SIMD', instead: 'Use the plain C++ path (most code keeps one behind an `#if`), or WebAssembly\'s fixed-width SIMD: `<wasm_simd128.h>` with `"simd": true` in est-build.json.', blocks: false },
  exceptions: { title: 'Exceptions and run-time type information', instead: 'The build passes `-fno-exceptions -fno-rtti`. Return a code instead of throwing; use `static_cast`.', blocks: false },
  random: { title: 'Random numbers and clocks', instead: 'Not repeatable, and the validator renders twice and compares (EST-C018). Seed your own noise generator (a few lines) and count time in samples.', blocks: false },
  library: { title: 'The C++ standard library', instead: 'A bare clang has no C++ standard library for wasm32. `<cmath>`, `<math.h>`, `<cstring>`, `<string.h>`, `<cstdint>` and `<cstddef>` are there. Replace a container with a fixed array, or with memory from `malloc` taken in `activate`; `std::min`, `std::max` and `std::clamp` are three lines each.', blocks: false },
  outside: { title: 'Headers that are not in this folder (a framework or a library)', instead: 'Its code does not come across. Rewrite the few calls the DSP makes to it, or bring that library\'s source in if its licence lets you.', blocks: false },
  slow: { title: '`long double`', instead: 'On wasm32 it is 128-bit software maths, very slow. Use `double`.', blocks: false },
  denormals: { title: 'Flush-to-zero switches', instead: 'WebAssembly has no flush-to-zero. Set a filter or feedback state below 1e-20 to 0 yourself; the validator counts them (EST-C027).', blocks: false },
} as const);
export type PortKind = keyof typeof PORT_KINDS;

interface Rule { kind: PortKind; include?: RegExp; code?: RegExp }
/** Headers the kit gives a module (so an include of one is no finding). */
const PROVIDED = /^(cmath|math\.h|cstring|string\.h|cstdint|stdint\.h|cstddef|stddef\.h|stdbool\.h|stdarg\.h|float\.h|limits\.h|iso646\.h|stdalign\.h|stdnoreturn\.h|wasm_simd128\.h|clap\/.*|est\/.*)$/;
const RULES: Rule[] = [
  { kind: 'window', include: /^(windows\.h|windowsx\.h|commctrl\.h|gdiplus\.h|d2d1.*|d3d.*|X11\/.*|xcb\/.*|wayland.*|Cocoa\/.*|AppKit\/.*|UIKit\/.*|gtk\/.*|gdk\/.*|GL\/.*|OpenGL\/.*|GLES\d*\/.*)$/i },
  { kind: 'window', code: /\b(?:class|struct)\s+\w*(?:Editor|Window|Gui|GUI|View|Widget|Panel|LookAndFeel|Canvas)\b|\bvoid\s+(?:paint|onPaint|onDraw|resized|mouse(?:Down|Up|Move|Drag))\s*\(|\b(?:HWND|NSView|NSWindow|XOpenDisplay|CreateWindow(?:Ex)?[AW]?)\b/ },
  { kind: 'threads', include: /^(thread|mutex|shared_mutex|atomic|condition_variable|future|semaphore|stop_token|latch|barrier|pthread\.h|threads\.h|stdatomic\.h)$/ },
  { kind: 'threads', code: /\bstd::(?:thread|jthread|mutex|recursive_mutex|shared_mutex|atomic\w*|lock_guard|unique_lock|scoped_lock|condition_variable\w*|async|future|promise)\b|\bpthread_\w+|\b(?:CreateThread|_beginthread\w*)\b|\b(?:startTimer|sleep_for|sleep_until|usleep|nanosleep)\b|\bclass\s+\w*Timer\b/ },
  { kind: 'files', include: /^(fstream|filesystem|cstdio|stdio\.h|iostream|sstream|iomanip|unistd\.h|fcntl\.h|dirent\.h|sys\/stat\.h|io\.h)$/ },
  { kind: 'files', code: /\b(?:fopen|fread|fwrite|fclose|fprintf|printf|puts)\s*\(|\bstd::(?:ifstream|ofstream|fstream|filesystem|cout|cerr)\b/ },
  { kind: 'network', include: /^(sys\/socket\.h|netinet\/.*|arpa\/.*|netdb\.h|winsock2?\.h|ws2tcpip\.h|curl\/.*)$/ },
  { kind: 'network', code: /\b(?:socket|getaddrinfo)\s*\(/ },
  { kind: 'loading', include: /^dlfcn\.h$/ },
  { kind: 'loading', code: /\b(?:dlopen|dlsym|LoadLibrary(?:Ex)?[AW]?|GetProcAddress)\s*\(/ },
  { kind: 'simd', include: /^((?:imm|x86|xmm|emm|pmm|tmm|smm|nmm|wmm|amm|avx|avx2)intrin\.h|arm_neon\.h|arm_sve\.h|altivec\.h)$/ },
  { kind: 'simd', code: /\b(?:_mm(?:256|512)?_\w+|__m(?:128|256|512)[id]?|float32x[24]_t|v(?:ld|st)1q?_\w+)\b/ },
  { kind: 'exceptions', include: /^(stdexcept|exception|typeinfo|typeindex)$/ },
  { kind: 'exceptions', code: /\bthrow\s+[\w:]|\btry\s*\{|\bcatch\s*\(|\bdynamic_cast\s*<|\btypeid\s*\(/ },
  { kind: 'random', include: /^(random|chrono|ctime|time\.h|sys\/time\.h)$/ },
  { kind: 'random', code: /(?<![\w.>:])(?:rand|srand|time|clock|gettimeofday|clock_gettime)\s*\(|\bstd::(?:random_device|chrono)\b|\b(?:QueryPerformanceCounter|GetTickCount(?:64)?)\b/ },
  { kind: 'denormals', code: /\b(?:_MM_SET_(?:FLUSH_ZERO|DENORMALS_ZERO)_MODE|fesetenv|_controlfp\w*)\b|\b\w*NoDenormals\b/ },
  { kind: 'slow', code: /\blong\s+double\b/ },
  { kind: 'library', include: /^(vector|string|memory|algorithm|array|map|unordered_map|set|unordered_set|list|deque|queue|stack|functional|utility|tuple|numeric|complex|limits|type_traits|cassert|assert\.h|cstdlib|stdlib\.h|initializer_list|optional|variant|string_view|iterator|new|climits|cfloat|bitset|span|ranges|any|cctype|ctype\.h|cwchar|locale|regex|valarray|bit|concepts|numbers)$/ },
];

export interface PortFinding { kind: PortKind; file: string; line: number; text: string }
export interface PortClass {
  name: string; file: string; line: number;
  /** Methods that look like the audio callback (`process…`, `render…`, `tick`), as written. */
  process: { name: string; line: number; text: string }[];
  /** Methods that look like set-up (`prepare…`, `setSampleRate`, `reset`, `init…`). */
  prepare: { name: string; line: number; text: string }[];
}
export interface PortSeen { file: string; line: number; how: 'layout' | 'table' | 'setter' | 'enum' | 'comment' | 'field'; text: string }
export interface PortParameter {
  id: number; name: string;
  min: number | null; max: number | null; default: number | null; unit: string;
  /** The setter to call, when one was seen (`setDrive`). */
  setter: string | null;
  /** Where each fact was seen. */
  seen: PortSeen[];
  /** What was not found and must be checked by hand: 'range', 'default', 'unit'. */
  todo: string[];
}
export interface PortFile {
  /** The path in the tree, forward slashes. */
  path: string; bytes: number; kind: 'source' | 'header';
  /** Quoted and angle includes, as written. */
  includes: { name: string; quoted: boolean; line: number }[];
  /** A kind that keeps the file out of the new folder, or null. */
  blocked: PortKind | null;
}
export interface PortScan {
  /** The tree's own name (its folder's, or the file's without its extension). */
  name: string;
  files: PortFile[];
  /** Files and folders not read, with why. */
  skipped: { path: string; why: string }[];
  /** How many entries past the caps were never looked at. */
  unread: number;
  licences: string[];
  classes: PortClass[];
  parameters: PortParameter[];
  /** Parameters found past the cap (not listed). */
  moreParameters: number;
  findings: PortFinding[];
  /** Findings past the cap, by kind. */
  moreFindings: Partial<Record<PortKind, number>>;
  /** The C++ standard to build with, and where it was read (null: nothing said, the template's). */
  std: string; stdSeen: { file: string; line: number; text: string } | null;
  /** The files to copy into the new folder (paths in the tree), in order. */
  copy: string[];
}

// ---- Untrusted text ----

/** One line of plain text from the tree: controls and line breaks become spaces, cut to the cap. */
export function oneLine(s: string, max: number = PORT_CAPS.line): string {
  let out = '';
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    // Controls, the line and paragraph separators, zero-width and direction marks: a space.
    out += c < 0x20 || c === 0x7f || (c >= 0x80 && c < 0xa0) || c === 0x2028 || c === 0x2029 || (c >= 0x200b && c <= 0x200f) || (c >= 0x202a && c <= 0x202e) || (c >= 0x2060 && c <= 0x2069) || c === 0xfeff ? ' ' : ch;
  }
  out = out.replace(/\s+/g, ' ').trim();
  return [...out].length > max ? `${[...out].slice(0, max - 1).join('')}…` : out;
}

/** Text from the tree as Markdown text: nothing in it is markup (a table cell, a list item, a link). */
export function md(s: string, max: number = PORT_CAPS.line): string {
  return oneLine(s, max).replace(/[\\`*_{}[\]()#+!|<>~]/g, c => (c === '<' ? '&lt;' : c === '>' ? '&gt;' : `\\${c}`)).replace(/^([-=]|\d+\.)/, '\\$1');
}

/** Text from the tree as a Markdown code span (source lines, file names): a backtick cannot close it, a pipe cannot split a table. */
export function mdCode(s: string, max: number = PORT_CAPS.line): string {
  const t = oneLine(s, max).replace(/`/g, "'").replace(/\|/g, '\\|');
  return t ? `\`${t}\`` : '';
}

/** Text from the tree inside a `//` comment of generated C++: one line, no comment end, no line splice. */
export function cComment(s: string, max: number = PORT_CAPS.line): string {
  return oneLine(s, max).replace(/\*\//g, '* /').replace(/\?\?/g, '? ?').replace(/[\\\s]+$/g, '');
}

/** A name for est.json and for a C string: printable ASCII without quotes, backslashes or backticks, at most 60. */
export function plainName(s: string, fallback: string): string {
  const t = oneLine(s, 400).replace(/[^\x20-\x7e]/g, ' ').replace(/["\\`]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60).trim();
  return t || fallback;
}

/** One segment of a copied file's path: `[A-Za-z0-9._+-]`, never `.`, `..`, hidden or an option. */
export function safeSegment(s: string): string {
  let t = s.replace(/[^A-Za-z0-9._+-]/g, '_').slice(0, 80);
  if (!t || /^\.+$/.test(t)) t = '_';
  if (/^[-.]/.test(t)) t = `_${t.slice(1)}`;
  return t;
}

// ---- Reading the tree ----

interface Read { path: string; text: string; bytes: number; kind: 'source' | 'header'; /** The text with comments and strings blanked (kept from the first pass). */ code?: string }

function walk(root: string, only: string | null) {
  const files: Read[] = [];
  const builds: { path: string; text: string }[] = [];
  const skipped: { path: string; why: string }[] = [];
  const licences: string[] = [];
  let entries = 0, total = 0, unread = 0;
  const visit = (dir: string, rel: string, depth: number) => {
    let names: string[];
    try { names = readdirSync(dir); } catch { skipped.push({ path: rel || '.', why: 'could not be read' }); return; }
    // Byte order, so the report is the same on every machine.
    names.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    for (const n of names) {
      if (only !== null && rel === '' && n !== only) continue;
      const path = rel ? `${rel}/${n}` : n;
      if (++entries > PORT_CAPS.entries) { unread++; continue; }
      let st;
      try { st = lstatSync(join(dir, n)); } catch { skipped.push({ path, why: 'could not be read' }); continue; }
      // Never followed: a link could lead anywhere, in the tree or out of it.
      if (st.isSymbolicLink()) { skipped.push({ path, why: 'a symbolic link (never followed)' }); continue; }
      if (st.isDirectory()) {
        if (SKIP_DIRS.has(n)) { skipped.push({ path, why: 'build output, an install or version control' }); continue; }
        if (depth >= PORT_CAPS.depth) { skipped.push({ path, why: `more than ${PORT_CAPS.depth} folders deep` }); continue; }
        visit(join(dir, n), path, depth + 1);
        continue;
      }
      if (!st.isFile()) { skipped.push({ path, why: 'not a file' }); continue; }
      if (LICENCE_FILE.test(n)) licences.push(path);
      const ext = extname(n).toLowerCase();
      const isBuild = BUILD_FILE.test(n);
      const kind = SOURCE_EXT.has(ext) ? 'source' : HEADER_EXT.has(ext) ? 'header' : null;
      if (ext === '.m' || ext === '.mm') { skipped.push({ path, why: 'Objective-C: a native window or system code' }); continue; }
      if (!kind && !isBuild) continue;
      if (st.size > PORT_CAPS.fileBytes) { if (kind) skipped.push({ path, why: `larger than ${PORT_CAPS.fileBytes >> 20} MiB (generated data, not read)` }); continue; }
      if (kind && files.length >= PORT_CAPS.files) { unread++; continue; }
      if (total + st.size > PORT_CAPS.totalBytes) { unread++; continue; }
      let text: string;
      try { text = readFileSync(join(dir, n)).toString('utf8'); } catch { skipped.push({ path, why: 'could not be read' }); continue; }
      total += st.size;
      if (kind) files.push({ path, text, bytes: st.size, kind });
      else builds.push({ path, text });
    }
  };
  visit(root, '', 0);
  return { files, builds, skipped, licences, unread };
}

/**
 * A source text three ways, each the same length with the same line breaks: `code` (comments and
 * the insides of strings blanked), `strings` (only comments blanked), `comments` (only comments).
 */
export function layers(src: string): { code: string; strings: string; comments: string } {
  const n = src.length;
  const code = new Array<string>(n), strings = new Array<string>(n), comments = new Array<string>(n);
  let i = 0;
  const put = (j: number, c: string, s: string, m: string) => { const nl = src[j] === '\n'; code[j] = nl ? '\n' : c; strings[j] = nl ? '\n' : s; comments[j] = nl ? '\n' : m; };
  while (i < n) {
    const ch = src[i]!;
    if (ch === '/' && src[i + 1] === '/') {
      while (i < n && src[i] !== '\n') { put(i, ' ', ' ', src[i]!); i++; }
      continue;
    }
    if (ch === '/' && src[i + 1] === '*') {
      const e = src.indexOf('*/', i + 2);
      const end = e < 0 ? n : e + 2;
      for (; i < end; i++) put(i, ' ', ' ', src[i]!);
      continue;
    }
    if (ch === '"' || (ch === "'" && !/[A-Za-z0-9_]/.test(src[i - 1] ?? ''))) {
      put(i, ch, ch, ' ');
      let j = i + 1;
      while (j < n && src[j] !== ch && src[j] !== '\n') {
        if (src[j] === '\\' && j + 1 < n) { put(j, ' ', src[j]!, ' '); j++; }
        put(j, ' ', src[j]!, ' ');
        j++;
      }
      if (j < n) put(j, src[j] === '\n' ? '\n' : ch, src[j] === '\n' ? '\n' : ch, ' ');
      i = j + 1;
      continue;
    }
    put(i, ch, ch, ' ');
    i++;
  }
  return { code: code.join(''), strings: strings.join(''), comments: comments.join('') };
}

/** The 1-based line of an index in `text`, by a search of its line starts (a file may hold tens of thousands of finds). */
function lineIndex(text: string): (index: number) => number {
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) starts.push(i + 1);
  return index => {
    let lo = 0, hi = starts.length - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (starts[mid]! <= index) lo = mid; else hi = mid - 1; }
    return lo + 1;
  };
}

/** The index after the brace that closes the one at `open` (in blanked code), or the text's end. */
function closeOf(code: string, open: number): number {
  let d = 0;
  for (let i = open; i < code.length; i++) {
    if (code[i] === '{') d++;
    else if (code[i] === '}' && --d === 0) return i + 1;
  }
  return code.length;
}

const PROCESS_NAME = /^(process\w*|render\w*|tick|perform|compute\w*)$/i;
const PREPARE_NAME = /^(prepare\w*|setSampleRate|setSamplingRate|setSampleFreq\w*|init\w*|reset|setup|activate|configure)$/i;
/** Setters that are not parameters. */
const NOT_A_PARAMETER = /^(SampleRate|SamplingRate|SampleFreq\w*|BlockSize|BufferSize|MaxBlockSize|NumChannels|Channels|ChannelCount|Tempo|Bpm|PlayHead|Host|Latency|Bypass(ed)?|Enabled|Parameter|Param|Value|State|Program|Preset|Listener|Callback|Buffer|Input|Output)$/;
const NUM = '[-+]?(?:\\d{1,24}\\.?\\d{0,24}|\\.\\d{1,24})(?:[eE][-+]?\\d{1,4})?[fF]?';
const UNITS = ['dB', 'Hz', 'kHz', 'ms', 's', '%', 'st', 'cents', 'oct'];
const UNIT_RE = '(dB|Hz|kHz|ms|sec|seconds|s|%|st|semitones|cents|oct|octaves)';
const unitOf = (u: string | undefined): string => {
  if (!u) return '';
  const l = u.toLowerCase();
  const t = l === 'sec' || l === 'seconds' ? 's' : l === 'semitones' ? 'st' : l === 'octaves' ? 'oct' : l === 'db' ? 'dB' : l === 'hz' ? 'Hz' : l === 'khz' ? 'kHz' : u;
  return UNITS.includes(t) ? t : '';
};
const num = (s: string | undefined): number | null => { if (s === undefined) return null; const v = Number(s.replace(/[fF]$/, '')); return Number.isFinite(v) ? v : null; };
/** `CutoffFreq`, `cutoff_freq`, `CUTOFF_FREQ` → "Cutoff Freq". */
export function wordsOf(ident: string): string {
  const parts = ident.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2').split(/[\s_]+/).filter(Boolean);
  return parts.map(w => (/^[A-Z0-9]+$/.test(w) && w.length > 3 ? w[0]! + w.slice(1).toLowerCase() : w[0]!.toUpperCase() + w.slice(1))).join(' ');
}
const keyOf = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, '');

interface Draft { name: string; key: string; min: number | null; max: number | null; def: number | null; unit: string; setter: string | null; seen: PortSeen[]; rank: number }

/** Scan a folder (or one file) of C or C++ source. Reads only; throws when there is nothing to read. */
export function scanPort(source: string): PortScan {
  // The path the person named may itself be a link; nothing below it is followed.
  const real = realpathSync(source);
  const single = !lstatSync(real).isDirectory();
  const root = single ? dirname(real) : real;
  const only = single ? basename(real) : null;
  const name = single ? basename(real, extname(real)) : basename(real);
  const tree = walk(root, only);
  if (!tree.files.length) throw new Error(`no C or C++ source in ${source} (looked for .c .cc .cpp .cxx .h .hh .hpp .hxx .inc)`);

  const byPath = new Map(tree.files.map(f => [f.path, f]));
  const byBase = new Map<string, string[]>();
  for (const f of tree.files) byBase.set(basename(f.path), [...(byBase.get(basename(f.path)) ?? []), f.path]);
  /** Where an include of `name` from `from` lands in the tree, or null. */
  const resolveInclude = (from: string, inc: string): string | null => {
    const parts = [...(dirname(from) === '.' ? [] : dirname(from).split('/')), ...inc.split('/')];
    const out: string[] = [];
    for (const p of parts) { if (p === '..') out.pop(); else if (p && p !== '.') out.push(p); }
    const rel = out.join('/');
    if (byPath.has(rel)) return rel;
    if (byPath.has(inc)) return inc;
    // By its last folders, then by its name when only one file has it.
    const tail = tree.files.find(f => f.path.endsWith(`/${inc}`));
    if (tail) return tail.path;
    const same = byBase.get(basename(inc));
    return same && same.length === 1 ? same[0]! : null;
  };

  const findings: PortFinding[] = [];
  const moreFindings: Partial<Record<PortKind, number>> = {};
  const counts = new Map<string, number>();
  const find = (kind: PortKind, file: string, line: number, text: string) => {
    const perFile = `${kind}\n${file}`;
    const total = counts.get(kind) ?? 0, here = counts.get(perFile) ?? 0;
    if (total >= PORT_CAPS.findings || here >= PORT_CAPS.findingsPerFile) { moreFindings[kind] = (moreFindings[kind] ?? 0) + 1; return; }
    counts.set(kind, total + 1);
    counts.set(perFile, here + 1);
    findings.push({ kind, file, line, text: oneLine(text) });
  };

  const files: PortFile[] = [];
  const classes: PortClass[] = [];
  const drafts: Draft[] = [];
  /** Ranges read from comments (`drive (0..36 dB)`), by name. */
  const commentRanges: { key: string; min: number; max: number; unit: string; seen: PortSeen }[] = [];
  /** Fields with a starting value (`float toneHz = 6000`), by name. */
  const fields: { key: string; value: number; seen: PortSeen }[] = [];
  const addDraft = (d: Omit<Draft, 'key'>) => {
    const key = keyOf(d.name);
    if (!key) return;
    const had = drafts.find(x => x.key === key);
    if (!had) { drafts.push({ ...d, key }); return; }
    // The better-ranked find keeps its numbers; the other adds what is missing and where it was seen.
    const [keep, add] = d.rank < had.rank ? [d, had] : [had, d];
    Object.assign(had, { name: keep.name, min: keep.min ?? add.min, max: keep.max ?? add.max, def: keep.def ?? add.def, unit: keep.unit || add.unit, setter: keep.setter ?? add.setter, rank: Math.min(d.rank, had.rank), seen: had.seen.length < 6 ? [...had.seen, ...d.seen] : had.seen });
  };

  for (const f of tree.files) {
    const lay = layers(f.text);
    f.code = lay.code;
    const lineAt = lineIndex(f.text);
    const srcLines = f.text.split('\n');
    const commentLines = lay.comments.split('\n');
    const codeLines = lay.code.split('\n');
    const stringLines = lay.strings.split('\n');
    const includes: PortFile['includes'] = [];
    let blocked: PortKind | null = null;
    const inWindowDir = f.path.split('/').slice(0, -1).find(seg => WINDOW_DIR.test(seg));
    if (inWindowDir) { blocked = 'window'; find('window', f.path, 1, `in the folder ${inWindowDir}/`); }

    for (let i = 0; i < codeLines.length; i++) {
      const inc = /^\s*#\s*include\s*(["<])([^">]+)[">]/.exec(stringLines[i]!);
      if (inc) {
        const quoted = inc[1] === '"', what = inc[2]!.trim();
        includes.push({ name: what, quoted, line: i + 1 });
        const rule = RULES.find(r => r.include?.test(what));
        if (rule) { find(rule.kind, f.path, i + 1, srcLines[i]!); if (PORT_KINDS[rule.kind].blocks) blocked ??= rule.kind; }
        else if (!PROVIDED.test(what) && !resolveInclude(f.path, what)) find('outside', f.path, i + 1, srcLines[i]!);
        continue;
      }
      for (const r of RULES) {
        if (!r.code || !r.code.test(codeLines[i]!)) continue;
        find(r.kind, f.path, i + 1, srcLines[i]!);
        if (PORT_KINDS[r.kind].blocks) blocked ??= r.kind;
      }
    }
    files.push({ path: f.path, bytes: f.bytes, kind: f.kind, includes, blocked });

    // A licence named in a file's own header.
    const spdx = /SPDX-License-Identifier:\s*([A-Za-z0-9.+-]{1,40})/.exec(lay.comments);
    if (spdx && tree.licences.length < 40) tree.licences.push(`${f.path} (SPDX ${spdx[1]})`);

    // Ranges in comments: `drive (0..36 dB)`, `tone: 200 to 12000 Hz`, `mix [0, 1]`.
    const rangeRe = new RegExp(`(?<![A-Za-z0-9_])([A-Za-z][A-Za-z0-9_]{0,60})\\s*[:(\\[=]\\s*\\(?\\s*(${NUM})\\s*(?:\\.\\.\\.?|…|\\bto\\b|–|,)\\s*(${NUM})(?:\\s*${UNIT_RE}(?![A-Za-z]))?`, 'g');
    for (const m of lay.comments.matchAll(rangeRe)) {
      const lo = num(m[2]), hi = num(m[3]);
      if (lo === null || hi === null || !(lo < hi)) continue;
      const line = lineAt(m.index);
      commentRanges.push({ key: keyOf(m[1]!), min: lo, max: hi, unit: unitOf(m[4]), seen: { file: f.path, line, how: 'comment', text: oneLine(m[0]) } });
    }

    // A parameter layout declaration: ("id", "Name", range(lo, hi[, step[, skew]]), default) or ("id", "Name", lo, hi, default).
    // The range either wrapped (a call or braces, with an optional step and skew, closed before the default) or bare.
    const layoutRe = new RegExp(`"([A-Za-z0-9_ .:-]{1,48})"(?:\\s*,\\s*\\d+\\s*\\})?\\s*,\\s*"([^"\\n]{1,80})"\\s*,\\s*(?:[A-Za-z_][\\w:<>\\s]{0,80}[({]\\s*(${NUM})\\s*,\\s*(${NUM})(?:\\s*,\\s*${NUM}){0,2}\\s*[)}]\\s*,\\s*(${NUM})|(${NUM})\\s*,\\s*(${NUM})\\s*,\\s*(${NUM}))`, 'g');
    const layoutAt = new Set<number>();
    for (const m of blocked ? [] : lay.strings.matchAll(layoutRe)) {
      const lo = num(m[3] ?? m[6]), hi = num(m[4] ?? m[7]), def = num(m[5] ?? m[8]);
      const line = lineAt(m.index);
      layoutAt.add(line);
      const okRange = lo !== null && hi !== null && lo < hi;
      addDraft({ name: m[2]!, min: okRange ? lo : null, max: okRange ? hi : null, def: okRange && def !== null && def >= lo && def <= hi ? def : null, unit: '', setter: null, rank: 0, seen: [{ file: f.path, line, how: 'layout', text: oneLine(m[0]) }] });
    }
    // A table row: { [id,] "Name", ["module",] lo, hi, default [, …, "unit"] }.
    const tableRe = new RegExp(`\\{\\s*(?:[A-Za-z_][\\w:]{0,80}\\s*,\\s*)?"([^"\\n]{1,80})"\\s*,\\s*(?:"[^"\\n]*"\\s*,\\s*)?(${NUM})\\s*,\\s*(${NUM})\\s*,\\s*(${NUM})(?:[^{}"\\n]{0,200}"([^"\\n]{0,16})")?`, 'g');
    for (const m of blocked ? [] : lay.strings.matchAll(tableRe)) {
      const line = lineAt(m.index);
      if (layoutAt.has(line)) continue;
      const lo = num(m[2]), hi = num(m[3]), def = num(m[4]);
      const okRange = lo !== null && hi !== null && lo < hi;
      addDraft({ name: m[1]!, min: okRange ? lo : null, max: okRange ? hi : null, def: okRange && def !== null && def >= lo && def <= hi ? def : null, unit: unitOf(m[5]), setter: null, rank: 1, seen: [{ file: f.path, line, how: 'table', text: oneLine(m[0]) }] });
    }

    // Classes, their audio and set-up methods, their setters and fields.
    for (const m of lay.code.matchAll(/\b(?:class|struct)\s+([A-Za-z_]\w*)\b[^;{()]{0,400}\{/g)) {
      const open = m.index + m[0].length - 1;
      const end = closeOf(lay.code, open);
      const body = lay.code.slice(open, end);
      const cls: PortClass = { name: m[1]!, file: f.path, line: lineAt(m.index), process: [], prepare: [] };
      // Only what is written at the class's own level: a name inside a method's body is a call or a local.
      const depth = new Int32Array(body.length + 1);
      for (let k = 0, d = 0; k < body.length; k++) { depth[k] = d; if (body[k] === '{') d++; else if (body[k] === '}') d--; }
      const member = (at: number) => depth[at] === 1;
      for (const fn of body.matchAll(/\b([A-Za-z_]\w*)\s*\(([^()]{0,600})\)\s*(?:const\s*)?(?:noexcept\s*)?(?:override\s*|final\s*)*[{;]/g)) {
        if (!member(fn.index)) continue;
        const at = open + fn.index, line = lineAt(at);
        const text = oneLine(srcLines[line - 1] ?? '');
        // The first place a name is written (a later one is a call from another method).
        const list = PROCESS_NAME.test(fn[1]!) ? cls.process : PREPARE_NAME.test(fn[1]!) ? cls.prepare : null;
        if (list && !list.some(x => x.name === fn[1])) list.push({ name: fn[1]!, line, text });
      }
      for (const s of body.matchAll(/\bvoid\s+set([A-Z]\w*)\s*\(\s*(?:const\s+)?(float|double|int|bool|unsigned|long|size_t|u?int\d+_t)\s*&?\s*(\w*)\s*\)/g)) {
        if (blocked || NOT_A_PARAMETER.test(s[1]!) || !member(s.index)) continue;
        const at = open + s.index, line = lineAt(at);
        // A range in the same line's comment: `void setDrive(float dB); // 0..36 dB`.
        const tail = new RegExp(`(${NUM})\\s*(?:\\.\\.\\.?|…|\\bto\\b|–)\\s*(${NUM})(?:\\s*${UNIT_RE}(?![A-Za-z]))?`).exec(commentLines[line - 1] ?? '');
        const lo = num(tail?.[1]), hi = num(tail?.[2]);
        const ok = lo !== null && hi !== null && lo < hi;
        const argUnit = /^(db|decibels?)$/i.test(s[3]!) ? 'dB' : /^(hz|freq\w*|hertz)$/i.test(s[3]!) ? 'Hz' : /^(ms|millis\w*)$/i.test(s[3]!) ? 'ms' : /^(percent|pct)$/i.test(s[3]!) ? '%' : '';
        const isBool = s[2] === 'bool';
        addDraft({ name: wordsOf(s[1]!), min: ok ? lo : isBool ? 0 : null, max: ok ? hi : isBool ? 1 : null, def: null, unit: unitOf(tail?.[3]) || argUnit, setter: `set${s[1]!}`, rank: 2, seen: [{ file: f.path, line, how: 'setter', text: oneLine(srcLines[line - 1] ?? '') }] });
      }
      for (const d of body.matchAll(/\b(?:float|double|int|bool)\s+([^;()]{0,400});/g)) {
        if (!member(d.index)) continue;
        const line = lineAt(open + d.index);
        for (const part of d[1]!.split(',')) {
          const fm = new RegExp(`^\\s*([A-Za-z_]\\w*)\\s*(?:=\\s*(${NUM})|\\{\\s*(${NUM})\\s*\\})\\s*$`).exec(part);
          const v = num(fm?.[2] ?? fm?.[3]);
          if (fm && v !== null) fields.push({ key: keyOf(fm[1]!), value: v, seen: { file: f.path, line, how: 'field', text: oneLine(`${fm[1]} = ${fm[2] ?? fm[3]}`) } });
        }
      }
      if (cls.process.length) classes.push(cls);
    }

    // An enum of parameters: its name says so, or two of its members do.
    for (const m of lay.code.matchAll(/\benum\s+(?:class\s+|struct\s+)?([A-Za-z_]\w*)?\s*(?::\s*[\w:\s]{1,60}?)?\s*\{([^{}]{0,8000})\}/g)) {
      if (blocked) continue;
      const members = m[2]!.split(',').map(x => /^\s*([A-Za-z_]\w*)/.exec(x)?.[1]).filter((x): x is string => !!x);
      const prefixed = members.filter(x => /^(k?Param|PARAM_|kP_|P_)/.test(x)).length;
      if (!/param/i.test(m[1] ?? '') && prefixed < 2) continue;
      const line = lineAt(m.index);
      for (const member of members) {
        if (/(count|num|total|last|size|max|end|params?)$/i.test(member)) continue;
        const bare = member.replace(/^(k?Param(eter)?_?|PARAM(ETER)?_|kP_|P_|k(?=[A-Z]))/, '');
        if (!bare) continue;
        addDraft({ name: wordsOf(bare), min: null, max: null, def: null, unit: '', setter: null, rank: 3, seen: [{ file: f.path, line, how: 'enum', text: member }] });
      }
    }
  }

  // Out-of-line definitions (`void Reverb::process(...)`) join their class.
  for (const f of tree.files) {
    const code = f.code ?? layers(f.text).code;
    const lineAt = lineIndex(f.text);
    const srcLines = f.text.split('\n');
    for (const m of code.matchAll(/\b([A-Za-z_]\w*)::([A-Za-z_]\w*)\s*\([^()]{0,600}\)\s*(?:const\s*)?(?:noexcept\s*)?\{/g)) {
      const isProcess = PROCESS_NAME.test(m[2]!), isPrepare = PREPARE_NAME.test(m[2]!);
      if (!isProcess && !isPrepare) continue;
      const line = lineAt(m.index);
      let cls = classes.find(c => c.name === m[1]);
      if (!cls) {
        if (!isProcess) continue;
        cls = { name: m[1]!, file: f.path, line, process: [], prepare: [] };
        classes.push(cls);
      }
      const list = isProcess ? cls.process : cls.prepare;
      if (!list.some(x => x.name === m[2])) list.push({ name: m[2]!, line, text: oneLine(srcLines[line - 1] ?? '') });
    }
  }
  // A class in a file that is left out is not one to port.
  const blockedFiles = new Set(files.filter(f => f.blocked).map(f => f.path));
  const dspClasses = classes.filter(c => !blockedFiles.has(c.file));

  // The parameters: ranges from comments and starting values from fields fill what is missing.
  const parameters: PortParameter[] = drafts.slice(0, PORT_CAPS.parameters).map((d, id) => {
    const seen = [...d.seen];
    let { min, max, unit } = d;
    const fromComment = commentRanges.find(r => r.key === d.key) ?? commentRanges.find(r => r.key.length >= 3 && (d.key.startsWith(r.key) || r.key.startsWith(d.key)));
    if (fromComment && (min === null || max === null)) { min = fromComment.min; max = fromComment.max; unit = unit || fromComment.unit; seen.push(fromComment.seen); }
    // A field is the DSP's own value (often not in the knob's unit), so it is a hint, never the default.
    const field = fields.find(x => x.key === d.key) ?? fields.find(x => d.key.length >= 3 && x.key.startsWith(d.key));
    if (field) seen.push(field.seen);
    const todo = [...(min === null || max === null ? ['range'] : []), ...(d.def === null ? ['default'] : []), ...(unit ? [] : ['unit'])];
    return { id, name: plainName(d.name, `Parameter ${id + 1}`), min, max, default: d.def, unit, setter: d.setter, seen: seen.slice(0, 6), todo };
  });

  // What to copy: the audio classes' files and what they include, else every file that may come across.
  const usable = files.filter(f => !f.blocked);
  const starts = [...new Set(dspClasses.map(c => c.file))];
  let copy: string[];
  if (starts.length) {
    const want = new Set<string>();
    const queue = [...starts];
    while (queue.length) {
      const p = queue.shift()!;
      if (want.has(p) || blockedFiles.has(p)) continue;
      want.add(p);
      const f = files.find(x => x.path === p)!;
      for (const inc of f.includes) { const to = resolveInclude(p, inc.name); if (to) queue.push(to); }
      // A header's own source file beside it (Reverb.h → Reverb.cpp).
      const stem = p.slice(0, p.length - extname(p).length);
      for (const other of usable) if (other.kind === 'source' && other.path !== p && other.path.slice(0, other.path.length - extname(other.path).length) === stem) queue.push(other.path);
    }
    copy = usable.filter(f => want.has(f.path)).map(f => f.path);
  } else copy = usable.map(f => f.path);
  let copied = 0;
  copy = copy.filter((p, i) => { const b = byPath.get(p)!.bytes; if (i >= PORT_CAPS.copyFiles || copied + b > PORT_CAPS.copyBytes) return false; copied += b; return true; });

  // The C++ standard: what the tree's build files say, else what the code needs, else the template's.
  let std = 'c++17';
  let stdSeen: PortScan['stdSeen'] = null;
  const stdRe = /CMAKE_CXX_STANDARD\s+(\d\d)\b|cxx_std_(\d\d)\b|-std=(?:c|gnu)\+\+(\d\d|2[abc])\b|\/std:c\+\+(\d\d)\b|stdcpp(\d\d)\b|cpp_std=(?:c|gnu)\+\+(\d\d)\b/;
  outer: for (const b of tree.builds) {
    const lines = b.text.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const m = stdRe.exec(lines[i]!);
      const v = m?.slice(1).find(Boolean);
      if (!v) continue;
      const n = v === '2a' ? '20' : v === '2b' ? '23' : v === '2c' ? '26' : v;
      if (!['11', '14', '17', '20', '23'].includes(n)) continue;
      std = `c++${n}`;
      stdSeen = { file: b.path, line: i + 1, text: oneLine(lines[i]!) };
      break outer;
    }
  }
  if (!stdSeen) {
    for (const f of tree.files) {
      const code = f.code ?? layers(f.text).code;
      const m = /\bconcept\s+\w+\s*=|\brequires\s*[({]|<=>|\bco_(?:await|yield|return)\b|\bconsteval\b|\bconstinit\b/.exec(code);
      if (m) { const line = lineIndex(f.text)(m.index); std = 'c++20'; stdSeen = { file: f.path, line, text: oneLine(f.text.split('\n')[line - 1] ?? '') }; break; }
    }
  }

  return {
    name, files, skipped: tree.skipped, unread: tree.unread, licences: tree.licences, classes: dspClasses, parameters,
    moreParameters: Math.max(0, drafts.length - PORT_CAPS.parameters), findings, moreFindings, std, stdSeen, copy,
  };
}
