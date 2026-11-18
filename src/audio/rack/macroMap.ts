/**
 * 1.741: the racks' **macro mapping**, Live's, shared by the Instrument Rack (`rackTypes.ts`) and the
 * Audio Effect Rack (`fxRackTypes.ts`). Pure: no store, no DOM.
 *
 * - **Map mode** (view state, never saved): Map on, a click on a macro chooses it, then a click on a
 *   parameter maps it to that macro over the parameter's whole range; the macro stays chosen, so
 *   several parameters map in a row, and a click on the chosen macro again lets it go. Escape or Map
 *   again leaves map mode.
 * - **Ranges**: a mapping's `min` and `max` in the parameter's own units, each held to the
 *   parameter's range; `min` above `max` is an inverted mapping (the macro turns the parameter down),
 *   which `macroValue`/`fxMacroValue` already play.
 * - **Colour**: a macro's optional `colour`, one of the palette's HSL triples (`"h s% l%"`), nothing
 *   else kept.
 * - **Chain order**: where a chain dragged in a list lands (`chainDropIndex`).
 */

/** A palette colour as the song keeps it (`PALETTE`'s values: "hue sat% light%"). */
const HSL_RE = /^(\d{1,3}) (\d{1,3})% (\d{1,3})%$/;

/** A macro's colour from anything: an HSL triple in range, else undefined (no colour). */
export function sanitiseMacroColour(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  const m = HSL_RE.exec(v);
  if (!m) return undefined;
  const [h, s, l] = [Number(m[1]), Number(m[2]), Number(m[3])];
  return h <= 360 && s <= 100 && l <= 100 ? v : undefined;
}

/** Map mode: off (null) or on, with the macro a parameter's click maps to (null: none chosen yet). */
export type MapMode = { macro: number | null } | null;

/** Map pressed: on with no macro chosen, or off. */
export const toggleMapMode = (m: MapMode): MapMode => (m ? null : { macro: null });

/** A macro clicked in map mode: chosen, or let go when it was the chosen one. Off, nothing changes. */
export function pickMapMacro(m: MapMode, i: number): MapMode {
  if (!m) return m;
  return { macro: m.macro === i ? null : i };
}

/** The macro a parameter's click maps to now (null: map mode off or no macro chosen). */
export const mapTargetMacro = (m: MapMode): number | null => (m ? m.macro : null);

/** What map mode says to do (the words under the macros). */
export function mapModeHint(m: MapMode, macroName: (i: number) => string): string {
  if (!m) return '';
  if (m.macro === null) return 'Map mode: click a macro, then the parameters it should turn.';
  return `Map mode: click a parameter to map it to ${macroName(m.macro)} (Escape or Map to finish).`;
}

/** A value held to a parameter's range (a non-number: the bound it is nearer, `lo`). */
const hold = (v: number, lo: number, hi: number): number => (Number.isFinite(v) ? Math.max(Math.min(lo, hi), Math.min(Math.max(lo, hi), v)) : Math.min(lo, hi));

/**
 * A mapping's range after one end is set: that end held to the parameter's range [`lo`, `hi`], the
 * other unchanged. Either may pass the other (an inverted mapping).
 */
export function mapRangeEdit(map: { min: number; max: number }, end: 'min' | 'max', v: number, lo: number, hi: number): { min: number; max: number } {
  return end === 'min' ? { min: hold(v, lo, hi), max: map.max } : { min: map.min, max: hold(v, lo, hi) };
}

/** A mapping's range turned round (Live's Invert Range). */
export const invertMapRange = (map: { min: number; max: number }): { min: number; max: number } => ({ min: map.max, max: map.min });

/** Whether a mapping turns its parameter down as the macro goes up. */
export const isInverted = (map: { min: number; max: number }): boolean => map.min > map.max;

/** A range in words: "200 Hz to 2.2 kHz", inverted said so. */
export function rangeWords(map: { min: number; max: number }, format: (v: number) => string): string {
  return `${format(map.min)} to ${format(map.max)}${isInverted(map) ? ' (inverted)' : ''}`;
}

/**
 * Where a chain dragged in a list lands: the first row whose middle is below the pointer (`mids`,
 * each row's middle in the list's order), else the last. -1 for no rows.
 */
export function chainDropIndex(mids: readonly number[], y: number): number {
  if (!mids.length) return -1;
  for (let i = 0; i < mids.length; i++) if (y < mids[i]!) return i;
  return mids.length - 1;
}

/** A chain's drag moved by the keys (Alt+↑/↓): the index it goes to, within the list. */
export const chainKeyMove = (from: number, dir: -1 | 1, n: number): number => Math.max(0, Math.min(n - 1, from + dir));

/**
 * The range a click in map mode gives an Instrument Rack parameter (a patch path has no range of its
 * own): 0 to 1 for a value in 0…1, −1 to 1 for one in −1…0, else 0 to twice it (or twice it to 0 for
 * a negative one), rounded to three places. The person sets the ends after.
 */
export function defaultPatchRange(value: unknown): { min: number; max: number } {
  const v = typeof value === 'number' && Number.isFinite(value) ? value : 0;
  const r3 = (x: number) => Math.round(x * 1000) / 1000;
  if (v >= 0 && v <= 1) return { min: 0, max: 1 };
  if (v < 0 && v >= -1) return { min: -1, max: 1 };
  return v > 0 ? { min: 0, max: r3(v * 2) } : { min: r3(v * 2), max: 0 };
}
