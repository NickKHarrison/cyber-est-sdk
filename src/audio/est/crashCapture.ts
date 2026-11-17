/**
 * 1.669 (the crash replayer, Cyber_Wave_N666_Work_Order.md "1.669"): a **crash capture**, the last
 * few blocks a plugin was given before it trapped, so a developer can run them again with
 * `est replay <bundle> <capture>` (sdk/packages/tools/src/replay.ts) and see the trapping function.
 *
 * - **Opt-in and local only.** Only an instance made while this device's switch is on
 *   (`captureSetting.ts`) keeps the ring (the processor's `CAP_MAX` comment: each block's input, the
 *   parameter values as it began, its transport and the events it was given); a fault posts it once,
 *   and it is held in memory for the visit beside the crash record (`crashes.ts`), never sent,
 *   never saved, never in a report. Only a developer saves it, as a file, from the plugin's card or
 *   Diagnostics (`captureText`).
 * - **The file** is JSON (`CAPTURE_FORMAT`, version `CAPTURE_VERSION`): the plugin's id, version
 *   and hash, the rate, the parameters and transport as the first block began, then each block's
 *   input (base64 of little-endian float32), the events at their frame offsets, and the trap.
 *   `parseCapture` checks every field and bound before a replay reads it.
 * - **A replay** starts a fresh instance, sets the parameters that differ from its defaults at the
 *   first block's frame 0, and plays the blocks with their events (`replayBlocks`). The plugin's own
 *   history before the first block (a delay line, a voice) is not in the capture: a crash that
 *   needs more of it replays with more blocks kept.
 *
 * Pure: no DOM, store or Web Audio (the SDK imports it in Node).
 */
import { decodeBase64, encodeBase64 } from './base64';

export const CAPTURE_FORMAT = 'cyber-est-capture';
export const CAPTURE_VERSION = 1;
/** Blocks kept by default and at most (the processor's `CAP_MAX`), and events a block (`CAP_EV`). */
export const CAPTURE_BLOCKS = 16;
export const CAPTURE_MAX_BLOCKS = 64;
export const CAPTURE_MAX_EVENTS = 64;
const MAX_FRAMES = 128;
const MAX_CHANNELS = 8;
const MAX_PARAMS = 512;
const MAX_MESSAGE = 200;

/** The processor's event kinds and CLAP's note event types (clap/events.h), as its rows hold them. */
const K_NOTE = 1, K_PARAM = 2, K_EXPR = 3, K_MIDI = 4, K_TR = 5, K_MOD = 6;
export const CLAP_NOTE_TYPES = { noteOn: 0, noteOff: 1, choke: 2 } as const;

/** A transport as the processor's `transport` event takes it (untimed: in force from the next block). */
export interface CaptureTransport {
  type: 'transport'; tempo: number; tempoEnd?: number; until?: number; beat: number; seconds: number; playing: boolean;
  num: number; den: number; loopStart?: number; loopEnd?: number; loopStartSeconds?: number; loopEndSeconds?: number;
  barStart: number; barNumber: number;
}

/** One event a block was given, `offset` frames into it. */
export type CaptureEvent = { offset: number } & (
  | { type: 'noteOn' | 'noteOff' | 'choke'; noteId: number; port: number; channel: number; key: number; velocity: number }
  | { type: 'param'; id: number; value: number }
  | { type: 'mod'; id: number; amount: number }
  | { type: 'expression'; expression: number; noteId: number; port: number; channel: number; key: number; value: number }
  | { type: 'midi'; port: number; data: [number, number, number] }
  | Omit<CaptureTransport, 'type'> & { type: 'transport' }
);

export interface CaptureBlock {
  /** The block's number in the instance's life (0 its first). */
  block: number;
  frames: number;
  /** Each main input channel's samples, base64 of little-endian float32 (none for an instrument). */
  input: string[];
  /** Each sidechain channel's (EST 1.1). */
  key: string[];
  /** A transport set between the previous block and this one (untimed), applied before it. */
  transport?: CaptureTransport;
  events: CaptureEvent[];
  /** Events the block was given past `CAPTURE_MAX_EVENTS` (not kept). */
  dropped: number;
}

export interface EstCapture {
  format: typeof CAPTURE_FORMAT;
  v: typeof CAPTURE_VERSION;
  plugin: { id: string; version: string; hash?: string };
  sampleRate: number;
  audioIn: number;
  sidechainIn: number;
  /** The fault: its phase, the trap message (cut to 200 characters) and the block it happened in. */
  trap: { phase: string; message: string; block: number | null };
  /** Every parameter's value as the first block began (as the host last set it). */
  params: { id: number; value: number }[];
  /** The transport in force as the first block began, if one was set. */
  transport?: CaptureTransport;
  blocks: CaptureBlock[];
}

/** The processor's `capture` message (estProcessor.ts `postCapture`). */
export interface RawCapture {
  type?: 'capture'; phase: string; sampleRate: number; frames: number; audioIn: number; sidechainIn: number; paramIds: number[];
  blocks: {
    block: number; frame: number; frames: number; dropped: number; untimedTransport: boolean; transportSet: boolean;
    transport: number[]; params: number[]; input: Float32Array[]; key: Float32Array[]; events: number[][];
  }[];
}

const num = (v: unknown, d = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);

function f32ToBase64(a: Float32Array): string {
  const bytes = new Uint8Array(a.length * 4), dv = new DataView(bytes.buffer);
  for (let i = 0; i < a.length; i++) dv.setFloat32(i * 4, a[i]!, true);
  return encodeBase64(bytes);
}

/** A channel's samples from the file. */
export function captureSamples(s: string): Float32Array {
  const bytes = new Uint8Array(decodeBase64(s));
  if (bytes.length % 4) throw new Error('a channel\'s samples are not whole float32 values');
  const dv = new DataView(bytes.buffer), out = new Float32Array(bytes.length / 4);
  for (let i = 0; i < out.length; i++) out[i] = dv.getFloat32(i * 4, true);
  return out;
}

/**
 * A transport row (the processor's `tr` layout: tempo, tempo_inc a sample, beats, seconds, anchor
 * frame, flags, num, den, loop start, loop end, bar start, bar number, loop start s, loop end s)
 * as the event that plays exactly as it at frame `at`: advanced from its anchor as `writeTransport`
 * advances it, so its anchor becomes `at`.
 */
export function transportAt(row: readonly number[], at: number, sampleRate: number): CaptureTransport {
  const flags = num(row[5]), playing = (flags & 1) !== 0, loop = (flags & 2) !== 0;
  const tempo0 = num(row[0], 120), inc = num(row[1]);
  const n = playing ? at - num(row[4]) : 0;
  const tempo = tempo0 + inc * n;
  const out: CaptureTransport = {
    type: 'transport', tempo, beat: num(row[2]) + (n > 0 ? (tempo0 * n + inc * n * n * 0.5) / (60 * sampleRate) : 0),
    seconds: num(row[3]) + (n > 0 ? n / sampleRate : 0), playing, num: num(row[6], 4), den: num(row[7], 4),
    barStart: num(row[10]), barNumber: num(row[11]),
  };
  if (inc !== 0) { out.tempoEnd = tempo + inc * sampleRate; out.until = 1; }
  if (loop) { out.loopStart = num(row[8]); out.loopEnd = num(row[9]); out.loopStartSeconds = num(row[12]); out.loopEndSeconds = num(row[13]); }
  return out;
}

/** One of the processor's queue rows, delivered `offset` frames into its block, as an event (null for a kind it does not name). */
export function eventOfRow(row: readonly number[], offset: number, sampleRate: number): CaptureEvent | null {
  const kind = row[1], at = num(row[0]);
  if (kind === K_NOTE) {
    const t = row[2] === CLAP_NOTE_TYPES.noteOff ? 'noteOff' : row[2] === CLAP_NOTE_TYPES.choke ? 'choke' : 'noteOn';
    return { offset, type: t, noteId: num(row[3], -1), port: num(row[4]), channel: num(row[5]), key: num(row[6], 60), velocity: num(row[7]) };
  }
  if (kind === K_PARAM) return { offset, type: 'param', id: num(row[3]), value: num(row[4]) };
  if (kind === K_MOD) return { offset, type: 'mod', id: num(row[3]), amount: num(row[4]) };
  if (kind === K_EXPR) return { offset, type: 'expression', noteId: num(row[3], -1), port: num(row[4]), channel: num(row[5], -1), key: num(row[6], -1), expression: num(row[7]), value: num(row[8]) };
  if (kind === K_MIDI) return { offset, type: 'midi', port: num(row[3]), data: [num(row[4]) & 0xff, num(row[5]) & 0x7f, num(row[6]) & 0x7f] };
  if (kind === K_TR) {
    const tr = row.slice(3, 17);
    tr[4] = at;
    const { type: _t, ...rest } = transportAt(tr, at, sampleRate);
    return { offset, type: 'transport', ...rest };
  }
  return null;
}

/** The processor's message as the capture a developer saves. */
export function captureFromRaw(raw: RawCapture, plugin: { id: string; version: string; hash?: string }, trap: { message: string; block?: number | null }): EstCapture {
  const sr = num(raw.sampleRate, 48000);
  const first = raw.blocks[0];
  const params = first ? raw.paramIds.map((id, i) => ({ id, value: num(first.params[i]) })) : [];
  return {
    format: CAPTURE_FORMAT, v: CAPTURE_VERSION,
    plugin: { id: plugin.id, version: plugin.version, ...(plugin.hash ? { hash: plugin.hash } : {}) },
    sampleRate: sr, audioIn: num(raw.audioIn), sidechainIn: num(raw.sidechainIn),
    trap: { phase: String(raw.phase), message: String(trap.message ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_MESSAGE), block: Number.isSafeInteger(trap.block) ? trap.block! : null },
    params,
    ...(first?.transportSet ? { transport: transportAt(first.transport, first.frame, sr) } : {}),
    blocks: raw.blocks.map((b, j) => ({
      block: b.block, frames: b.frames,
      input: b.input.map(f32ToBase64), key: b.key.map(f32ToBase64),
      ...(j > 0 && b.untimedTransport ? { transport: transportAt(b.transport, b.frame, sr) } : {}),
      events: b.events.map(r => eventOfRow(r, Math.max(0, num(r[0]) - b.frame), sr)).filter((e): e is CaptureEvent => e !== null),
      dropped: b.dropped,
    })),
  };
}

/** The file's text (one line a block, so a diff of two captures reads). */
export function captureText(c: EstCapture): string {
  const { blocks, ...head } = c;
  return `${JSON.stringify(head, null, 2).replace(/\n}$/, ',\n  "blocks": [\n')}${blocks.map(b => `    ${JSON.stringify(b)}`).join(',\n')}\n  ]\n}\n`;
}

/** A file name for the capture: the plugin, its version and the block. */
export function captureFileName(c: Pick<EstCapture, 'plugin' | 'trap'>): string {
  const safe = (s: string) => s.replace(/[^A-Za-z0-9._-]+/g, '-').slice(0, 60);
  return `${safe(c.plugin.id)}-${safe(c.plugin.version)}-block-${c.trap.block ?? 'unknown'}.estcapture.json`;
}

function need(ok: boolean, what: string): void {
  if (!ok) throw new Error(`not a crash capture: ${what}`);
}
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isInt = (v: unknown, lo: number, hi: number): v is number => Number.isSafeInteger(v) && (v as number) >= lo && (v as number) <= hi;

function checkTransport(t: unknown, where: string): void {
  need(!!t && typeof t === 'object', `${where} is not a transport`);
  const r = t as Record<string, unknown>;
  need(r.type === 'transport' || r.type === undefined, `${where} is not a transport`);
  for (const k of ['tempo', 'beat', 'seconds', 'num', 'den', 'barStart', 'barNumber']) need(isNum(r[k]), `${where}.${k} is not a number`);
  need(typeof r.playing === 'boolean', `${where}.playing is not true or false`);
  for (const k of ['tempoEnd', 'until', 'loopStart', 'loopEnd', 'loopStartSeconds', 'loopEndSeconds']) need(r[k] === undefined || isNum(r[k]), `${where}.${k} is not a number`);
}

function checkEvent(e: unknown, frames: number, where: string): void {
  need(!!e && typeof e === 'object', `${where} is not an event`);
  const r = e as Record<string, unknown>;
  need(isInt(r.offset, 0, frames - 1), `${where}.offset is not a frame of its block`);
  const nums = (...ks: string[]) => { for (const k of ks) need(isNum(r[k]), `${where}.${k} is not a number`); };
  switch (r.type) {
    case 'noteOn': case 'noteOff': case 'choke': nums('noteId', 'port', 'channel', 'key', 'velocity'); break;
    case 'param': nums('id', 'value'); break;
    case 'mod': nums('id', 'amount'); break;
    case 'expression': nums('expression', 'noteId', 'port', 'channel', 'key', 'value'); need(isInt(r.expression, 0, 6), `${where}.expression is not a CLAP expression id`); break;
    case 'midi': nums('port'); need(Array.isArray(r.data) && r.data.length === 3 && r.data.every(x => isInt(x, 0, 255)), `${where}.data is not three bytes`); break;
    case 'transport': checkTransport(r, where); break;
    default: need(false, `${where}.type is not an event the host sends`);
  }
}

function checkChannels(list: unknown, count: number, frames: number, where: string): void {
  need(Array.isArray(list) && list.length === count, `${where} does not hold ${count} channel${count === 1 ? '' : 's'}`);
  for (const [i, s] of (list as unknown[]).entries()) {
    need(typeof s === 'string' && /^[A-Za-z0-9+/]*={0,2}$/.test(s), `${where}[${i}] is not base64`);
    let n = -1;
    try { n = captureSamples(s as string).length; } catch { /* not whole samples */ }
    need(n === frames, `${where}[${i}] is not ${frames} samples`);
  }
}

/** A capture file's text, checked field by field (throws in words on anything else). */
export function parseCapture(text: string): EstCapture {
  let c: unknown;
  try { c = JSON.parse(text); } catch { throw new Error('not a crash capture: the file is not JSON'); }
  need(!!c && typeof c === 'object' && !Array.isArray(c), 'the file is not an object');
  const r = c as Record<string, unknown>;
  need(r.format === CAPTURE_FORMAT, `its format is not "${CAPTURE_FORMAT}"`);
  need(r.v === CAPTURE_VERSION, `its version is ${String(r.v)}, and this reads version ${CAPTURE_VERSION}`);
  const plugin = r.plugin as Record<string, unknown> | undefined;
  need(!!plugin && typeof plugin.id === 'string' && typeof plugin.version === 'string' && (plugin.hash === undefined || (typeof plugin.hash === 'string' && /^[0-9a-f]{64}$/.test(plugin.hash))), 'plugin is not an id, a version and a hash');
  need(isNum(r.sampleRate) && r.sampleRate >= 8000 && r.sampleRate <= 384000, 'sampleRate is not a sample rate');
  need(isInt(r.audioIn, 0, MAX_CHANNELS) && isInt(r.sidechainIn, 0, 2), 'audioIn or sidechainIn is not a channel count');
  const trap = r.trap as Record<string, unknown> | undefined;
  need(!!trap && typeof trap.phase === 'string' && typeof trap.message === 'string' && (trap.message as string).length <= MAX_MESSAGE && (trap.block === null || isInt(trap.block, 0, Number.MAX_SAFE_INTEGER)), 'trap is not a phase, a message and a block');
  need(Array.isArray(r.params) && r.params.length <= MAX_PARAMS && r.params.every(p => !!p && isNum((p as { id: unknown }).id) && isNum((p as { value: unknown }).value)), 'params is not a list of ids and values');
  if (r.transport !== undefined) checkTransport(r.transport, 'transport');
  need(Array.isArray(r.blocks) && r.blocks.length >= 1 && r.blocks.length <= CAPTURE_MAX_BLOCKS, `blocks is not 1 to ${CAPTURE_MAX_BLOCKS} blocks`);
  (r.blocks as unknown[]).forEach((b, j) => {
    const where = `blocks[${j}]`;
    need(!!b && typeof b === 'object', `${where} is not a block`);
    const k = b as Record<string, unknown>;
    need(isInt(k.block, 0, Number.MAX_SAFE_INTEGER), `${where}.block is not a block number`);
    need(isInt(k.frames, 1, MAX_FRAMES), `${where}.frames is not 1 to ${MAX_FRAMES}`);
    need(isInt(k.dropped, 0, Number.MAX_SAFE_INTEGER), `${where}.dropped is not a count`);
    checkChannels(k.input, r.audioIn as number, k.frames as number, `${where}.input`);
    checkChannels(k.key, r.sidechainIn as number, k.frames as number, `${where}.key`);
    if (k.transport !== undefined) checkTransport(k.transport, `${where}.transport`);
    need(Array.isArray(k.events) && k.events.length <= CAPTURE_MAX_EVENTS, `${where}.events is not up to ${CAPTURE_MAX_EVENTS} events`);
    (k.events as unknown[]).forEach((e, i) => checkEvent(e, k.frames as number, `${where}.events[${i}]`));
  });
  return c as EstCapture;
}

/** An event as the processor queues it, at `frame` (seconds at `sampleRate`: `time`). */
export type ReplayEvent = Record<string, unknown> & { type: string };

/**
 * The capture as a replay plays it, block by block from frame 0: each block's frame, its input
 * channels, its key channels and the events to send before it (timed to their frames). The first
 * block's are the transport and every parameter whose value differs from `defaults` (the fresh
 * instance's), at its frame 0. A transport is sent timed to its block's first frame, so its anchor
 * is that frame whenever the message arrives.
 */
export function replayBlocks(c: EstCapture, defaults: ReadonlyMap<number, number> = new Map()): { frame: number; frames: number; block: number; input: Float32Array[]; key: Float32Array[]; events: ReplayEvent[] }[] {
  const sr = c.sampleRate;
  let frame = 0;
  return c.blocks.map((b, j) => {
    const at = frame;
    const time = (offset: number) => (at + offset) / sr;
    const events: ReplayEvent[] = [];
    if (j === 0) {
      if (c.transport) events.push({ ...c.transport, type: 'transport', time: time(0) });
      for (const p of c.params) if (defaults.get(p.id) !== p.value) events.push({ type: 'param', id: p.id, value: p.value, time: time(0) });
    } else if (b.transport) events.push({ ...b.transport, type: 'transport', time: time(0) });
    for (const e of b.events) {
      const { offset, ...rest } = e;
      events.push({ ...rest, time: time(offset) });
    }
    frame += b.frames;
    return { frame: at, frames: b.frames, block: b.block, input: b.input.map(captureSamples), key: b.key.map(captureSamples), events };
  });
}
