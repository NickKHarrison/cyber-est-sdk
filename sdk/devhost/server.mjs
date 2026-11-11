/**
 * The EST dev host's server (`est dev`, docs/est/EST_Phase4_Work_Order.md §3). Two origins:
 *
 * - **the host**, `http://localhost:4430`: the dev host page (sdk/devhost/, built by Vite from
 *   Cyber's own sources: it imports src/audio/est/ directly, so the plugin runs in `EstNode`,
 *   `ensureEstRuntime`, the shim and the compiling Worker that reads, meters and runs the
 *   conformance check exactly as an install does) and its API under `/__est/` (the session, the
 *   bundle, its presets, a stream of events);
 * - **the plugin's files**, `http://localhost:4431`: the bundle unpacked under `/est/b/<hash>/…`,
 *   answered by Cyber's own plugin-origin code (`server/estOrigin.mjs`: production's headers and
 *   CSP, framed only by the host), so the custom UI's frame is cross-origin and sandboxed as in Cyber.
 *
 * The target is a plugin's folder (built and packed on every change), a `.est` file, or a folder
 * holding `bundle.est` (as `est-plugins/dist/<hash>/`). Every bundle is read by Cyber's reader
 * (`readBundle`) before it is served. `uiPreview`: a folder's `ui/` against a parameter list from a
 * file, with no bundle and no DSP (a UI written before its plugin).
 */
import { createHash } from 'node:crypto';
import { createServer as createHttpServer } from 'node:http';
import { createReadStream, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, watch, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, extname, join, relative, resolve, sep } from 'node:path';
import { createEstOrigin } from '../../server/estOrigin.mjs';
import { withEstUi } from '../packages/ui/copyRule.mjs';
import { buildKind, packFolder } from './build.mjs';
import { createDevFollow } from './follow.mjs'; // EST Phase 5a (5-C): Cyber's Follow `est dev`
// In a published @cyber-est/cli these two are their `.package.mjs` siblings (scripts/sdk-build.mjs):
// the page and the reader built once with the package, @cyber-est/tools bundled in.
import { ensurePage, loadReader } from './pageBuild.mjs';
import { loadTools } from './tools.mjs';

export const DEFAULT_HOST_PORT = 4430;
export const DEFAULT_FILES_PORT = 4431;

/** Folders whose changes never trigger a rebuild. */
const IGNORED = /(^|[\\/])(target|build|dist|node_modules|\.git)([\\/]|$)/;

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.wasm': 'application/wasm', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.woff2': 'font/woff2', '.est': 'application/octet-stream',
};

/**
 * Whether a request's `Host` names this machine's loopback (1.319). Both servers listen on
 * localhost only, but a web page can still reach them by DNS rebinding (a name of its own that it
 * re-points at 127.0.0.1), and its requests then carry that name: they are refused (421).
 * @param {import('node:http').IncomingMessage} req
 */
export function loopbackHost(req) {
  const h = String(req.headers.host ?? '').toLowerCase();
  const name = h.startsWith('[') ? h.slice(0, h.indexOf(']') + 1) : h.split(':')[0];
  return name === 'localhost' || name === '127.0.0.1' || name === '[::1]';
}

/** @param {import('node:http').ServerResponse} res */
function refuseHost(res) {
  res.writeHead(421, { 'content-type': 'text/plain; charset=utf-8' });
  res.end('est dev answers only requests for localhost, 127.0.0.1 or [::1]\n');
}

/**
 * What a target names. @param {string} target
 * @returns {{ kind: 'folder' | 'file' | 'unpacked', path: string }}
 */
export function resolveTarget(target) {
  const p = resolve(target);
  if (!existsSync(p)) throw new Error(`${target}: no such file or folder`);
  if (statSync(p).isFile()) {
    if (!p.endsWith('.est')) throw new Error(`${target}: not a .est bundle`);
    return { kind: 'file', path: p };
  }
  if (existsSync(join(p, 'bundle.est')) && !buildKind(p)) return { kind: 'unpacked', path: join(p, 'bundle.est') };
  if (existsSync(join(p, 'est.json'))) return { kind: 'folder', path: p };
  throw new Error(`${target}: neither a plugin folder (est.json) nor a bundle`);
}

/** Every file under `dir`, as `/`-separated paths relative to `base`. */
function walk(dir, base) {
  const out = [];
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p, base));
    else out.push(relative(base, p).split(sep).join('/'));
  }
  return out;
}

/**
 * @typedef {{ type: string, [k: string]: unknown }} DevEvent
 * @typedef {{
 *   target: string, hostPort?: number, filesPort?: number, watch?: boolean,
 *   onEvent?: (e: DevEvent) => void, log?: (line: string) => void, uiPreview?: string, pageDir?: string,
 *   cyber?: string[],
 * }} DevHostOptions
 */

/**
 * Start the dev host. Ports 0 take free ones (the tests). Resolves once both servers listen and
 * the first bundle is ready (or its build failed: the page shows why).
 * @param {DevHostOptions} o
 */
export async function startDevHost(o) {
  const log = o.log ?? ((line) => console.log(line));
  const preview = o.uiPreview ? resolve(o.uiPreview) : null;
  const previewParams = preview ? JSON.parse(readFileSync(preview, 'utf8')) : null;
  if (previewParams && !Array.isArray(previewParams)) throw new Error(`${o.uiPreview}: not a list of parameters`);
  const target = preview ? { kind: 'preview', path: resolve(o.target) } : resolveTarget(o.target);
  // `pageDir`: a built page to serve instead of building one (the unit tests serve a stand-in).
  const [page, reader] = await Promise.all([o.pageDir ? Promise.resolve(resolve(o.pageDir)) : ensurePage({ log }), loadReader()]);
  const stage = mkdtempSync(join(tmpdir(), 'est-dev-'));
  const tools = target.kind === 'folder' ? await loadTools(log) : null;

  /** The page's event streams. */
  const streams = new Set();
  const send = (event, data) => {
    const frame = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const res of streams) res.write(frame);
  };

  const state = {
    /** @type {null | { hash: string, bytes: Uint8Array | null, manifest: any, presets: any[] }} */
    bundle: null,
    build: { n: 0, ok: false, at: '', via: '', message: '', log: '' },
    /** @type {any} */
    validation: null,
    validationNote: '',
  };

  const host = createHttpServer();
  await new Promise((r, j) => { host.once('error', j); host.listen(o.hostPort ?? DEFAULT_HOST_PORT, 'localhost', () => r(undefined)); });
  const hostPort = /** @type {import('node:net').AddressInfo} */ (host.address()).port;
  const hostOrigin = `http://localhost:${hostPort}`;

  const files = createEstOrigin({ EST_ORIGIN_DIR: stage, EST_APP_ORIGIN: `${hostOrigin} http://127.0.0.1:${hostPort}` }, { anyHost: true });
  // EST Phase 5a (5-C): `/est/dev/…` for Cyber's Follow `est dev` (follow.mjs), CORS for `cyber` only.
  // DEV-E (1.325): Cyber attaching is said (the terminal's line, --json's event).
  const follow = createDevFollow({
    cyber: o.cyber ?? [],
    onAttach: (origin, via) => {
      log(`Cyber attached from ${origin} (${via === 'events' ? 'following the build stream' : 'polling'}).`);
      o.onEvent?.({ type: 'cyber', event: 'attached', origin, via });
    },
  });
  const filesServer = createHttpServer((req, res) => {
    if (!loopbackHost(req)) { refuseHost(res); return; }
    if (!follow.handle(req, res) && !files?.handle(req, res)) { res.writeHead(404); res.end(); }
  });
  await new Promise((r, j) => { filesServer.once('error', j); filesServer.listen(o.filesPort ?? DEFAULT_FILES_PORT, 'localhost', () => r(undefined)); });
  const filesOrigin = `http://localhost:${/** @type {import('node:net').AddressInfo} */ (filesServer.address()).port}`;

  /** Serve `files` (path → bytes) as the bundle `hash`. */
  const stageFiles = (hash, entries) => {
    const dir = join(stage, hash);
    rmSync(dir, { recursive: true, force: true });
    for (const [name, data] of entries) {
      mkdirSync(dirname(join(dir, name)), { recursive: true });
      writeFileSync(join(dir, name), data);
    }
  };

  /** Read a bundle with Cyber's reader and serve its files. @param {Uint8Array} bytes */
  async function adopt(bytes) {
    const b = await reader.readBundle(bytes);
    stageFiles(b.hash, [...b.files, ['bundle.est', bytes]]);
    state.bundle = { hash: b.hash, bytes, manifest: b.manifest, presets: b.presets.map((p) => ({ id: p.path, name: p.name, state: Buffer.from(p.bytes).toString('base64') })) };
  }

  /** A UI preview: the folder's ui/ (with @cyber-est/ui copied in when it names it) and its est.json's ui. */
  function adoptPreview() {
    const dir = target.path;
    const manifest = existsSync(join(dir, 'est.json')) ? JSON.parse(readFileSync(join(dir, 'est.json'), 'utf8')) : {};
    if (!existsSync(join(dir, 'ui'))) throw new Error(`${dir}: no ui/ folder to preview`);
    /** @type {Record<string, Uint8Array>} */
    const raw = {};
    for (const f of walk(join(dir, 'ui'), dir)) raw[f] = new Uint8Array(readFileSync(join(dir, f)));
    const { files: all } = withEstUi(raw);
    const h = createHash('sha256');
    for (const k of Object.keys(all).sort()) h.update(k).update(all[k]);
    const hash = h.digest('hex');
    const ui = manifest.ui ?? { path: 'ui/index.html', size: { w: 660, h: 480 } };
    const shown = { id: manifest.id ?? 'preview', version: manifest.version ?? '0.0.0', name: manifest.name ?? basename(dir), kind: 'preview', ui, parameters: manifest.parameters ?? [], limits: { maxLatencyFrames: 0, memoryPagesMax: 16, tailSeconds: 0 } };
    // 1.314 (EST-04): the plugin origin serves a page only as its est.json's `ui.path`, so the preview's
    // manifest is staged beside its files, as a bundle's is.
    stageFiles(hash, [...Object.entries(all), ['est.json', new TextEncoder().encode(JSON.stringify(shown))]]);
    state.bundle = { hash, bytes: null, presets: [], manifest: shown };
  }

  /** A validation.json beside the bundle (written by `est validate`), if there is one. */
  const validationIn = (dir) => {
    const v = join(dir, 'validation.json');
    if (!existsSync(v)) return null;
    try { return JSON.parse(readFileSync(v, 'utf8')); } catch { return null; }
  };

  async function load() {
    const n = state.build.n + 1;
    state.build = { n, ok: false, at: new Date().toISOString(), via: '', message: 'building', log: '' };
    send('build', state.build);
    try {
      if (target.kind === 'preview') {
        adoptPreview();
        state.build.via = 'ui preview';
      } else if (target.kind === 'folder') {
        const packed = await packFolder(target.path, tools);
        await adopt(packed.bytes);
        state.build.via = packed.via;
        state.build.log = String(packed.log ?? '').slice(-20_000);
        const out = join(target.path, 'dist');
        mkdirSync(out, { recursive: true });
        writeFileSync(join(out, 'dev.est'), packed.bytes);
        if (tools && typeof tools.validate === 'function') {
          state.validation = await tools.validate(packed.bytes, {});
          writeFileSync(join(out, 'validation.json'), `${JSON.stringify(state.validation, null, 2)}\n`);
          state.validationNote = '@cyber-est/tools validate, written to dist/validation.json';
        } else {
          state.validation = validationIn(out);
          state.validationNote = state.validation ? 'dist/validation.json (from the last est validate)' : '@cyber-est/tools is not in this checkout yet: the install check above is Cyber\'s';
        }
      } else {
        await adopt(new Uint8Array(readFileSync(target.path)));
        state.build.via = 'bundle';
        state.validation = validationIn(dirname(target.path));
        state.validationNote = state.validation ? 'validation.json beside the bundle' : 'no validation.json beside the bundle (run est validate)';
      }
      state.build.ok = true;
      const m = state.bundle?.manifest;
      state.build.message = `ready: ${m?.name} ${m?.version} (${state.bundle?.hash.slice(0, 12)})`;
    } catch (err) {
      state.build.ok = false;
      const code = /** @type {any} */ (err)?.code;
      state.build.message = `${code ? `refused (${code}): ` : ''}${err instanceof Error ? err.message : String(err)}`;
      state.build.log = String(/** @type {any} */ (err)?.log ?? '').slice(-20_000);
    }
    log(`[est dev] ${state.build.ok ? '' : 'build failed: '}${state.build.message}`);
    send('build', state.build);
    if (state.build.ok) send('bundle', { hash: state.bundle?.hash });
    if (state.build.ok && state.bundle?.bytes) follow.publish({ hash: state.bundle.hash, id: state.bundle.manifest.id, version: state.bundle.manifest.version, builtAt: state.build.at, n, bytes: state.bundle.bytes });
    else if (!state.build.ok) follow.failed({ n, at: state.build.at, message: state.build.message });
    o.onEvent?.({ type: 'build', n, ok: state.build.ok, via: state.build.via, message: state.build.message, hash: state.bundle?.hash ?? null });
  }

  const json = (res, status, body) => {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    res.end(JSON.stringify(body));
  };

  const session = () => ({
    filesOrigin,
    build: state.build,
    validation: state.validation,
    validationNote: state.validationNote,
    target: { kind: target.kind, name: basename(target.kind === 'unpacked' ? dirname(target.path) : target.path) },
    uiPreview: previewParams,
    plugin: state.bundle
      ? {
          hash: state.bundle.hash, id: state.bundle.manifest.id, version: state.bundle.manifest.version, name: state.bundle.manifest.name,
          kind: state.bundle.manifest.kind, manifest: state.bundle.manifest, presets: state.bundle.presets.map((p) => ({ id: p.id, name: p.name })),
        }
      : null,
  });

  const body = (req) => new Promise((r, j) => {
    let s = '';
    req.setEncoding('utf8');
    req.on('data', (d) => { s += d; if (s.length > 1_000_000) req.destroy(); });
    req.on('end', () => r(s));
    req.on('error', j);
  });

  /** The built page's files (the API aside). */
  const servePage = (req, res, pathname) => {
    const rel = pathname === '/' ? 'index.html' : decodeURIComponent(pathname.slice(1));
    const file = resolve(page, rel);
    if (!file.startsWith(page + sep) || !existsSync(file) || !statSync(file).isFile()) { res.writeHead(404, { 'content-type': 'text/plain' }); res.end('Not found'); return; }
    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream', 'cache-control': rel === 'index.html' ? 'no-store' : 'public, max-age=31536000, immutable', 'x-content-type-options': 'nosniff' });
    createReadStream(file).pipe(res);
  };

  host.on('request', async (req, res) => {
    if (!loopbackHost(req)) { refuseHost(res); return; }
    const url = new URL(req.url ?? '/', hostOrigin);
    try {
      if (url.pathname === '/__est/session') return json(res, 200, session());
      if (url.pathname === '/__est/bundle.est') {
        if (!state.bundle?.bytes) return json(res, 404, { error: 'no bundle' });
        res.writeHead(200, { 'content-type': 'application/octet-stream', 'cache-control': 'no-store', 'x-est-hash': state.bundle.hash });
        return res.end(Buffer.from(state.bundle.bytes));
      }
      if (url.pathname === '/__est/preset') {
        const p = state.bundle?.presets.find((x) => x.id === url.searchParams.get('id'));
        return p ? json(res, 200, p) : json(res, 404, { error: 'no such preset' });
      }
      if (url.pathname === '/__est/events') {
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
        res.write(`event: build\ndata: ${JSON.stringify(state.build)}\n\n`);
        streams.add(res);
        req.on('close', () => streams.delete(res));
        return undefined;
      }
      if (url.pathname === '/__est/emit' && req.method === 'POST') {
        const lines = JSON.parse(await body(req));
        for (const e of Array.isArray(lines) ? lines : [lines]) if (e && typeof e === 'object') o.onEvent?.(e);
        res.writeHead(204);
        return res.end();
      }
      if (url.pathname === '/__est/rebuild' && req.method === 'POST') {
        void load();
        res.writeHead(202);
        return res.end();
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }
      servePage(req, res, url.pathname);
    } catch (err) {
      json(res, 500, { error: err instanceof Error ? err.message : String(err) });
    }
    return undefined;
  });

  await load();

  /** @type {import('node:fs').FSWatcher | null} */
  let watcher = null;
  let timer = null;
  if (o.watch !== false) {
    let busy = false;
    let again = false;
    const rebuild = async () => {
      if (busy) { again = true; return; }
      busy = true;
      try { await load(); } finally { busy = false; }
      if (again) { again = false; void rebuild(); }
    };
    const kick = () => { clearTimeout(timer); timer = setTimeout(() => void rebuild(), 300); };
    if (target.kind === 'file' || target.kind === 'unpacked') watcher = watch(target.path, kick);
    else watcher = watch(target.path, { recursive: true }, (_e, name) => { if (!(name && IGNORED.test(String(name)))) kick(); });
  }

  return {
    url: hostOrigin,
    filesOrigin,
    /** The current bundle's hash (null while none). */
    hash: () => state.bundle?.hash ?? null,
    build: () => ({ ...state.build }),
    /** Rebuild or reload now. */
    reload: () => load(),
    /** A command to the page (`--json`'s stdin; headless.mjs lists them). @param {Record<string, unknown>} c */
    command: (c) => send('command', c),
    async close() {
      clearTimeout(timer);
      watcher?.close();
      follow.close();
      for (const res of streams) res.end();
      streams.clear();
      host.closeAllConnections?.();
      filesServer.closeAllConnections?.();
      await new Promise((r) => host.close(() => r(undefined)));
      await new Promise((r) => filesServer.close(() => r(undefined)));
      rmSync(stage, { recursive: true, force: true });
    },
  };
}
