/**
 * The EST UI frame protocol, versions 1 and 2, as a plugin's page speaks it. The host's side is
 * Cyber's `src/components/est/estFrameProtocol.ts`; this is its mirror, kept to exactly the same shapes:
 *
 * - frame → host: `est:ready {}`, `est:param { id, value }`, `est:gesture { id, phase }`; version 2
 *   also `est:resize { w, h }` (taken by the host only when the manifest's `ui.resizable`);
 * - host → frame: `est:init { params }` (version 2 adds `rate`, `theme`, `meters`), `est:param { id, value }`;
 *   version 2 also `est:meter { in, out }` (at most 30 a second) and `est:theme { theme }`;
 * - every message is `{ v, type, nonce, … }` with exactly those keys, at most 64 KiB as JSON;
 * - the nonce and the host's origin arrive in the page's fragment (`#n=<nonce>&p=<origin>`).
 *
 * EST 1.1 (Cyber 1.327), **version 3: the UI sees audio.** `est:init` adds `audio` (whether the host
 * answers `est:audio`: only for a bundle whose est.json says `ui.audio: true`); the page may send
 * `est:audio { fftSize, rate }` (`fftSize` 64…2048, a power of two; `rate` 1…30 a second, 0 stops)
 * and gets `est:spectrum { bins, rms }`: the plugin's output as magnitudes in whole dB (−120…0,
 * `fftSize / 2` of them) and the RMS `[l, r]`, from the host's own analyser. Never samples.
 *
 * Versions: the page says `est:ready` in version 3 (EST 1.1; version 2 before); a host from before EST Phase 5 refuses it and
 * sends a version-1 `est:init` on the frame's load, after which the page speaks version 1; a
 * version-2 host answers in version 2. So a page speaks the version of the last `est:init` it took.
 * Pure: no DOM.
 */

export const EST_UI_PROTOCOL = 3;
export type EstUiVersion = 1 | 2 | 3;
/** Version 3: the FFT sizes the host's analyser takes, and the most spectra a second. */
export const AUDIO_FFT_SIZES = [64, 128, 256, 512, 1024, 2048] as const;
export const AUDIO_PER_SECOND = 30;
/** Version 3: a bin's floor (dB). */
export const SPECTRUM_FLOOR_DB = -120;
/** The host refuses a message larger than this (as JSON). */
export const MAX_MESSAGE_BYTES = 64 * 1024;
/**
 * 1.331: `est:init` alone may be larger: it carries every parameter (up to the SDK's 512, each with
 * a name and a module of up to 255 characters and six numbers: about 610 bytes at most, 312 KB).
 */
export const MAX_INIT_BYTES = 512 * 1024;
/** The host drops what a frame sends past this many messages a second. */
export const HOST_MAX_PER_SECOND = 240;
/** What `@cyber-est/ui` lets itself send a second, safely under the host's limit. */
export const SEND_PER_SECOND = 200;
/** A meter value is a linear peak at most this (+12 dBFS). */
export const MAX_METER = 4;
/** `est:resize`'s bounds (the manifest's own for `ui.size`). */
export const UI_SIZE_BOUNDS = { w: [120, 2000], h: [80, 1400] } as const;

/** CLAP's parameter flags (`clap/ext/params.h`), as `est:init` carries them. */
export const FLAGS = { STEPPED: 1, PERIODIC: 2, HIDDEN: 4, READONLY: 8, BYPASS: 16, AUTOMATABLE: 32 } as const;

/**
 * One parameter as `est:init` carries it: a CLAP id, plain values in the parameter's range, and
 * (since EST 1.286, D-44) `scale: 'log'` when est.json marks it so; absent, linear.
 */
export interface EstUiParam {
  id: number;
  name: string;
  module: string;
  min: number;
  max: number;
  def: number;
  flags: number;
  value: number;
  scale?: 'linear' | 'log';
}

/** Version 2: the host's colours (`#rrggbb`), set on the page as `--est-bg`, `--est-fg`, `--est-accent`. */
export interface EstUiTheme { bg: string; fg: string; accent: string }
/** Version 2: the strip's levels, linear peaks `[left, right]`; `in` is null where the host meters no input. */
export interface EstUiMeter { in: [number, number] | null; out: [number, number] }
/** Version 3 (EST 1.1): the plugin's output as the page may see it: magnitudes (whole dB) and the RMS `[l, r]`. */
export interface EstUiSpectrum { bins: number[]; rms: [number, number] }

export type HostMessage =
  | { type: 'est:init'; v: EstUiVersion; params: EstUiParam[]; rate: number | null; theme: EstUiTheme | null; meters: boolean; audio: boolean }
  | { type: 'est:param'; v: EstUiVersion; id: number; value: number }
  | { type: 'est:meter'; v: 2 | 3; in: [number, number] | null; out: [number, number] }
  | { type: 'est:theme'; v: 2 | 3; theme: EstUiTheme }
  | { type: 'est:spectrum'; v: 3; bins: number[]; rms: [number, number] };

export type FrameMessage =
  | { v: EstUiVersion; type: 'est:ready'; nonce: string }
  | { v: EstUiVersion; type: 'est:param'; nonce: string; id: number; value: number }
  | { v: EstUiVersion; type: 'est:gesture'; nonce: string; id: number; phase: 'begin' | 'end' }
  | { v: 2 | 3; type: 'est:resize'; nonce: string; w: number; h: number }
  | { v: 3; type: 'est:audio'; nonce: string; fftSize: number; rate: number };

const HOST_KEYS: Record<EstUiVersion, Partial<Record<HostMessage['type'], string>>> = {
  1: { 'est:init': 'nonce,params,type,v', 'est:param': 'id,nonce,type,v,value' },
  2: {
    'est:init': 'meters,nonce,params,rate,theme,type,v',
    'est:param': 'id,nonce,type,v,value',
    'est:meter': 'in,nonce,out,type,v',
    'est:theme': 'nonce,theme,type,v',
  },
  3: {
    'est:init': 'audio,meters,nonce,params,rate,theme,type,v',
    'est:param': 'id,nonce,type,v,value',
    'est:meter': 'in,nonce,out,type,v',
    'est:theme': 'nonce,theme,type,v',
    'est:spectrum': 'bins,nonce,rms,type,v',
  },
};
const PARAM_KEYS = 'def,flags,id,max,min,module,name,value';
/** The same with the scale hint (a host sends `scale` only on a parameter est.json marks). */
const PARAM_KEYS_SCALED = 'def,flags,id,max,min,module,name,scale,value';

/** The JSON size of a value (Infinity when it cannot be serialised). */
export function messageSize(m: unknown): number {
  try {
    const s = JSON.stringify(m);
    return s === undefined ? Infinity : s.length;
  } catch {
    return Infinity;
  }
}

const isObject = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);
const finite = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const keysOf = (m: Record<string, unknown>) => Object.keys(m).sort().join(',');

function checkParam(raw: unknown): EstUiParam | null {
  if (!isObject(raw)) return null;
  const keys = keysOf(raw);
  if (keys !== PARAM_KEYS && keys !== PARAM_KEYS_SCALED) return null;
  const { id, name, module, min, max, def, flags, value, scale } = raw;
  if (keys === PARAM_KEYS_SCALED && scale !== 'linear' && scale !== 'log') return null;
  if (typeof id !== 'number' || !Number.isInteger(id) || id < 0 || id > 0xffffffff) return null;
  if (typeof name !== 'string' || typeof module !== 'string') return null;
  if (!finite(min) || !finite(max) || !finite(def) || !finite(value) || min > max) return null;
  if (typeof flags !== 'number' || !Number.isInteger(flags) || flags < 0) return null;
  // A value or default outside the range is clamped into it (the UI must show something).
  const clamp = (x: number) => Math.min(max, Math.max(min, x));
  const out: EstUiParam = { id, name, module, min, max, def: clamp(def), flags, value: clamp(value) };
  if (scale === 'log') out.scale = 'log';
  return out;
}

const HEX = /^#[0-9a-f]{6}$/;
function checkTheme(raw: unknown): EstUiTheme | null {
  if (!isObject(raw) || keysOf(raw) !== 'accent,bg,fg') return null;
  const { bg, fg, accent } = raw;
  if (typeof bg !== 'string' || typeof fg !== 'string' || typeof accent !== 'string') return null;
  if (!HEX.test(bg) || !HEX.test(fg) || !HEX.test(accent)) return null;
  return { bg, fg, accent };
}
function checkPair(raw: unknown): [number, number] | null {
  if (!Array.isArray(raw) || raw.length !== 2) return null;
  const [l, r] = raw as unknown[];
  if (!finite(l) || !finite(r) || l < 0 || r < 0 || l > MAX_METER || r > MAX_METER) return null;
  return [l, r];
}

/**
 * One message from the host, checked as the host checks the frame's: the schema with exactly its
 * keys, the version, the nonce, the size, and (for `est:param`) a known parameter and a value in
 * its range. The message, or null (refused). The caller has already checked the sender.
 */
export function checkHostMessage(raw: unknown, nonce: string, known: ReadonlyMap<number, EstUiParam>): HostMessage | null {
  if (!isObject(raw)) return null;
  if (messageSize(raw) > (raw.type === 'est:init' ? MAX_INIT_BYTES : MAX_MESSAGE_BYTES)) return null;
  if ((raw.v !== 1 && raw.v !== 2 && raw.v !== 3) || typeof raw.nonce !== 'string' || raw.nonce !== nonce || typeof raw.type !== 'string') return null;
  const v = raw.v as EstUiVersion;
  const keys = HOST_KEYS[v][raw.type as HostMessage['type']];
  if (!keys || keysOf(raw) !== keys) return null;
  if (raw.type === 'est:init') {
    if (!Array.isArray(raw.params)) return null;
    const params: EstUiParam[] = [];
    const seen = new Set<number>();
    for (const p of raw.params) {
      const ok = checkParam(p);
      if (!ok || seen.has(ok.id)) return null;
      seen.add(ok.id);
      params.push(ok);
    }
    if (v === 1) return { type: 'est:init', v, params, rate: null, theme: null, meters: false, audio: false };
    const rate = raw.rate;
    if (rate !== null && (!finite(rate) || !Number.isInteger(rate) || rate < 8000 || rate > 384000)) return null;
    const theme = checkTheme(raw.theme);
    if (!theme || typeof raw.meters !== 'boolean') return null;
    if (v === 3 && typeof raw.audio !== 'boolean') return null;
    return { type: 'est:init', v, params, rate, theme, meters: raw.meters, audio: v === 3 && raw.audio === true };
  }
  if (raw.type === 'est:spectrum') {
    const bins = raw.bins, rms = checkPair(raw.rms);
    if (!rms || !Array.isArray(bins) || !(AUDIO_FFT_SIZES as readonly number[]).includes(bins.length * 2)) return null;
    for (const b of bins) if (typeof b !== 'number' || !Number.isInteger(b) || b < SPECTRUM_FLOOR_DB || b > 0) return null;
    return { type: 'est:spectrum', v: 3, bins: (bins as number[]).slice(), rms };
  }
  if (raw.type === 'est:meter') {
    const out = checkPair(raw.out);
    const input = raw.in === null ? null : checkPair(raw.in);
    if (!out || (raw.in !== null && !input)) return null;
    return { type: 'est:meter', v: v as 2 | 3, in: input, out };
  }
  if (raw.type === 'est:theme') {
    const theme = checkTheme(raw.theme);
    return theme ? { type: 'est:theme', v: v as 2 | 3, theme } : null;
  }
  const { id, value } = raw;
  if (typeof id !== 'number' || !Number.isInteger(id)) return null;
  const p = known.get(id);
  if (!p || !finite(value) || value < p.min || value > p.max) return null;
  return { type: 'est:param', v, id, value };
}

/** The nonce and the host's origin from a page's fragment (`#n=…&p=…`). */
export function readFragment(hash: string): { nonce: string; hostOrigin: string } {
  const q = new URLSearchParams(hash.replace(/^#/, ''));
  return { nonce: q.get('n') ?? '', hostOrigin: q.get('p') ?? '' };
}

export const readyMessage = (nonce: string, v: EstUiVersion = EST_UI_PROTOCOL): FrameMessage => ({ v, type: 'est:ready', nonce });
export const paramMessage = (nonce: string, id: number, value: number, v: EstUiVersion = EST_UI_PROTOCOL): FrameMessage => ({ v, type: 'est:param', nonce, id, value });
export const gestureMessage = (nonce: string, id: number, phase: 'begin' | 'end', v: EstUiVersion = EST_UI_PROTOCOL): FrameMessage => ({ v, type: 'est:gesture', nonce, id, phase });
export const resizeMessage = (nonce: string, w: number, h: number, v: 2 | 3 = 2): FrameMessage => ({ v, type: 'est:resize', nonce, w, h });
/** Version 3: ask for (or, `rate` 0, stop) the host's analysis of the plugin's output. */
export const audioMessage = (nonce: string, fftSize: number, rate: number): FrameMessage => ({ v: 3, type: 'est:audio', nonce, fftSize, rate });

/** A size the host takes: whole pixels within `UI_SIZE_BOUNDS`. */
export function clampSize(w: number, h: number): { w: number; h: number } {
  const c = (x: number, [lo, hi]: readonly [number, number]) => (Number.isFinite(x) ? Math.min(hi, Math.max(lo, Math.round(x))) : lo);
  return { w: c(w, UI_SIZE_BOUNDS.w), h: c(h, UI_SIZE_BOUNDS.h) };
}

/** A value made one the host accepts for `p`: finite, within the range, whole for a stepped parameter. */
export function clampValue(p: Pick<EstUiParam, 'min' | 'max' | 'flags'>, v: number): number {
  if (!Number.isFinite(v)) return p.min;
  let x = Math.min(p.max, Math.max(p.min, v));
  if (p.flags & FLAGS.STEPPED) x = Math.min(p.max, Math.max(p.min, Math.round(x)));
  return x;
}

/** A sliding one-second window: true while fewer than `max` sends fell in the last second. */
export function sendGate(max = SEND_PER_SECOND, now: () => number = () => Date.now()) {
  const times: number[] = [];
  return {
    ok(): boolean {
      const t = now();
      while (times.length && t - times[0]! >= 1000) times.shift();
      return times.length < max;
    },
    take(): void {
      times.push(now());
    },
  };
}
