/**
 * @est/tools: `est compare` (EST-DEV-3, DEV-G 1.326; sdk/docs/porting-cpp.md, "Checking a port").
 * Two renders of the same input and events, one from each side (a bundle rendered by `render`, on
 * the conformance host's real `est-plugin` processor, or a WAV the desktop build wrote), measured
 * against each other: per channel the peak and RMS of each and of their difference, the level
 * difference, the difference in octave bands, and the first sample where they part by more than a
 * threshold. `htmlReport` draws it as one self-contained page (no script), the two waveforms
 * overlaid.
 *
 * Pure: no file system (the command reads and writes the files), so it runs anywhere. The WAV
 * reader takes PCM 16, 24 and 32 bit, float 32 and 64, plain or WAVE_FORMAT_EXTENSIBLE; mono is
 * played on both channels, a third channel and beyond are dropped (EST 1.0 is stereo).
 */

export interface Stereo { sampleRate: number; left: Float32Array; right: Float32Array }

// ---- WAV ----

/** A WAV file's samples, as stereo float. Throws on what it cannot read, saying what it is. */
export function readWav(bytes: Uint8Array): Stereo {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (at: number) => String.fromCharCode(bytes[at]!, bytes[at + 1]!, bytes[at + 2]!, bytes[at + 3]!);
  if (bytes.length < 12 || tag(0) !== 'RIFF' || tag(8) !== 'WAVE') throw new Error('not a WAV file (no RIFF/WAVE header)');
  let fmt: { format: number; channels: number; rate: number; bits: number } | null = null;
  let data: { at: number; size: number } | null = null;
  for (let at = 12; at + 8 <= bytes.length;) {
    const id = tag(at), size = v.getUint32(at + 4, true), body = at + 8;
    if (id === 'fmt ' && size >= 16) {
      let format = v.getUint16(body, true);
      if (format === 0xfffe && size >= 40) format = v.getUint16(body + 24, true); // EXTENSIBLE: the sub-format's first two bytes
      fmt = { format, channels: v.getUint16(body + 2, true), rate: v.getUint32(body + 4, true), bits: v.getUint16(body + 14, true) };
    } else if (id === 'data') data = { at: body, size: Math.min(size, bytes.length - body) };
    at = body + size + (size & 1);
  }
  if (!fmt) throw new Error('the WAV has no fmt chunk');
  if (!data) throw new Error('the WAV has no data chunk');
  const { format, channels, rate, bits } = fmt;
  const width = bits / 8;
  const ok = (format === 1 && (bits === 16 || bits === 24 || bits === 32)) || (format === 3 && (bits === 32 || bits === 64));
  if (!ok || channels < 1) throw new Error(`a WAV of format ${format} with ${bits}-bit samples and ${channels} channels (read: PCM 16, 24 or 32 bit, float 32 or 64)`);
  const frames = Math.floor(data.size / (width * channels));
  const left = new Float32Array(frames), right = new Float32Array(frames);
  const sample = (at: number): number => {
    if (format === 3) return bits === 32 ? v.getFloat32(at, true) : v.getFloat64(at, true);
    if (bits === 16) return v.getInt16(at, true) / 32768;
    if (bits === 24) { const x = bytes[at]! | (bytes[at + 1]! << 8) | (bytes[at + 2]! << 16); return ((x << 8) >> 8) / 8388608; }
    return v.getInt32(at, true) / 2147483648;
  };
  for (let f = 0; f < frames; f++) {
    const at = data.at + f * width * channels;
    left[f] = sample(at);
    right[f] = channels > 1 ? sample(at + width) : left[f]!;
  }
  return { sampleRate: rate, left, right };
}

/** Stereo float as a 32-bit float WAV. */
export function writeWav(s: Stereo): Uint8Array {
  const frames = Math.min(s.left.length, s.right.length);
  const out = new Uint8Array(44 + frames * 8);
  const v = new DataView(out.buffer);
  const put = (at: number, t: string) => { for (let i = 0; i < 4; i++) out[at + i] = t.charCodeAt(i); };
  put(0, 'RIFF'); v.setUint32(4, 36 + frames * 8, true); put(8, 'WAVE');
  put(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 3, true); v.setUint16(22, 2, true);
  v.setUint32(24, s.sampleRate, true); v.setUint32(28, s.sampleRate * 8, true); v.setUint16(32, 8, true); v.setUint16(34, 32, true);
  put(36, 'data'); v.setUint32(40, frames * 8, true);
  for (let f = 0; f < frames; f++) { v.setFloat32(44 + f * 8, s.left[f]!, true); v.setFloat32(48 + f * 8, s.right[f]!, true); }
  return out;
}

// ---- Measuring ----

/** dBFS of a linear level; null for silence (below -300 dB). */
export const dbOf = (x: number): number | null => (x > 1e-15 ? 20 * Math.log10(x) : null);

/** The octave bands the spectral difference is reported in (centre frequencies, Hz). */
export const BANDS = [31.5, 63, 125, 250, 500, 1000, 2000, 4000, 8000, 16000] as const;
const FFT = 4096;

/** An in-place radix-2 FFT (re, im of length a power of two). */
function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j]!, re[i]!]; [im[i], im[j]] = [im[j]!, im[i]!]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const a = (-2 * Math.PI) / len, wr = Math.cos(a), wi = Math.sin(a);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const p = i + k, q = p + len / 2;
        const tr = re[q]! * cr - im[q]! * ci, ti = re[q]! * ci + im[q]! * cr;
        re[q] = re[p]! - tr; im[q] = im[p]! - ti;
        re[p] = re[p]! + tr; im[p] = im[p]! + ti;
        const nr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = nr;
      }
    }
  }
}

/** The power in each octave band (Hann-windowed frames of 4096, half overlapping), summed over the signal. */
export function bandPower(x: Float32Array, sampleRate: number): number[] {
  const out = BANDS.map(() => 0);
  const win = Float64Array.from({ length: FFT }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / FFT));
  const re = new Float64Array(FFT), im = new Float64Array(FFT);
  const band = new Int8Array(FFT / 2).fill(-1);
  for (let k = 1; k < FFT / 2; k++) {
    const f = (k * sampleRate) / FFT;
    const b = BANDS.findIndex(c => f >= c / Math.SQRT2 && f < c * Math.SQRT2);
    band[k] = b;
  }
  for (let at = 0; at < Math.max(1, x.length - FFT / 2); at += FFT / 2) {
    for (let i = 0; i < FFT; i++) { re[i] = (x[at + i] ?? 0) * win[i]!; im[i] = 0; }
    fft(re, im);
    for (let k = 1; k < FFT / 2; k++) { const b = band[k]!; if (b >= 0) out[b] = out[b]! + re[k]! * re[k]! + im[k]! * im[k]!; }
  }
  return out;
}

export interface ChannelCompare {
  channel: 'left' | 'right';
  peakA: number | null; peakB: number | null;
  rmsA: number | null; rmsB: number | null;
  /** B's RMS level less A's, in dB (null when either is silent). */
  levelDiffDb: number | null;
  /** The difference signal (B − A): its peak and RMS, dBFS (null: identical). */
  diffPeakDb: number | null; diffRmsDb: number | null;
  /** NaN and infinite samples on each side (any one makes the comparison fail). */
  nonFinite: { a: number; b: number };
  /** The first frame where |B − A| passes the threshold or either side is not finite, and its time; null when it never does. */
  firstDivergence: { frame: number; seconds: number; a: number; b: number } | null;
  /** Per octave band: B's power less A's, dB (null where both are below −200 dB). */
  bands: { hz: number; diffDb: number | null }[];
}

export interface CompareOptions {
  /** The largest allowed peak of the difference, dBFS (default −80): past it, `ok` is false. */
  toleranceDb?: number;
  /** The level that counts as parting for the first divergence, dBFS (default: the tolerance). */
  thresholdDb?: number;
}

export interface CompareResult {
  ok: boolean;
  sampleRate: number;
  frames: number;
  /** When the two lengths differ, both (the comparison covers the shorter). */
  lengths: { a: number; b: number } | null;
  toleranceDb: number;
  thresholdDb: number;
  channels: ChannelCompare[];
  /** The worst channel's difference peak over the finite samples, dBFS (null: no finite difference). */
  worstDiffDb: number | null;
  /** Whether either side has a NaN or an infinity anywhere (then `ok` is false). */
  nonFinite: boolean;
}

function channel(name: 'left' | 'right', a: Float32Array, b: Float32Array, frames: number, sr: number, threshold: number): ChannelCompare {
  let pa = 0, pb = 0, sa = 0, sb = 0, pd = 0, sd = 0, badA = 0, badB = 0;
  let first: ChannelCompare['firstDivergence'] = null;
  // A NaN or an infinity is a divergence wherever it is (never "identical": NaN compares false
  // with everything, so it is counted apart); the levels and bands are measured over the finite
  // samples, a non-finite one taken as 0.
  const fa = new Float32Array(frames), fb = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    const x = a[i]!, y = b[i]!;
    const okX = Number.isFinite(x), okY = Number.isFinite(y);
    if (!okX) badA++;
    if (!okY) badB++;
    const cx = okX ? x : 0, cy = okY ? y : 0, e = cy - cx;
    fa[i] = cx; fb[i] = cy;
    pa = Math.max(pa, Math.abs(cx)); pb = Math.max(pb, Math.abs(cy)); pd = Math.max(pd, Math.abs(e));
    sa += cx * cx; sb += cy * cy; sd += e * e;
    if (!first && (!okX || !okY || Math.abs(e) > threshold)) first = { frame: i, seconds: i / sr, a: x, b: y };
  }
  const n = Math.max(1, frames);
  const rmsA = dbOf(Math.sqrt(sa / n)), rmsB = dbOf(Math.sqrt(sb / n));
  const ba = bandPower(fa, sr), bb = bandPower(fb, sr);
  const floor = 1e-20; // −200 dB
  return {
    channel: name, peakA: dbOf(pa), peakB: dbOf(pb), rmsA, rmsB,
    levelDiffDb: rmsA === null || rmsB === null ? null : rmsB - rmsA,
    diffPeakDb: dbOf(pd), diffRmsDb: dbOf(Math.sqrt(sd / n)),
    nonFinite: { a: badA, b: badB },
    firstDivergence: first,
    bands: BANDS.map((hz, i) => ({ hz, diffDb: ba[i]! < floor && bb[i]! < floor ? null : 10 * Math.log10(Math.max(bb[i]!, floor) / Math.max(ba[i]!, floor)) })),
  };
}

/** Compare two renders at one sample rate. */
export function compareRenders(a: Stereo, b: Stereo, opts: CompareOptions = {}): CompareResult {
  if (a.sampleRate !== b.sampleRate) throw new Error(`the two are at different sample rates (${a.sampleRate} and ${b.sampleRate} Hz): render the reference at ${a.sampleRate} Hz, or pass --sample-rate ${b.sampleRate}`);
  const toleranceDb = opts.toleranceDb ?? -80;
  const thresholdDb = opts.thresholdDb ?? toleranceDb;
  const la = a.left.length, lb = b.left.length, frames = Math.min(la, lb);
  const threshold = 10 ** (thresholdDb / 20);
  const channels = [channel('left', a.left, b.left, frames, a.sampleRate, threshold), channel('right', a.right, b.right, frames, a.sampleRate, threshold)];
  const peaks = channels.map(c => c.diffPeakDb).filter((x): x is number => x !== null);
  const worstDiffDb = peaks.length ? Math.max(...peaks) : null;
  const nonFinite = channels.some(c => c.nonFinite.a > 0 || c.nonFinite.b > 0);
  return {
    ok: la === lb && !nonFinite && (worstDiffDb === null || worstDiffDb <= toleranceDb),
    sampleRate: a.sampleRate, frames, lengths: la === lb ? null : { a: la, b: lb },
    toleranceDb, thresholdDb, channels, worstDiffDb, nonFinite,
  };
}

/**
 * 1.400 (P3): what makes a comparison mean little, in words, before any sample is measured: two
 * bundles of different kinds (an effect processes the input, an instrument ignores it and plays
 * the notes), an instrument given an input, or an effect given silence. `kind` is a bundle's
 * manifest `kind` (`effect`, `instrument`), null for a WAV side; `input` is `--input`'s word;
 * `hasNotes` whether any event is a note.
 */
export function compareWarnings(kindA: string | null, kindB: string | null, input: string, hasNotes = false): string[] {
  const out: string[] = [];
  if (kindA && kindB && kindA !== kindB) out.push(`A is an ${kindA} and B an ${kindB}: an effect processes the input and an instrument ignores it and plays only the events' notes, so the two renders measure different things. Compare two effects or two instruments (a port with its original, two versions of one plugin).`);
  const kinds = [kindA, kindB].filter((k): k is string => !!k);
  if (kinds.length && kinds.every(k => k === 'instrument') && !hasNotes) out.push(`${kinds.length === 2 ? 'both are instruments' : 'the bundle is an instrument'}, which ignore the input (${input}) and play notes: give them notes with --events (noteOn and noteOff), or the renders are silent.`);
  if (kinds.length && kinds.every(k => k === 'effect') && input === 'silence') out.push('both are effects and the input is silence: most effects then output silence too, so the comparison shows little. Try --input noise or sine.');
  return out;
}

// ---- Words and the page ----

const db = (x: number | null, signed = false) => (x === null ? 'silent' : `${signed && x > 0 ? '+' : ''}${x.toFixed(2)} dB`);

/** The report as text lines (the command's output). */
export function formatCompare(r: CompareResult, names: { a: string; b: string }): string {
  const out = [`${r.ok ? 'SAME' : 'DIFFERENT'}  A ${names.a}  vs  B ${names.b}`, `  ${r.frames} frames at ${r.sampleRate} Hz; tolerance ${r.toleranceDb} dBFS on the difference's peak`];
  if (r.lengths) out.push(`  x the lengths differ: A ${r.lengths.a} frames, B ${r.lengths.b} (compared over the shorter)`);
  for (const c of r.channels) if (c.nonFinite.a || c.nonFinite.b) out.push(`  x ${c.channel}: not finite (NaN or infinity): A ${c.nonFinite.a} samples, B ${c.nonFinite.b}${c.firstDivergence ? `, the first at frame ${c.firstDivergence.frame}` : ''}`);
  for (const c of r.channels) {
    out.push(`  ${c.channel}: A peak ${db(c.peakA)}, RMS ${db(c.rmsA)}; B peak ${db(c.peakB)}, RMS ${db(c.rmsB)}; level B−A ${c.levelDiffDb === null ? 'n/a' : db(c.levelDiffDb, true)}`);
    out.push(`    difference: peak ${c.diffPeakDb === null ? 'none (identical)' : db(c.diffPeakDb)}, RMS ${c.diffRmsDb === null ? 'none' : db(c.diffRmsDb)}${c.firstDivergence ? `; first past ${r.thresholdDb} dBFS at frame ${c.firstDivergence.frame} (${c.firstDivergence.seconds.toFixed(4)} s: A ${c.firstDivergence.a.toFixed(6)}, B ${c.firstDivergence.b.toFixed(6)})` : ''}`);
    out.push(`    bands B−A: ${c.bands.map(b => `${b.hz >= 1000 ? `${b.hz / 1000}k` : b.hz} ${b.diffDb === null ? '-' : `${b.diffDb > 0 ? '+' : ''}${b.diffDb.toFixed(2)}`}`).join('  ')}`);
  }
  return out.join('\n');
}

const esc = (s: string) => s.replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);

/** One channel's two waveforms overlaid (min and max per column), and the difference under them. */
function waves(rawA: Float32Array, rawB: Float32Array, frames: number, label: string): string {
  // A NaN or an infinity draws as 0 (the tables report them); SVG takes no NaN in a path.
  const finite = (x: Float32Array) => x.map(v => (Number.isFinite(v) ? v : 0));
  const a = finite(rawA), b = finite(rawB);
  const W = 960, H = 160, D = 60;
  const cols = Math.min(W, Math.max(1, frames));
  const env = (x: Float32Array, f: (v: number) => number) => {
    let path = '';
    for (let c = 0; c < cols; c++) {
      const from = Math.floor((c * frames) / cols), to = Math.max(from + 1, Math.floor(((c + 1) * frames) / cols));
      let lo = Infinity, hi = -Infinity;
      for (let i = from; i < to && i < frames; i++) { const v = f(x[i]!); lo = Math.min(lo, v); hi = Math.max(hi, v); }
      if (lo === Infinity) continue;
      const xpos = ((c + 0.5) * W) / cols;
      path += `M${xpos.toFixed(1)} ${lo.toFixed(1)}V${Math.max(hi, lo + 0.6).toFixed(1)}`;
    }
    return path;
  };
  let peak = 1e-9;
  for (let i = 0; i < frames; i++) peak = Math.max(peak, Math.abs(a[i]!), Math.abs(b[i]!));
  const y = (v: number) => H / 2 - (v / peak) * (H / 2 - 4);
  const diff = new Float32Array(frames);
  let dpeak = 1e-30;
  for (let i = 0; i < frames; i++) { diff[i] = b[i]! - a[i]!; dpeak = Math.max(dpeak, Math.abs(diff[i]!)); }
  const yd = (v: number) => D / 2 - (v / dpeak) * (D / 2 - 3);
  return `<figure><figcaption>${esc(label)} (scaled to the larger peak; the difference scaled to its own, ${esc(db(dbOf(dpeak > 1e-29 ? dpeak : 0)))})</figcaption>
<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(label)}: A and B overlaid"><line x1="0" x2="${W}" y1="${H / 2}" y2="${H / 2}" class="axis"/><path class="a" d="${env(a, y)}"/><path class="b" d="${env(b, y)}"/></svg>
<svg viewBox="0 0 ${W} ${D}" role="img" aria-label="${esc(label)}: the difference, B minus A"><line x1="0" x2="${W}" y1="${D / 2}" y2="${D / 2}" class="axis"/><path class="d" d="${env(diff, yd)}"/></svg></figure>`;
}

/** The report as one self-contained HTML page (no script, no outside file). */
export function htmlReport(r: CompareResult, a: Stereo, b: Stereo, names: { a: string; b: string }, setup: string): string {
  const rows = r.channels.map(c => `<tr><th scope="row">${c.channel}</th><td>${db(c.peakA)}</td><td>${db(c.peakB)}</td><td>${db(c.rmsA)}</td><td>${db(c.rmsB)}</td><td>${c.levelDiffDb === null ? 'n/a' : db(c.levelDiffDb, true)}</td><td>${c.diffPeakDb === null ? 'identical' : db(c.diffPeakDb)}</td><td>${c.diffRmsDb === null ? '-' : db(c.diffRmsDb)}</td><td>${c.firstDivergence ? `frame ${c.firstDivergence.frame} (${c.firstDivergence.seconds.toFixed(4)} s)` : 'never'}</td></tr>`).join('\n');
  const bandHead = BANDS.map(hz => `<th scope="col">${hz >= 1000 ? `${hz / 1000} k` : hz}</th>`).join('');
  const bandRows = r.channels.map(c => `<tr><th scope="row">${c.channel}</th>${c.bands.map(x => `<td>${x.diffDb === null ? '-' : `${x.diffDb > 0 ? '+' : ''}${x.diffDb.toFixed(2)}`}</td>`).join('')}</tr>`).join('\n');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>est compare</title>
<style>
:root { --bg: #ffffff; --fg: #1b1f24; --muted: #57606a; --line: #d0d7de; --a: #0969da; --b: #bc4c00; --d: #cf222e; --ok: #1a7f37; --bad: #cf222e; }
@media (prefers-color-scheme: dark) { :root { --bg: #0d1117; --fg: #e6edf3; --muted: #9da7b3; --line: #30363d; --a: #58a6ff; --b: #ffa657; --d: #ff7b72; --ok: #3fb950; --bad: #ff7b72; } }
body { background: var(--bg); color: var(--fg); font: 14px/1.5 system-ui, sans-serif; margin: 0 auto; padding: 16px; max-width: 1000px; }
h1 { font-size: 20px; margin: 0 0 4px; } .verdict { font-weight: 700; } .ok { color: var(--ok); } .bad { color: var(--bad); }
p, figcaption { color: var(--muted); } code { font-family: ui-monospace, monospace; color: var(--fg); overflow-wrap: anywhere; }
table { border-collapse: collapse; margin: 8px 0 16px; font-variant-numeric: tabular-nums; display: block; overflow-x: auto; }
th, td { border-bottom: 1px solid var(--line); padding: 4px 8px; text-align: right; white-space: nowrap; } th[scope=row] { text-align: left; }
svg { width: 100%; height: auto; display: block; border: 1px solid var(--line); margin-top: 4px; }
.axis { stroke: var(--line); } .a, .b, .d { fill: none; stroke-width: 1; } .a { stroke: var(--a); opacity: .75; } .b { stroke: var(--b); opacity: .6; } .d { stroke: var(--d); }
.key span { display: inline-block; width: 12px; height: 3px; vertical-align: middle; margin: 0 4px 0 12px; }
</style></head><body>
<h1>est compare: <span class="verdict ${r.ok ? 'ok' : 'bad'}">${r.ok ? 'the same, within the tolerance' : 'different'}</span></h1>
<p><b>A</b> <code>${esc(names.a)}</code><br><b>B</b> <code>${esc(names.b)}</code></p>
<p>${esc(setup)}. ${r.frames} frames at ${r.sampleRate} Hz. Tolerance: the difference's peak at most ${r.toleranceDb} dBFS (worst: ${r.worstDiffDb === null ? 'none, identical' : `${r.worstDiffDb.toFixed(2)} dBFS`}).${r.nonFinite ? ` <b class="bad">Not finite:</b> ${r.channels.filter(c => c.nonFinite.a || c.nonFinite.b).map(c => `${c.channel}: A ${c.nonFinite.a}, B ${c.nonFinite.b} samples NaN or infinite`).join('; ')}.` : ''}${r.lengths ? ` The lengths differ: A ${r.lengths.a} frames, B ${r.lengths.b}; compared over the shorter.` : ''}</p>
<table><thead><tr><th></th><th scope="col">A peak</th><th scope="col">B peak</th><th scope="col">A RMS</th><th scope="col">B RMS</th><th scope="col">level B−A</th><th scope="col">difference peak</th><th scope="col">difference RMS</th><th scope="col">first past ${r.thresholdDb} dBFS</th></tr></thead><tbody>
${rows}
</tbody></table>
<h2>Octave bands, B − A (dB)</h2>
<table><thead><tr><th></th>${bandHead}</tr></thead><tbody>
${bandRows}
</tbody></table>
<h2>Waveforms</h2>
<p class="key"><span style="background: var(--a)"></span>A<span style="background: var(--b)"></span>B<span style="background: var(--d)"></span>B − A</p>
${waves(a.left, b.left, r.frames, 'Left')}
${waves(a.right, b.right, r.frames, 'Right')}
</body></html>
`;
}
