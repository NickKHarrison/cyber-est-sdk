/**
 * 1.898 (one prompt, one thing back): **the tidy-up between a chat assistant's files and the build**.
 * Pure (no DOM, nothing run): it reads the source as text and writes back
 *
 * - **est.json, whole** (`repairManifest`): the assistant writes only what it decides (id, name,
 *   version, kind, description, the tail and the window's size); Cyber fills the rest a bundle needs
 *   (the ABI, the ports of its kind, the module and asset entries, which the packer hashes) and takes
 *   **what the code itself says** where the two must agree: the descriptor's id, name, vendor and
 *   version, the kind from the base class, and the parameter list from the code's `new Param(…)`
 *   lines (the ids the module will report: EST-C008). A slip in the JSON (a trailing comma, a
 *   comment) is mended. Each change is a note in plain words.
 * - **the window** (`repairUi`): what never runs in a plugin's sandboxed frame is made to: an inline
 *   `<script>` becomes a file, an `on…=` attribute a listener in a file (the frame's policy runs only
 *   the bundle's own script files), `type="module"` and `crossorigin` are dropped (EST-U005), a tag
 *   that loads from another host is removed (EST-U002), and Cyber's own `est-ui.js` is put in (the
 *   library the page talks to Cyber through; the assistant never writes it). What is left wrong is
 *   found by the kit's own UI probe (`uiProbe.ts`: one rule with `est validate`) and comes back as
 *   problems for the assistant to fix.
 *
 * Nothing here decides whether the plugin may run: the bundle it leads to goes through the one
 * install pipeline like any other.
 */
import { EST_ID_RE, EST_VERSION_RE } from '../../../audio/est/slot';
import { probeUi } from '../../../audio/est/install/uiProbe';
import { INDEX, MANIFEST, UI_PAGE, setText, textOf, type VibeSource } from './vibeFiles';

/** A thing the assistant has to fix: where, and what, in words it can act on. */
export interface VibeProblem { where: string; message: string }

export const EST_UI_FILE = 'ui/est-ui.js';
/** The window's size when neither est.json nor the page says one. */
export const DEFAULT_UI_SIZE = Object.freeze({ w: 560, h: 320 });

// ── The code, read as text ──────────────────────────────────────────────────────────────────────────

export interface CodeFacts {
  /** The first four string arguments of `new Descriptor(…)`, when written as literals. */
  id: string | null; name: string | null; vendor: string | null; version: string | null;
  kind: 'effect' | 'instrument' | null;
  /** The declared parameters, or null when any could not be read with certainty. */
  params: { id: number; name: string; unit: string; log: boolean }[] | null;
}

const STR = String.raw`"((?:[^"\\]|\\.)*)"`;
const unq = (s: string) => s.replace(/\\(.)/g, '$1');

/** The code with its comments blanked (strings kept), so a commented-out line is not read. */
function withoutComments(src: string): string {
  let out = '';
  let i = 0;
  while (i < src.length) {
    const c = src[i]!;
    if (c === '"' || c === "'" || c === '`') {
      let j = i + 1;
      while (j < src.length && src[j] !== c) j += src[j] === '\\' ? 2 : 1;
      out += src.slice(i, j + 1); i = j + 1; continue;
    }
    if (c === '/' && src[i + 1] === '/') { const e = src.indexOf('\n', i); i = e < 0 ? src.length : e; continue; }
    if (c === '/' && src[i + 1] === '*') { const e = src.indexOf('*/', i + 2); const end = e < 0 ? src.length : e + 2; out += src.slice(i, end).replace(/[^\n]/g, ' '); i = end; continue; }
    out += c; i++;
  }
  return out;
}

/** What the AssemblyScript says about itself. */
export function readCode(source: string): CodeFacts {
  const src = withoutComments(source);
  const d = new RegExp(String.raw`new\s+Descriptor\s*\(\s*${STR}\s*,\s*${STR}\s*,\s*${STR}\s*,\s*${STR}`).exec(src);
  const kind = /\bextends\s+Instrument\b/.test(src) ? 'instrument' : /\bextends\s+Effect\b/.test(src) ? 'effect' : null;
  // Whole-number constants: `const CUTOFF: u32 = 1;`
  const consts = new Map<string, number>();
  for (const m of src.matchAll(/\bconst\s+([A-Za-z_$][\w$]*)\s*(?::\s*[a-z0-9]+)?\s*=\s*(\d+)\s*;/g)) consts.set(m[1]!, Number(m[2]));
  let params: CodeFacts['params'] = [];
  const starts = [...src.matchAll(/new\s+Param\s*\(/g)].map(m => m.index);
  for (let k = 0; k < starts.length && params; k++) {
    const seg = src.slice(starts[k]!, starts[k + 1] ?? src.length);
    // The id: a number, a constant, or a sum of them (`BAR0 + 3`).
    const head = new RegExp(String.raw`^new\s+Param\s*\(\s*((?:[A-Za-z_$][\w$]*|\d+)(?:\s*\+\s*(?:[A-Za-z_$][\w$]*|\d+))*)\s*,\s*${STR}\s*\)`).exec(seg);
    if (!head) { params = null; break; }
    let id: number | undefined = 0;
    for (const term of head[1]!.split('+').map(t => t.trim())) {
      const v = /^\d+$/.test(term) ? Number(term) : consts.get(term);
      if (v === undefined || id === undefined) { id = undefined; break; }
      id += v;
    }
    if (id === undefined) { params = null; break; }
    // The builder chain: up to the statement's end.
    const chain = seg.slice(head[0].length, (() => { const e = seg.search(/[;\]]\s*(\n|$)|,\s*\n\s*new\s+Param/); return e < 0 ? seg.length : e; })());
    const unit = new RegExp(String.raw`\.unit\s*\(\s*${STR}\s*\)`).exec(chain);
    params.push({ id, name: unq(head[2]!), unit: /\.hertz\s*\(/.test(chain) ? 'Hz' : unit ? unq(unit[1]!) : '', log: /\.log\s*\(/.test(chain) });
  }
  if (params && new Set(params.map(p => p.id)).size !== params.length) params = null;
  return { id: d ? unq(d[1]!) : null, name: d ? unq(d[2]!) : null, vendor: d ? unq(d[3]!) : null, version: d ? unq(d[4]!) : null, kind, params };
}

// ── est.json ────────────────────────────────────────────────────────────────────────────────────────

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** JSON as chat assistants sometimes write it: comments and trailing commas taken out (outside strings). */
export function looseJson(text: string): unknown {
  try { return JSON.parse(text); } catch { /* mend it */ }
  let out = '';
  let i = 0;
  while (i < text.length) {
    const c = text[i]!;
    if (c === '"') {
      let j = i + 1;
      while (j < text.length && text[j] !== '"') j += text[j] === '\\' ? 2 : 1;
      out += text.slice(i, j + 1); i = j + 1; continue;
    }
    if (c === '/' && text[i + 1] === '/') { const e = text.indexOf('\n', i); i = e < 0 ? text.length : e; continue; }
    if (c === '/' && text[i + 1] === '*') { const e = text.indexOf('*/', i + 2); i = e < 0 ? text.length : e + 2; continue; }
    out += c; i++;
  }
  // A comma before a closing bracket, outside strings.
  let mended = '';
  for (let j = 0; j < out.length; j++) {
    const c = out[j]!;
    if (c === '"') {
      let k = j + 1;
      while (k < out.length && out[k] !== '"') k += out[k] === '\\' ? 2 : 1;
      mended += out.slice(j, k + 1); j = k; continue;
    }
    if (c === ',' && /^\s*[}\]]/.test(out.slice(j + 1))) continue;
    mended += c;
  }
  return JSON.parse(mended);
}

const slug = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
/** Control characters (a manifest's text fields may hold none). */
const isControl = (c: number) => c < 0x20 || c === 0x7f;
const uncontrol = (t: string) => Array.from(t, ch => (isControl(ch.codePointAt(0) ?? 0) ? ' ' : ch)).join('');
const plain = (v: unknown, max: number): string | null => (typeof v === 'string' && v.trim() ? uncontrol(v).trim().slice(0, max) : null);
const whole = (v: unknown, lo: number, hi: number): number | null => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : null);

/**
 * est.json made whole from what the assistant wrote and what the code says. Writes the file back into
 * `src`, and may change the code's descriptor id (only to make an unusable id usable). Returns the
 * problems only the assistant can fix.
 */
export function repairManifest(src: VibeSource): VibeProblem[] {
  const problems: VibeProblem[] = [];
  const note = (s: string) => { src.notes.push(s); };
  let code = textOf(src, INDEX);
  if (!code.trim()) return [{ where: INDEX, message: 'There is no assembly/index.ts (the plugin\'s sound code). Give every file again, each under its "=== file: path ===" line.' }];
  const facts = readCode(code);

  let m: Record<string, unknown> = {};
  const raw = textOf(src, MANIFEST);
  if (raw.trim()) {
    try {
      const v = looseJson(raw);
      if (!isObj(v)) throw new Error('it is not an object in { }');
      m = v;
      try { JSON.parse(raw); } catch { note('est.json had a small slip (a comment or an extra comma), which Cyber mended.'); }
    } catch (e) {
      return [{ where: MANIFEST, message: `est.json is not valid JSON: ${e instanceof Error ? e.message : String(e)}` }];
    }
  } else if (facts.id) note('There was no est.json, so Cyber wrote one from the code.');
  else return [{ where: MANIFEST, message: 'There is no est.json. Give every file again, each under its "=== file: path ===" line.' }];
  delete m.$schema;

  // The kind: the code's base class decides.
  const kind: 'effect' | 'instrument' = facts.kind ?? (m.kind === 'instrument' ? 'instrument' : 'effect');
  if (m.kind !== undefined && m.kind !== kind) note(`est.json said "${String(m.kind)}", but the code is ${kind === 'instrument' ? 'an instrument' : 'an effect'}: Cyber used the code's.`);
  m.kind = kind;

  // Name, vendor, description, licence.
  const name = plain(facts.name, 60) ?? plain(m.name, 60) ?? 'My Plugin';
  m.name = name;
  m.vendor = plain(facts.vendor, 60) ?? plain(m.vendor, 60) ?? 'Me';
  m.description = plain(m.description, 400) ?? name;
  m.license = plain(m.license, 64) ?? 'MIT';

  // The id: the module reports the code's, so est.json follows it; an id neither can use is made usable in both.
  const want = typeof m.id === 'string' ? m.id : null;
  let id = facts.id ?? want ?? '';
  if (!EST_ID_RE.test(id) || !id.includes('.')) {
    const better = want && EST_ID_RE.test(want) && want.includes('.') ? want : `com.example.${slug(name) || 'my-plugin'}`;
    if (facts.id !== null) {
      code = code.replace(new RegExp(String.raw`(new\s+Descriptor\s*\(\s*)"(?:[^"\\]|\\.)*"`), (_all, head: string) => `${head}${JSON.stringify(better)}`);
      setText(src, INDEX, code);
    }
    note(`The plugin's id${id ? ` ("${id.slice(0, 60)}")` : ''} was not one Cyber can use (lower-case letters, digits, dots and hyphens), so it is now ${better}.`);
    id = better;
  } else if (want && want !== id) note(`est.json's id (${want.slice(0, 80)}) and the code's (${id}) differed: Cyber used the code's.`);
  m.id = id;

  // The version: the code's when it is one, else est.json's, else 1.0.0.
  const ver = (v: unknown) => (typeof v === 'string' && EST_VERSION_RE.test(v) ? v : typeof v === 'string' && /^\d+\.\d+$/.test(v) ? `${v}.0` : null);
  m.version = (facts.version && EST_VERSION_RE.test(facts.version) ? facts.version : null) ?? ver(m.version) ?? '1.0.0';

  // Features: the kind's first.
  const first = kind === 'effect' ? 'audio-effect' : 'instrument';
  const feats = (Array.isArray(m.features) ? m.features : []).map(f => plain(f, 64)).filter((f): f is string => !!f && f !== 'audio-effect' && f !== 'instrument');
  m.features = [first, ...feats].slice(0, 32);

  m.est = 1;
  const abi = isObj(m.abi) ? m.abi : {};
  const wantsAudio = isObj(m.ui) && m.ui.audio === true;
  m.abi = { est: abi.est === '1.1' || wantsAudio ? '1.1' : '1.0', clap: typeof abi.clap === 'string' && /^1\.\d{1,4}(\.\d{1,4})?$/.test(abi.clap) ? abi.clap : '1.2' };
  m.module = { path: 'module.wasm' };
  m.assets = [];
  const a = isObj(m.audio) ? m.audio : {};
  const stereo = [{ channels: 2 }];
  m.audio = {
    inputs: kind === 'effect' ? (Array.isArray(a.inputs) && a.inputs.length ? a.inputs : stereo) : [],
    outputs: Array.isArray(a.outputs) && a.outputs.length ? a.outputs : stereo,
    sampleRates: 'any',
  };
  const n = isObj(m.notes) ? m.notes : {};
  m.notes = { inputs: kind === 'instrument' ? 1 : whole(n.inputs, 0, 1) ?? 0, outputs: whole(n.outputs, 0, 1) ?? 0 };
  // The limits, where the assistant often writes them: `limits.tailSeconds`, or `tailSeconds` at the top.
  const l = isObj(m.limits) ? m.limits : {};
  m.limits = {
    maxLatencyFrames: whole(l.maxLatencyFrames, 0, 192000) ?? 0,
    memoryPagesMax: whole(l.memoryPagesMax, 16, 2048) ?? 64,
    // The most the plugin may report, not what it does report (`tail()` says that): the ceiling, so a
    // generous tail is never refused for passing a smaller number written here (EST-C006).
    tailSeconds: 60,
  };
  delete m.tailSeconds;
  m.permissions = [];
  m.stateVersion = whole(m.stateVersion, 1, 1_000_000) ?? 1;
  if (!isObj(m.compat)) m.compat = { host: '>=1.0.0 <2' };
  if (m.presets !== undefined && !src.files.has(String(m.presets))) delete m.presets;
  if (m.url !== undefined) delete m.url;

  // The parameters: the code's own list (the ids the module reports).
  if (facts.params) {
    m.parameters = facts.params.map(p => ({ id: p.id, name: p.name.slice(0, 255), ...(p.unit ? { unit: p.unit.slice(0, 16) } : {}), ...(p.log ? { scale: 'log' } : {}) }));
  } else if (!Array.isArray(m.parameters)) {
    problems.push({ where: MANIFEST, message: 'Cyber could not read the parameter list from the code, and est.json has no "parameters". Declare each parameter as `new Param(NAME, "Name")` with `const NAME: u32 = <number>;`, as in the example.' });
  }

  // The window.
  const u = isObj(m.ui) ? m.ui : {};
  if (src.files.has(UI_PAGE)) {
    const page = textOf(src, UI_PAGE);
    const meta = /<meta\b[^>]*name\s*=\s*["']est-ui-size["'][^>]*content\s*=\s*["']\s*(\d{2,4})\s*[x×,]\s*(\d{2,4})/i.exec(page);
    const size = isObj(u.size) ? u.size : {};
    const w = whole(size.w ?? u.width ?? u.w, 120, 2000) ?? (meta ? whole(Number(meta[1]), 120, 2000) : null) ?? DEFAULT_UI_SIZE.w;
    const h = whole(size.h ?? u.height ?? u.h, 80, 1400) ?? (meta ? whole(Number(meta[2]), 80, 1400) : null) ?? DEFAULT_UI_SIZE.h;
    m.ui = { path: UI_PAGE, size: { w, h }, ...(u.resizable === true ? { resizable: true } : {}), ...(wantsAudio ? { audio: true } : {}) };
  } else {
    if (m.ui !== undefined) note('est.json named a window, but there was no ui/index.html, so the plugin shows Cyber\'s generated dials.');
    delete m.ui;
  }

  setText(src, MANIFEST, `${JSON.stringify(m, null, 2)}\n`);
  return problems;
}

// ── The window ──────────────────────────────────────────────────────────────────────────────────────

const TAG_ATTRS = String.raw`(?:[^>"']|"[^"]*"|'[^']*')*`;
const attr = (attrs: string, name: string): string | null => {
  const m = new RegExp(String.raw`\s${name}\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))`, 'i').exec(attrs);
  return m ? (m[1] ?? m[2] ?? m[3] ?? '') : null;
};
const EXTERNAL = /^(?:https?:)?\/\//i;

/**
 * The window made to run in the plugin frame, and Cyber's library put in. `estUi`: the library's text
 * (`est-ui.js`), or null when the kit has none to give (then a page that names it is left to the probe).
 */
export function repairUi(src: VibeSource, estUi: string | null): VibeProblem[] {
  if (!src.files.has(UI_PAGE)) return [];
  const note = (s: string) => { src.notes.push(s); };
  let html = textOf(src, UI_PAGE);
  if (!/<html[\s>]|<!doctype\s+html/i.test(html)) {
    html = `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<title>Plugin</title>\n</head>\n<body>\n${html}\n</body>\n</html>\n`;
    note('ui/index.html was only a piece of a page, so Cyber wrapped it in a whole one.');
  }

  // Tags that load from another host: they never load in a plugin's window.
  let dropped = 0;
  html = html.replace(new RegExp(String.raw`<link\b(${TAG_ATTRS})>`, 'gi'), (all, attrs: string) => {
    const href = attr(attrs, 'href') ?? '';
    const rel = (attr(attrs, 'rel') ?? '').toLowerCase();
    if (EXTERNAL.test(href) || /\b(modulepreload|preconnect|dns-prefetch|preload|icon|manifest)\b/.test(rel)) { dropped++; return ''; }
    return all;
  });
  html = html.replace(new RegExp(String.raw`<script\b(${TAG_ATTRS})>\s*</script\s*>`, 'gi'), (all, attrs: string) => {
    if (EXTERNAL.test(attr(attrs, 'src') ?? '')) { dropped++; return ''; }
    return all;
  });
  if (dropped) note('The window tried to load something from the web (a font or a script from another site), which a plugin\'s window may not do: Cyber took those lines out.');

  // `type="module"` and `crossorigin` (EST-U005): a classic script instead.
  let modules = 0;
  html = html.replace(new RegExp(String.raw`<(script|link|img)\b(${TAG_ATTRS})>`, 'gi'), (all, tag: string, attrs: string) => {
    const next = attrs.replace(/\s(?:type\s*=\s*(?:"module"|'module'|module)|crossorigin(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'>]+))?)/gi, () => { modules++; return ''; });
    return next === attrs ? all : `<${tag}${next}>`;
  });
  if (modules) note('The window\'s script was marked as a module, which does not load in a plugin\'s window: Cyber made it an ordinary script.');

  // Inline scripts → files (the frame's policy runs only the bundle's own script files).
  let inline = 0;
  html = html.replace(new RegExp(String.raw`<script\b(${TAG_ATTRS})>([\s\S]*?)</script\s*>`, 'gi'), (all, attrs: string, body: string) => {
    if (attr(attrs, 'src') !== null || !body.trim()) return all;
    const type = (attr(attrs, 'type') ?? '').toLowerCase();
    if (type && !/^(text|application)\/(java|ecma)script$/.test(type)) return all; // data (JSON), not code
    let name = `inline-${++inline}.js`;
    while (src.files.has(`ui/${name}`)) name = `inline-${++inline}.js`;
    setText(src, `ui/${name}`, `${body.replace(/^\s*\n/, '').replace(/\s+$/, '')}\n`);
    return `<script src="${name}"></script>`;
  });
  if (inline) note('The window\'s script was written inside the page, where a plugin\'s window does not run it: Cyber moved it into a file of its own.');

  // on…="" attributes → listeners in a file.
  const handlers: string[] = [];
  html = html.replace(new RegExp(String.raw`<([a-z][a-z0-9-]*)\b(${TAG_ATTRS})>`, 'gi'), (all, tag: string, attrs: string) => {
    if (!/\son[a-z]+\s*=/i.test(attrs)) return all;
    const key = handlers.length;
    let any = false;
    const next = attrs.replace(/\s(on[a-z]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi, (_a, ev: string, dq: string | undefined, sq: string | undefined) => {
      const body = (dq ?? sq ?? '').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, '&');
      handlers.push(`  on(${key}, ${JSON.stringify(ev.slice(2).toLowerCase())}, function (event) { ${body} });`);
      any = true;
      return '';
    });
    return any ? `<${tag}${next} data-est-on="${key}">` : all;
  });
  if (handlers.length) {
    const js = `// Written by Cyber from the page's on…="" attributes, which a plugin's window does not run.\n(function () {\n  function on(key, type, fn) {\n    var el = document.querySelector('[data-est-on="' + key + '"]');\n    if (el) el.addEventListener(type, fn);\n  }\n${handlers.join('\n')}\n})();\n`;
    setText(src, 'ui/est-handlers.js', js);
    html = /<\/body\s*>/i.test(html) ? html.replace(/<\/body\s*>/i, '<script src="est-handlers.js"></script>\n</body>') : `${html}\n<script src="est-handlers.js"></script>\n`;
    note('The window used on…="" attributes (such as onclick), which a plugin\'s window does not run: Cyber turned them into listeners.');
  }

  // Cyber's library: named by the page (added before the first script when a script uses it), and its file put in.
  const usesLib = [...src.files.keys()].some(p => /^ui\/.*\.js$/i.test(p) && p !== EST_UI_FILE && /\bEstUI\b/.test(textOf(src, p))) || /<est-(knob|slider)\b/i.test(html);
  const namesLib = /<script\b[^>]*\bsrc\s*=\s*["'](?:\.\/)?est-ui\.js["']/i.test(html);
  if (usesLib && !namesLib) {
    const firstScript = /<script\b/i.exec(html);
    const tag = '<script src="est-ui.js"></script>\n';
    html = firstScript ? `${html.slice(0, firstScript.index)}${tag}${html.slice(firstScript.index)}` : html.replace(/<\/body\s*>/i, `${tag}</body>`);
    note('The window uses Cyber\'s library but did not load it: Cyber added the line that does.');
  }
  setText(src, UI_PAGE, html);
  if ((usesLib || namesLib) && estUi) setText(src, EST_UI_FILE, estUi);

  const problems: VibeProblem[] = [];
  if (!usesLib) {
    problems.push({ where: UI_PAGE, message: 'The window never talks to Cyber: no script calls EstUI.connect() and the page has no <est-knob> or <est-slider>, so its controls would do nothing. Load est-ui.js and call EstUI.connect(), as in the example.' });
  }
  // What is still wrong, by the kit's own UI rules.
  const seen = new Set<string>();
  for (const f of probeUi(UI_PAGE, src.files)) {
    if (f.rule === 'EST-U004') continue; // a warning (large files), not a refusal
    const key = `${f.rule}|${f.message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    problems.push({ where: f.where, message: `${f.message} (${f.rule}: ${UI_RULE_HELP[f.rule] ?? ''})` });
  }
  // What the frame's policy stops without an error anyone would see.
  for (const p of [...src.files.keys()].filter(q => /^ui\/.*\.js$/i.test(q) && q !== EST_UI_FILE).sort()) {
    const js = withoutComments(textOf(src, p));
    if (/\b(?:fetch|XMLHttpRequest|WebSocket|EventSource)\s*\(/.test(js) || /\bnew\s+(?:XMLHttpRequest|WebSocket|EventSource)\b/.test(js)) problems.push({ where: p, message: 'It uses the network (fetch, XMLHttpRequest or a socket). A plugin\'s window has no network at all, not even for its own files: put the data in the script.' });
    if (/\b(?:localStorage|sessionStorage|indexedDB)\b/.test(js)) problems.push({ where: p, message: 'It uses browser storage (localStorage, sessionStorage or IndexedDB), which a plugin\'s window does not have. Keep state in the plugin\'s parameters.' });
    if (/\bnew\s+(?:AudioContext|webkitAudioContext|Worker)\b/.test(js)) problems.push({ where: p, message: 'It makes its own AudioContext or Worker. The window makes no sound: the sound is assembly/index.ts, and the window only reads and writes parameters.' });
  }
  return problems;
}

const UI_RULE_HELP: Record<string, string> = {
  'EST-U001': 'ui/index.html must be a whole HTML page',
  'EST-U002': 'a plugin\'s window loads only its own files, nothing from the web',
  'EST-U003': 'refer to files by a relative path, and include every file the page names',
  'EST-U005': 'load ordinary scripts with <script src="…">, never type="module"',
};
