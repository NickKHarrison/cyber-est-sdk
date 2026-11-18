import { frameAttended, frameCommitBudget, writeCost } from './frameCommitBudget';
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { SHARED_SHIELD_WORDS, armShared, isSharedRecord, sharedArmed, shieldDrops, shieldKeyNow, subscribeSharedShield } from './sharedShield';
import { noteEstInstanceFrame } from '../../audio/est/instanceState';
import type { EstParam } from '../../audio/est/EstNode';
import type { EstInstalled } from '../../audio/est/library';
import type { EstEdit } from './estHooks';
import {
  DEFAULT_THEME, METER_PER_SECOND, isWrapHello, bundleUiUrl, checkFrameMessage, checkKeyMessage, frameWrapUrl, initMessage, meterMessage, newNonce, paramMessage, rateGate,
  spectrumMessage, themeMessage, themeOf, tokenHex, withFragment, type EstUiTheme, type EstUiVersion, type FrameKey,
} from './estFrameProtocol';
import { postFrom } from '../../lib/realmPost';
import { noteEstOriginBlocked, noteEstOriginOk, probeEstOrigin, type EstProbeCode } from '../../audio/est/originReach';

/**
 * EST Phase 2, stream 2-C (docs/est/EST_Phase2_Work_Order.md §3 "The window"; EST_SECURITY_ARCHITECTURE.md
 * §4): a plugin's own UI, in exactly the frame Phase 1 proved (e2e/est-frame.spec.ts):
 * `<iframe sandbox="allow-scripts" allow="" referrerpolicy="no-referrer">` on the plugin origin, at
 * `/est/b/<bundle hash>/<ui.path>` (or, EST Phase 5a 5-B, D-45, a developer bundle's
 * `/est/dev/<bundle hash>/<ui.path>`: `uiUrl`, from `uiUrlFor`), the per-instance nonce and this
 * page's origin in the fragment. Without `allow-same-origin` the frame's origin is opaque: it
 * reaches no storage, no cookie and no other frame, and the host's chrome (the window's title, the
 * switch, the badge) stays outside it.
 *
 * 1.413: the frame here is the plugin origin's **frame wrapper** (`frameWrapUrl`,
 * server/estFrameWrap.mjs, `/est/frame/<b|dev|studio>/<hash>/<ui.path>`), a fixed page of Cyber's
 * that frames the UI page (still `sandbox="allow-scripts"`, opaque) under a `frame-src` naming that
 * page alone, so the plugin's own navigations of its frame are checked against the wrapper's policy,
 * never this page's (whose `frame-src` holds Google sign-in and YouTube); it relays messages both
 * ways without reading them. The wrapper is the plugin origin's (`allow-scripts allow-same-origin`
 * here and in its own CSP: Chromium refuses every `frame-ancestors` under an opaque ancestor), so
 * inbound messages are taken only from this frame's window with exactly the plugin origin (before
 * 1.413, `"null"`), then checked by `checkFrameMessage` (schema, nonce, size, the parameter's range)
 * and a rate gate; refusals are counted (`data-rejected`). Parameter changes are coalesced to the animation frame and heard at
 * once (`edit.preview`); they are written once (`edit.write`, one undo step and one live change)
 * when a gesture ends (`est:gesture`) or after `QUIET_MS` without one. Changes from anywhere else
 * (a knob, automation, a collaborator) are posted to the frame (targetOrigin the plugin origin, the
 * wrapper's; `'*'` before 1.413, when the frame itself was opaque).
 *
 * Protocol version 2 (5-B): the host answers in the version the frame last spoke (`data-ui-version`).
 * To a version-2 frame `est:init` adds the sample rate (`rate`), the theme (Cyber's `--cyber-0`,
 * `--foreground` and `--cyber-accent` where the frame sits, checked once a second and sent as
 * `est:theme` on a change) and `meters`; `est:meter` comes at most 30 times a second from `meters`
 * (the strip's own meter reading: no analyser of the frame's), only while this is mounted and the
 * page is visible, and only when the levels changed. EST 1.1 (1.327), version 3: a frame whose
 * est.json says `ui.audio` may ask `est:audio { fftSize, rate }` and gets `est:spectrum` from the
 * host's own analyser on the plugin's output (`audio`, opened on asking, closed on stop or unmount;
 * magnitudes and RMS, never samples); `est:resize` sizes the frame when the
 * manifest's `ui.resizable` (within the manifest's bounds, the window's width still capping it).
 */

/**
 * 1.346: a key the frame guard handed back (`checkKeyMessage`), dispatched on the frame's element
 * as a key event of the page's, so every page listener hears it as a key pressed with the frame
 * focused (the computer keys, Space's transport, the pad keys; what they reserve, they reserve).
 * Nothing while the frame does not have the page's focus, or (1.662) the page the system's. 1.662:
 * Escape too, so the window or dialog around the frame closes. Exported for tests.
 */
export function playFrameKey(el: HTMLIFrameElement | null, k: FrameKey): boolean {
  // 1.495: the frame's own document (a popped-out window's popup for a frame drawn there).
  if (!el || typeof document === 'undefined' || el.ownerDocument.activeElement !== el) return false;
  // 1.662: and that document has the system focus. The frame stays the active element while the person
  // is in another tab, window or app (or the page's other window), and a plugin's script can post
  // what the guard posts (the nonce is in its own address): no key then.
  if (typeof el.ownerDocument.hasFocus === 'function' && !el.ownerDocument.hasFocus()) return false;
  el.dispatchEvent(new KeyboardEvent(k.down ? 'keydown' : 'keyup', {
    key: k.key, code: k.code, shiftKey: k.shift, repeat: k.repeat, bubbles: true, cancelable: true, composed: true,
  }));
  return true;
}

/** A burst of the frame's parameter messages outside a gesture is written once it has been quiet this long. */
export const QUIET_MS = 300;
/**
 * 1.314 (EST-15): a gesture's end commits at most this often: a frame that sends `param`, `begin`,
 * `end` 240 times a second used to make about 80 undo steps (and live-room writes) a second; now a
 * commit within `COMMIT_MS` of the last waits for the rest of it (folded into the quiet timer), so
 * there are at most four `edit.write`s a second and the last value always lands.
 */
export const COMMIT_MS = 250;
/**
 * 1.630 (docs/launch/network-filters.md): how long the frame has to prove it loaded (its wrapper's
 * first message from exactly the plugin origin) before a failed probe of the origin counts as a
 * network that blocks it. A cross-origin `load` is no proof: Chromium fires it for its own refused page.
 */
export const HANDSHAKE_MS = 4000;
/** How often the theme tokens are read again (a change is sent as `est:theme`). */
export const THEME_CHECK_MS = 1000;

/**
 * EST 1.1 (protocol v3): an analyser on the plugin's output, opened for one FFT size: `read` fills
 * the magnitudes (dB, `fftSize / 2`) and the RMS `[l, r]` (false: nothing to read yet); `close` lets go.
 */
export type EstAudioTap = (fftSize: number) => { read(db: Float32Array<ArrayBuffer>, rms: Float32Array): boolean; close(): void } | null;

/**
 * EST 1.1 (protocol v3): the host's own analysers on `src` (a plugin's output) for one FFT size: a
 * mono analyser for the magnitudes, a splitter and two for the RMS. Made on asking, disconnected
 * on `close`. Shared by Cyber (`estAudioTap`) and the SDK's dev host.
 */
export function analyserTap(src: AudioNode, fftSize: number): ReturnType<EstAudioTap> {
  const ctx = src.context;
  const mk = () => { const a = ctx.createAnalyser(); a.fftSize = fftSize; a.smoothingTimeConstant = 0.6; return a; };
  const mono = mk(), left = mk(), right = mk();
  const split = ctx.createChannelSplitter(2);
  src.connect(mono);
  src.connect(split);
  split.connect(left, 0);
  split.connect(right, 1);
  const t = new Float32Array(fftSize);
  const rmsOf = (a: AnalyserNode) => { a.getFloatTimeDomainData(t); let s = 0; for (let i = 0; i < t.length; i++) s += t[i]! * t[i]!; return Math.sqrt(s / t.length); };
  return {
    read(db, rms) {
      mono.getFloatFrequencyData(db);
      rms[0] = rmsOf(left);
      rms[1] = rmsOf(right);
      return true;
    },
    close() {
      for (const n of [mono, left, right, split]) { try { n.disconnect(); } catch { /* gone */ } }
      try { src.disconnect(mono); } catch { /* gone */ }
      try { src.disconnect(split); } catch { /* gone */ }
    },
  };
}

/** The strip's post-fader peaks now into `out[0]`, `out[1]` (false: nothing to read yet). */
export type EstMeterRead = (out: Float32Array) => boolean;

/** Cyber's colour tokens where `el` sits, as the frame's theme. */
function themeAt(el: Element | null): EstUiTheme {
  if (!el || typeof getComputedStyle !== 'function') return DEFAULT_THEME;
  const cs = getComputedStyle(el);
  const t = (name: string) => tokenHex(cs.getPropertyValue(name)) ?? undefined;
  return themeOf({ bg: t('--cyber-0'), fg: t('--foreground'), accent: t('--cyber-accent') });
}

const sameTheme = (a: EstUiTheme, b: EstUiTheme) => a.bg === b.bg && a.fg === b.fg && a.accent === b.accent;

/**
 * 1.330: where the frame hears what the plugin itself reported: its read-only parameters (a
 * readout) change without a write, so they come from the running instance, not the song.
 */
export interface EstReadout { read: () => readonly EstParam[] | null; subscribe: (fn: () => void) => () => void }

/** CLAP's read-only flag (clap/ext/params.h). */
const READONLY = 8;

export function EstPluginFrame({ installed, params, edit, origin, title, uiUrl, rate = null, meters = null, audio = null, readout = null, onBlocked = null, instance = null }: {
  installed: EstInstalled; params: readonly EstParam[]; edit: EstEdit; origin: string; title: string;
  /** The UI page's address without a fragment (`uiUrlFor`); default the bundle's on the plugin origin. */
  uiUrl?: string | null;
  /** The sample rate the plugin runs at (Hz), for a version-2 frame's `est:init`. */
  rate?: number | null;
  /** The strip's meter (version 2's `est:meter`); none: `meters: false` in `est:init`. */
  meters?: EstMeterRead | null;
  /** EST 1.1 (protocol v3): the plugin's output for `est:audio`; none, or a bundle without `ui.audio`: refused. */
  audio?: EstAudioTap | null;
  /** 1.330: the running instance's values, for the plugin's read-only parameters (`EstReadout`). */
  readout?: EstReadout | null;
  /** 1.630: the frame never answered and the plugin origin could not be read (`HANDSHAKE_MS`, `probeEstOrigin`). */
  onBlocked?: ((code: EstProbeCode) => void) | null;
  /** 1.663: the slot whose instance this frame shows: its fallback noted on the instance's record (instanceState.ts' `frame`), never its state. */
  instance?: { stripId: string; slotId: string } | null;
}) {
  const ui = installed.manifest.ui!;
  // 1.795 (D-64): a shared plugin's window is shielded until the first press (sharedShield.ts): the host's
  // own layer over the frame, and every writing message dropped meanwhile.
  const shieldKey = isSharedRecord(installed) ? shieldKeyNow(installed.ref.hash) : null;
  const armedNow = useSyncExternalStore(subscribeSharedShield, () => (shieldKey ? sharedArmed(shieldKey) : true));
  const shielded = !!shieldKey && !armedNow;
  const shieldedRef = useRef(shielded);
  shieldedRef.current = shielded;
  const [dropped, setDropped] = useState(0);
  const [nonce] = useState(newNonce);
  const frame = useRef<HTMLIFrameElement>(null);
  const hostEl = useRef<HTMLDivElement>(null);
  const [rejected, setRejected] = useState(0);
  const [version, setVersion] = useState<EstUiVersion>(1);
  const [size, setSize] = useState({ w: ui.w, h: ui.h });
  const page = uiUrl ?? bundleUiUrl(origin, installed.ref.hash, ui.path);
  // 1.413: the frame is the plugin origin's wrapper, which frames the page (see above).
  const wrap = useMemo(() => frameWrapUrl(page), [page]);
  const src = useMemo(() => (wrap ? withFragment(wrap, nonce, location.origin) : null), [wrap, nonce]);
  /** The wrapper's origin: the only origin its messages may come from, and the only one posted to. */
  const frameOrigin = wrap ? new URL(wrap).origin : null;
  const frameOriginRef = useRef(frameOrigin);
  frameOriginRef.current = frameOrigin;
  // The latest of everything the listener reads, without re-subscribing.
  const audioOk = installed.manifest.uiAudio === true && !!audio;
  const live = useRef({ params, edit, rate, meters, resizable: ui.resizable, audio, audioOk });
  live.current = { params, edit, rate, meters, resizable: ui.resizable, audio, audioOk };
  /** What the frame has (values it sent or was sent), so a change is posted once and never echoed back. */
  const known = useRef<Record<string, number>>({});
  /** The version the frame last spoke (the host answers in it). */
  const ver = useRef<EstUiVersion>(1);
  /** The theme the frame was last given (version 2). */
  const theme = useRef<EstUiTheme | null>(null);
  const sendInitRef = useRef<() => void>(() => {});
  // 1.630: the handshake. The wrapper's first message from exactly the plugin origin proves the frame
  // loaded (its hello, or any message it relays: an older wrapper says no hello). Until then a probe
  // of the origin runs; a redirect or a timeout falls back at once, a failed read at `HANDSHAKE_MS`.
  const [blocked, setBlocked] = useState<EstProbeCode | null>(null);
  const handshaken = useRef(false);
  const onBlockedRef = useRef(onBlocked);
  onBlockedRef.current = onBlocked;
  const instanceRef = useRef(instance);
  instanceRef.current = instance;
  const handshakeRef = useRef<() => void>(() => {});
  /** 1.658: the frame proved it loaded (or a quiet page on a reachable origin was kept): drawn only then. */
  const [revealed, setRevealed] = useState(false);
  /** 1.658: the frame's load, counted: one more after a quiet first load on a reachable origin. */
  const [attempt, setAttempt] = useState(0);

  // 1.551: posted as the code of the window the frame is drawn in (a popped-out window's popup), so
  // the message's `source` is the frame's parent, which is all the wrapper relays (`realmPost.ts`).
  const post = (m: unknown) => {
    const o = frameOriginRef.current;
    const el = frame.current;
    const target = el?.contentWindow;
    if (o && el && target) postFrom(el.ownerDocument.defaultView, target, m, o);
  };

  useEffect(() => {
    const gate = rateGate();
    let batch: Record<string, number> = {};
    let raf = 0;
    let quiet: ReturnType<typeof setTimeout> | null = null;
    let uncommitted: Record<string, number> = {};
    const gestures = new Set<number>();
    let lastCommit = -Infinity;
    const budget = frameCommitBudget();
    /** A gesture that began with a real input behind it: its end's write is attended however long the drag. */
    let gestureAttended = false;
    /** Write what is uncommitted now (the unmount, or a commit whose turn has come). */
    const commitNow = () => {
      if (quiet) { clearTimeout(quiet); quiet = null; }
      const p = uncommitted;
      uncommitted = {};
      if (Object.keys(p).length) { lastCommit = Date.now(); live.current.edit.write(p); }
    };
    /** 1.314 (EST-15): a commit at most every COMMIT_MS; an early one waits out the rest of it. */
    // The sandbox attack order (stream E): and within the frame's budget (`frameCommitBudget.ts`): a write
    // with no real input behind it (the page's user activation, now or when its gesture began) is rare,
    // one with it bounded, so a window's own script cannot flood the undo history or a live room's doc.
    // A write that waits loses nothing: its values stay previewed and go in the next one.
    const commit = () => {
      if (!Object.keys(uncommitted).length) { commitNow(); return; }
      const now = Date.now();
      const attended = gestureAttended || frameAttended(frame.current?.ownerDocument.defaultView);
      // Charged by what it holds (`writeCost`): a slower write may not simply be a larger one.
      const cost = writeCost(Object.keys(uncommitted).length);
      const wait = Math.max(COMMIT_MS - (now - lastCommit), budget.wait(attended, now, cost));
      if (wait > 0) {
        if (quiet) clearTimeout(quiet);
        // Looked at again within a second: an input meanwhile makes the write an attended one.
        quiet = setTimeout(commit, Math.min(wait, 1000));
        return;
      }
      budget.take(attended, now, cost);
      gestureAttended = false;
      commitNow();
    };
    const flush = () => {
      raf = 0;
      const b = batch;
      batch = {};
      if (!Object.keys(b).length) return;
      uncommitted = { ...uncommitted, ...b };
      live.current.edit.preview(uncommitted);
      if (quiet) clearTimeout(quiet);
      if (!gestures.size) quiet = setTimeout(commit, QUIET_MS);
    };
    const refuse = () => setRejected(n => n + 1);
    /** `est:init` with every shown parameter at the slot's values: on the frame's load, and again when it asks (`est:ready`). */
    const sendInit = () => {
      const values = live.current.params.map(p => ({ ...p, value: live.current.edit.values[String(p.id)] ?? p.value }));
      if (ver.current >= 2) {
        theme.current = themeAt(hostEl.current);
        post(initMessage(nonce, values, { rate: live.current.rate, theme: theme.current, meters: !!live.current.meters, ...(ver.current === 3 ? { audio: live.current.audioOk } : {}) }));
      } else {
        post(initMessage(nonce, values));
      }
      for (const p of values) known.current[String(p.id)] = p.value;
    };
    sendInitRef.current = sendInit;
    const el = frame.current;
    const onMessage = (e: MessageEvent) => {
      const win = frame.current?.contentWindow;
      if (!win || e.source !== win) return; // not this frame's: not ours to count
      if (!frameOriginRef.current || e.origin !== frameOriginRef.current) { refuse(); return; }
      // 1.630: anything from the wrapper, on the plugin origin, is the handshake; its hello is only that.
      handshakeRef.current();
      if (isWrapHello(e.data)) return;
      if (!gate()) { refuse(); return; }
      // 1.346: a key the frame guard hands back: played as the page's own key, only while the frame
      // has the focus (so a plugin cannot press keys while the person is elsewhere).
      const key = checkKeyMessage(e.data, nonce);
      if (key) {
        if (shieldedRef.current) { setDropped(n => n + 1); return; } // 1.795: a shielded window plays nothing
        playFrameKey(frame.current, key);
        return;
      }
      const m = checkFrameMessage(e.data, nonce, live.current.params, live.current.resizable, live.current.audioOk);
      if (!m) { refuse(); return; }
      // 1.795 (D-64): before the first press a shared plugin's window writes nothing (its values, gestures).
      if (shieldedRef.current && shieldDrops(m.type)) { setDropped(n => n + 1); return; }
      if (ver.current !== m.v) { ver.current = m.v; setVersion(m.v); }
      if (m.type === 'est:ready') { sendInit(); return; }
      if (m.type === 'est:resize') { setSize({ w: m.w, h: m.h }); return; }
      if (m.type === 'est:audio') { listen(m.fftSize, m.rate); return; }
      if (m.type === 'est:gesture') {
        if (m.phase === 'begin') { gestures.add(m.id); if (frameAttended(frame.current?.ownerDocument.defaultView)) gestureAttended = true; }
        else { gestures.delete(m.id); if (!gestures.size) { if (raf) { cancelAnimationFrame(raf); flush(); } commit(); } }
        return;
      }
      known.current[String(m.id)] = m.value;
      batch[String(m.id)] = m.value;
      if (!raf) raf = requestAnimationFrame(flush);
    };
    // EST 1.1 (version 3): the plugin's output for the frame, from the host's analyser (never samples).
    let tap: ReturnType<EstAudioTap> = null;
    let audioTimer: ReturnType<typeof setInterval> | null = null;
    const stopAudio = () => { if (audioTimer) clearInterval(audioTimer); audioTimer = null; tap?.close(); tap = null; };
    function listen(fftSize: number, perSecond: number) {
      stopAudio();
      if (perSecond <= 0 || !live.current.audio) return;
      tap = live.current.audio(fftSize);
      if (!tap) return;
      const db = new Float32Array(fftSize / 2), rms = new Float32Array(2);
      audioTimer = setInterval(() => {
        if (!tap || (typeof document !== 'undefined' && document.visibilityState === 'hidden')) return;
        let ok: boolean;
        try { ok = tap.read(db, rms); } catch { ok = false; }
        if (ok) post(spectrumMessage(nonce, db, rms));
      }, Math.ceil(1000 / perSecond));
    }
    // 1.495: the frame posts to its parent, the window it is drawn in: a popped-out window's popup
    // for one there (the same origin as the page). Its own messages only (`e.source` above).
    const host = el?.ownerDocument.defaultView ?? window;
    host.addEventListener('message', onMessage);
    // Version 2: the theme once a second (sent when it changed), the meters at most 30 a second.
    const themeTimer = setInterval(() => {
      if (ver.current < 2 || !theme.current) return;
      const now = themeAt(hostEl.current);
      if (sameTheme(now, theme.current)) return;
      theme.current = now;
      post(themeMessage(nonce, now, ver.current as 2 | 3));
    }, THEME_CHECK_MS);
    const levels = new Float32Array(2);
    const last = [-1, -1];
    const meterTimer = setInterval(() => {
      const read = live.current.meters;
      if (ver.current < 2 || !read || (typeof document !== 'undefined' && document.visibilityState === 'hidden')) return;
      let ok: boolean;
      try { ok = read(levels); } catch { ok = false; }
      if (!ok) { levels[0] = 0; levels[1] = 0; }
      const m = meterMessage(nonce, levels, null, ver.current as 2 | 3);
      if (m.out[0] === last[0] && m.out[1] === last[1]) return;
      last[0] = m.out[0]!; last[1] = m.out[1]!;
      post(m);
    }, Math.ceil(1000 / METER_PER_SECOND));
    return () => {
      host.removeEventListener('message', onMessage);
      clearInterval(themeTimer);
      clearInterval(meterTimer);
      stopAudio();
      if (raf) { cancelAnimationFrame(raf); flush(); }
      commitNow();
    };
  }, [nonce]);

  // 1.630: the handshake's clock and the probe (see above), for each address the frame loads.
  // 1.658 (the network failure simulation, e2e/netFail.ts): the frame is drawn hidden until it proves it
  // loaded (`revealed`), so a blocked load never shows the browser's own error page, even for the
  // handshake's few seconds; at `HANDSHAKE_MS` without a handshake the origin is probed **afresh** (a
  // cached OK may be stale: the network changed since), and on a reachable origin the frame is loaded
  // once more (`attempt`: a load that failed on a passing blip recovers with no reload of the page);
  // only a second quiet load on a reachable origin is shown as it is (a page that says nothing).
  useEffect(() => {
    if (!src) return;
    let done = false;
    handshaken.current = false;
    setBlocked(null);
    setRevealed(false);
    const fail = (code: EstProbeCode) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      noteEstOriginBlocked(origin, code, true);
      setBlocked(code);
      if (instanceRef.current) noteEstInstanceFrame(instanceRef.current.stripId, instanceRef.current.slotId, 'fallback');
      onBlockedRef.current?.(code);
    };
    handshakeRef.current = () => {
      if (handshaken.current) return;
      handshaken.current = true;
      done = true;
      clearTimeout(timer);
      setRevealed(true);
      noteEstOriginOk(origin);
      if (instanceRef.current) noteEstInstanceFrame(instanceRef.current.stripId, instanceRef.current.slotId, 'own');
    };
    // review2 C-1: the frame's address is the wrapper's (`frameWrapUrl`: /est/frame/b/<hash>/…), so the bundle's hash is read there.
    const kindB = /\/est\/(?:frame\/)?b\/([0-9a-f]{64})\//.exec(src)?.[1] ?? null;
    const probe = probeEstOrigin(origin, kindB);
    void probe.then(r => { if (r.code === 'filter-redirect' || r.code === 'timeout') fail(r.code); });
    const timer = setTimeout(() => {
      if (done) return;
      void probeEstOrigin(origin, kindB, { fresh: true }).then(r => {
        if (done) return;
        if (r.code !== 'ok') { fail(r.code); return; }
        done = true;
        if (attempt === 0) setAttempt(1); // the origin reads: load the frame once more
        else setRevealed(true); // a quiet plugin page on a reachable origin, kept
      });
    }, HANDSHAKE_MS);
    return () => { done = true; clearTimeout(timer); handshakeRef.current = () => {}; };
  }, [src, origin, attempt]);

  // A new sample rate (the engine's context made again): a version-2 frame hears it in a fresh est:init.
  const sentRate = useRef(rate);
  useEffect(() => {
    if (sentRate.current === rate) return;
    sentRate.current = rate;
    if (ver.current >= 2) sendInitRef.current();
  }, [rate]);

  // 1.330: the plugin's readout (its read-only parameters) as it reports it, at most a frame apart.
  useEffect(() => {
    if (!readout || !params.some(p => p.flags & READONLY)) return;
    let raf = 0;
    const send = () => {
      raf = 0;
      const now = readout.read();
      if (!now) return;
      for (const p of now) {
        if (!(p.flags & READONLY)) continue;
        const k = String(p.id);
        if (!(k in known.current) || known.current[k] === p.value) continue;
        known.current[k] = p.value;
        post(paramMessage(nonce, p.id, p.value, ver.current));
      }
    };
    const off = readout.subscribe(() => { if (!raf) raf = requestAnimationFrame(send); });
    return () => { off(); if (raf) cancelAnimationFrame(raf); };
  }, [readout, params, nonce]);

  // A value changed elsewhere: tell the frame (only what it does not have).
  useEffect(() => {
    for (const p of params) {
      const k = String(p.id);
      const v = edit.values[k];
      if (v === undefined || !(k in known.current) || known.current[k] === v) continue;
      known.current[k] = v;
      post(paramMessage(nonce, p.id, v, ver.current));
    }
  }, [edit.values, params, nonce]);

  return (
    <div ref={hostEl} className="relative flex min-h-0 flex-1 items-start justify-center overflow-auto bg-cyber-0" data-testid="est-frame-host" data-rejected={rejected} data-ui-version={version} data-shield={shieldKey ? (shielded ? 'on' : 'off') : undefined} data-dropped={shieldKey ? dropped : undefined}>
      {blocked ? <p role="note" className="p-4 text-sm" data-testid="est-frame-blocked" data-probe={blocked}>This plugin&apos;s own window needs the plugin site, which your network blocks. Sound and saving work as usual.</p> : src ? <>
      {!revealed && <p role="status" className="absolute p-4 text-[11px] text-muted-foreground" data-testid="est-frame-opening">Opening the plugin&apos;s own window…</p>}
      <iframe
        key={attempt}
        ref={frame}
        src={src}
        // 1.658: the wrapper's load (once per attempt: `key`), sending est:init (a frame drawn again by
        // `attempt` is a new element, so a listener added once would never hear it).
        onLoad={() => sendInitRef.current()}
        data-shown={revealed ? 'true' : 'false'}
        data-attempt={attempt}
        sandbox="allow-scripts allow-same-origin"
        allow=""
        referrerPolicy="no-referrer"
        title={title}
        data-testid="est-frame"
        className="block flex-none border-0 bg-cyber-0"
        style={{ width: size.w, height: size.h, maxWidth: '100%', visibility: revealed ? undefined : 'hidden' }}
      />
      {shielded && shieldKey && (
        // 1.795 (D-64): the host's own layer over a shared plugin's frame until the first press. Transparent
        // over the plugin (it draws underneath), its words on a strip; a click or Enter lifts it.
        <button
          type="button"
          className="absolute inset-0 flex cursor-pointer items-end justify-center bg-transparent p-2 focus-visible:outline focus-visible:outline-2"
          aria-label={SHARED_SHIELD_WORDS}
          data-testid="est-frame-shield"
          onClick={() => armShared(shieldKey)}
        >
          <span className="rounded bg-cyber-0/90 px-2 py-1 text-[11px] text-foreground shadow">{SHARED_SHIELD_WORDS}</span>
        </button>
      )}</> : <p className="p-4 text-sm" data-testid="est-frame-unavailable">This plugin's own page is not on the plugin origin, so it cannot be shown.</p>}
    </div>
  );
}
