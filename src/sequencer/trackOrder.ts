import { groupOf } from './routing';
import type { Track } from './sequencerTypes';

/**
 * 1.136 (stream G1, Cyber_Grouping_Layout_Work_Order.md §2 "The order rule"): a group's members
 * lie directly under it, as in Live. Pure, and with no value import from `sequencerTypes.ts` (its
 * sanitiser's `fitMix` applies `groupedOrder` on load).
 *
 * The rows that are no group's member (groups, and the tracks that play into the master, a return
 * or an audio track) keep their relative order; each group is followed by its members (`groupOf`),
 * in their current relative order; a group with no members stays alone. Deterministic, so every
 * peer of a live room gathers the same way.
 */
export function groupedOrder<T extends Track>(tracks: readonly T[]): readonly T[] {
  const groupOfId = new Map<string, string>();
  for (const t of tracks) {
    const g = groupOf(t, tracks);
    if (g) groupOfId.set(t.id, g);
  }
  if (!groupOfId.size) return tracks;
  const members = new Map<string, T[]>();
  for (const t of tracks) {
    const g = groupOfId.get(t.id);
    if (!g) continue;
    let list = members.get(g);
    if (!list) { list = []; members.set(g, list); }
    list.push(t);
  }
  const out: T[] = [];
  for (const t of tracks) {
    if (groupOfId.has(t.id)) continue;
    out.push(t);
    if (t.kind === 'group') out.push(...(members.get(t.id) ?? []));
  }
  return out.every((t, i) => t === tracks[i]) ? tracks : out;
}

/**
 * The top-level units of an order: each group with its members (as they lie after `groupedOrder`),
 * or one track alone. The ids, top to bottom.
 */
export function trackUnits(tracks: readonly Track[]): string[][] {
  const units: string[][] = [];
  for (const t of groupedOrder(tracks)) {
    const g = groupOf(t, tracks);
    const last = units[units.length - 1];
    if (g && last && last[0] === g) last.push(t.id);
    else units.push([t.id]);
  }
  return units;
}

/**
 * The order after moving track `id` to `toIndex` (`moveTrack`'s index: where the row lands, read
 * as a plain splice would, so the SEQ grip, the header drag and MIX's strip drag keep their maths).
 *
 * - A **member** stays inside its block: the index is clamped to the rows under its group.
 * - Any other row moves as a **unit** (a group with its members, or a track alone): the row named
 *   by `toIndex` picks the unit it lies in, and the moved unit goes just above it (moving up) or
 *   just below it (moving down). A move down by one that names the unit's own member (the grip's
 *   ↓ on a group) steps over the next unit.
 *
 * Returns the same array when nothing moves.
 */
export function movedOrder<T extends Track>(tracks: readonly T[], id: string, toIndex: number): readonly T[] {
  const from = tracks.findIndex(x => x.id === id);
  if (from < 0 || !Number.isFinite(toIndex)) return tracks;
  let to = Math.max(0, Math.min(tracks.length - 1, Math.round(toIndex)));
  const t = tracks[from]!;
  const g = groupOf(t, tracks);
  if (g) {
    // A member: clamped inside its group's rows (the block as it lies).
    const gi = tracks.findIndex(x => x.id === g);
    let end = gi;
    while (end + 1 < tracks.length && groupOf(tracks[end + 1]!, tracks) === g) end++;
    if (gi < 0 || from <= gi || from > end) return plainMove(tracks, from, to); // not gathered (an old peer's write)
    to = Math.max(gi + 1, Math.min(end, to));
    return plainMove(tracks, from, to);
  }
  if (to === from) return tracks;
  const units = trackUnits(tracks);
  const unitOf = (rowId: string) => units.findIndex(u => u.includes(rowId));
  const own = unitOf(id);
  let target = unitOf(tracks[to]!.id);
  if (own < 0 || target < 0) return tracks;
  if (target === own) {
    if (to !== from + 1) return tracks;
    target = own + 1;
    if (target >= units.length) return tracks;
  }
  const moving = units[own]!;
  const rest = units.filter((_, i) => i !== own);
  const at = rest.indexOf(units[target]!);
  rest.splice(to < from ? at : at + 1, 0, moving);
  const byId = new Map(tracks.map(x => [x.id, x] as const));
  const out = rest.flat().map(x => byId.get(x)!);
  return out.every((x, i) => x === tracks[i]) ? tracks : out;
}

function plainMove<T>(tracks: readonly T[], from: number, to: number): readonly T[] {
  if (to === from) return tracks;
  const out = tracks.slice();
  const [t] = out.splice(from, 1);
  out.splice(to, 0, t!);
  return out;
}
