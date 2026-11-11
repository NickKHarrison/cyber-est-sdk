import { slotTakesKey, type FxSlot } from '../audio/mixer/fxDefs';
import type { AutomationLane, ReturnBus, Track } from './sequencerTypes';

/**
 * 1.127 (Cyber_Owner_Followups_Work_Order.md §2 "1.127"): the one routing graph. Every track and
 * return has an **output** (`output`; absent or null: the master): a group, a return, or an
 * **audio** track (resampling: the destination hears it on its input tap, `Strip.inputTap`, as
 * its monitor allows). The mixer (`mixer.ts`), the export (`exportSequence.ts`), mute and solo
 * (`arrangement.ts`'s `effectiveMute`, `inMutedPath`) and the sidechain rules (`ducker.ts`) all
 * read it from here, so they never disagree.
 *
 * The rules (`outputRefusal`, `canRoute`): nothing plays into itself; only a group, a return or an
 * audio track takes an output (never a MIDI, instrument or pads track); a group never plays into a
 * group (groups never nest); a return plays only into a later return or the master (the forward
 * order of its sends, `forwardInputs`); and no route closes a loop, through outputs, sends,
 * a return's sends or an accepted sidechain key.
 *
 * `groupId` (1.8) is kept for one release as a derived alias: a track whose output names a group
 * has `groupId` too (the sanitiser and `setTrackOutput` write both), and data from before 1.127
 * that has only `groupId` reads as that output (`storedOutput`). Nothing reads `groupId` but this
 * file: use `outputOf`, `groupOf`, `membersOf`.
 *
 * Pure, and with no value import from `sequencerTypes.ts` (its sanitiser imports `fitOutputs`).
 */

/** The master as an output (the same string as `MASTER_ROW_ID`). */
export const MASTER_OUT = 'master';

/** What the routing reads of a song. */
export interface RouteState {
  tracks: readonly Track[];
  returns: readonly ReturnBus[];
  /** The master strip's inserts (it may key from any track: nothing leaves it, so no loop). */
  master?: { fx: readonly FxSlot[] };
  /** The lanes, for sends a lane drives (left out: none). */
  automation?: readonly AutomationLane[];
}

/** A track or a return (anything with an output). */
export type Routable = Track | ReturnBus;

const isTrack = (x: Routable): x is Track => 'kind' in x;

/**
 * The output as stored, before any check: `output` when the key is there (null: the master),
 * else a pre-1.127 `groupId`; null for the master.
 */
export function storedOutput(x: Routable): string | null {
  if (x.output !== undefined) return x.output ?? null;
  return isTrack(x) ? x.groupId ?? null : null;
}

/** The ids the returns have, in order. */
const returnIndexIn = (s: Pick<RouteState, 'returns'>, id: string): number => s.returns.findIndex(r => r.id === id);

/**
 * Why `from` may not play into `to` by the rules alone (no loop check), or null when it may.
 * `to` null or `MASTER_OUT` is the master: always allowed.
 */
export function outputRefusal(s: Pick<RouteState, 'tracks' | 'returns'>, from: Routable, to: string | null): string | null {
  if (to === null || to === MASTER_OUT) return null;
  if (to === from.id) return 'A track cannot play into itself';
  const ri = returnIndexIn(s, to);
  if (!isTrack(from)) {
    const own = returnIndexIn(s, from.id);
    if (ri < 0) return 'A return plays only into a later return or the master';
    if (ri <= own) return 'A return plays only into the returns after it';
    return null;
  }
  if (ri >= 0) return null;
  const dest = s.tracks.find(t => t.id === to);
  if (!dest) return 'No such track or return';
  if (dest.kind === 'group') return from.kind === 'group' ? 'A group cannot play into another group' : null;
  if (dest.kind === 'audio') return null;
  return 'Only an audio track, a group or a return takes another track';
}

/**
 * Where a track or a return goes: `MASTER_OUT`, or the id of the group, return or audio track it
 * plays into. An output the rules refuse (it names nothing, a MIDI track, a group from a group …)
 * reads as the master, as the mixer and the export play it.
 */
export function outputOf(x: Routable, s: Pick<RouteState, 'tracks' | 'returns'>): string {
  const o = storedOutput(x);
  if (o === null || outputRefusal(s, x, o) !== null) return MASTER_OUT;
  return o;
}

/** The group track `t` plays into, or null (the master, a return or another track). */
export function groupOf(t: Track, tracks: readonly Track[]): string | null {
  if (t.kind === 'group') return null;
  const o = storedOutput(t);
  if (!o) return null;
  const g = tracks.find(x => x.id === o);
  return g && g.kind === 'group' ? o : null;
}

/** The tracks in group `groupId` (their output names it), in track order. */
export function membersOf(groupId: string, tracks: readonly Track[]): Track[] {
  return tracks.filter(t => groupOf(t, tracks) === groupId);
}

/** The tracks and returns that play into `id` (a group, a return or an audio track), in order. */
export function inputsOf(id: string, s: Pick<RouteState, 'tracks' | 'returns'>): Routable[] {
  return [...s.tracks, ...s.returns].filter(x => outputOf(x, s) === id);
}

/**
 * The track `t`'s output goes into when that is a track (a group or an audio track), or null
 * (the master, a return, or an output the rules refuse). Reads the tracks only.
 */
export function outputTrack(t: Track, tracks: readonly Track[]): Track | null {
  const o = storedOutput(t);
  if (!o || o === t.id) return null;
  const d = tracks.find(x => x.id === o);
  if (!d) return null;
  if (d.kind === 'audio' || (d.kind === 'group' && t.kind !== 'group')) return d;
  return null;
}

/**
 * The tracks `t` plays through on its way to the master, nearest first (its group, the audio track
 * it resamples into and that one's own output …); itself left out. A loop (never written, but a
 * live room's race could hold one until the sanitiser breaks it) stops the walk.
 */
export function pathOf(t: Track, tracks: readonly Track[]): Track[] {
  const out: Track[] = [];
  const seen = new Set<string>([t.id]);
  for (let d = outputTrack(t, tracks); d && !seen.has(d.id); d = outputTrack(d, tracks)) {
    seen.add(d.id);
    out.push(d);
  }
  return out;
}

// --- The graph ----------------------------------------------------------------------------------

/** 1.55: the returns (by index) each track sends to: a send up, a send lane, a Drum Rack pad's send up or automated. */
export function sendsTo(s: Pick<RouteState, 'tracks' | 'returns' | 'automation'>): Map<string, Set<number>> {
  const out = new Map<string, Set<number>>();
  const add = (id: string, i: number) => { if (i < 0 || i >= s.returns.length) return; let e = out.get(id); if (!e) { e = new Set(); out.set(id, e); } e.add(i); };
  for (const t of s.tracks) {
    t.sends.forEach((v, i) => { if (v > 0) add(t.id, i); });
    if (t.kind === 'synth' && t.engine === 'drums') for (const p of t.patch.pads) p.sends.forEach((v, i) => { if (v > 0) add(t.id, i); });
  }
  for (const l of s.automation ?? []) {
    if (!l.on) continue;
    const g = l.target;
    if (g.kind === 'track' && g.param === 'send') add(g.trackId, g.index);
    else if (g.kind === 'synth') { const m = /sends\.(\d+)$/.exec(g.param); if (m) add(g.trackId, Number(m[1])); }
  }
  return out;
}

export type Edges = Map<string, Set<string>>;
const addEdge = (e: Edges, a: string, b: string) => { let x = e.get(a); if (!x) { x = new Set(); e.set(a, x); } x.add(b); };

/**
 * The signal edges with no keys: each track's and return's output (not the master), each track's
 * sends (to the returns it sends to) and each return's sends (to the later returns, up or driven
 * by a lane). `skip` leaves one strip's output edge out (a route being tried in its place).
 */
export function routeEdges(s: RouteState, skip?: string): Edges {
  const out: Edges = new Map();
  for (const x of [...s.tracks, ...s.returns]) {
    if (x.id === skip) continue;
    const o = outputOf(x, s);
    if (o !== MASTER_OUT) addEdge(out, x.id, o);
  }
  const sends = sendsTo(s);
  for (const t of s.tracks) for (const i of sends.get(t.id) ?? []) { const r = s.returns[i]; if (r) addEdge(out, t.id, r.id); }
  s.returns.forEach((r, i) => {
    r.sends?.forEach((v, k) => { const to = s.returns[k]; if (v > 0 && k > i && to) addEdge(out, r.id, to.id); });
  });
  for (const l of s.automation ?? []) {
    const g = l.target;
    if (!l.on || g.kind !== 'return' || g.param !== 'send') continue;
    const from = returnIndexIn(s, g.returnId);
    const to = s.returns[g.index];
    if (from >= 0 && to && g.index > from) addEdge(out, g.returnId, to.id);
  }
  return out;
}

/** Whether `to` is reached from `from` along the edges (a strip reaches itself). */
export function reaches(edges: Edges, from: string, to: string): boolean {
  if (from === to) return true;
  const seen = new Set<string>([from]);
  const stack = [from];
  while (stack.length) {
    const n = stack.pop()!;
    for (const m of edges.get(n) ?? []) {
      if (m === to) return true;
      if (!seen.has(m)) { seen.add(m); stack.push(m); }
    }
  }
  return false;
}

export interface KeyUse { owner: string; fxId: string; key: string }
/** Every keyed effect that is on and names a key, in strip order (tracks, returns, the master), then insert order. */
export function keyUses(s: RouteState): KeyUse[] {
  const out: KeyUse[] = [];
  const strips: { id: string; fx: readonly FxSlot[] }[] = [...s.tracks, ...s.returns, ...(s.master ? [{ id: MASTER_OUT, fx: s.master.fx }] : [])];
  for (const st of strips) {
    for (const f of st.fx) {
      if (!slotTakesKey(f) || !f.on || !f.keyTrackId) continue;
      // 1.55: the master's Cyber Comp takes no key (its picker is hidden there).
      if (st.id === MASTER_OUT && f.type === 'cyberComp') continue;
      out.push({ owner: st.id, fxId: f.id, key: f.keyTrackId });
    }
  }
  return out;
}

/**
 * Add the accepted keys' edges (key → owner) to `edges`, in `keyUses` order, and return the
 * accepted ones (`<strip>:<fx>`): a key is accepted when it names a track or a return and the
 * owner cannot already reach it (outputs, sends and the keys accepted before it).
 */
export function addKeyEdges(s: RouteState, edges: Edges): Set<string> {
  const ids = new Set([...s.tracks.map(t => t.id), ...s.returns.map(r => r.id)]);
  const ok = new Set<string>();
  for (const u of keyUses(s)) {
    if (!ids.has(u.key) || reaches(edges, u.owner, u.key)) continue;
    addEdge(edges, u.key, u.owner);
    ok.add(`${u.owner}:${u.fxId}`);
  }
  return ok;
}

/** The keyed effects (`<strip>:<fx>`) whose key is used: it exists and closes no loop (1.127: through an output either). */
export function acceptedKeys(s: RouteState): Set<string> {
  return addKeyEdges(s, routeEdges(s));
}

export type RouteCheck = { ok: true } | { ok: false; reason: string };

/**
 * Whether the track or return `from` may play into `to` (an id, or null / `MASTER_OUT` for the
 * master): the rules (`outputRefusal`), then no loop: `to` must not reach `from` through the
 * other strips' outputs, the sends and the accepted keys (`from`'s own output left out).
 */
export function canRoute(s: RouteState, from: string, to: string | null): RouteCheck {
  const x: Routable | undefined = s.tracks.find(t => t.id === from) ?? s.returns.find(r => r.id === from);
  if (!x) return { ok: false, reason: 'No such track or return' };
  const why = outputRefusal(s, x, to);
  if (why) return { ok: false, reason: why };
  if (to === null || to === MASTER_OUT) return { ok: true };
  const edges = routeEdges(s, from);
  addKeyEdges(s, edges);
  if (reaches(edges, to, from)) {
    const name = s.tracks.find(t => t.id === to)?.name ?? s.returns.find(r => r.id === to)?.name ?? to;
    return { ok: false, reason: `${name} already plays into this one (a loop)` };
  }
  return { ok: true };
}

/**
 * The outputs fitted for a sanitised song (`sanitiseSequencerState`): each track's and return's
 * output kept when the rules allow it, and a track's dropped when it would close a loop through
 * the outputs kept before it (track order, so every machine keeps the same ones). Returns the
 * output by strip id (null: the master).
 */
export function fitOutputs(s: Pick<RouteState, 'tracks' | 'returns'>): Map<string, string | null> {
  const out = new Map<string, string | null>();
  const edges: Edges = new Map();
  for (const x of [...s.tracks, ...s.returns]) {
    const o = storedOutput(x);
    if (o === null || outputRefusal(s, x, o) !== null || reaches(edges, o, x.id)) { out.set(x.id, null); continue; }
    addEdge(edges, x.id, o);
    out.set(x.id, o);
  }
  return out;
}

/**
 * `t` playing into `output` (null: the master), with `groupId` written beside it while it is the
 * alias (1.127: both written for one release), and neither key at the master (the old shape).
 */
export function withOutput<T extends Routable>(x: T, output: string | null, tracks: readonly Track[]): T {
  const { output: _o, ...rest } = x as T & { output?: string | null; groupId?: string | null };
  if (!isTrack(x)) return (output === null ? rest : { ...rest, output }) as T;
  const { groupId: _g, ...base } = rest as typeof rest & { groupId?: string | null };
  if (output === null) return base as T;
  const isGroup = x.kind !== 'group' && tracks.some(g => g.id === output && g.kind === 'group');
  return { ...base, output, ...(isGroup ? { groupId: output } : {}) } as T;
}

/** `x` playing into the master (neither `output` nor `groupId`): a render's own copy of a track. */
export const atMaster = <T extends Routable>(x: T): T => withOutput(x, null, []);
