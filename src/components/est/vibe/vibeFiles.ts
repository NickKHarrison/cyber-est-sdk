/**
 * 1.898 (one prompt, one thing back): **the one thing a chat assistant gives back, read into a
 * plugin's source files**. Three shapes, one result (`VibeSource`: paths → bytes, and what was
 * tidied, in plain words):
 *
 * - `readVibeText`: a pasted answer. Files are found by their **marker lines**
 *   (`=== file: ui/index.html ===`, also `--- est.json ---`), else by **named code blocks** (a file
 *   name in the fence's info string, on the line before the fence, or in the block's first comment),
 *   else by **what a block holds** (code that imports from "est", a manifest, an HTML page, a style
 *   sheet, a script that calls `EstUI`). Markdown fences round a file, or round the whole answer, are
 *   taken off.
 * - `readVibeZip`: a `.zip` of the same files, read only through the bounded reader
 *   (`src/lib/boundedZip.ts`) under `VIBE_CAPS`; nothing in it is run.
 * - Both end in `tidyPaths`: a wrapping folder is taken off, the usual near-miss names are put where
 *   the build reads them (`manifest.json` → `est.json`, a lone `index.ts` → `assembly/index.ts`, a page
 *   at the root → `ui/`), and what the build never packs (a README, `node_modules`) is left out.
 *
 * Pure: no DOM, no store, nothing fetched or stored. It only sorts text and bytes into files; whether
 * they make a plugin is the compiler's and the install pipeline's to say (`vibeBuild.ts`).
 */
import { BoundedZip, BoundedZipError, type BoundedZipLimits } from '../../../lib/boundedZip';
import { isSourceEstNames } from '../../../../shared/estSourceEst.mjs';

/** What one drop or paste may hold. A plugin's sources are small: these are far above any real one and far below a bomb. */
export const VIBE_CAPS = Object.freeze({
  /** A pasted answer's characters (a whole synth with its window is about 40 000). */
  textChars: 2 * 1024 * 1024,
  /** A zip's own size. */
  zipBytes: 24 * 1024 * 1024,
  /** Files kept. */
  files: 200,
  /** One file, unpacked. */
  fileBytes: 8 * 1024 * 1024,
  /** Every file together, unpacked (under the bundle's own 64 MiB and the own-bundle upload's 32 MB). */
  totalBytes: 24 * 1024 * 1024,
});

const ZIP_LIMITS: BoundedZipLimits = { maxEntries: 2000, maxTotalUnpacked: VIBE_CAPS.totalBytes, maxRatio: 200, ratioFloor: 1024 * 1024, maxEntry: VIBE_CAPS.fileBytes };

export interface VibeSource {
  files: Map<string, Uint8Array>;
  /** What was tidied on the way in, each a plain sentence. */
  notes: string[];
  /** A pasted answer that stops inside a code block (the assistant ran out of room): the last file it reached. */
  cutOff?: string;
  /**
   * 1.910: a pasted answer whose text ends inside its last file (a code block left open, or files under
   * marker lines with no block round them): if that file is not whole, the answer was cut off there (`vibeCut.ts`).
   */
  endsOpen?: boolean;
  /** 1.910: the window was left out and a note already says why (so the manifest's own note is not a second one). */
  windowLeftOut?: boolean;
}

/** A refusal with words for the person (never a stack). */
export class VibeReadError extends Error {}

export const MANIFEST = 'est.json';
export const INDEX = 'assembly/index.ts';
export const UI_PAGE = 'ui/index.html';

const enc = new TextEncoder();
const dec = new TextDecoder('utf-8');

/** The file's text (a BOM dropped), or '' when the source has none. */
export function textOf(src: VibeSource, path: string): string {
  const b = src.files.get(path);
  return b ? dec.decode(b).replace(/^\uFEFF/, '') : '';
}
export function setText(src: VibeSource, path: string, text: string): void {
  src.files.set(path, enc.encode(text));
}

// ── Text ────────────────────────────────────────────────────────────────────────────────────────────

const PATH = String.raw`[A-Za-z0-9_@][A-Za-z0-9_@./\\-]*\.[A-Za-z0-9]{1,6}`;
/** `=== file: ui/index.html ===`, `--- est.json ---`, `##### File: assembly/index.ts`: a line that is only a file's name between marks. */
const MARKER = new RegExp(String.raw`^\s*(?:[=\-#*]{3,}|/{2,}\s*[=\-]{3,})\s*(?:file(?:name)?\s*[:=]\s*)?[\`"']?(${PATH})[\`"']?\s*[=\-#*]*\s*$`, 'i');
const FENCE = /^\s{0,3}(`{3,}|~{3,})\s*([^`]*)$/;

const KNOWN_EXT = /\.(ts|json|html?|css|js|mjs|svg|txt|md)$/i;

const lines = (s: string) => s.replace(/\r\n?/g, '\n').split('\n');

/** A chunk's body with a fence taken off: the fenced block it opens with, else the text less a stray closing fence. */
function unfence(body: string[]): string {
  let i = 0;
  while (i < body.length && !(body[i] ?? '').trim()) i++;
  const open = FENCE.exec(body[i] ?? '');
  if (open) {
    const mark = (open[1] ?? '```')[0];
    const out: string[] = [];
    for (let j = i + 1; j < body.length; j++) {
      const close = /^\s{0,3}(`{3,}|~{3,})\s*$/.exec(body[j] ?? '');
      if (close && (close[1] ?? '')[0] === mark) return out.join('\n');
      out.push(body[j] ?? '');
    }
    return out.join('\n');
  }
  // No fence of its own: the outer block's closing fence (and anything after it) is not the file's.
  const out: string[] = [];
  for (let j = i; j < body.length; j++) {
    if (/^\s{0,3}(`{3,}|~{3,})\s*$/.test(body[j] ?? '')) break;
    out.push(body[j] ?? '');
  }
  return out.join('\n');
}

const finish = (s: string) => `${s.replace(/\s+$/, '')}\n`;

/**
 * 1.910: a file's name on a line of its own as chats also write it: a markdown heading (`## est.json`,
 * `### File: ui/ui.js`), bold (`**assembly/index.ts**`) or `File: ui/style.css`. Never valid code in
 * any of a plugin's files; counted only beside at least one other name line (`byMarkers`).
 */
const HEADING = new RegExp(String.raw`^\s{0,3}(?:#{1,6}\s+|\*\*\s*|(?=file(?:name)?\s*[:=]))(?:\d+[.)]\s*)?(?:file(?:name)?\s*[:=]\s*)?[\`"']?(${PATH})[\`"']?\s*(?:\*\*)?\s*:?\s*$`, 'i');
const FENCE_LINE = /^\s{0,3}(`{3,}|~{3,})/;

function byMarkers(all: string[]): Map<string, string> | null {
  const at: { line: number; path: string; inside: boolean }[] = [];
  // Whether each line is inside a code block (a marker inside one names a file within a block that holds several).
  let inside = false;
  for (let i = 0; i < all.length; i++) {
    const l = all[i] ?? '';
    if (FENCE_LINE.test(l)) { inside = !inside; continue; }
    const m = MARKER.exec(l) ?? HEADING.exec(l);
    if (m && KNOWN_EXT.test(m[1] ?? '')) at.push({ line: i, path: m[1] ?? '', inside });
  }
  // One name line alone is a file only in the prompt's own form (`=== file: ui/ui.js ===`): an answer that goes on
  // from a cut-off one may hold just the one file (1.910). Any other lone name line is too little to go on.
  if (at.length < 2 && !(at.length === 1 && /^\s*={3,}\s*file\s*:/i.test(all[at[0]!.line] ?? ''))) return null;
  const chunks = at.map((cur, k) => {
    const body = all.slice(cur.line + 1, k + 1 < at.length ? at[k + 1]!.line : all.length);
    // A name outside every block: its file is the first code block after it (talk between them is not the file's).
    const fenced = !cur.inside && body.some(l => FENCE_LINE.test(l));
    // A name inside a block: its file runs to the block's end (what follows the closing line is talk, never a block of its own).
    const closes = cur.inside ? body.findIndex(l => FENCE_LINE.test(l)) : -1;
    const lines = closes >= 0 ? body.slice(0, closes) : fenced ? body.slice(body.findIndex(l => FENCE_LINE.test(l))) : body;
    return { ...cur, fenced, text: finish(closes >= 0 ? lines.join('\n') : unfence(lines)) };
  });
  // Where files come in code blocks, a name line with no block after it is talk about the file, not the file.
  const anyCode = chunks.some(c => c.inside || c.fenced);
  const out = new Map<string, string>();
  for (const c of chunks) {
    if (anyCode && !c.inside && !c.fenced) continue;
    if (!c.text.trim()) continue;
    out.set(c.path, c.text);
  }
  return out.size >= Math.min(2, at.length) ? out : null;
}

interface Block { info: string; body: string; before: string }

function blocksOf(all: string[]): Block[] {
  const out: Block[] = [];
  let open: { mark: string; len: number; info: string; body: string[]; before: string } | null = null;
  let lastText = '';
  for (const l of all) {
    if (!open) {
      const m = FENCE.exec(l);
      if (m) open = { mark: (m[1] ?? '```')[0] ?? '`', len: (m[1] ?? '```').length, info: (m[2] ?? '').trim(), body: [], before: lastText };
      else if (l.trim()) lastText = l.trim();
      continue;
    }
    const close = /^\s{0,3}(`{3,}|~{3,})\s*$/.exec(l);
    if (close && (close[1] ?? '')[0] === open.mark && (close[1] ?? '').length >= open.len) {
      out.push({ info: open.info, body: open.body.join('\n'), before: open.before });
      open = null; lastText = '';
    } else open.body.push(l);
  }
  // An answer cut off inside its last block still gives that block.
  if (open && open.body.length) out.push({ info: open.info, body: open.body.join('\n'), before: open.before });
  return out;
}

const NAME_IN = new RegExp(String.raw`(?:^|[\s\`"'*:(\[])(${PATH})(?=$|[\s\`"'*:)\],])`);

/** A file name a block is given: in its info string, on the line before it, or in its first line's comment. */
function nameOf(b: Block): string | null {
  const from = (s: string) => {
    const m = NAME_IN.exec(s);
    return m && KNOWN_EXT.test(m[1] ?? '') ? (m[1] ?? null) : null;
  };
  const info = from(b.info.replace(/^[a-z0-9+#-]+[:\s]+/i, ' '));
  if (info) return info;
  // The line before: short, and little else than the name ("**ui/ui.js**", "### est.json", "File: assembly/index.ts:").
  if (b.before.length <= 120) {
    const n = from(b.before);
    if (n && b.before.replace(n, '').replace(/[`*#:_\-\s()[\].]|file(name)?|here is|the/gi, '').length <= 12) return n;
  }
  const first = (b.body.split('\n').find(l => l.trim()) ?? '').trim();
  const c = /^(?:\/\/|\/\*|<!--|#)\s*(?:file(?:name)?\s*[:=]\s*)?(\S+?)\s*(?:\*\/|-->)?$/.exec(first);
  if (c && new RegExp(`^${PATH}$`).test(c[1] ?? '') && KNOWN_EXT.test(c[1] ?? '')) return c[1] ?? null;
  return null;
}

const looksManifest = (s: string) => /^\s*\{/.test(s) && /"(?:id|est|parameters)"\s*:/.test(s) && !/\bfrom\s+["']est["']/.test(s);

/** What a block with no name most likely is, by what it holds. */
function guess(b: Block): string | null {
  const lang = (/^([a-z0-9+#-]+)/i.exec(b.info)?.[1] ?? '').toLowerCase();
  const s = b.body;
  if (/\bfrom\s+["']est["']/.test(s)) return INDEX;
  if (looksManifest(s)) return MANIFEST;
  if (/<!doctype\s+html|<html[\s>]/i.test(s)) return UI_PAGE;
  if (lang === 'css' || (lang === '' && /^\s*(?::root|html|body|\*)\s*[,{]/m.test(s) && !/\bfunction\b|=>/.test(s))) return 'ui/style.css';
  if ((lang === 'js' || lang === 'javascript' || lang === '') && /\bEstUI\b/.test(s)) return 'ui/ui.js';
  return null;
}

/** A pasted answer's files. Throws `VibeReadError` when it holds none. */
export function readVibeText(text: string): VibeSource {
  if (text.length > VIBE_CAPS.textChars) throw new VibeReadError('That text is too long to be a plugin\'s source (over 2 MB). Paste only your AI\'s answer.');
  const all = lines(text);
  const notes: string[] = [];
  let found = byMarkers(all);
  if (!found) {
    found = new Map();
    const blocks = blocksOf(all);
    let guessed = 0;
    for (const b of blocks) {
      let name = nameOf(b);
      if (!name) { name = guess(b); if (name) guessed++; }
      if (!name) continue;
      // A later block of the same file wins: a pasted chat may hold a first try and its fix.
      found.set(name, finish(b.body));
    }
    // No fences at all, yet the text is one file's worth of code: nothing to go on.
    if (!found.size) throw new VibeReadError('No plugin files were found in that text. Paste your AI\'s whole answer: it should hold est.json, assembly/index.ts and the ui files, each under a line like "=== file: est.json ===".');
    if (guessed) notes.push(guessed === 1 ? 'One code block had no file name, so Cyber worked out which file it was from what it holds.' : `${guessed} code blocks had no file name, so Cyber worked out which files they were from what they hold.`);
  }
  const files = new Map<string, Uint8Array>();
  for (const [p, t] of found) files.set(p, enc.encode(t));
  // A code block left open at the end: the answer was cut off there.
  const fences = all.filter(l => /^\s{0,3}(`{3,}|~{3,})/.test(l)).length;
  const last = [...found.keys()].pop();
  const out = tidyPaths({ files, notes });
  if (fences % 2 === 1 && last) out.cutOff = last;
  out.endsOpen = fences % 2 === 1 || fences === 0;
  return out;
}

// ── Zip ─────────────────────────────────────────────────────────────────────────────────────────────

const zipWords = (e: unknown): string => {
  if (!(e instanceof BoundedZipError)) return e instanceof Error ? e.message : String(e);
  switch (e.code) {
    case 'not-zip': return 'That file is not a zip.';
    case 'zip64': return 'That zip is in the ZIP64 format, which Cyber does not read here. Ask your AI for an ordinary zip, or for the files as text.';
    case 'encrypted': return 'That zip has a password. Ask your AI for one without, or for the files as text.';
    case 'bomb': return 'That zip unpacks to far more than a plugin\'s source should, so it was not opened.';
    default: return e.message;
  }
};

/** A zip of source files. Throws `VibeReadError` in words. */
export async function readVibeZip(bytes: Uint8Array): Promise<VibeSource> {
  if (bytes.length > VIBE_CAPS.zipBytes) throw new VibeReadError('That zip is larger than 24 MB, more than a plugin\'s source should be.');
  let zip: BoundedZip;
  try { zip = new BoundedZip(bytes, ZIP_LIMITS); } catch (e) { throw new VibeReadError(zipWords(e)); }
  const names = zip.names().filter(n => !n.endsWith('/') && !junk(n));
  if (names.length > VIBE_CAPS.files) throw new VibeReadError(`That zip holds ${names.length} files, more than a plugin's source should (${VIBE_CAPS.files} at most).`);
  const files = new Map<string, Uint8Array>();
  try {
    for (const n of names) {
      const data = await zip.read(n);
      if (data) files.set(n, data);
    }
  } catch (e) { throw new VibeReadError(zipWords(e)); }
  if (!files.size) throw new VibeReadError('That zip holds no files.');
  return tidyPaths({ files, notes: [] });
}

/** Whether these bytes start as a zip does. */
export const isZipBytes = (b: Uint8Array): boolean => b.length > 3 && b[0] === 0x50 && b[1] === 0x4b && (b[2] === 3 || b[2] === 5) ;

/** Whether a zip's bytes are a built `.est` bundle (a stored zip whose first entry is est.json and which holds a module), not sources. */
export function looksLikeBundle(bytes: Uint8Array): boolean {
  if (!isZipBytes(bytes) || bytes.length < 38) return false;
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const nameLen = v.getUint16(26, true);
  if (dec.decode(bytes.subarray(30, 30 + nameLen)) !== 'est.json') return false;
  try { return new BoundedZip(bytes, ZIP_LIMITS).names().some(n => /\.wasm$/i.test(n)); } catch { return false; }
}

/**
 * 1.909: whether a zip's bytes are a plugin's source packed as a `.est` (shared/estSourceEst.mjs: no
 * `.wasm` entry, an AssemblyScript source). Only the bounded reader's directory is read.
 */
export function isSourceEstZip(bytes: Uint8Array): boolean {
  if (!isZipBytes(bytes)) return false;
  try { return isSourceEstNames(new BoundedZip(bytes, ZIP_LIMITS).names()); } catch { return false; }
}

/** 1.909: the note a source `.est` is read with. */
export const SOURCE_EST_NOTE = 'This .est held the plugin\'s source, not a built plugin, so Cyber built it here.';

// ── Paths ───────────────────────────────────────────────────────────────────────────────────────────

const junk = (p: string) => /(^|\/)(__MACOSX|node_modules|\.git|dist|build)\//.test(p) || /(^|\/)(\.DS_Store|Thumbs\.db)$/.test(p) || /(^|\/)\._[^/]*$/.test(p);

const clean = (p: string) => p.replace(/\\/g, '/').replace(/^(\.\/)+/, '').replace(/^\/+/, '').replace(/\/{2,}/g, '/');

const UI_FILE = /\.(html?|css|js|mjs|svg|png|webp|woff2)$/i;

/** The files where the build reads them; what moved or was left out is noted. */
export function tidyPaths(src: VibeSource): VibeSource {
  const notes = [...src.notes];
  let entries = [...src.files].map(([p, b]) => [clean(p), b] as [string, Uint8Array]).filter(([p]) => p && !junk(p));

  // A wrapping folder: everything under the folder that holds the manifest (or the code).
  const anchor = entries.map(([p]) => p).filter(p => /(^|\/)(est|manifest)\.json$/i.test(p)).sort((a, b) => a.length - b.length)[0]
    ?? entries.map(([p]) => p).filter(p => /(^|\/)assembly\/index\.ts$/i.test(p)).map(p => p.replace(/assembly\/index\.ts$/i, 'x')).sort((a, b) => a.length - b.length)[0];
  const root = anchor && anchor.includes('/') ? anchor.slice(0, anchor.lastIndexOf('/') + 1) : '';
  if (root) {
    entries = entries.filter(([p]) => p.startsWith(root)).map(([p, b]) => [p.slice(root.length), b] as [string, Uint8Array]);
    notes.push(`The files were inside a folder (${root.replace(/\/$/, '')}); Cyber read them from there.`);
  }

  const out = new Map<string, Uint8Array>();
  const put = (p: string, b: Uint8Array) => { if (!out.has(p)) out.set(p, b); };
  const moved: string[] = [];
  const tsOutside = entries.filter(([p]) => /\.ts$/i.test(p) && !/\.d\.ts$/i.test(p) && !p.startsWith('assembly/') && !p.startsWith('ui/'));
  const hasIndex = entries.some(([p]) => p === INDEX);
  for (const [p, b] of entries) {
    const lower = p.toLowerCase();
    if (lower === 'est.json') { put(MANIFEST, b); continue; }
    if (p.startsWith('assembly/') || p.startsWith('ui/') || p.startsWith('presets/')) {
      // A lone source file under assembly/ with another name is the plugin's code.
      if (!hasIndex && /^assembly\/[^/]+\.ts$/i.test(p) && entries.filter(([q]) => /^assembly\/[^/]+\.ts$/i.test(q)).length === 1) { put(INDEX, b); moved.push(`${p} → ${INDEX}`); continue; }
      put(p, b); continue;
    }
    if (/^(manifest|plugin|est-manifest)\.json$/.test(lower) && !entries.some(([q]) => q.toLowerCase() === 'est.json')) { put(MANIFEST, b); moved.push(`${p} → ${MANIFEST}`); continue; }
    if (/\.ts$/i.test(p) && !/\.d\.ts$/i.test(p)) {
      if (!hasIndex && tsOutside.length === 1) { put(INDEX, b); moved.push(`${p} → ${INDEX}`); }
      else if (/^(src|source|dsp)\//i.test(p)) { const to = `assembly/${p.replace(/^[^/]+\//, '')}`; put(to, b); moved.push(`${p} → ${to}`); }
      continue;
    }
    // A page and its files at the root (or under another folder name) belong in ui/.
    const base = p.replace(/^(public|web|gui|window|frontend|src\/ui|html)\//i, '');
    if (UI_FILE.test(base) && !base.startsWith('assembly/')) { const to = `ui/${base}`; put(to, b); moved.push(`${p} → ${to}`); continue; }
    // Anything else (a README, package.json, asconfig.json, a script) is not part of a plugin: left out.
  }
  // A window whose page has another name.
  if (!out.has(UI_PAGE)) {
    const pages = [...out.keys()].filter(p => /^ui\/[^/]+\.html?$/i.test(p));
    if (pages.length === 1) {
      const from = pages[0]!;
      out.set(UI_PAGE, out.get(from)!); out.delete(from); moved.push(`${from} → ${UI_PAGE}`);
    }
  }
  if (moved.length) notes.push(`Cyber put ${moved.length === 1 ? 'a file' : 'some files'} where a plugin keeps ${moved.length === 1 ? 'it' : 'them'}: ${moved.join(', ')}.`);
  if (out.size > VIBE_CAPS.files) throw new VibeReadError(`That is ${out.size} files, more than a plugin's source should hold (${VIBE_CAPS.files} at most).`);
  let total = 0;
  for (const [p, b] of out) {
    if (b.length > VIBE_CAPS.fileBytes) throw new VibeReadError(`${p} is larger than 8 MB.`);
    total += b.length;
  }
  if (total > VIBE_CAPS.totalBytes) throw new VibeReadError('The files together are larger than 24 MB.');
  return { files: out, notes };
}
