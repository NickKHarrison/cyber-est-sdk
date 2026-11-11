/**
 * @cyber-est/tools: the UI probe (EST Phase 4, rules `EST-U001` to `EST-U004`). A custom plugin UI runs
 * in Cyber's sandboxed frame (`sandbox="allow-scripts"`) on the plugin origin, served from the
 * bundle's own folder (`/est/b/<hash>/…`), so it may load only files from its own bundle. This
 * reads the UI's HTML, scripts and styles as text and finds every URL in them: one to another host
 * is `EST-U002`, one that does not resolve to a file in the bundle `EST-U003`. Since 1.335 a page
 * that loads a module script (`type="module"`, a `crossorigin` attribute, `<link rel="modulepreload">`:
 * CORS requests that the opaque frame's origin never gets answered) is `EST-U005`.
 *
 * It reads, it never runs anything. The scan is lexical (attributes, `url()`, `@import`, string
 * literals and import specifiers, with comments skipped), so a URL built at run time from pieces
 * is not seen: the frame's sandbox and the plugin origin's policy are what stop it there.
 *
 * Pure: no DOM, no Node APIs.
 */
import { EST_UI_MAX_BYTES } from '../../../../src/audio/est/install/rules';

export interface UiFinding {
  rule: 'EST-U001' | 'EST-U002' | 'EST-U003' | 'EST-U004' | 'EST-U005';
  message: string;
  where: string;
}

/** XML namespace names: identifiers that look like URLs but load nothing. */
const NAMESPACES = new Set([
  'http://www.w3.org/2000/svg', 'http://www.w3.org/1999/xhtml', 'http://www.w3.org/1999/xlink',
  'http://www.w3.org/XML/1998/namespace', 'http://www.w3.org/2000/xmlns/', 'http://www.w3.org/1998/Math/MathML',
]);

/** URL schemes that load nothing from a host. */
const LOCAL_SCHEMES = /^(data|blob|about|javascript):/i;
const SCHEME = /^[a-z][a-z0-9+.-]*:/i;
const EXTERNAL = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i;

const TEXT = /\.(html?|m?js|css|svg)$/i;

const dec = new TextDecoder('utf-8', { fatal: true });

function text(bytes: Uint8Array): string | null {
  try { return dec.decode(bytes); } catch { return null; }
}

/** The string literals and import specifiers of a script, comments skipped (a small lexer: no regex literals). */
export function scriptStrings(src: string): { strings: string[]; specifiers: string[] } {
  const strings: string[] = [];
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i]!;
    if (c === '/' && src[i + 1] === '/') { const e = src.indexOf('\n', i); i = e < 0 ? n : e; continue; }
    if (c === '/' && src[i + 1] === '*') { const e = src.indexOf('*/', i + 2); i = e < 0 ? n : e + 2; continue; }
    if (c === '"' || c === "'" || c === '`') {
      let j = i + 1, s = '';
      while (j < n && src[j] !== c) {
        if (src[j] === '\\') { s += src[j + 1] ?? ''; j += 2; continue; }
        if (c === '`' && src[j] === '$' && src[j + 1] === '{') { // a template's expression ends the literal's text here
          strings.push(s); s = '';
          let depth = 1; j += 2;
          while (j < n && depth) { if (src[j] === '{') depth++; else if (src[j] === '}') depth--; j++; }
          continue;
        }
        s += src[j]; j++;
      }
      strings.push(s);
      i = j + 1;
      continue;
    }
    i++;
  }
  const specifiers: string[] = [];
  const re = /(?:\bimport\s*(?:[\w*{}\s,$]+\s*from\s*)?|\bexport\s*[\w*{}\s,$]+\s*from\s*|\bimport\s*\(\s*|\bimportScripts\s*\(\s*|\bnew\s+(?:Shared)?Worker\s*\(\s*)(["'])([^"'\n]*)\1/g;
  const stripped = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:\\])\/\/[^\n]*/g, '$1');
  for (const m of stripped.matchAll(re)) specifiers.push(m[2]!);
  return { strings, specifiers };
}

/** The URLs in a style sheet (`url(…)`, `@import`), comments skipped. */
export function cssUrls(src: string): string[] {
  const s = src.replace(/\/\*[\s\S]*?\*\//g, '');
  const out: string[] = [];
  for (const m of s.matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)\s]*))\s*\)/gi)) out.push((m[1] ?? m[2] ?? m[3] ?? '').trim());
  for (const m of s.matchAll(/@import\s+(?:"([^"]*)"|'([^']*)')/gi)) out.push(m[1] ?? m[2] ?? '');
  return out;
}

/** The URLs in an HTML page's attributes, its inline styles and scripts. */
export function htmlUrls(src: string): { urls: string[]; scripts: string[]; styles: string[] } {
  const s = src.replace(/<!--[\s\S]*?-->/g, '');
  const urls: string[] = [];
  const scripts: string[] = [];
  const styles: string[] = [];
  for (const m of s.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script\s*>/gi)) scripts.push(m[1]!);
  for (const m of s.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi)) styles.push(m[1]!);
  const tags = s.replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, m => m.slice(0, m.indexOf('>') + 1)).replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, m => m.slice(0, m.indexOf('>') + 1));
  const attr = /\s(src|href|action|formaction|poster|data|background|xlink:href|srcset|imagesrcset|style|content)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi;
  for (const m of tags.matchAll(attr)) {
    const name = m[1]!.toLowerCase();
    const v = (m[2] ?? m[3] ?? m[4] ?? '').trim();
    if (name === 'style') { styles.push(v); continue; }
    if (name === 'content') { const r = /(?:^|;)\s*url\s*=\s*(\S+)/i.exec(v); if (r) urls.push(r[1]!.replace(/^['"]|['"]$/g, '')); continue; }
    if (name === 'srcset' || name === 'imagesrcset') { for (const part of v.split(',')) { const u = part.trim().split(/\s+/)[0]; if (u) urls.push(u); } continue; }
    urls.push(v);
  }
  return { urls, scripts, styles };
}

/** An attribute's value in a tag's attribute text (lower case, trimmed), or null when it is absent. */
function attrValue(attrs: string, name: string): string | null {
  for (const m of attrs.matchAll(/\s([a-z][a-z0-9:-]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/gi)) {
    if (m[1]!.toLowerCase() === name) return (m[2] ?? m[3] ?? m[4] ?? '').trim().toLowerCase();
  }
  return null;
}

/**
 * EST-U005 (1.335): what in an HTML page makes a CORS request the plugin origin never answers, so
 * the frame stays blank: a `<script type="module">`, a `crossorigin` attribute on any element, a
 * `<link rel="modulepreload">`. Comments and script bodies are skipped: only tags count.
 */
export function moduleScriptTags(src: string): string[] {
  const s = src.replace(/<!--[\s\S]*?-->/g, '').replace(/(<script\b(?:[^>"']|"[^"]*"|'[^']*')*>)[\s\S]*?<\/script\s*>/gi, '$1');
  const out: string[] = [];
  for (const m of s.matchAll(/<([a-z][a-z0-9-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/gi)) {
    const tag = m[1]!.toLowerCase();
    const attrs = m[2]!;
    const shown = m[0].length > 120 ? `${m[0].slice(0, 117)}...` : m[0];
    if (tag === 'script' && attrValue(attrs, 'type') === 'module') out.push(`a module script, ${shown}`);
    else if (tag === 'link' && (attrValue(attrs, 'rel') ?? '').split(/\s+/).includes('modulepreload')) out.push(`a module preload, ${shown}`);
    else if (attrValue(attrs, 'crossorigin') !== null) out.push(`a crossorigin attribute, ${shown}`);
  }
  return out;
}

/** `url` from the file at `from` (a bundle path), as a bundle path, or why it is not one. */
function resolveIn(from: string, url: string): { path: string } | { outside: string } | null {
  const u = url.trim();
  if (!u || u.startsWith('#') || LOCAL_SCHEMES.test(u)) return null;
  if (u.startsWith('/')) return { outside: `the root-relative URL ${u}` };
  const clean = u.split(/[?#]/)[0]!;
  if (!clean) return null;
  let decoded = clean;
  try { decoded = decodeURIComponent(clean); } catch { /* keep it */ }
  const parts = from.split('/').slice(0, -1);
  for (const seg of decoded.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') { if (!parts.length) return { outside: `${u}, which leaves the bundle` }; parts.pop(); continue; }
    parts.push(seg);
  }
  return { path: parts.join('/') };
}

/**
 * Probe a bundle's UI: `uiPath` (est.json's `ui.path`) and the bundle's files. Returns the
 * findings, in a stable order (the page first, then the files by path); none when the UI is clean.
 */
export function probeUi(uiPath: string, files: ReadonlyMap<string, Uint8Array>): UiFinding[] {
  const out: UiFinding[] = [];
  const page = files.get(uiPath);
  const html = page ? text(page) : null;
  if (html === null || !/<html[\s>]|<!doctype\s+html/i.test(html)) {
    out.push({ rule: 'EST-U001', message: page ? `${uiPath} is not UTF-8 HTML (no <html> element or doctype)` : `${uiPath} is not in the bundle`, where: uiPath });
    return out;
  }
  const seen = new Set<string>();
  const check = (from: string, url: string, kind: 'url' | 'string') => {
    const u = url.trim();
    if (!u) return;
    if (kind === 'string') {
      // A string literal counts only when it is a URL to a host (a namespace name loads nothing).
      if (!EXTERNAL.test(u) || LOCAL_SCHEMES.test(u) || NAMESPACES.has(u) || !/^(?:[a-z][a-z0-9+.-]*:)?\/\/[^/\s]/i.test(u)) return;
    }
    const key = `${from}\u0000${u}`;
    if (seen.has(key)) return;
    seen.add(key);
    if (NAMESPACES.has(u)) return;
    if (EXTERNAL.test(u) && !LOCAL_SCHEMES.test(u)) {
      if (SCHEME.test(u) && !/^(https?|wss?|ftp):/i.test(u) && !u.startsWith('//')) {
        out.push({ rule: 'EST-U002', message: `${from} links to ${u}, outside the bundle (only the bundle's own files load in a plugin UI)`, where: from });
      } else {
        out.push({ rule: 'EST-U002', message: `${from} reaches an external host: ${u}`, where: from });
      }
      return;
    }
    const r = resolveIn(from, u);
    if (!r) return;
    if ('outside' in r) { out.push({ rule: 'EST-U003', message: `${from} uses ${r.outside} (a UI URL must be relative, inside the bundle)`, where: from }); return; }
    if (!files.has(r.path)) out.push({ rule: 'EST-U003', message: `${from} refers to ${u}, which is not in the bundle (${r.path})`, where: from });
  };
  const scanScript = (from: string, src: string) => {
    const { strings, specifiers } = scriptStrings(src);
    for (const s of specifiers) {
      if (!/^(\.{1,2}\/|\/|[a-z][a-z0-9+.-]*:|\/\/)/i.test(s)) {
        out.push({ rule: 'EST-U003', message: `${from} imports the bare module "${s}", which does not resolve in a plugin UI (bundle it into one script)`, where: from });
        continue;
      }
      check(from, s, 'url');
    }
    for (const s of strings) check(from, s, 'string');
  };
  const scanCss = (from: string, src: string) => { for (const u of cssUrls(src)) check(from, u, 'url'); };
  const scanHtml = (from: string, src: string) => {
    const h = htmlUrls(src);
    for (const u of h.urls) check(from, u, 'url');
    for (const s of h.scripts) scanScript(from, s);
    for (const s of h.styles) scanCss(from, s);
  };
  const scanModules = (from: string, src: string) => {
    for (const what of moduleScriptTags(src)) out.push({ rule: 'EST-U005', message: `${from} has ${what}: it loads nothing in the plugin's sandboxed frame (load one classic script instead)`, where: from });
  };
  scanHtml(uiPath, html);
  scanModules(uiPath, html);
  const others = [...files.keys()].filter(p => p !== uiPath && p !== 'est.json' && TEXT.test(p)).sort();
  for (const p of others) {
    const src = text(files.get(p)!);
    if (src === null) continue;
    if (/\.html?$/i.test(p)) { scanHtml(p, src); scanModules(p, src); }
    else if (/\.m?js$/i.test(p)) scanScript(p, src);
    else if (/\.css$/i.test(p)) scanCss(p, src);
    else if (/\.svg$/i.test(p)) scanHtml(p, src);
  }
  const base = uiPath.includes('/') ? `${uiPath.slice(0, uiPath.lastIndexOf('/'))}/` : '';
  let total = 0;
  for (const [p, b] of files) if (p === uiPath || (base && p.startsWith(base))) total += b.length;
  if (total > EST_UI_MAX_BYTES) out.push({ rule: 'EST-U004', message: `the UI's files total ${total} bytes (over ${EST_UI_MAX_BYTES})`, where: base || uiPath });
  return out;
}
