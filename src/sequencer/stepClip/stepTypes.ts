/**
 * 1.482 (Cyber_Step_Sequencer_Work_Order.md): a **Step Sequencer clip**, Live 13's. A MIDI clip
 * (`Clip` or a Session MIDI clip) whose `steps` is set is edited and played as rows of steps; its
 * `notes` are then ignored for playback (kept, so Convert back is lossless where it can be).
 * Pure types and constants only: every reader goes through `src/sequencer/stepClip/`.
 */

/** Live 13's Size choices: the most steps any row may have. */
export const STEP_SIZES = [8, 16, 32, 64, 128] as const;
export type StepSize = (typeof STEP_SIZES)[number];

/** A row's rate: the length of one of its steps, in beats (a quarter note = 1). */
export const STEP_RATES = [
  { id: '1/32t', beats: 1 / 12 }, { id: '1/32', beats: 1 / 8 }, { id: '1/16t', beats: 1 / 6 },
  { id: '1/16', beats: 1 / 4 }, { id: '1/16d', beats: 3 / 8 }, { id: '1/8t', beats: 1 / 3 },
  { id: '1/8', beats: 1 / 2 }, { id: '1/8d', beats: 3 / 4 }, { id: '1/4t', beats: 2 / 3 },
  { id: '1/4', beats: 1 }, { id: '1/4d', beats: 3 / 2 }, { id: '1/2', beats: 2 }, { id: '1', beats: 4 },
] as const;
export type StepRateId = (typeof STEP_RATES)[number]['id'];

/** The order a row walks its steps. */
export const STEP_DIRECTIONS = ['forward', 'reverse', 'pingpong', 'random'] as const;
export type StepDirection = (typeof STEP_DIRECTIONS)[number];

/** The six per-step parameters (the editor's tabs, in Live's order). */
export const STEP_PARAMS = ['velocity', 'offset', 'length', 'repeat', 'pitch', 'chance'] as const;
export type StepParam = (typeof STEP_PARAMS)[number];

/**
 * The ranges Cyber chose where Live 13's beta notes are silent (the manual's §15.2). One table, so
 * a value found in the shipped Live is one edit here (and its tests).
 */
export const STEP_LIMITS = {
  /** Row swing, per cent: 0 straight, 100 the off-steps moved by half a step. */
  swing: { min: 0, max: 100 },
  /** Offset, per cent of a step: −50…+50. */
  offset: { min: -50, max: 50 },
  /** Length, per cent of the step's span (its own `span` steps): 1…100. */
  length: { min: 1, max: 100 },
  /** Repeat: how many hits share the step, 1 (none) … 8. */
  repeat: { min: 1, max: 8 },
  /** Pitch: the step's bend, semitones −12…+12 (0 none), played as per-note bend. */
  pitch: { min: -12, max: 12 },
  /** Chance, per cent 0…100 (100 always). */
  chance: { min: 0, max: 100 },
} as const;

/** One step. Absent fields are the defaults (velocity 100, offset 0, length 100, repeat 1, pitch 0, chance 100, span 1). */
export interface Step {
  /** 1…127; a step with no velocity (or 0) is off. */
  velocity?: number;
  offset?: number;
  length?: number;
  repeat?: number;
  pitch?: number;
  chance?: number;
  /** Extended over this many adjacent step positions (Live's edge drag, ⌘⇧←/→), 1…the row's steps. */
  span?: number;
}

export interface StepRow {
  id: string;
  /** The MIDI note (a Drum Rack pad's note, a Cyber PADS pad row, or a pitch). */
  pitch: number;
  /** The row's own length in steps, 1…the clip's `size`. */
  steps: number;
  rate: StepRateId;
  dir: StepDirection;
  /** STEP_LIMITS.swing. */
  swing: number;
  muted?: boolean;
  soloed?: boolean;
  /** Sparse: the on steps by index (0…size−1); a missing index is off. Steps past `steps` are kept but not played. */
  cells: Record<number, Step>;
}

export interface StepClipData {
  size: StepSize;
  rows: StepRow[];
  /** Fold to Scale: melodic rows outside the clip's scale are hidden (view and add-row choices only; data unchanged). */
  fold?: boolean;
}

export const MAX_STEP_ROWS = 128;
