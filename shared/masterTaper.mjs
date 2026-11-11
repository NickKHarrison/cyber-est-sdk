/**
 * 1.133: the DAW master fader's tapers, shared by the app (`src/audio/masterGain.ts` re-exports
 * these) and the server (`server/workspaceLimits.mjs` migrates a stored song's master lane the
 * way the client does before comparing a limited editor's save). Pure: dB in, fader positions out.
 *
 * `MASTER_MIN_DB` is the floor and means silence; `MASTER_MAX_DB` the top (+6 since 1.133, as a
 * track's). The tracks' taper is linear in dB from `MASTER_TRACK_FLOOR_DB` to the top, position 0
 * silence. The knee taper before 1.133 ran to +12 (`faderToMasterDbBefore133`): the migration
 * keeps an old lane's points at their dB (`migrateMasterLanePoints`).
 */
export const MASTER_MIN_DB = -70;
export const MASTER_MAX_DB = 6;
export const MASTER_KNEE_POS = 1 / 6;
export const MASTER_KNEE_DB = -18;
export const MASTER_TRACK_FLOOR_DB = -48;

/** @param {number} db */
export function clampMasterDb(db) {
  if (typeof db !== 'number' || Number.isNaN(db)) return 0;
  return Math.min(MASTER_MAX_DB, Math.max(MASTER_MIN_DB, db));
}

/** @param {number} db */
export function isMasterSilent(db) {
  return !(db > MASTER_MIN_DB + 1e-6);
}

/** A master value as the DAW master fader's position on the tracks' taper (0 at silence). @param {number} db */
export function masterDbToTrackFader(db) {
  if (isMasterSilent(db)) return 0;
  const d = clampMasterDb(db);
  return Math.min(1, Math.max(0, (d - MASTER_TRACK_FLOOR_DB) / (MASTER_MAX_DB - MASTER_TRACK_FLOOR_DB)));
}

/** The master lane's taper before 1.133 (the knee taper with its top at +12 dB). @param {number} pos */
export function faderToMasterDbBefore133(pos) {
  const p = Math.min(1, Math.max(0, Number.isFinite(pos) ? pos : 0));
  if (p >= MASTER_KNEE_POS) return MASTER_KNEE_DB + (p - MASTER_KNEE_POS) * ((12 - MASTER_KNEE_DB) / (1 - MASTER_KNEE_POS));
  return MASTER_MIN_DB + (p / MASTER_KNEE_POS) * (MASTER_KNEE_DB - MASTER_MIN_DB);
}

/** A master-volume lane point's value from the old taper to the tracks' at the same dB. @param {number} v */
export function migrateMasterLaneValue(v) {
  return Math.round(masterDbToTrackFader(faderToMasterDbBefore133(v)) * 1e6) / 1e6;
}

/**
 * The lanes of a song written before 1.133 (no `masterTaper`), with every master-volume lane's
 * points moved to the tracks' taper; the same list when none is there. Plain data in, plain
 * data out (the server runs it on a stored song before comparing a limited editor's save).
 * @param {unknown} lanes @returns {unknown}
 */
export function migrateMasterLanePoints(lanes) {
  if (!Array.isArray(lanes)) return lanes;
  const isMaster = (/** @type {any} */ l) => l && typeof l === 'object' && l.target && l.target.kind === 'master' && l.target.param === 'volume';
  if (!lanes.some(isMaster)) return lanes;
  return lanes.map((/** @type {any} */ l) => (isMaster(l) && Array.isArray(l.points)
    ? { ...l, points: l.points.map((/** @type {any} */ p) => (p && typeof p === 'object' && typeof p.value === 'number' ? { ...p, value: migrateMasterLaneValue(p.value) } : p)) }
    : l));
}
