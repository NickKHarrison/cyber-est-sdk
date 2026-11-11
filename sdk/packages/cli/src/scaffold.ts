/**
 * `est new`: a plugin folder from a template (sdk/templates/<template>), changed only in its id
 * and name, and **with no path back into Cyber's repository**: a template that uses the SDK's
 * shared code by a relative path outside its own folder (the Rust crate `est`, the
 * AssemblyScript library) gets a copy of that code inside the new folder and the path pointed at
 * it. Then every reference is checked to stay inside the folder.
 *
 * References it follows: a Cargo.toml's `path = "…"` (dependencies) and `library = "…"` (4-B's
 * `[package.metadata.est]` block), an asconfig.json's `runtime`, `lib`, `entries`, `extends`,
 * `path` (asc's module search folders: a folder holding the library `est` is vendored as `est/`
 * and the search path becomes `.`) and `library`, and the relative import and export specifiers of
 * TypeScript files. Either language's library lands at `est/` in the new folder.
 *
 * What names the template is renamed from the new id: the Rust crate (Cargo.toml's and
 * Cargo.lock's `name`, and the `[package.metadata.est] module` path's file name, still under
 * `target/` so CARGO_TARGET_DIR applies), the plugin's struct or class `Template` (in code, never
 * in strings or comments) and so the source's header, which names the plugin by its name and id.
 * The machine-readable files an agent reads (the manifest schema, the validator's rules, the ABI)
 * are copied in beside est.json, and `est-ui.d.ts` (the UI library's types). `ui: true` adds the
 * template's example UI (`ui-example/` becomes `ui/`, and est.json gains its `ui` entry). `app: true`
 * (1.335, `est new … --app`) adds the template's window as an app instead: `ui-app/` (a Vite build,
 * sdk/docs/ui.md "A whole app as the window") whose `package.json` lands at the folder's root, so
 * `npm run build:ui` writes `ui/`; est.json gains the `ui` entry, sized from `ui-app/index.html`.
 */
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { EST_ID_RE } from '../../../../src/audio/est/slot';

/** Folders a copy leaves out: build output and installs. */
const SKIP = new Set(['target', 'build', 'dist', 'node_modules', '.git', '.est-build']);
const TEXT = /\.(rs|ts|mts|js|mjs|json|toml|md|txt|html|css|svg|yml|yaml)$|^(LICENSE|AGENTS\.md|CLAUDE\.md|llms\.txt|\.gitignore)$/;

export interface ScaffoldOptions {
  template: string; dest: string; id?: string; name?: string; templatesDir: string;
  /** The manifest schema to copy in beside est.json (`SPEC_FILES.schema`), so `$schema` resolves offline. */
  schema?: string;
  /** Other reference files copied in beside est.json as they are (the rules table, the ABI, the UI library's types). */
  extras?: string[];
  /** Add the template's example UI (`ui-example/` as `ui/`) and est.json's `ui` entry. */
  ui?: boolean;
  /** Add the template's window as an app (`ui-app/`, its package.json at the root) and est.json's `ui` entry (1.335). */
  app?: boolean;
}
export interface Scaffolded { dir: string; id: string; name: string; vendored: string[]; files: number; crate: string | null; type: string | null; ui: boolean; app: boolean }

/**
 * npm never packs a file named `.gitignore`, so a published `@cyber-est/cli` carries a template's
 * as `_gitignore` (`scripts/sdk-build.mjs`) and the new folder gets it back under its own name.
 */
export const PACKED_GITIGNORE = '_gitignore';
const destName = (f: string) => (basename(f) === PACKED_GITIGNORE ? join(dirname(f), '.gitignore') : f);

/** The template's example UI, copied as `ui/` by `--ui` (never otherwise). */
export const UI_EXAMPLE = 'ui-example';
/** The template's window as an app, copied by `--app` (never otherwise); its package.json goes to the root. */
export const UI_APP = 'ui-app';

/** Names the SDK's libraries export: a plugin type is never given one of them. */
const TAKEN = new Set(['Effect', 'Instrument', 'Plugin', 'Param', 'Io', 'Note', 'Voice', 'Voices', 'SynthVoice', 'Filter', 'FilterMode', 'Oscillator', 'Wave', 'Smoother', 'Envelope', 'Lfo', 'DelayLine', 'Biquad', 'BiquadKind', 'Coefficients', 'Descriptor', 'Events', 'Event', 'Expression', 'Transport', 'StateWriter', 'StateReader', 'Format', 'Self']);

/** The crate name for an id: its last label, `[a-z0-9-]`, starting with a letter. */
export function crateNameOf(id: string): string {
  const last = id.split('.').pop() ?? '';
  const s = last.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/-+/g, '-').replace(/^-+|-+$/g, '');
  // Never `est`, the SDK's own crate (a dependency of every plugin).
  return !s || s === 'est' ? 'est-plugin' : /^[a-z]/.test(s) ? s : `est-${s}`;
}

/** The plugin's type name for an id: its last label in PascalCase (`my-chorus` → `MyChorus`). */
export function typeNameOf(id: string): string {
  const parts = crateNameOf(id).split('-').filter(Boolean);
  const t = parts.map(w => w[0]!.toUpperCase() + w.slice(1)).join('');
  return TAKEN.has(t) ? `${t}Plugin` : t;
}

/** `from` → `to` as a whole word in the code of a Rust or TypeScript file: never inside a string or a comment. */
export function renameInCode(src: string, from: string, to: string): string {
  const word = new RegExp(`\\b${from}\\b`, 'g');
  let out = '';
  let i = 0;
  let code = '';
  const flush = () => { out += code.replace(word, to); code = ''; };
  while (i < src.length) {
    const c = src[i]!;
    if (c === '/' && src[i + 1] === '/') { flush(); const e = src.indexOf('\n', i); const end = e < 0 ? src.length : e; out += src.slice(i, end); i = end; continue; }
    if (c === '/' && src[i + 1] === '*') { flush(); const e = src.indexOf('*/', i + 2); const end = e < 0 ? src.length : e + 2; out += src.slice(i, end); i = end; continue; }
    if (c === '"' || c === '`' || (c === "'" && !/[A-Za-z0-9_]/.test(src[i - 1] ?? '') && src[i + 2] === "'")) {
      flush();
      let j = i + 1;
      while (j < src.length && src[j] !== c) j += src[j] === '\\' ? 2 : 1;
      out += src.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    code += c;
    i++;
  }
  flush();
  return out;
}

function files(dir: string, base = dir): string[] {
  const out: string[] = [];
  for (const n of readdirSync(dir).sort()) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) { if (!SKIP.has(n)) out.push(...files(p, base)); } else out.push(relative(base, p));
  }
  return out;
}

const inside = (root: string, p: string) => { const r = relative(root, p); return r === '' || (!r.startsWith('..') && !isAbsolute(r)); };
const posix = (p: string) => p.split(sep).join('/');

interface Ref {
  file: string; start: number; end: number; spec: string; kind: 'cargo' | 'asconfig' | 'ts';
  /** asc's `path`: a folder searched for modules (the library is the `est` folder inside it). */
  searchDir?: boolean;
}

/** Every relative path reference in a project file (`file` relative to the project). */
function refsOf(root: string, file: string): Ref[] {
  const text = readFileSync(join(root, file), 'utf8');
  const out: Ref[] = [];
  const b = basename(file);
  if (b === 'Cargo.toml') {
    for (const m of text.matchAll(/\b(?:path|library)\s*=\s*"([^"]+)"/g)) {
      const start = m.index! + m[0].indexOf('"') + 1;
      out.push({ file, start, end: start + m[1]!.length, spec: m[1]!, kind: 'cargo' });
    }
  } else if (b === 'asconfig.json') {
    for (const m of text.matchAll(/"(runtime|extends|lib|entries|path|library)"\s*:\s*(\[[^\]]*\]|"[^"]*")/g)) {
      const body = m[2]!;
      const bodyAt = m.index! + m[0].length - body.length;
      for (const s of body.matchAll(/"([^"]+)"/g)) {
        const spec = s[1]!;
        if (m[1] === 'runtime' && !spec.includes('/')) continue; // a built-in runtime: "stub", "incremental"
        const start = bodyAt + s.index! + 1;
        out.push({ file, start, end: start + spec.length, spec, kind: 'asconfig', searchDir: m[1] === 'path' });
      }
    }
  } else if (/\.m?ts$/.test(b)) {
    for (const m of text.matchAll(/(\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)(["'])(\.{1,2}\/[^"'\n]*)\2/g)) {
      const start = m.index! + m[1]!.length + 1;
      out.push({ file, start, end: start + m[3]!.length, spec: m[3]!, kind: 'ts' });
    }
  }
  return out;
}

/** The folder to copy for a reference leaving the template: the nearest `est` above it, else the crate or the folder it names. */
function libraryRoot(target: string, kind: Ref['kind']): string {
  let d = target;
  while (d !== dirname(d)) {
    if (basename(d) === 'est' && existsSync(d) && statSync(d).isDirectory()) return d;
    d = dirname(d);
  }
  if (kind === 'cargo') return target;
  return existsSync(target) && statSync(target).isDirectory() ? target : dirname(target);
}

/** Make a plugin folder from a template. */
export function scaffold(opts: ScaffoldOptions): Scaffolded {
  const src = resolve(opts.templatesDir, opts.template);
  if (!existsSync(join(src, 'est.json'))) {
    const have = existsSync(opts.templatesDir) ? readdirSync(opts.templatesDir).filter(n => existsSync(join(opts.templatesDir, n, 'est.json'))).sort() : [];
    throw new Error(`no template "${opts.template}" (the templates: ${have.join(', ') || 'none'})`);
  }
  const dest = resolve(opts.dest);
  if (existsSync(dest) && readdirSync(dest).length) throw new Error(`${dest} is not empty`);
  const tmpl = JSON.parse(readFileSync(join(src, 'est.json'), 'utf8')) as { id: string; name: string };
  const slug = basename(dest).toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '') || 'plugin';
  const id = opts.id ?? `org.example.${slug}`;
  if (!EST_ID_RE.test(id)) throw new Error(`--id ${id} is not a reverse-DNS id of [a-z0-9.-] (for example com.example.my-verb)`);
  const name = opts.name ?? basename(dest).replace(/[-_]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase()).slice(0, 60);
  if (!name.trim() || name.length > 60 || /["\\`]/.test(name) || [...name].some(ch => ch.charCodeAt(0) < 0x20 || ch.charCodeAt(0) === 0x7f)) throw new Error('--name is plain text of at most 60 characters, without quotes or backslashes');

  // The example UI only with `ui`, and then as `ui/`; the app only with `app`.
  const exampleUi = files(src).filter(f => posix(f).startsWith(`${UI_EXAMPLE}/`));
  if (opts.ui && !exampleUi.length) throw new Error(`the ${opts.template} template has no example UI`);
  const appFiles = files(src).filter(f => posix(f).startsWith(`${UI_APP}/`));
  if (opts.app && opts.ui) throw new Error('--app and --ui both make ui/: choose one (--app builds ui/ from ui-app/)');
  if (opts.app && !appFiles.length) throw new Error(`the ${opts.template} template has no app window (--app is for the instrument-* and effect-* templates)`);
  if (opts.app && (existsSync(join(src, 'package.json')) || existsSync(join(src, 'ui')))) throw new Error(`the ${opts.template} template already has a package.json or ui/`);
  mkdirSync(dest, { recursive: true });
  const list = files(src).filter(f => !posix(f).startsWith(`${UI_EXAMPLE}/`) && (opts.app || !posix(f).startsWith(`${UI_APP}/`)));
  /** Where a template file lands: the app's package.json at the root (`npm run build:ui` there). */
  const landing = (f: string) => (posix(f) === `${UI_APP}/package.json` ? 'package.json' : destName(f));
  for (const f of list) { const to = join(dest, landing(f)); mkdirSync(dirname(to), { recursive: true }); cpSync(join(src, f), to); }
  if (opts.app) {
    const ignore = join(dest, '.gitignore');
    const had = existsSync(ignore) ? readFileSync(ignore, 'utf8') : '';
    if (!/^node_modules\/?$/m.test(had)) writeFileSync(ignore, `${had}${had && !had.endsWith('\n') ? '\n' : ''}# The app window's build tools (npm install for npm run build:ui).\nnode_modules/\n`);
  }
  if (opts.ui) {
    for (const f of exampleUi) {
      const to = join(dest, 'ui', relative(UI_EXAMPLE, f));
      mkdirSync(dirname(to), { recursive: true });
      cpSync(join(src, f), to);
    }
  }

  // References that leave the template: copy what they name inside, and point them at the copy.
  const vendored = new Map<string, string>(); // library root (in the repository) → its folder in dest
  const edits = new Map<string, Ref[]>();
  for (const f of list) {
    for (const r of refsOf(src, f)) {
      const named = resolve(dirname(join(src, f)), r.spec);
      if (inside(src, named)) continue;
      // A search folder stands for the library inside it (`<path>/est`).
      const target = r.searchDir && existsSync(join(named, 'est')) ? join(named, 'est') : named;
      // A library inside one already vendored is reached through that copy.
      const within = [...vendored.keys()].find(v => inside(v, target));
      const lib = within ?? libraryRoot(target, r.kind);
      if (!vendored.has(lib)) {
        let name0 = basename(lib), n = 2;
        while (existsSync(join(dest, name0)) && ![...vendored.values()].includes(join(dest, name0))) name0 = `${basename(lib)}-${n++}`;
        const to = join(dest, name0);
        cpSync(lib, to, { recursive: true, filter: s => !SKIP.has(basename(s)) });
        vendored.set(lib, to);
      }
      const into = join(vendored.get(lib)!, relative(lib, target));
      const at = r.searchDir && target !== named ? dirname(into) : into;
      let spec = posix(relative(dirname(join(dest, f)), at)) || '.';
      if (r.kind === 'ts' && !spec.startsWith('.')) spec = `./${spec}`;
      edits.set(f, [...(edits.get(f) ?? []), { ...r, spec }]);
    }
  }
  for (const [f, rs] of edits) {
    let text = readFileSync(join(dest, f), 'utf8');
    for (const r of [...rs].sort((a, b) => b.start - a.start)) text = text.slice(0, r.start) + r.spec + text.slice(r.end);
    writeFileSync(join(dest, f), text);
  }

  // The id and the name, everywhere they are written (est.json, the DSP's descriptor, the UI).
  const all = files(dest);
  for (const f of all) {
    if (!TEXT.test(basename(f))) continue;
    const p = join(dest, f);
    const before = readFileSync(p, 'utf8');
    let text = before.split(tmpl.id).join(id);
    if (tmpl.name && tmpl.name !== name) text = text.split(tmpl.name).join(name);
    if (text !== before) writeFileSync(p, text);
  }
  // The crate and the plugin's type, named from the id (the template's names would be every plugin's).
  const crate = crateNameOf(id);
  const type = typeNameOf(id);
  let crateRenamed: string | null = null;
  const cargoToml = join(dest, 'Cargo.toml');
  if (existsSync(cargoToml)) {
    let t = readFileSync(cargoToml, 'utf8');
    const old = /\[package\][^[]*?\nname\s*=\s*"([^"]+)"/.exec(t)?.[1];
    if (old) {
      t = t.replace(/(\[package\][^[]*?\nname\s*=\s*")[^"]+(")/, `$1${crate}$2`);
      const oldLib = old.replace(/-/g, '_');
      t = t.replace(/(\nmodule\s*=\s*"[^"]*\/)([A-Za-z0-9_]+)(\.wasm")/, (all, a: string, lib: string, b: string) => (lib === oldLib ? `${a}${crate.replace(/-/g, '_')}${b}` : all));
      writeFileSync(cargoToml, t);
      const lock = join(dest, 'Cargo.lock');
      if (existsSync(lock)) writeFileSync(lock, readFileSync(lock, 'utf8').split(`name = "${old}"`).join(`name = "${crate}"`));
      crateRenamed = crate;
    }
  }
  let typeRenamed: string | null = null;
  for (const f of ['src/lib.rs', 'assembly/index.ts']) {
    const pth = join(dest, f);
    if (!existsSync(pth)) continue;
    const before = readFileSync(pth, 'utf8');
    if (new RegExp(`\\b${type}\\b`).test(before)) continue; // the name is taken in this file
    const after = renameInCode(before, 'Template', type);
    if (after !== before) { writeFileSync(pth, after); typeRenamed = type; }
  }

  const m = JSON.parse(readFileSync(join(dest, 'est.json'), 'utf8')) as Record<string, unknown>;
  m.id = id;
  m.name = name;
  if (opts.ui || opts.app) {
    const size = (m.ui as { size?: unknown } | undefined)?.size;
    m.ui = { path: 'ui/index.html', size: size ?? exampleUiSize(join(dest, opts.app ? UI_APP : 'ui', 'index.html')) };
  }
  for (const extra of opts.extras ?? []) if (existsSync(extra)) cpSync(extra, join(dest, basename(extra)));
  // The schema beside est.json: a `$schema` naming it (by any path or URL) points at the copy.
  if (opts.schema && existsSync(opts.schema)) {
    const schemaName = basename(opts.schema);
    cpSync(opts.schema, join(dest, schemaName));
    if (typeof m.$schema === 'string' && m.$schema.endsWith(schemaName)) m.$schema = `./${schemaName}`;
  }
  writeFileSync(join(dest, 'est.json'), `${JSON.stringify(m, null, 2)}\n`);

  // Nothing may lead back out: every reference resolves inside the new folder.
  const escaping: string[] = [];
  for (const f of all) for (const r of refsOf(dest, f)) if (!inside(dest, resolve(dirname(join(dest, f)), r.spec))) escaping.push(`${f}: ${r.spec}`);
  if (escaping.length) throw new Error(`the new folder still refers outside itself: ${escaping.join('; ')}`);
  return { dir: dest, id, name, vendored: [...vendored.values()].map(v => relative(dest, v)), files: files(dest).length, crate: crateRenamed, type: typeRenamed, ui: !!opts.ui, app: !!opts.app };
}

/** The example UI's frame size, from its page's `<meta name="est-ui-size" content="W×H">` (else 420 × 240). */
function exampleUiSize(page: string): { w: number; h: number } {
  const t = existsSync(page) ? readFileSync(page, 'utf8') : '';
  const m = /<meta\s+name="est-ui-size"\s+content="(\d+)x(\d+)"/.exec(t);
  return m ? { w: Number(m[1]), h: Number(m[2]) } : { w: 420, h: 240 };
}
