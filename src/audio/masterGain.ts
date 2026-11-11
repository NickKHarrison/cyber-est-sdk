/**
 * The master volume (the store's `masterGainDb`, the gain after the MASTER chain): its range,
 * its fader taper and how it is shown. Pure, so the MASTER page's GAIN fader, the SEQUENCER's
 * Master row, the mixer's master strip, the master automation lane, the engine and the export
 * all agree.
 *
 * The value stays in dB. `MASTER_MIN_DB` is the floor and means silence (gain 0, shown "−∞"):
 * JSON cannot hold −Infinity, so the floor is a finite number every reader treats as off.
 *
 * 1.133 (Cyber_Mixer_Inspector_Work_Order.md §2 "The master at +6"): the top is +6 dB, as a
 * track's, and the DAW master's faders (the MIX strip, the SEQ Master row, the master lane) run on
 * the tracks' taper (`masterDbToTrackFader`: linear −48…+6 dB, the bottom silent), so their marks
 * are a track's. A value above +6 is capped on set, on load and live (an older song loses the
 * excess). The Editor's MASTER GAIN keeps the knee taper (`masterDbToFader`): linear in dB from
 * the knee (−18 dB at a sixth) to +6 at the top; below the knee the travel's bottom sixth falls
 * fast to silence at 0.
 */
import { MASTER_MIN_DB, MASTER_MAX_DB, MASTER_KNEE_POS, MASTER_KNEE_DB, MASTER_TRACK_FLOOR_DB, clampMasterDb, isMasterSilent, masterDbToTrackFader, faderToMasterDbBefore133 } from '../../shared/masterTaper.mjs';

// The constants and the two tapers the server shares (`shared/masterTaper.mjs`: the limited-editor
// save check migrates a stored song's master lane as the client does).
export { MASTER_MIN_DB, MASTER_MAX_DB, MASTER_KNEE_POS, MASTER_KNEE_DB, MASTER_TRACK_FLOOR_DB, clampMasterDb, isMasterSilent, masterDbToTrackFader, faderToMasterDbBefore133 };
/** dB a whole travel above the knee. */
const UPPER_DB_PER_POS = (MASTER_MAX_DB - MASTER_KNEE_DB) / (1 - MASTER_KNEE_POS); // 28.8

/** The linear gain of a master value in dB: 0 at the floor. */
export function masterDbToGain(db: number): number {
  if (isMasterSilent(db)) return 0;
  return Math.pow(10, Math.min(MASTER_MAX_DB, db) / 20);
}

/** A fader position (0…1) as dB on the master taper. */
export function faderToMasterDb(pos: number): number {
  const p = Math.min(1, Math.max(0, Number.isFinite(pos) ? pos : 0));
  if (p >= MASTER_KNEE_POS) return MASTER_KNEE_DB + (p - MASTER_KNEE_POS) * UPPER_DB_PER_POS;
  return MASTER_MIN_DB + (p / MASTER_KNEE_POS) * (MASTER_KNEE_DB - MASTER_MIN_DB);
}

/** A master value in dB as its fader position (0…1). */
export function masterDbToFader(db: number): number {
  const d = clampMasterDb(db);
  if (d >= MASTER_KNEE_DB) return MASTER_KNEE_POS + (d - MASTER_KNEE_DB) / UPPER_DB_PER_POS;
  return ((d - MASTER_MIN_DB) / (MASTER_KNEE_DB - MASTER_MIN_DB)) * MASTER_KNEE_POS;
}

/** 1.133: a DAW master fader's position (0…1, the tracks' taper) as dB; 0 is silence (`MASTER_MIN_DB`). */
export function trackFaderToMasterDb(pos: number): number {
  const p = Math.min(1, Math.max(0, Number.isFinite(pos) ? pos : 0));
  if (p <= 0) return MASTER_MIN_DB;
  return MASTER_TRACK_FLOOR_DB + p * (MASTER_MAX_DB - MASTER_TRACK_FLOOR_DB);
}

/** A dB value from the fader, rounded to 0.1 dB (and 0 dB caught near unity). */
export function roundMasterDb(db: number): number {
  const r = Math.round(clampMasterDb(db) * 10) / 10;
  return Object.is(r, -0) ? 0 : r;
}

/** "−∞" at the floor, else as `formatDb` does: "0.0", "+3.5", "-12.0" (no unit). */
export function formatMasterDb(db: number): string {
  if (isMasterSilent(db)) return '−∞';
  const r = Math.round(db * 10) / 10;
  if (r === 0) return '0.0';
  return `${r > 0 ? '+' : ''}${r.toFixed(1)}`;
}
