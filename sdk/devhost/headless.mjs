/**
 * `est dev --json`: the dev host with no screen, for coding agents. It starts the dev host, opens
 * the page in Playwright's Chromium (headless, autoplay allowed), starts the audio, and prints one
 * JSON object a line on stdout:
 *
 *   {"type":"build","ok":true,…}        a build (and every rebuild)
 *   {"type":"install","ok":true,…}      Cyber's install check (reader, meter, conformance)
 *   {"type":"ready","params":3,…}       the instance is running
 *   {"type":"meter","peak":[-6.1,-6.1],"rms":[-9.2,-9.2]}   four times a second (dBFS; null is silence)
 *   {"type":"ui","event":"load"|"ready"|"init"|"rejected"|"console"|"error"|"http",…}   the custom UI
 *   {"type":"command"|"done",…}         a command started, and finished
 *   {"type":"param"|"note-on"|"state"|"stats"|"error"|…}     everything the page logs
 *
 * and reads commands, one JSON object a line, on stdin (run one at a time, in order, no sooner than
 * they arrived: commands.mjs):
 *
 *   {"cmd":"note","key":60,"velocity":100,"ms":500}  {"cmd":"noteOn","key":60}  {"cmd":"noteOff","key":60}
 *   {"cmd":"param","id":0,"value":-6}  {"cmd":"play"}  {"cmd":"stop"}  {"cmd":"tempo","bpm":128}
 *   {"cmd":"signal","kind":"sine"|"noise"|"pulse"|"off"}  {"cmd":"state"}  {"cmd":"preset","id":"presets/x.bin"}
 *   {"cmd":"params"}  {"cmd":"wait","ms":500}  {"cmd":"quit"}
 *   {"cmd":"ui-param","id":0,"value":-6}   the custom UI's page writes the parameter itself (uiParam below)
 *
 * How long it runs (one rule): `--seconds N` stops it N seconds after the instance started, whatever
 * else is queued. Without it, it stops 1 s after the last of its work: with `--play`, the last
 * note's release; without, stdin's end and the last of its commands. `quit` stops it when its turn
 * comes.
 */
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { pathToFileURL } from 'node:url';
import { commandQueue } from './commands.mjs';
import { startDevHost } from './server.mjs';

/** How long a command may take before the queue gives up on it and goes on. */
const COMMAND_TIMEOUT_MS = 30_000;
/** After the last of the work: the releases ring out and the page's last events arrive. */
const LINGER_MS = 1000;
/** `ui-param`: how long the host page may take to log the frame's write (a frame, a message, a batch). */
const UI_PARAM_WAIT_MS = 3000;

/**
 * --play's notes as commands: each held 400 ms, one every 500 ms.
 * @param {number[]} keys
 */
export function playCommands(keys) {
  return keys.flatMap((key) => [{ cmd: 'note', key, velocity: 100, ms: 400 }, { cmd: 'wait', ms: 500 }]);
}

/** A start failure in words an agent can act on. @param {unknown} err */
export function startMessage(err) {
  const code = /** @type {any} */ (err)?.code;
  const message = err instanceof Error ? err.message : String(err);
  return code === 'EADDRINUSE' ? `${message}: the port is taken (another est dev?); pass --port and --files-port with free ports, or 0 to take any` : message;
}

/**
 * What runs inside the custom UI's frame for `ui-param`: the page's own `@cyber-est/ui` connection
 * (`EstUI.currentConnection()`, the library's public API) writes the parameter as one of its
 * controls does on a drag: the gesture's begin, the value, its end. So the messages leave the frame
 * as the page's own and the host checks them as Cyber does; nothing is set from the host's side.
 * Plain and self-contained (it is serialised into the frame), and it uses only what every
 * `est-ui.js` since 1.282 has, so a plugin packed before this needs no repacking.
 * `early` marks a refusal that may pass once the page has come up (no script yet, no est:init).
 * @param {[number, number]} args
 */
export function frameWrite([id, value]) {
  const ui = /** @type {any} */ (globalThis).EstUI;
  if (!ui || typeof ui.currentConnection !== 'function') return { ok: false, early: true, reason: 'the page does not load est-ui.js (no window.EstUI)' };
  const c = ui.currentConnection();
  if (!c) return { ok: false, early: true, reason: 'the page has not called EstUI.connect()' };
  if (!c.initialised) return { ok: false, early: true, reason: 'no est:init has arrived yet' };
  if (!c.param(id)) return { ok: false, reason: `no parameter with id ${String(id)}` };
  const before = c.get(id);
  c.begin(id);
  c.set(id, value);
  c.end(id);
  const after = c.get(id);
  return { ok: true, value: after, changed: after !== before };
}

/**
 * `{"cmd":"ui-param","id":n,"value":v}`: the custom UI's page writes parameter `n` itself
 * (`frameWrite`, run inside the frame by the browser driver, the only way into a sandboxed frame
 * from outside); the host page takes the frame's messages as Cyber does and logs `param` with
 * `"origin":"frame"`. The command's own lines are `command` and `done`, and an `error` when there is
 * no frame, the page does not load `est-ui.js` or never connects, or the parameter does not exist.
 * @param {import('@playwright/test').Page} page
 * @param {string} filesOrigin
 * @param {Record<string, unknown>} c
 * @param {(e: Record<string, unknown>) => void} line
 */
export async function uiParam(page, filesOrigin, c, line) {
  const shown = { ...c };
  delete shown.seq;
  line({ type: 'command', command: shown });
  const fail = (/** @type {string} */ message) => { line({ type: 'error', phase: 'command', message: `ui-param: ${message}` }); line({ type: 'done', cmd: 'ui-param' }); };
  const id = typeof c.id === 'number' ? c.id : NaN;
  const value = typeof c.value === 'number' ? c.value : NaN;
  if (!Number.isInteger(id) || !Number.isFinite(value)) { fail('needs an integer id and a finite value'); return; }
  const inFiles = (/** @type {string} */ url) => { try { return new URL(url).origin === filesOrigin; } catch { return false; } };
  /** The frame's `param` lines the host page has logged so far, to tell this write's apart. */
  const framesLogged = () => page.evaluate(() => /** @type {any} */ (globalThis).estDev?.log().filter((/** @type {any} */ l) => l.type === 'param' && l.origin === 'frame').length ?? 0);
  const before = await framesLogged().catch(() => 0);
  /**
   * 5-D: whether the host has answered the page's est:ready with its est:init. The host sends one
   * on the frame's load and another on est:ready; a write made between the page taking the first
   * and the second would be overwritten by the second's values, so the write waits for it.
   */
  const answered = () => page.evaluate(() => /** @type {any} */ (globalThis).estDev?.log().some((/** @type {any} */ l) => l.type === 'ui' && l.event === 'init' && l.reason === 'ready') ?? false);
  // The frame opens when the instance runs and its page connects a moment later: a command sent
  // right after `ready` waits for it (and for its est:init), up to UI_PARAM_WAIT_MS.
  const until = Date.now() + UI_PARAM_WAIT_MS;
  /** @type {null | { ok: boolean, early?: boolean, reason?: string, value?: number, changed?: boolean }} */
  let r = null;
  let why = 'no custom UI frame is open (the plugin has no "ui", or the instance is not running)';
  for (;;) {
    // 1.413: the plugin's page, not the frame wrapper around it (`/est/frame/…`, on the same origin).
    const frame = page.frames().find((f) => inFiles(f.url()) && !new URL(f.url()).pathname.startsWith('/est/frame/'));
    // (Until it is answered, or the wait is over: a page that never says est:ready is written to as it is.)
    const waiting = Date.now() < until - 1000 && !(await answered().catch(() => true));
    if (frame && !waiting) {
      try {
        r = await frame.evaluate(frameWrite, /** @type {[number, number]} */ ([id, value]));
      } catch (err) {
        // The frame is navigating (its document replaced under the evaluation): try again.
        r = { ok: false, early: true, reason: `the frame could not be driven: ${err instanceof Error ? err.message : String(err)}` };
      }
      if (r.ok) break;
      why = String(r.reason ?? 'refused');
      if (!r.early) break;
    }
    if (Date.now() >= until) break;
    await new Promise((res) => setTimeout(res, 50));
  }
  if (!r || !r.ok) { fail(why); return; }
  if (r.changed) {
    // The host page logs the frame's write once the gesture's end arrives.
    const until = Date.now() + UI_PARAM_WAIT_MS;
    while (Date.now() < until && (await framesLogged().catch(() => before)) <= before) await new Promise((res) => setTimeout(res, 25));
    if ((await framesLogged().catch(() => before)) <= before) line({ type: 'error', phase: 'command', message: 'ui-param: the page wrote, but the host logged no param from it (a refusal is a ui line above)' });
    // The page posts its lines in batches: let the param line reach stdout before this done.
    else await new Promise((res) => setTimeout(res, 150));
  }
  line({ type: 'done', cmd: 'ui-param', id, value: r.value, changed: !!r.changed });
}

/**
 * Playwright's `chromium`, an optional peer: from beside the dev host (the clone, or where
 * @cyber-est/cli is installed), else from the plugin's own folder. Null when neither has it.
 * @param {string} target
 */
async function loadChromium(target) {
  try {
    return (await import('@playwright/test')).chromium;
  } catch { /* not beside the dev host */ }
  const abs = resolve(target);
  for (const base of [join(abs, 'package.json'), join(dirname(abs), 'package.json')]) {
    try {
      const m = await import(pathToFileURL(createRequire(base).resolve('@playwright/test')).href);
      return m.chromium ?? m.default?.chromium ?? null;
    } catch { /* not there either */ }
  }
  return null;
}

/**
 * @param {{ target: string, port: number, filesPort: number, watch: boolean, seconds: number | null, play: number[], uiPreview: string | null, cyber?: string[] }} o
 * @param {{ stdout: NodeJS.WritableStream, stderr: NodeJS.WritableStream, stdin: NodeJS.ReadableStream }} io
 */
export async function runHeadless(o, io) {
  const line = (e) => io.stdout.write(`${JSON.stringify(e)}\n`);

  // stdin is read from the first moment, so each command's arrival time is when it was written,
  // not when the instance was ready (the queue keeps the spacing).
  /** Commands sent to the page, waiting for its `done`. @type {Map<number, () => void>} */
  const waiting = new Map();
  let seq = 0;
  /** @type {null | { command(c: Record<string, unknown>): void, filesOrigin: string }} */
  let target = null;
  /** The page, once open (`ui-param` drives its frame). @type {null | import('@playwright/test').Page} */
  let pageRef = null;
  /** False when the instance never started: commands are then skipped, not sent. */
  let live = true;
  /** @type {() => void} */
  let done = () => {};
  const finished = new Promise((r) => { done = () => r(undefined); });
  const queue = commandQueue({
    quit: () => done(),
    dispatch: (c) => new Promise((resolve) => {
      if (!live || !target) { line({ type: 'error', phase: 'command', message: `no instance: ${String(c.cmd)} skipped` }); resolve(); return; }
      if (c.cmd === 'ui-param') {
        if (!pageRef) { line({ type: 'error', phase: 'command', message: 'ui-param: no page' }); resolve(); return; }
        uiParam(pageRef, new URL(target.filesOrigin).origin, c, line).then(resolve, (err) => { line({ type: 'error', phase: 'command', message: err instanceof Error ? err.message : String(err) }); resolve(); });
        return;
      }
      const n = ++seq;
      const timer = setTimeout(() => {
        waiting.delete(n);
        line({ type: 'error', phase: 'command', message: `${String(c.cmd)} did not finish in ${COMMAND_TIMEOUT_MS / 1000} s; going on` });
        resolve();
      }, COMMAND_TIMEOUT_MS);
      waiting.set(n, () => { clearTimeout(timer); resolve(); });
      target.command({ ...c, seq: n });
    }),
  });
  for (const c of playCommands(o.play)) queue.push(c);
  let inputClosed = false;
  /** @type {() => void} */
  let closed = () => {};
  const inputEnd = new Promise((r) => { closed = () => r(undefined); });
  const rl = createInterface({ input: io.stdin });
  rl.on('line', (raw) => {
    const s = raw.trim();
    if (!s) return;
    let c;
    try { c = JSON.parse(s); } catch { line({ type: 'error', phase: 'command', message: `not JSON: ${s.slice(0, 80)}` }); return; }
    if (!c || typeof c !== 'object' || Array.isArray(c)) { line({ type: 'error', phase: 'command', message: `not a command: ${s.slice(0, 80)}` }); return; }
    queue.push(c);
  });
  rl.on('close', () => { inputClosed = true; closed(); });

  const chromium = await loadChromium(o.target);
  if (!chromium) {
    rl.close();
    io.stderr.write('est dev --json needs Playwright\'s Chromium (an optional peer of @cyber-est/cli): npm install --save-dev --save-exact @playwright/test@1.64.1, then npx playwright install chromium (est doctor checks)\n');
    return 1;
  }

  const onEvent = (e) => {
    line(e);
    if (e && e.type === 'done' && typeof e.seq === 'number') { waiting.get(e.seq)?.(); waiting.delete(e.seq); }
  };

  let host;
  try {
    // DEV-E (1.325): with --cyber, Cyber may follow a headless run too; its attach is a `cyber` line.
    host = await startDevHost({ target: o.target, hostPort: o.port, filesPort: o.filesPort, watch: o.watch, uiPreview: o.uiPreview ?? undefined, cyber: o.cyber ?? [], onEvent, log: () => {} });
  } catch (err) {
    rl.close();
    line({ type: 'error', phase: 'start', message: startMessage(err) });
    return 1;
  }
  target = host;
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  let failed = false;
  try {
    const page = await browser.newPage();
    pageRef = page;
    const files = new URL(host.filesOrigin).origin;
    const inFiles = (url) => { try { return new URL(url).origin === files; } catch { return false; } };
    // The custom UI's frame is on the files origin: its console, its errors and its failed loads are the UI's.
    page.on('console', (m) => {
      const url = m.location()?.url ?? '';
      const type = m.type();
      if (inFiles(url)) { if (type === 'error' || type === 'warning') line({ type: 'ui', event: 'console', level: type, text: m.text(), url }); return; }
      if (type === 'error') line({ type: 'console', level: 'error', text: m.text() });
    });
    page.on('pageerror', (err) => {
      // A frame's uncaught error arrives here too: its stack names the frame's files.
      const at = String(err.stack ?? '').match(/https?:\/\/[^\s)]+/)?.[0] ?? '';
      if (inFiles(at)) { line({ type: 'ui', event: 'error', message: err.message, url: at.replace(/:\d+:\d+$/, '') }); return; }
      failed = true;
      line({ type: 'error', phase: 'page', message: err.message });
    });
    page.on('response', (r) => { if (inFiles(r.url()) && r.status() >= 400) line({ type: 'ui', event: 'http', status: r.status(), url: r.url() }); });
    page.on('requestfailed', (r) => { if (inFiles(r.url())) line({ type: 'ui', event: 'http', status: null, url: r.url(), failure: r.failure()?.errorText ?? null }); });
    await page.goto(`${host.url}/?json=1&autostart=1`);
    line({ type: 'host', url: host.url, files: host.filesOrigin });

    // The page's phase: 'running' (an instance, or a UI preview) or 'failed'.
    const phase = () => /** @type {any} */ (globalThis).document.querySelector('[data-phase]')?.getAttribute('data-phase') ?? '';
    const running = await page.waitForFunction(`['running', 'failed'].includes((${phase})())`, undefined, { timeout: 90_000 })
      .then(() => page.evaluate(`(${phase})() === 'running'`))
      .catch(() => false);
    // The page posts its events in batches: let the last one (the install check's line) arrive first.
    if (!running) await new Promise((r) => setTimeout(r, 300));
    if (!running) { failed = true; live = false; line({ type: 'error', phase: 'start', message: 'the instance did not start (see the install line above)' }); }
    queue.start();

    if (o.seconds !== null) setTimeout(() => done(), o.seconds * 1000);
    else {
      void (async () => {
        if (!o.play.length && !inputClosed) await inputEnd;
        await queue.idle();
        await new Promise((r) => setTimeout(r, LINGER_MS));
        done();
      })();
    }
    await finished;
    rl.close();
    // The page's last batch of events.
    await new Promise((r) => setTimeout(r, 250));
  } finally {
    rl.close();
    for (const w of waiting.values()) w();
    await browser.close().catch(() => {});
    await host.close();
  }
  const check = failed ? 1 : 0;
  return host.build().ok ? check : 1;
}
