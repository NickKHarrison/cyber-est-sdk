/**
 * EST Phase 2, stream 2-C: the host's side of a plugin UI's messages (EST_SECURITY_ARCHITECTURE.md
 * §4; EST_SPECIFICATION_DRAFT.md §8; Phase 1's e2e/est/probe/host.js, proven in
 * e2e/est-frame.spec.ts). Pure: the checks every inbound message passes, so they are tested alone.
 *
 * The frame is `<iframe sandbox="allow-scripts">` on the plugin origin: its origin is opaque, so a
 * message from it arrives with `origin === "null"` and the host posts to it with targetOrigin
 * `'*'` (Phase 1's finding); what binds a message to its frame is the sender (`event.source` is
 * that frame's window) and a per-instance nonce, carried to the frame in its URL's fragment.
 *
 * Messages, every one `{ v, type, nonce, … }` with exactly these keys:
 * - frame → host (`v` 1 or 2): `est:ready {}` (send me `est:init`), `est:param { id, value }` (a CLAP
 *   param id, a plain value within the parameter's range), `est:gesture { id, phase: 'begin' | 'end' }`;
 *   version 2 only: `est:resize { w, h }` (whole CSS pixels within `UI_SIZE_BOUNDS`, taken only when
 *   the manifest's `ui.resizable`).
 * - host → frame: `est:init { params: [{ id, name, module, min, max, def, flags, value, scale? }] }` (2-D's
 *   EST Delay UI reads `id` and `value`; the rest is for UIs that draw their own controls), sent on the
 *   frame's load and again on `est:ready`, `est:param { id, value }` (a change from anywhere else: a
 *   knob, automation, a collaborator).
 * - EST Phase 5a (5-B), **version 2**: `est:init` also carries `rate` (the context's sample rate, Hz,
 *   or null when no context runs), `theme` (`{ bg, fg, accent }`, `#rrggbb` from Cyber's tokens) and
 *   `meters` (whether `est:meter` will come); `est:meter { in, out }` (each `[l, r]` a linear peak,
 *   0…MAX_METER; `in` is null where Cyber meters no input: a strip's meter is post-fader only) at
 *   most `METER_PER_SECOND` while the window is open; `est:theme { theme }` when the tokens change.
 *
 * - EST 1.1 (1.327, DEV-H, D-56), **version 3: the UI sees audio.** A frame whose bundle's est.json
 *   says `ui.audio: true` may send `est:audio { fftSize, rate }` (`fftSize` a power of two in
 *   `AUDIO_FFT_SIZES`, `rate` 1…`AUDIO_PER_SECOND` a second; `rate` 0 stops); the host answers with
 *   `est:spectrum { bins, rms }` at that rate while the window is open and the page visible:
 *   `bins` the magnitudes of the plugin's output in dB (`fftSize / 2` of them, whole dB from
 *   `SPECTRUM_FLOOR_DB` to 0), `rms` `[l, r]` linear (4 places), from the host's own analysers on the
 *   plugin's output. **Never samples** (EST_SECURITY_ARCHITECTURE.md §4: what the frame may learn
 *   of the audio is bounded; rounded magnitudes 30 times a second cannot be turned back into the
 *   sound a user plays through the plugin). `est:init` in version 3 adds `audio` (whether the host
 *   will answer `est:audio`). A frame of a bundle without `ui.audio`, or a request out of bounds,
 *   is refused and counted. Version 1 and 2 frames are answered in their own version, unchanged.
 *
 * Versions: the host speaks to a frame in the version of the last message it took from it (before
 * any, version 1, so a frame from before Phase 5 never sees a key it does not know); a version-2
 * frame (`@cyber-est/ui` 2) speaks version 1 after a version-1 `est:init` and version 2 after a
 * version-2 one, so either side may be the older.
 * Anything else, a wrong nonce, a key too many, a value out of range, an unknown parameter, more
 * than 64 KiB, or more than `MAX_PER_SECOND` messages in a second, is refused and counted.
 */

import type { EstParam } from '../../audio/est/EstNode';

/** CLAP's read-only flag (clap/ext/params.h): the plugin's own readout. */
const CLAP_PARAM_IS_READONLY = 8;

/** The newest version the host speaks; it still takes (and speaks) versions 1 and 2. EST 1.1 (1.327): 3. */
export const EST_UI_PROTOCOL = 3;
export type EstUiVersion = 1 | 2 | 3;
/** Version 3: the FFT sizes a frame may ask for (the host's analyser's). */
export const AUDIO_FFT_SIZES = [64, 128, 256, 512, 1024, 2048] as const;
/** Version 3: `est:spectrum` at most this many times a second (spec §8: 30 Hz, as the meters). */
export const AUDIO_PER_SECOND = 30;
/** Version 3: a bin's floor (dB); quieter is sent as this. */
export const SPECTRUM_FLOOR_DB = -120;
/** Security §4: a message other than state is at most 64 KiB (as JSON). */
export const MAX_MESSAGE_BYTES = 64 * 1024;
/** A frame may send at most this many messages a second; the rest are dropped (parameter writes are coalesced to the animation frame anyway). */
export const MAX_PER_SECOND = 240;
/** Version 2: the host sends at most this many `est:meter` a second (spec §8: 30 Hz). */
export const METER_PER_SECOND = 30;
/** A meter value is a linear peak; anything above this (+12 dBFS) is sent as this. */
export const MAX_METER = 4;
/** `est:resize`'s bounds: the manifest's own for `ui.size` (EST-M009: w 120–2000, h 80–1400). */
export const UI_SIZE_BOUNDS = { w: [120, 2000], h: [80, 1400] } as const;

export interface EstUiTheme { bg: string; fg: string; accent: string }

export type FrameMessage =
  | { type: 'est:ready'; v: EstUiVersion }
  | { type: 'est:param'; v: EstUiVersion; id: number; value: number }
  | { type: 'est:gesture'; v: EstUiVersion; id: number; phase: 'begin' | 'end' }
  | { type: 'est:resize'; v: 2 | 3; w: number; h: number }
  | { type: 'est:audio'; v: 3; fftSize: number; rate: number };

const KEYS: Record<FrameMessage['type'], string> = {
  'est:ready': 'nonce,type,v',
  'est:param': 'id,nonce,type,v,value',
  'est:gesture': 'id,nonce,phase,type,v',
  'est:resize': 'h,nonce,type,v,w',
  'est:audio': 'fftSize,nonce,rate,type,v',
};
/** What a frame may send in each version (est:resize is version 2's). */
export const FRAME_TYPES: Record<EstUiVersion, readonly FrameMessage['type'][]> = {
  1: ['est:ready', 'est:param', 'est:gesture'],
  2: ['est:ready', 'est:param', 'est:gesture', 'est:resize'],
  3: ['est:ready', 'est:param', 'est:gesture', 'est:resize', 'est:audio'],
};
/** The keys each frame message has, exactly (the dev host's explanations read them). */
export const FRAME_KEYS: Readonly<Record<FrameMessage['type'], readonly string[]>> = Object.fromEntries(
  Object.entries(KEYS).map(([k, v]) => [k, v.split(',')]),
) as unknown as Record<FrameMessage['type'], readonly string[]>;

/** The JSON size of a message (Infinity when it cannot be serialised: a cycle, a function). */
export function messageSize(m: unknown): number {
  try { const s = JSON.stringify(m); return s === undefined ? Infinity : s.length; } catch { return Infinity; }
}

const inBounds = (x: unknown, [lo, hi]: readonly [number, number]): x is number => typeof x === 'number' && Number.isInteger(x) && x >= lo && x <= hi;

/**
 * One inbound message checked against the schema, the nonce, the size cap and the parameters the
 * instance has: the message, or null (refused). The caller has already checked the sender.
 * `resizable`: the manifest's `ui.resizable` (an `est:resize` is refused without it).
 */
export function checkFrameMessage(raw: unknown, nonce: string, params: readonly EstParam[], resizable = false, audio = false): FrameMessage | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  if (messageSize(raw) > MAX_MESSAGE_BYTES) return null;
  const m = raw as Record<string, unknown>;
  if ((m.v !== 1 && m.v !== 2 && m.v !== 3) || typeof m.nonce !== 'string' || m.nonce !== nonce || typeof m.type !== 'string') return null;
  const v = m.v as EstUiVersion;
  if (!(FRAME_TYPES[v] as readonly string[]).includes(m.type)) return null;
  const keys = KEYS[m.type as FrameMessage['type']];
  if (Object.keys(m).sort().join(',') !== keys) return null;
  if (m.type === 'est:ready') return { type: 'est:ready', v };
  if (m.type === 'est:resize') {
    if (!resizable || !inBounds(m.w, UI_SIZE_BOUNDS.w) || !inBounds(m.h, UI_SIZE_BOUNDS.h)) return null;
    return { type: 'est:resize', v: v as 2 | 3, w: m.w, h: m.h };
  }
  if (m.type === 'est:audio') {
    // EST 1.1 (version 3): only a bundle whose est.json says `ui.audio`, within the bounds.
    if (!audio || !(AUDIO_FFT_SIZES as readonly number[]).includes(m.fftSize as number) || !inBounds(m.rate, [0, AUDIO_PER_SECOND])) return null;
    return { type: 'est:audio', v: 3, fftSize: m.fftSize as number, rate: m.rate as number };
  }
  if (typeof m.id !== 'number' || !Number.isInteger(m.id)) return null;
  const p = params.find(x => x.id === m.id);
  // 1.330: a read-only parameter (a plugin's readout) is the plugin's to set, never its UI's.
  if (!p || (p.flags & CLAP_PARAM_IS_READONLY)) return null;
  if (m.type === 'est:gesture') return m.phase === 'begin' || m.phase === 'end' ? { type: 'est:gesture', v, id: p.id, phase: m.phase } : null;
  if (typeof m.value !== 'number' || !Number.isFinite(m.value) || m.value < p.min || m.value > p.max) return null;
  return { type: 'est:param', v, id: p.id, value: m.value };
}

/**
 * 1.346: a key the frame guard (`server/estFrameGuard.mjs`, the host's own script at the head of the
 * plugin's page) hands back to the host: a click in a plugin's window gives the frame the keyboard,
 * and Cyber's computer keys (notes, Z X C V, Space's transport, the pad keys) must keep playing.
 * Not a protocol message of the plugin's: any version, and it never moves the version the host
 * speaks. The host plays it only while the frame has the focus (`EstPluginFrame`).
 */
export interface FrameKey { key: string; code: string; shift: boolean; down: boolean; repeat: boolean }
const KEY_KEYS = 'code,down,key,nonce,repeat,shift,type,v';
/** The codes a forwarded key may carry: a printable key of the main block (the guard's own list). */
export const KEY_CODE_RE = /^(Key[A-Z]|Digit[0-9]|Space|Semicolon|Quote|Comma|Period|Slash|Backslash|BracketLeft|BracketRight|Minus|Equal|Backquote)$/;

/** A forwarded key checked (schema, nonce, a printable key): the key, or null. */
export function checkKeyMessage(raw: unknown, nonce: string): FrameKey | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const m = raw as Record<string, unknown>;
  if (m.type !== 'est:key' || m.v !== 1 || m.nonce !== nonce) return null;
  if (Object.keys(m).sort().join(',') !== KEY_KEYS) return null;
  if (typeof m.key !== 'string' || !/^[\x20-\x7e]$/.test(m.key)) return null;
  if (typeof m.code !== 'string' || !KEY_CODE_RE.test(m.code)) return null;
  if (typeof m.shift !== 'boolean' || typeof m.down !== 'boolean' || typeof m.repeat !== 'boolean') return null;
  return { key: m.key, code: m.code, shift: m.shift, down: m.down, repeat: m.repeat };
}

/** A sliding one-second window of accepted messages: false once a second holds `max`. */
export function rateGate(max = MAX_PER_SECOND, now: () => number = () => performance.now()) {
  const times: number[] = [];
  return () => {
    const t = now();
    while (times.length && t - times[0]! >= 1000) times.shift();
    if (times.length >= max) return false;
    times.push(t);
    return true;
  };
}

/** A fresh per-instance nonce: 16 random bytes in hex. */
export function newNonce(): string {
  const b = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(b, x => x.toString(16).padStart(2, '0')).join('');
}

const encodePath = (p: string) => p.split('/').filter(Boolean).map(encodeURIComponent).join('/');

/** The UI page's address for a bundle the plugin origin holds (`/est/b/<hash>/<ui.path>`). */
export function bundleUiUrl(pluginOrigin: string, hash: string, uiPath: string): string {
  return `${pluginOrigin.replace(/\/+$/, '')}/est/b/${hash}/${encodePath(uiPath)}`;
}

/** 5-B (D-45): the UI page's address for a developer bundle uploaded for this session (`/est/dev/<hash>/<ui.path>`). */
export function devUiUrl(pluginOrigin: string, hash: string, uiPath: string): string {
  return `${pluginOrigin.replace(/\/+$/, '')}/est/dev/${hash}/${encodePath(uiPath)}`;
}

/**
 * 1.413: the frame wrapper's address (server/estFrameWrap.mjs) for a UI page on the plugin origin
 * (`/est/<b|dev|studio>/<hash>/<path>` → `/est/frame/<b|dev|studio>/<hash>/<path>`), or null for any
 * other address. The host frames only the wrapper; the wrapper frames the page, so the page's own
 * navigations are checked against the wrapper's `frame-src` (that page alone), never the app's.
 */
export function frameWrapUrl(pageUrl: string): string | null {
  const m = /^(https?:\/\/[^/?#]+)\/est\/(b|dev|studio)\/([0-9a-f]{64}\/[^?#]+)$/.exec(pageUrl.split('#')[0]!);
  return m ? `${m[1]}/est/frame/${m[2]}/${m[3]}` : null;
}

/** A UI page's address with the nonce and the host's origin in the fragment (any earlier fragment dropped). */
export function withFragment(pageUrl: string, nonce: string, hostOrigin: string): string {
  return `${pageUrl.split('#')[0]}#n=${nonce}&p=${encodeURIComponent(hostOrigin)}`;
}

/** The frame's address: the bundle's UI page on the plugin origin, with the nonce and the host's origin in the fragment. */
export function frameSrc(pluginOrigin: string, hash: string, uiPath: string, nonce: string, hostOrigin: string): string {
  return withFragment(bundleUiUrl(pluginOrigin, hash, uiPath), nonce, hostOrigin);
}

/** Version 2's extra `est:init` fields (version 3: and `audio`). */
export interface InitV2 { rate: number | null; theme: EstUiTheme; meters: boolean; audio?: boolean }

/** What `est:init` carries: every shown parameter, plain values; in version 2 also the rate, the theme and whether meters come. */
export function initMessage(nonce: string, params: readonly EstParam[], v2?: InitV2) {
  const base = {
    v: 1 as EstUiVersion, type: 'est:init', nonce,
    // EST tidy (1.286, D-44): `scale: 'log'` only on a log parameter, so a frame from before it (whose
    // @cyber-est/ui takes exactly the eight keys) never sees the key: its bundle's est.json marks none.
    params: params.map(p => ({ id: p.id, name: p.name, module: p.module, min: p.min, max: p.max, def: p.def, flags: p.flags, value: p.value, ...(p.scale === 'log' ? { scale: 'log' as const } : {}) })),
  };
  if (!v2) return base;
  const two = { ...base, v: 2 as EstUiVersion, rate: rateOf(v2.rate), theme: themeOf(v2.theme), meters: v2.meters };
  // EST 1.1: version 3 adds `audio`; a version-2 frame never sees it.
  return v2.audio === undefined ? two : { ...two, v: 3 as EstUiVersion, audio: v2.audio };
}
export const paramMessage = (nonce: string, id: number, value: number, v: EstUiVersion = 1) => ({ v, type: 'est:param', nonce, id, value });

/** A sample rate as sent: a whole number of Hz in 8000…384000, or null. */
export const rateOf = (r: number | null | undefined): number | null =>
  typeof r === 'number' && Number.isFinite(r) && r >= 8000 && r <= 384000 ? Math.round(r) : null;

const meterValue = (x: number) => (Number.isFinite(x) && x > 0 ? Math.min(MAX_METER, Math.round(x * 1e4) / 1e4) : 0);
/** Version 2: the strip's levels (`out`, and `in` where one is metered), linear peaks rounded to 4 places. */
export function meterMessage(nonce: string, out: ArrayLike<number>, input: ArrayLike<number> | null = null, v: 2 | 3 = 2) {
  return {
    v, type: 'est:meter', nonce,
    in: input ? [meterValue(input[0] ?? 0), meterValue(input[1] ?? 0)] : null,
    out: [meterValue(out[0] ?? 0), meterValue(out[1] ?? 0)],
  };
}
/** Version 2: the theme changed. */
export const themeMessage = (nonce: string, theme: EstUiTheme, v: 2 | 3 = 2) => ({ v, type: 'est:theme', nonce, theme: themeOf(theme) });

/**
 * Version 3 (EST 1.1): the plugin's output as the frame may see it: each bin's magnitude in whole dB
 * (`SPECTRUM_FLOOR_DB`…0; a non-finite one, or below the floor, as the floor) and the RMS `[l, r]`
 * (linear, 4 places, at most `MAX_METER`). Never samples.
 */
export function spectrumMessage(nonce: string, db: ArrayLike<number>, rms: ArrayLike<number>) {
  const bins: number[] = new Array(db.length);
  for (let i = 0; i < db.length; i++) {
    const d = db[i]!;
    bins[i] = Number.isFinite(d) ? Math.max(SPECTRUM_FLOOR_DB, Math.min(0, Math.round(d))) : SPECTRUM_FLOOR_DB;
  }
  return { v: 3, type: 'est:spectrum', nonce, bins, rms: [meterValue(rms[0] ?? 0), meterValue(rms[1] ?? 0)] };
}

const HEX = /^#[0-9a-f]{6}$/;
/** Cyber's dark tokens (`--cyber-0`, `--foreground`, `--cyber-accent` in src/styles.css), as hex. */
export const DEFAULT_THEME: EstUiTheme = { bg: '#0a0c0f', fg: '#e1e4ea', accent: '#ffb647' };
/** A theme as sent: each colour `#rrggbb` (anything else becomes the fallback's). */
export function themeOf(raw: Partial<EstUiTheme>, fallback: EstUiTheme = DEFAULT_THEME): EstUiTheme {
  const pick = (k: keyof EstUiTheme) => {
    const v = raw[k];
    return typeof v === 'string' && HEX.test(v.toLowerCase()) ? v.toLowerCase() : fallback[k];
  };
  return { bg: pick('bg'), fg: pick('fg'), accent: pick('accent') };
}

const hex = (c: number[]) => `#${c.map(x => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, '0')).join('')}`;
/**
 * A colour token as Cyber writes it (`222 18% 5%`, `hsl(222 18% 5%)`, `#rrggbb`, `rgb(r, g, b)`) as
 * `#rrggbb`, or null. Pure, so the theme a frame gets is tested without a DOM.
 */
export function tokenHex(raw: string): string | null {
  const s = raw.trim().toLowerCase();
  if (HEX.test(s)) return s;
  const rgb = /^rgba?\(\s*(\d{1,3})[\s,]+(\d{1,3})[\s,]+(\d{1,3})/.exec(s);
  if (rgb) return hex([Number(rgb[1]), Number(rgb[2]), Number(rgb[3])]);
  const m = /^(?:hsla?\(\s*)?(-?[\d.]+)(?:deg)?[\s,]+([\d.]+)%[\s,]+([\d.]+)%/.exec(s);
  if (!m) return null;
  const h = ((Number(m[1]) % 360) + 360) % 360, sat = Math.min(1, Number(m[2]) / 100), l = Math.min(1, Number(m[3]) / 100);
  const a = sat * Math.min(l, 1 - l);
  const f = (n: number) => { const k = (n + h / 30) % 12; return 255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))); };
  return hex([f(0), f(8), f(4)]);
}
