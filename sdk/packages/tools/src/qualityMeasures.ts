/**
 * 1.604: the measures of `est quality` (`quality.ts`), pure: samples in, numbers out (no WebAssembly,
 * no files), so `sdk/tests/quality.test.ts` holds each to a signal whose answer is known.
 *
 * - `integratedLufs`: ITU-R BS.1770-4 integrated loudness (K-weighting at any rate, 400 ms blocks
 *   with 75 % overlap, the −70 LUFS absolute and −10 LU relative gates), stereo;
 * - `truePeakDb`: the peak of a 4× oversampled copy (a 48-tap windowed sinc a phase), dBTP;
 * - `dcDb`: a channel's mean, dBFS;
 * - `correlation`: the Pearson correlation of left and right (−1 is a channel inverted);
 * - `clickAt`: how far the high-passed (3 kHz) burst just after a moment stands above the high-passed
 *   sound around it (a step or a kink is broadband; a loud attack of a low or smooth sound is not);
 * - `spectrum` and `inharmonicDb`: a Hann-windowed power spectrum and, for a held note of known pitch,
 *   the share of the power below a frequency that lies between its harmonics (aliases land there);
 * - `bandDb`: the power above a frequency against the power around the fundamental.
 */

const EPS = 1e-20;

export const toDb = (power: number) => 10 * Math.log10(Math.max(power, EPS));
export const ampDb = (amp: number) => 20 * Math.log10(Math.max(Math.abs(amp), 1e-10));

/** One biquad (direct form I) over a buffer. */
function biquad(x: Float32Array, b: number[], a: number[]): Float64Array {
  const y = new Float64Array(x.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const xi = x[i]!;
    const yi = b[0]! * xi + b[1]! * x1 + b[2]! * x2 - a[1]! * y1 - a[2]! * y2;
    x2 = x1; x1 = xi; y2 = y1; y1 = yi;
    y[i] = yi;
  }
  return y;
}

/** BS.1770's K-weighting at `sr` (the two stages' analogue prototypes through the bilinear transform, as libebur128 does). */
function kWeight(x: Float32Array, sr: number): Float64Array {
  let f0 = 1681.974450955533;
  const G = 3.999843853973347;
  let Q = 0.7071752369554196;
  let K = Math.tan((Math.PI * f0) / sr);
  const Vh = Math.pow(10, G / 20);
  const Vb = Math.pow(Vh, 0.4996667741545416);
  let a0 = 1 + K / Q + K * K;
  const pb = [(Vh + (Vb * K) / Q + K * K) / a0, (2 * (K * K - Vh)) / a0, (Vh - (Vb * K) / Q + K * K) / a0];
  const pa = [1, (2 * (K * K - 1)) / a0, (1 - K / Q + K * K) / a0];
  f0 = 38.13547087602444;
  Q = 0.5003270373238773;
  K = Math.tan((Math.PI * f0) / sr);
  a0 = 1 + K / Q + K * K;
  const rb = [1, -2, 1];
  const ra = [1, (2 * (K * K - 1)) / a0, (1 - K / Q + K * K) / a0];
  const s1 = biquad(x, pb, pa);
  const f = new Float32Array(s1.length);
  for (let i = 0; i < s1.length; i++) f[i] = s1[i]!;
  return biquad(f, rb, ra);
}

/** Integrated loudness (LUFS) of a stereo signal, or −Infinity when every block is under the absolute gate. */
export function integratedLufs(left: Float32Array, right: Float32Array, sr: number): number {
  const l = kWeight(left, sr), r = kWeight(right, sr);
  const block = Math.round(0.4 * sr), hop = Math.round(0.1 * sr);
  const powers: number[] = [];
  for (let at = 0; at + block <= l.length; at += hop) {
    let s = 0;
    for (let i = at; i < at + block; i++) s += l[i]! * l[i]! + r[i]! * r[i]!;
    powers.push(s / block);
  }
  const lufs = (p: number) => -0.691 + 10 * Math.log10(Math.max(p, EPS));
  const abs = powers.filter(p => lufs(p) > -70);
  if (!abs.length) return -Infinity;
  const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
  const rel = lufs(mean(abs)) - 10;
  const gated = abs.filter(p => lufs(p) > rel);
  return lufs(mean(gated.length ? gated : abs));
}

const TP_TAPS = 48;
const TP_PHASES = 4;
let tpKernel: Float64Array[] | null = null;

/** The 4× interpolation's phases: a windowed sinc (Kaiser-like Blackman window), unity gain at each phase. */
function truePeakKernel(): Float64Array[] {
  if (tpKernel) return tpKernel;
  const phases: Float64Array[] = [];
  const n = TP_TAPS * TP_PHASES;
  for (let p = 0; p < TP_PHASES; p++) {
    const k = new Float64Array(TP_TAPS);
    let sum = 0;
    for (let t = 0; t < TP_TAPS; t++) {
      const i = t * TP_PHASES + p;
      const x = (i - n / 2) / TP_PHASES;
      const sinc = x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x);
      const w = 0.42 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1)) + 0.08 * Math.cos((4 * Math.PI * i) / (n - 1));
      k[t] = sinc * w;
      sum += k[t]!;
    }
    for (let t = 0; t < TP_TAPS; t++) k[t] = k[t]! / sum;
    phases.push(k);
  }
  return (tpKernel = phases);
}

/** The true peak (dBTP) of one or more channels: the largest magnitude of a 4× oversampled copy, or of the samples. */
export function truePeakDb(...channels: Float32Array[]): number {
  const k = truePeakKernel();
  let peak = 0;
  for (const x of channels) {
    for (let i = 0; i < x.length; i++) peak = Math.max(peak, Math.abs(x[i]!));
    for (let i = TP_TAPS; i < x.length; i++) {
      for (let p = 0; p < TP_PHASES; p++) {
        const kp = k[p]!;
        let s = 0;
        for (let t = 0; t < TP_TAPS; t++) s += kp[t]! * x[i - t]!;
        const a = Math.abs(s);
        if (a > peak) peak = a;
      }
    }
  }
  return ampDb(peak);
}

/** A channel's mean (dBFS) over `from` to `to`. */
export function dcDb(x: Float32Array, from = 0, to = x.length): number {
  let s = 0;
  for (let i = from; i < to; i++) s += x[i]!;
  return ampDb(s / Math.max(1, to - from));
}

/** The mean (signed) of a channel. */
export function meanOf(x: Float32Array, from = 0, to = x.length): number {
  let s = 0;
  for (let i = from; i < to; i++) s += x[i]!;
  return s / Math.max(1, to - from);
}

/** The Pearson correlation of left and right over `from` to `to` (1 when either is silent: nothing to compare). */
export function correlation(l: Float32Array, r: Float32Array, from = 0, to = l.length): number {
  let sl = 0, sr = 0, sll = 0, srr = 0, slr = 0;
  const n = Math.max(1, to - from);
  for (let i = from; i < to; i++) { const a = l[i]!, b = r[i]!; sl += a; sr += b; sll += a * a; srr += b * b; slr += a * b; }
  const vl = sll / n - (sl / n) ** 2, vr = srr / n - (sr / n) ** 2;
  if (vl < 1e-12 || vr < 1e-12) return 1;
  return (slr / n - (sl / n) * (sr / n)) / Math.sqrt(vl * vr);
}

/** RMS (dBFS) of both channels over a span. */
export function rmsDb(l: Float32Array, r: Float32Array, from: number, to: number): number {
  let s = 0;
  const a = Math.max(0, from), b = Math.min(l.length, to);
  for (let i = a; i < b; i++) s += l[i]! * l[i]! + r[i]! * r[i]!;
  return toDb(s / Math.max(1, 2 * (b - a)));
}

/** A 2nd-order Butterworth high-pass at `fc` over `x[from, to)` (from rest at `from`). */
function highPass(x: Float32Array, from: number, to: number, fc: number, sr: number): Float64Array {
  const K = Math.tan((Math.PI * fc) / sr), Q = Math.SQRT1_2;
  const n = 1 / (1 + K / Q + K * K);
  const b0 = n, b1 = -2 * n, b2 = n, a1 = 2 * (K * K - 1) * n, a2 = (1 - K / Q + K * K) * n;
  const y = new Float64Array(Math.max(0, to - from));
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = from; i < to; i++) {
    const xi = x[i] ?? 0;
    const yi = b0 * xi + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1; x1 = xi; y2 = y1; y1 = yi;
    y[i - from] = yi;
  }
  return y;
}

/** The `q` quantile of |v| over a span of several arrays. */
function quantileAbs(arrays: Float64Array[], from: number, to: number, q: number): number {
  const v: number[] = [];
  for (const a of arrays) for (let i = Math.max(0, from); i < Math.min(a.length, to); i++) v.push(Math.abs(a[i]!));
  if (!v.length) return 0;
  v.sort((a, b) => a - b);
  return v[Math.min(v.length - 1, Math.floor(q * v.length))]!;
}

export interface ClickReading {
  /** The largest high-passed (3 kHz) sample in the moment's window, linear. */
  jump: number;
  /** Its ratio to the high-passed sound's own around the window (its 99th percentile, both sides). */
  ratio: number;
}

/** Where a click's energy is read: a step or a kink is broadband, a low sound's own waveform is not. */
export const CLICK_HP_HZ = 3000;

/**
 * A click reading at frame `at`: both channels high-passed at `CLICK_HP_HZ`; the window is `at − 1 ms` to
 * `at + win ms`, the reference the 20 ms before and the 10–40 ms after. A step reads far above the sound's
 * own (tens to thousands); a smooth attack or a bright steady sound stays near 1. A floor (1e-5) keeps
 * silence on both sides from reading as a click; `jump` says how loud the burst is.
 */
export function clickAt(l: Float32Array, r: Float32Array, at: number, sr: number, winMs = 3): ClickReading {
  const ms = sr / 1000;
  const from = Math.max(0, Math.round(at - 30 * ms)), to = Math.min(l.length, Math.round(at + 45 * ms));
  const hl = highPass(l, from, to, CLICK_HP_HZ, sr), hr = highPass(r, from, to, CLICK_HP_HZ, sr);
  const rel = (f: number) => Math.round(f) - from;
  const jump = quantileAbs([hl, hr], rel(at - ms), rel(at + winMs * ms), 1);
  const before = quantileAbs([hl, hr], rel(at - 20 * ms), rel(at - ms), 0.99);
  const after = quantileAbs([hl, hr], rel(at + 10 * ms), rel(at + 40 * ms), 0.99);
  return { jump, ratio: jump / Math.max(1e-5, before, after) };
}

/** An in-place radix-2 FFT of `re`/`im` (length a power of two). */
function fft(re: Float64Array, im: Float64Array) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j]!, re[i]!]; [im[i], im[j]] = [im[j]!, im[i]!]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const ar = re[i + k]!, ai = im[i + k]!;
        const br = re[i + k + len / 2]! * cr - im[i + k + len / 2]! * ci;
        const bi = re[i + k + len / 2]! * ci + im[i + k + len / 2]! * cr;
        re[i + k] = ar + br; im[i + k] = ai + bi;
        re[i + k + len / 2] = ar - br; im[i + k + len / 2] = ai - bi;
        const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t;
      }
    }
  }
}

/** The Hann-windowed power spectrum of the mid (L+R)/2 over `n` frames from `from` (n a power of two): power per bin. */
export function spectrum(l: Float32Array, r: Float32Array, from: number, n: number): Float64Array {
  const re = new Float64Array(n), im = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1));
    re[i] = (((l[from + i] ?? 0) + (r[from + i] ?? 0)) / 2) * w;
  }
  fft(re, im);
  const p = new Float64Array(n / 2);
  for (let k = 0; k < n / 2; k++) p[k] = re[k]! * re[k]! + im[k]! * im[k]!;
  return p;
}

/**
 * For a held note at `f0`: the power below `limit` Hz lying farther than `tol` × f0 from every harmonic
 * k·f0, against all the power below `limit` (dB; −∞ for a pure harmonic tone). Noise, detuning and
 * reverb raise it at every rate; aliasing raises it more at a lower rate (`quality.ts` compares two).
 */
export function inharmonicDb(p: Float64Array, sr: number, f0: number, limit = 18000, tol = 0.12): number {
  const n = p.length * 2;
  let all = 0, off = 0;
  for (let k = 1; k < p.length; k++) {
    const f = (k * sr) / n;
    if (f > limit) break;
    if (f < f0 * 0.5) continue;
    all += p[k]!;
    const h = Math.round(f / f0);
    if (Math.abs(f - h * f0) > tol * f0) off += p[k]!;
  }
  return toDb(off) - toDb(all);
}

/** The power above `from` Hz against the power within ±10 % of `f0` (dB). */
export function bandDb(p: Float64Array, sr: number, f0: number, from = 18000): number {
  const n = p.length * 2;
  let hi = 0, fund = 0;
  for (let k = 1; k < p.length; k++) {
    const f = (k * sr) / n;
    if (f >= from) hi += p[k]!;
    if (Math.abs(f - f0) <= f0 * 0.1) fund += p[k]!;
  }
  return toDb(hi) - toDb(fund);
}
