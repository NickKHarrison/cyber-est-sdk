/**
 * 1.482 (Cyber_Step_Sequencer_Work_Order.md): a Step Sequencer clip's `steps` in range. Called by
 * `sanitiseClip` (so the arrangement's and the Session's MIDI clips alike): every field clamped to
 * `STEP_LIMITS`, the size one of `STEP_SIZES`, at most `MAX_STEP_ROWS` rows with unique ids, cells
 * past `size` pruned, a cell with velocity 0 dropped (off), defaults left absent. Pure; imports no
 * runtime value from `sequencerTypes.ts` (which imports this), so the pitch ceiling is passed in.
 */

import {
  MAX_STEP_ROWS, STEP_DIRECTIONS, STEP_LIMITS, STEP_RATES, STEP_SIZES,
  type Step, type StepClipData, type StepDirection, type StepRateId, type StepRow, type StepSize,
} from './stepTypes';

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const ROW_ID_RE = /^[A-Za-z0-9_-]{1,40}$/;
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const clampInt = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Math.round(v)));

export const DEFAULT_STEP_RATE: StepRateId = '1/16';
export const DEFAULT_STEP_SIZE: StepSize = 16;

export const isStepSize = (v: unknown): v is StepSize => (STEP_SIZES as readonly unknown[]).includes(v);
export const isStepRate = (v: unknown): v is StepRateId => STEP_RATES.some(r => r.id === v);
export const isStepDirection = (v: unknown): v is StepDirection => (STEP_DIRECTIONS as readonly unknown[]).includes(v);
/** A rate's step length in beats. */
export const rateBeats = (id: StepRateId): number => STEP_RATES.find(r => r.id === id)?.beats ?? 0.25;

/** One step in range, defaults left out; null when off (velocity 0). `room` is how many positions are left from its index to the row's end (its span's ceiling). */
export function sanitiseStep(raw: unknown, room: number): Step | null {
  if (!isObj(raw)) return null;
  const out: Step = {};
  if (finite(raw.velocity)) {
    const v = clampInt(raw.velocity, 0, 127);
    if (v === 0) return null;
    if (v !== 100) out.velocity = v;
  }
  const L = STEP_LIMITS;
  if (finite(raw.offset)) { const v = clampInt(raw.offset, L.offset.min, L.offset.max); if (v !== 0) out.offset = v; }
  if (finite(raw.length)) { const v = clampInt(raw.length, L.length.min, L.length.max); if (v !== 100) out.length = v; }
  if (finite(raw.repeat)) { const v = clampInt(raw.repeat, L.repeat.min, L.repeat.max); if (v !== 1) out.repeat = v; }
  if (finite(raw.pitch)) { const v = clampInt(raw.pitch, L.pitch.min, L.pitch.max); if (v !== 0) out.pitch = v; }
  if (finite(raw.chance)) { const v = clampInt(raw.chance, L.chance.min, L.chance.max); if (v !== 100) out.chance = v; }
  if (finite(raw.span)) { const v = clampInt(raw.span, 1, Math.max(1, room)); if (v !== 1) out.span = v; }
  return out;
}

/**
 * The rows and clip data this sanitiser returned, with the `size|maxPitch` (and for a clip's data,
 * the `maxPitch`) they were made for. Its output is a fixed point (sanitising it again gives an equal
 * value) and the song's objects are never changed in place (every edit copies), so one it made is
 * handed back as it is: an edit keeps every other row's object, and the Step editor (rows memoised by
 * their object, the canvas repainting only changed rows) redraws one row, not all of them. Until
 * this, every write made 64 new rows at 128 × 64, which re-rendered every row and repainted the
 * whole page in the edit's task (`e2e/step-editor.spec.ts`' long-task bound).
 */
const cleanRows = new WeakMap<object, string>();
const cleanData = new WeakMap<object, number>();

/** One row in range, or null (no id, or a pitch outside 0…maxPitch). */
export function sanitiseStepRow(raw: unknown, size: StepSize, maxPitch: number): StepRow | null {
  if (!isObj(raw) || typeof raw.id !== 'string' || !ROW_ID_RE.test(raw.id)) return null;
  if (cleanRows.get(raw) === `${size}|${maxPitch}`) return raw as unknown as StepRow;
  if (!finite(raw.pitch)) return null;
  const pitch = Math.round(raw.pitch);
  if (pitch < 0 || pitch > maxPitch) return null;
  const steps = finite(raw.steps) ? clampInt(raw.steps, 1, size) : Math.min(16, size);
  const cells: Record<number, Step> = {};
  if (isObj(raw.cells)) {
    for (const [k, v] of Object.entries(raw.cells)) {
      if (!/^\d{1,3}$/.test(k)) continue;
      const i = Number(k);
      if (i >= size) continue;
      const s = sanitiseStep(v, size - i);
      if (s) cells[i] = s;
    }
  }
  const row: StepRow = {
    id: raw.id, pitch, steps,
    rate: isStepRate(raw.rate) ? raw.rate : DEFAULT_STEP_RATE,
    dir: isStepDirection(raw.dir) ? raw.dir : 'forward',
    swing: finite(raw.swing) ? clampInt(raw.swing, STEP_LIMITS.swing.min, STEP_LIMITS.swing.max) : 0,
    cells,
  };
  if (raw.muted === true) row.muted = true;
  if (raw.soloed === true) row.soloed = true;
  cleanRows.set(row, `${size}|${maxPitch}`);
  return row;
}

/**
 * A clip's `steps` in range, or undefined (absent or not an object: an ordinary MIDI clip).
 * `maxPitch` is 127, or `PAD_ROWS − 1` on a track that plays a pad kit.
 */
export function sanitiseStepClip(raw: unknown, maxPitch = 127): StepClipData | undefined {
  if (!isObj(raw)) return undefined;
  if (cleanData.get(raw) === maxPitch) return raw as unknown as StepClipData;
  const size = isStepSize(raw.size) ? raw.size : DEFAULT_STEP_SIZE;
  const rows: StepRow[] = [];
  const seen = new Set<string>();
  if (Array.isArray(raw.rows)) {
    for (const r of raw.rows) {
      if (rows.length >= MAX_STEP_ROWS) break;
      const row = sanitiseStepRow(r, size, maxPitch);
      if (row && !seen.has(row.id)) { seen.add(row.id); rows.push(row); }
    }
  }
  const out: StepClipData = { size, rows, ...(raw.fold === true ? { fold: true } : {}) };
  cleanData.set(out, maxPitch);
  return out;
}
