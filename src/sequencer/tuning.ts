/**
 * 1.388 (Cyber_Instruments_MIDI_Work_Order_4.md, stream 6): the song's **tuning**. Read from a
 * Scala scale (`.scl`, with an optional keyboard map `.kbm`) or an AnaMark tuning (`.tun`), with a
 * reference pitch (A = 440 Hz by default); none is 12-TET at A = 440, as before. Song data
 * (`sequencer.tuning`). Pure: the parsers, the sanitiser, the per-note table every instrument plays
 * (`tuningTable`: each MIDI note's offset from 12-TET at A = 440, in semitones) and the roll's
 * degree names. No DOM, Web Audio or store imports.
 *
 * How a Scala scale maps to the keys (the common "standard mapping" when no `.kbm` is loaded):
 * every key is the next degree, note 60 is degree 0 and sounds at 12-TET's C4 for the reference
 * pitch (261.63 Hz at A = 440), so a 12-note scale keeps C where it was. A `.kbm` gives its own map,
 * its middle note, its reference note and frequency; the song's reference pitch then scales every
 * frequency by `refHz / 440` (a pitch standard over the map), as it does a `.tun`'s.
 */

export const MAX_SCALE_DEGREES = 128;
export const MIN_REF_HZ = 300;
export const MAX_REF_HZ = 600;
export const DEFAULT_REF_HZ = 440;
/** The largest offset a note may have from 12-TET, in semitones (a map that goes past it is clamped). */
export const MAX_TUNE_SEMIS = 64;

/** A `.kbm` keyboard map (Scala's). `map` entries are scale degrees, `null` an unmapped key ("x": silent). */
export interface KeyMap {
  /** The keys retuned, inclusive; the others are silent. */
  first: number;
  last: number;
  /** The key the map's first entry is on (degree 0 with an empty map). */
  middle: number;
  /** The key that sounds at `refFreq`. */
  refNote: number;
  refFreq: number;
  /** The degree a whole pattern of the map spans (0: the scale's size). */
  octaveDegree: number;
  /** Empty: every key the next degree (a linear map). */
  map: (number | null)[];
}

export interface SongTuning {
  /** What the header and Settings show (the file's description, or its name). */
  name: string;
  /** A = this many Hz (MIN_REF_HZ … MAX_REF_HZ; absent: 440). */
  refHz?: number;
  /** A Scala scale: its degrees 1…n in cents (the last is the period, usually 1200). */
  scale?: number[];
  /** The scale's keyboard map (absent: the standard mapping). */
  keymap?: KeyMap;
  /** A `.tun`: each MIDI note's pitch in cents above 12-TET's note 0 (8.1758 Hz), 128 values. */
  notes?: number[];
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const fin = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const intIn = (v: unknown, lo: number, hi: number, d: number) => (fin(v) ? Math.max(lo, Math.min(hi, Math.round(v))) : d);
const round = (x: number, places = 4) => Math.round(x * 10 ** places) / 10 ** places;
const cleanText = (v: unknown, max = 60): string => {
  if (typeof v !== 'string') return '';
  let out = '';
  for (const ch of v) { const c = ch.codePointAt(0)!; if (c >= 0x20 && c !== 0x7f) out += ch; }
  return out.trim().slice(0, max);
};

// --- Parsers -------------------------------------------------------------------------------------

export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

/** Lines of a Scala file without its comments (`!` lines). */
const sclLines = (text: string): string[] => text.replace(/^\uFEFF/, '').split(/\r\n|\r|\n/).filter(l => !l.trimStart().startsWith('!'));

/** One `.scl` pitch: cents when it has a dot, else a ratio `a/b` or a whole number `a` (= a/1). Text after it is ignored. */
export function sclPitchCents(raw: string): number | null {
  const t = raw.trim().split(/\s+/)[0] ?? '';
  if (!t) return null;
  if (t.includes('.')) { const c = Number(t); return Number.isFinite(c) ? c : null; }
  const m = /^(\d+)(?:\/(\d+))?$/.exec(t);
  if (!m) return null;
  const a = Number(m[1]), b = m[2] === undefined ? 1 : Number(m[2]);
  if (!(a > 0) || !(b > 0)) return null;
  return 1200 * Math.log2(a / b);
}

/** A `.scl`: its description and its degrees in cents (1…n; the last the period). */
export function parseScl(text: string): ParseResult<{ name: string; scale: number[] }> {
  const lines = sclLines(text);
  if (lines.length < 2) return { ok: false, error: 'Not a Scala scale: it needs a description line and a count of notes' };
  const name = cleanText(lines[0]);
  const count = Number((lines[1] ?? '').trim().split(/\s+/)[0]);
  if (!Number.isInteger(count) || count < 1) return { ok: false, error: 'Not a Scala scale: its count of notes is missing' };
  if (count > MAX_SCALE_DEGREES) return { ok: false, error: `A scale may have at most ${MAX_SCALE_DEGREES} notes; this one has ${count}` };
  const scale: number[] = [];
  for (const l of lines.slice(2)) {
    if (scale.length >= count) break;
    if (!l.trim()) continue;
    const c = sclPitchCents(l);
    if (c === null) return { ok: false, error: `Not a pitch: "${l.trim().slice(0, 30)}"` };
    scale.push(round(c));
  }
  if (scale.length < count) return { ok: false, error: `The scale says ${count} notes but lists ${scale.length}` };
  if (!(scale[scale.length - 1]! > 0)) return { ok: false, error: 'The scale\'s last note (its period) must be above its first' };
  return { ok: true, value: { name, scale } };
}

/** A `.kbm`: its seven numbers, then one map entry per key of the pattern (a degree, or `x`). */
export function parseKbm(text: string): ParseResult<KeyMap> {
  const lines = sclLines(text).map(l => l.trim()).filter(Boolean).map(l => l.split(/\s+/)[0]!);
  if (lines.length < 7) return { ok: false, error: 'Not a Scala keyboard map: it needs seven numbers before its map' };
  const n = lines.slice(0, 7).map(Number);
  if (n.some(x => !Number.isFinite(x))) return { ok: false, error: 'Not a Scala keyboard map: one of its first seven values is not a number' };
  const [size, first, last, middle, refNote, refFreq, octaveDegree] = n as [number, number, number, number, number, number, number];
  if (!Number.isInteger(size) || size < 0 || size > MAX_SCALE_DEGREES) return { ok: false, error: `A map may have at most ${MAX_SCALE_DEGREES} keys` };
  if (!(refFreq > 0)) return { ok: false, error: 'The map\'s reference frequency must be above 0 Hz' };
  const map: (number | null)[] = [];
  for (const e of lines.slice(7)) {
    if (map.length >= size) break;
    if (e.toLowerCase() === 'x') { map.push(null); continue; }
    const d = Number(e);
    if (!Number.isInteger(d) || d < 0) return { ok: false, error: `Not a degree: "${e.slice(0, 20)}"` };
    map.push(d);
  }
  // Scala: a map shorter than its size leaves the rest unmapped.
  while (map.length < size) map.push(null);
  return { ok: true, value: sanitiseKeyMap({ first, last, middle, refNote, refFreq, octaveDegree, map })! };
}

/** 12-TET's note 0, in Hz: a `.tun`'s default base. */
const TUN_BASE_HZ = 8.175798915643707;

/** An AnaMark `.tun`: `[Exact Tuning]` (or `[Tuning]`) `note N = cents` above its `BaseFreq` (8.1758 Hz). */
export function parseTun(text: string): ParseResult<{ name: string; notes: number[] }> {
  let section = '';
  let base = TUN_BASE_HZ;
  let name = '';
  const coarse = new Map<number, number>(), exact = new Map<number, number>();
  for (const raw of text.replace(/^\uFEFF/, '').split(/\r\n|\r|\n/)) {
    const line = raw.replace(/;.*$/, '').trim();
    if (!line) continue;
    const sec = /^\[(.+)\]$/.exec(line);
    if (sec) { section = sec[1]!.trim().toLowerCase(); continue; }
    const kv = /^([^=]+)=(.*)$/.exec(line);
    if (!kv) continue;
    const key = kv[1]!.trim().toLowerCase();
    const val = kv[2]!.trim().replace(/^"|"$/g, '');
    if (section === 'info' && key === 'name') { name = cleanText(val); continue; }
    if (section !== 'tuning' && section !== 'exact tuning') continue;
    if (key === 'basefreq' && section === 'exact tuning') { const b = Number(val); if (b > 0) base = b; continue; }
    const note = /^note\s*(\d+)$/.exec(key);
    if (!note) continue;
    const i = Number(note[1]), c = Number(val);
    if (!(i >= 0 && i <= 127) || !Number.isFinite(c)) continue;
    (section === 'exact tuning' ? exact : coarse).set(i, c);
  }
  const use = exact.size ? exact : coarse;
  if (!use.size) return { ok: false, error: 'Not an AnaMark tuning: no [Tuning] or [Exact Tuning] notes were found' };
  // As cents above 12-TET's note 0, whatever the file's base was; a note it leaves out stays 12-TET.
  const shift = 1200 * Math.log2(base / TUN_BASE_HZ);
  const notes = Array.from({ length: 128 }, (_, i) => round(use.has(i) ? use.get(i)! + shift : i * 100));
  return { ok: true, value: { name, notes } };
}

/** A tuning from loaded files: a `.scl` (with an optional `.kbm`) or a `.tun`, named after the file when it has no description. */
export function tuningFromFiles(files: { scl?: { name: string; text: string }; kbm?: { name: string; text: string }; tun?: { name: string; text: string } }, refHz?: number): ParseResult<SongTuning> {
  const base = (n: string) => n.replace(/\.[a-z0-9]+$/i, '');
  const ref = refHz === undefined || refHz === DEFAULT_REF_HZ ? {} : { refHz };
  if (files.tun) {
    const r = parseTun(files.tun.text);
    if (!r.ok) return r;
    return { ok: true, value: sanitiseTuning({ name: r.value.name || base(files.tun.name), notes: r.value.notes, ...ref })! };
  }
  if (!files.scl) return { ok: false, error: 'Load a .scl or a .tun file' };
  const s = parseScl(files.scl.text);
  if (!s.ok) return s;
  let keymap: KeyMap | undefined;
  if (files.kbm) {
    const k = parseKbm(files.kbm.text);
    if (!k.ok) return k;
    keymap = k.value;
    if (!keyDegree({ scale: s.value.scale, keymap }, keymap.refNote)) return { ok: false, error: 'The map leaves its own reference note unmapped' };
  }
  const t = sanitiseTuning({ name: s.value.name || base(files.scl.name), scale: s.value.scale, ...(keymap ? { keymap } : {}), ...ref });
  return t ? { ok: true, value: t } : { ok: false, error: 'The scale could not be read' };
}

// --- Sanitising ----------------------------------------------------------------------------------

export function sanitiseKeyMap(raw: unknown): KeyMap | null {
  if (!isObj(raw)) return null;
  const map: (number | null)[] = [];
  for (const e of Array.isArray(raw.map) ? raw.map : []) {
    if (map.length >= MAX_SCALE_DEGREES) break;
    map.push(fin(e) && e >= 0 ? Math.min(1024, Math.round(e)) : null);
  }
  const first = intIn(raw.first, 0, 127, 0), last = intIn(raw.last, 0, 127, 127);
  const refFreq = fin(raw.refFreq) && raw.refFreq > 0 ? Math.min(20000, Math.max(1, raw.refFreq)) : 261.6255653005986;
  return {
    first: Math.min(first, last), last: Math.max(first, last),
    middle: intIn(raw.middle, 0, 127, 60), refNote: intIn(raw.refNote, 0, 127, 60), refFreq: round(refFreq, 6),
    octaveDegree: intIn(raw.octaveDegree, 0, 1024, 0), map,
  };
}

/** A tuning from anything (a song, a peer): null when it is not one (12-TET). */
export function sanitiseTuning(raw: unknown): SongTuning | null {
  if (!isObj(raw)) return null;
  const out: SongTuning = { name: cleanText(raw.name) || 'Tuning' };
  if (fin(raw.refHz) && raw.refHz !== DEFAULT_REF_HZ) out.refHz = round(Math.max(MIN_REF_HZ, Math.min(MAX_REF_HZ, raw.refHz)), 3);
  if (Array.isArray(raw.notes)) {
    if (raw.notes.length !== 128 || !raw.notes.every(fin)) return null;
    out.notes = (raw.notes as number[]).map((c, i) => round(Math.max(i * 100 - MAX_TUNE_SEMIS * 100, Math.min(i * 100 + MAX_TUNE_SEMIS * 100, c))));
    return out;
  }
  if (Array.isArray(raw.scale)) {
    const scale = raw.scale.slice(0, MAX_SCALE_DEGREES).filter(fin).map(c => round(Math.max(-12000, Math.min(12000, c))));
    if (!scale.length || !(scale[scale.length - 1]! > 0)) return null;
    out.scale = scale;
    const km = raw.keymap === undefined ? null : sanitiseKeyMap(raw.keymap);
    if (km) out.keymap = km;
    return out;
  }
  // A reference pitch alone: 12-TET at another A.
  return out.refHz !== undefined ? out : null;
}

// --- The table -----------------------------------------------------------------------------------

/** A degree's cents (any degree: whole periods above the scale's own), or null for an unmapped key. */
function degreeCents(scale: readonly number[], d: number | null): number | null {
  if (d === null) return null;
  const n = scale.length;
  const period = scale[n - 1]!;
  const oct = Math.floor(d / n), k = ((d % n) + n) % n;
  return oct * period + (k === 0 ? 0 : scale[k - 1]!);
}

/** The degree a key plays (its index into the scale, and its whole patterns), or null for an unmapped or out-of-range key. */
export function keyDegree(t: Pick<SongTuning, 'scale' | 'keymap'>, note: number): { degree: number; cents: number } | null {
  const scale = t.scale;
  if (!scale?.length) return null;
  const km = t.keymap;
  const middle = km?.middle ?? 60;
  if (km && (note < km.first || note > km.last)) return null;
  const off = note - middle;
  if (!km || km.map.length === 0) {
    const cents = degreeCents(scale, off);
    return cents === null ? null : { degree: off, cents };
  }
  const size = km.map.length;
  const idx = ((off % size) + size) % size;
  const pats = Math.floor(off / size);
  const entry = km.map[idx] ?? null;
  if (entry === null) return null;
  const octDeg = km.octaveDegree > 0 ? km.octaveDegree : scale.length;
  const c = degreeCents(scale, entry);
  const per = degreeCents(scale, octDeg);
  if (c === null || per === null) return null;
  return { degree: entry + pats * octDeg, cents: c + pats * per };
}

/** A note's frequency in the tuning, Hz (null: silent). 12-TET at A = 440 with no tuning. */
export function tunedHz(t: SongTuning | null | undefined, note: number): number | null {
  const std = (n: number) => 440 * Math.pow(2, (n - 69) / 12);
  if (!t) return std(note);
  const pitchStd = (t.refHz ?? DEFAULT_REF_HZ) / DEFAULT_REF_HZ;
  if (t.notes) return TUN_BASE_HZ * Math.pow(2, (t.notes[note] ?? note * 100) / 1200) * pitchStd;
  if (!t.scale?.length) return std(note) * pitchStd;
  const here = keyDegree(t, note);
  if (!here) return null;
  if (t.keymap) {
    const ref = keyDegree(t, t.keymap.refNote);
    // A map whose reference key is unmapped (refused on load) sounds from its middle key at its frequency.
    const refCents = ref?.cents ?? 0;
    return t.keymap.refFreq * Math.pow(2, (here.cents - refCents) / 1200) * pitchStd;
  }
  // The standard mapping: note 60 is degree 0 at 12-TET's C4 for the reference pitch.
  return std(60) * pitchStd * Math.pow(2, here.cents / 1200);
}

/**
 * What every instrument is sent (`{ type: 'tuning', semis, mute }`): each MIDI note's offset from
 * 12-TET at A = 440 in semitones (its played pitch is `note + semis[note]`), and the notes the map
 * leaves silent. Null for no tuning (12-TET: nothing to send).
 */
export interface TuningMessage { type: 'tuning'; semis: number[]; mute: number[] }
export function tuningTable(t: SongTuning | null | undefined): TuningMessage | null {
  if (!t) return null;
  const semis: number[] = [];
  const mute: number[] = [];
  for (let n = 0; n < 128; n++) {
    const hz = tunedHz(t, n);
    if (hz === null || !(hz > 0)) { semis.push(0); mute.push(n); continue; }
    const off = 69 + 12 * Math.log2(hz / 440) - n;
    semis.push(round(Math.max(-MAX_TUNE_SEMIS, Math.min(MAX_TUNE_SEMIS, off)), 6));
  }
  return { type: 'tuning', semis, mute };
}

/** The message that puts an instrument back to 12-TET (a tuning cleared). */
export const TWELVE_TET: TuningMessage = { type: 'tuning', semis: new Array<number>(128).fill(0), mute: [] };

/** A short key for render caches: '' with no tuning (so a key from before 1.388 still matches). */
export const tuningKey = (t: SongTuning | null | undefined): string => (t ? JSON.stringify([t.refHz ?? DEFAULT_REF_HZ, t.scale ?? null, t.keymap ?? null, t.notes ?? null]) : '');

/** The engines the tuning reaches (1.388): the built-in synths, the SAMPLER and the rack's chains. An EST instrument, a Drum Rack, Cyber PADS and a MIDI track stay 12-TET. */
export function tunesEngine(engine: string): boolean {
  switch (engine) {
    case 'analog': case 'wave': case 'fm': case 'chip': case 'sampler': case 'rack': return true;
    // An EST plugin has no tuning in its ABI (12-TET, its card says so); a Drum Rack's pads, Cyber PADS and a MIDI track play no keyboard of the song's.
    case 'est': case 'drums': case 'pads': case 'none': return false;
    default: return false;
  }
}

/**
 * The roll's key name in a scale tuning: the degree within its pattern and the scale's size
 * (Scala's "7\19"), or null with no scale (a `.tun`, 12-TET: the note names stay). Degree 0's key
 * is the pattern's start (the roll names it as it names each C).
 */
export function degreeLabel(t: SongTuning | null | undefined, note: number): { label: string; root: boolean } | null {
  if (!t?.scale?.length) return null;
  const d = keyDegree(t, note);
  if (!d) return { label: '×', root: false };
  const n = t.scale.length;
  const k = ((d.degree % n) + n) % n;
  return { label: `${k}\\${n}`, root: k === 0 };
}

/** What the header and Settings say about a tuning. */
export function tuningWords(t: SongTuning | null | undefined): string {
  if (!t) return '12-TET, A = 440 Hz';
  const a = `A = ${t.refHz ?? DEFAULT_REF_HZ} Hz`;
  if (t.notes) return `${t.name} (.tun), ${a}`;
  if (t.scale) return `${t.name} (${t.scale.length} notes${t.keymap ? ', with a keyboard map' : ''}), ${a}`;
  return `12-TET, ${a}`;
}
