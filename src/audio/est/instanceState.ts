/**
 * 1.663: **one state machine for an EST plugin instance's runtime**. Before it, what an instance was
 * doing was spread over a dozen places (the host's placeholder reason, running.ts' "stopped after a
 * problem" marks, the watchdog's stall and overrun, the processor's slow stop, the health table's
 * ghost row, the registry's block, the trial, Follow's handover, the frame's fallback), each with
 * its own words; the owner's false "Crashed. Cube Tone stopped after a problem" (1.630) came from
 * them disagreeing: a mark meaning "it may have hung last time" was drawn as a crash.
 *
 * Here every state an instance can be in, every cause that moves it, which moves are legal, and the
 * one set of words each state has. Pure and light (`EST_LIGHT`): no imports but types, no DOM, no
 * Web Audio, no store. The writers (insert.ts, instrument.ts, the watchdog's stop, the processor's
 * slow stop, running.ts' marks through `resolveEst`, the registry's block, the trial's install) all
 * move an instance through `fireEstInstance`/`stepEstInstance`, and the readers (the card, the
 * instrument panel, the window, Home's card and the plugin page, SLIDES' face, the health readout,
 * Diagnostics) read the state or the status derived from it (`statusOfState`, `reasonOfState`) and
 * its words (`estStateSentence`, `estStateLine`, `EST_STATE_CHIP`, `estStateNotice`).
 *
 * **Crashed comes only from a real fault** (`'fault'`: the plugin's code trapped or errored, or its
 * start failed): a stall is `stalled`, a slow plugin `slow-stopped`, a mark left from an earlier visit
 * `stopped-after-problem`, and none of them is drawn as a crash. A mark never reaches an instance that
 * runs (`'stopped-mark'` from `running` is refused): it only stops the next start.
 *
 * Orthogonal to the state, never a state of their own (each was once read as a reason to stop):
 * - `source`, `'installed'` or `'trial'` (1.499's play before install): a trial runs exactly as an
 *   installed version does; installing it (`'installed'`) changes the source and nothing else.
 * - `frame`, `'own'` or `'fallback'` (1.630): the plugin's own window could not be reached and the
 *   generated controls show. A UI frame never moves the runtime state (the 1.630 rule: nothing about
 *   a frame or the network writes a "stopped after a problem" record).
 *
 * The live table (`estInstanceOf`, keyed by strip and slot, the newest instance of a slot winning, as
 * status.ts' handles do) holds **live** instances only: an offline render's instance runs the same
 * transitions locally (`stepEstInstance`) and is refused by `beginEstInstance`, so a render never
 * shows in the card, Diagnostics or the health readout (its stop is worded by renderClaims.ts).
 */

import type { EstUnavailable } from './library';

/** Every state an instance can be in. */
export const EST_INSTANCE_STATES = [
  /** Built; finding its installed record (the library, the registry's blocklist, the account, the marks). */
  'resolving',
  /** Its record found and its claim held: the module and its state loading, the node being made. */
  'loading',
  /** Follow's rebuild (DEV-E): loading while the instance it replaces still plays, then a crossfade. */
  'handing-over',
  /**
   * 1.794 (D-64, shared plugins): the device does not hold the version but the open project (or live
   * room) offers it: its bundle is being fetched and run through the install pipeline ("Loading <name>…").
   */
  'loading-shared',
  /** Running (after the processor's `ready`). */
  'running',
  /** Not installed on this device (`not-installed`). */
  'missing',
  /** Another version of the plugin is installed here, not this one. */
  'other-version',
  /** The registry's blocklist names the version, or this account may not run plugins. */
  'blocked',
  /** 1.794: the project offers the plugin but nobody is signed in: "Sign in or try Cyber to hear this plugin". */
  'needs-sign-in',
  /** 1.794: the project offered the plugin and fetching or checking it failed (the pipeline's or the route's reason, in words). */
  'shared-refused',
  /** It failed the safety check (an instrument where an effect was asked for; the validator). */
  'refused',
  /** The tab's live pool was full (`claimEst`). */
  'over-budget',
  /** Marked on this device: it never got well the last time it ran here (running.ts, on evidence), until Start. */
  'stopped-after-problem',
  /** The stall watchdog stopped it: the audio clock stood still while the context ran. */
  'stalled',
  /** Too slow: over its block budget for `OVERRUN_MS`, or the processor's own slow stop (1.410). */
  'slow-stopped',
  /** A real fault: the plugin trapped, errored, or failed to start. The only way to `crashed`. */
  'crashed',
  /** An offline render's slot that is off: no instance made, the dry path (offline only). */
  'bypassed',
  /** Let go of (the slot removed or rebuilt). Final. */
  'disposed',
] as const;
export type EstInstanceState = typeof EST_INSTANCE_STATES[number];

/** Every cause that moves an instance. */
export const EST_INSTANCE_CAUSES = [
  'resolved', 'ready', 'skip', 'not-installed', 'other-version', 'block', 'refuse', 'budget',
  'stopped-mark', 'stall', 'overrun', 'slow', 'fault', 'start', 'handover-lost', 'dispose',
  /** 1.794: shared plugins. */
  'fetch-shared', 'sign-in', 'shared-refuse',
] as const;
export type EstInstanceCause = typeof EST_INSTANCE_CAUSES[number];

/** What a cause means, in words (Diagnostics and the development log). */
export const EST_CAUSE_WORDS: Readonly<Record<EstInstanceCause, string>> = {
  resolved: 'its installed record was found and its claim held',
  ready: 'the processor said it was ready',
  skip: 'an offline render left the slot off',
  'not-installed': 'the plugin is not installed on this device',
  'other-version': 'another version is installed here',
  block: 'the registry blocked the version, or the account may not run plugins',
  refuse: 'it failed the safety check',
  budget: 'the tab\'s live pool was full',
  'stopped-mark': 'it was marked stopped after a problem on this device',
  stall: 'the stall watchdog saw the audio clock stand still',
  overrun: 'it ran over its block budget for a second',
  slow: 'the processor stopped it for being too slow',
  fault: 'the plugin trapped or errored',
  start: 'Start was pressed (or the slot tried again)',
  'handover-lost': 'the instance it was replacing stopped first',
  dispose: 'the slot let it go',
  'fetch-shared': 'the project offers the plugin, so its bundle is being fetched and checked',
  'sign-in': 'the project offers the plugin, but nobody is signed in',
  'shared-refuse': 'the bundle the project offered could not be fetched or failed its check',
};

/** States where no instance runs and the slot is a placeholder (the card's words say why). */
export const EST_STOPPED_STATES: readonly EstInstanceState[] = ['missing', 'other-version', 'blocked', 'needs-sign-in', 'shared-refused', 'refused', 'over-budget', 'stopped-after-problem', 'stalled', 'slow-stopped', 'crashed', 'bypassed'];
const STOPPED = new Set<EstInstanceState>(EST_STOPPED_STATES);
/** Whether the state is a placeholder's (nothing runs). */
export const isEstStoppedState = (s: EstInstanceState): boolean => STOPPED.has(s);

/** The causes that refuse an instance before it runs, and the state each leads to. */
const REFUSALS: Readonly<Partial<Record<EstInstanceCause, EstInstanceState>>> = {
  'not-installed': 'missing', 'other-version': 'other-version', block: 'blocked', refuse: 'refused',
  budget: 'over-budget', 'stopped-mark': 'stopped-after-problem', fault: 'crashed',
  'sign-in': 'needs-sign-in', 'shared-refuse': 'shared-refused',
};

/**
 * The legal moves: for each state, each cause it takes and where it leads. Anything not listed is
 * refused (`stepEstInstance` answers null and, in development, logs it).
 */
export const EST_TRANSITIONS: Readonly<Record<EstInstanceState, Readonly<Partial<Record<EstInstanceCause, EstInstanceState>>>>> = (() => {
  const fromStopped: Partial<Record<EstInstanceCause, EstInstanceState>> = {
    // Start (the card's, after `startEstAgain`) or the host trying the slot again.
    start: 'resolving',
    // A block reaching a placeholder is the more telling reason.
    block: 'blocked',
    dispose: 'disposed',
  };
  const t: Record<EstInstanceState, Partial<Record<EstInstanceCause, EstInstanceState>>> = {
    resolving: { ...REFUSALS, resolved: 'loading', skip: 'bypassed', 'fetch-shared': 'loading-shared', dispose: 'disposed' },
    // 1.794: fetched and checked, then resolved as any installed version (the claim, the module).
    'loading-shared': { ...REFUSALS, resolved: 'loading', dispose: 'disposed' },
    loading: { ...REFUSALS, ready: 'running', skip: 'bypassed', dispose: 'disposed' },
    // Follow's rebuild resolves and loads in this state; a stall of the new instance before ready is its own.
    'handing-over': { ...REFUSALS, resolved: 'handing-over', ready: 'running', stall: 'stalled', 'handover-lost': 'loading', dispose: 'disposed' },
    running: { stall: 'stalled', overrun: 'slow-stopped', slow: 'slow-stopped', fault: 'crashed', block: 'blocked', dispose: 'disposed' },
    missing: { ...fromStopped },
    'other-version': { ...fromStopped },
    blocked: { start: 'resolving', dispose: 'disposed' },
    'needs-sign-in': { ...fromStopped },
    'shared-refused': { ...fromStopped },
    refused: { ...fromStopped },
    'over-budget': { ...fromStopped },
    'stopped-after-problem': { ...fromStopped },
    stalled: { ...fromStopped },
    'slow-stopped': { ...fromStopped },
    crashed: { ...fromStopped },
    bypassed: { dispose: 'disposed' },
    disposed: {},
  };
  return t;
})();

/** Where `cause` takes an instance in `from`, or null when the move is illegal. */
export function estNextState(from: EstInstanceState, cause: EstInstanceCause): EstInstanceState | null {
  return EST_TRANSITIONS[from][cause] ?? null;
}

let illegalLog: ((from: EstInstanceState, cause: EstInstanceCause, where: string) => void) | null = (from, cause, where) => {
  // Development only: an illegal move is a bug in a writer, never something a person can do.
  let dev = false;
  try { dev = !!(import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV; } catch { /* no import.meta.env */ }
  if (dev) console.warn(`[cyber] EST instance${where ? ` ${where}` : ''}: "${cause}" refused in "${from}" (${EST_CAUSE_WORDS[cause]})`);
};
/** Tests: hear (or silence, null) the illegal moves. Returns the logger before. */
export function setEstIllegalLog(fn: typeof illegalLog): typeof illegalLog { const was = illegalLog; illegalLog = fn; return was; }

/**
 * One move: the next state, or `from` unchanged when the move is illegal (refused and logged in
 * development; `ok` false). Used locally by an offline render's instance, and by the live table.
 */
export function stepEstInstance(from: EstInstanceState, cause: EstInstanceCause, where = ''): { state: EstInstanceState; ok: boolean } {
  const next = estNextState(from, cause);
  if (next === null) { illegalLog?.(from, cause, where); return { state: from, ok: false }; }
  return { state: next, ok: true };
}

// ---------------------------------------------------------------- reasons and the status

/** Why a slot cannot run its plugin: library.ts' `EstUnavailable` (a type only; defined there so the SDK's public mirror, which carries library.ts, needs no new file). */
export type EstReason = EstUnavailable;

/** The placeholder reason each stopped state is (the status's `reason`), undefined where none. */
export const EST_STATE_REASON: Readonly<Partial<Record<EstInstanceState, EstReason>>> = {
  missing: 'not-installed', 'other-version': 'other-version', blocked: 'blocked', refused: 'refused',
  'needs-sign-in': 'sign-in', 'shared-refused': 'shared-refused',
  'over-budget': 'budget', 'stopped-after-problem': 'stopped', stalled: 'stalled', 'slow-stopped': 'slow', crashed: 'crashed',
};
export const reasonOfState = (s: EstInstanceState): EstReason | undefined => EST_STATE_REASON[s];

/** The state a reason names (status.ts' worked-out status before any instance is built; a host's caught error). */
export function stateOfReason(r: EstReason | undefined): EstInstanceState {
  switch (r) {
    case 'other-version': return 'other-version';
    case 'blocked': return 'blocked';
    case 'refused': return 'refused';
    case 'budget': return 'over-budget';
    case 'crashed': return 'crashed';
    case 'stopped': return 'stopped-after-problem';
    case 'stalled': return 'stalled';
    case 'slow': return 'slow-stopped';
    case 'sign-in': return 'needs-sign-in';
    case 'shared-refused': return 'shared-refused';
    default: return 'missing';
  }
}

/** The cause a reason is (a host's caught error carries a reason as its message: host.ts `reasonOf`). */
export function causeOfReason(r: EstReason): EstInstanceCause {
  switch (r) {
    case 'not-installed': return 'not-installed';
    case 'other-version': return 'other-version';
    case 'blocked': return 'block';
    case 'refused': return 'refuse';
    case 'budget': return 'budget';
    case 'stopped': return 'stopped-mark';
    case 'stalled': return 'stall';
    case 'slow': return 'slow';
    case 'sign-in': return 'sign-in';
    case 'shared-refused': return 'shared-refuse';
    default: return 'fault';
  }
}

/** The status's coarse state (status.ts' `EstInsertState`) for an instance state. */
export function statusOfState(s: EstInstanceState): 'loading' | 'ready' | 'placeholder' {
  if (s === 'running') return 'ready';
  if (s === 'resolving' || s === 'loading' || s === 'handing-over' || s === 'loading-shared') return 'loading';
  return 'placeholder';
}

/** Whether a slot in this state offers Start (the hash is marked stopped on this device: a stall, a slow stop, a mark from before). */
export const estOffersStart = (s: EstInstanceState): boolean => s === 'stopped-after-problem' || s === 'stalled' || s === 'slow-stopped';
/** The same, from a status's reason. */
export const estReasonOffersStart = (r: EstReason | undefined): boolean => r === 'stopped' || r === 'stalled' || r === 'slow';
/** Whether the health readout shows the watchdog's or processor's reason (a stop it recorded, not a refusal). */
export const estReasonHasStopWhy = (r: EstReason | undefined): boolean => r === 'stalled' || r === 'slow' || r === 'crashed' || r === 'stopped';

// ---------------------------------------------------------------- words

/** The status chip each state shows (a word always beside its colour). */
export type EstChipKey = 'ready' | 'loading' | 'missing' | 'budget' | 'crashed' | 'blocked' | 'stopped' | 'stalled' | 'slow' | 'sign-in';
export const EST_CHIP_WORDS: Readonly<Record<EstChipKey, string>> = {
  ready: 'Ready', loading: 'Loading', missing: 'Missing', budget: 'Over budget', crashed: 'Crashed', blocked: 'Blocked',
  stopped: 'Stopped', stalled: 'Stalled', slow: 'Too slow', 'sign-in': 'Sign in',
};
export const EST_CHIP_TONE: Readonly<Record<EstChipKey, 'ok' | 'warn' | 'alert' | 'none'>> = {
  ready: 'ok', loading: 'none', missing: 'warn', budget: 'warn', crashed: 'alert', blocked: 'alert',
  stopped: 'warn', stalled: 'alert', slow: 'alert', 'sign-in': 'warn',
};
export const EST_STATE_CHIP: Readonly<Record<EstInstanceState, EstChipKey>> = {
  resolving: 'loading', loading: 'loading', 'handing-over': 'loading', 'loading-shared': 'loading', running: 'ready',
  missing: 'missing', 'other-version': 'missing', blocked: 'blocked', 'needs-sign-in': 'sign-in', 'shared-refused': 'blocked', refused: 'blocked', 'over-budget': 'budget',
  'stopped-after-problem': 'stopped', stalled: 'stalled', 'slow-stopped': 'slow', crashed: 'crashed',
  bypassed: 'missing', disposed: 'missing',
};

/** 1.794: what a signed-out visitor is told of a plugin the project offers (with Sign in and Try Cyber beside it). */
export const EST_SIGN_IN_TO_HEAR = 'Sign in or try Cyber to hear this plugin.';

/**
 * The one sentence each state has, naming the plugin (`it`: "EST Gain 1.0.0"); the host adds its
 * tail (an effect's "The sound passes through.", an instrument's "The track is silent; its notes are
 * kept.", a SLIDES block's "This instrument is silent."): `EST_TAILS`. `because`: a block's reason
 * (`blocked`) or, 1.794, why a shared plugin was refused (`shared-refused`: the pipeline's or the route's words).
 */
export function estStateSentence(s: EstInstanceState, it: string, blockedBecause?: string | null): string {
  switch (s) {
    case 'resolving': case 'loading': case 'handing-over': return `${it} is loading.`;
    case 'loading-shared': return `${it} is loading from the project.`;
    case 'needs-sign-in': return `${it} plays once you sign in. ${EST_SIGN_IN_TO_HEAR}`;
    case 'shared-refused': return blockedBecause ? `${it} could not be loaded from the project: ${blockedBecause.replace(/\.$/, '')}.` : `${it} could not be loaded from the project.`;
    case 'running': return `${it} is running.`;
    case 'missing': return `${it} isn't installed on this device.`;
    case 'other-version': return `${it} isn't installed here (another version is).`;
    case 'blocked': return blockedBecause ? `${it} was blocked by the registry (${blockedBecause}).` : `${it} was blocked and is off.`;
    case 'refused': return `${it} failed the safety check and is off.`;
    case 'over-budget': return `${it} didn't start: too many plugins in this tab.`;
    case 'stopped-after-problem': return `${it} stopped after a problem the last time it ran on this device, so it is off until you press Start.`;
    case 'stalled': return `${it} stalled the audio and was stopped, so it is off until you press Start.`;
    case 'slow-stopped': return `${it} was too slow for the audio and was stopped, so it is off until you press Start.`;
    case 'crashed': return `${it} stopped after a problem.`;
    case 'bypassed': return `${it} is bypassed.`;
    case 'disposed': return `${it} was removed.`;
  }
}

/** What each host adds after a stopped state's sentence. */
export const EST_TAILS = {
  effect: 'The sound passes through.',
  instrument: 'The track is silent; its notes are kept.',
  block: 'This instrument is silent.',
} as const;

/** The short line Home's EST PLUGINS card and the plugin page give a stopped state (null while it can run). */
export function estStateLine(s: EstInstanceState, blockedBecause?: string | null): string | null {
  switch (s) {
    case 'blocked': return blockedBecause ? `Blocked by the registry (${blockedBecause}).` : 'Blocked: it is off everywhere.';
    case 'refused': return 'It failed the safety check and is off.';
    case 'stopped-after-problem': return 'Stopped after a problem the last time it ran on this device: open it to start it again.';
    case 'stalled': return 'It stalled the audio and was stopped: open it to start it again.';
    case 'slow-stopped': return 'It was too slow for the audio and was stopped: open it to start it again.';
    case 'crashed': return 'It stopped after a problem.';
    case 'over-budget': return 'Too many plugins are running in this tab.';
    case 'needs-sign-in': return EST_SIGN_IN_TO_HEAR;
    case 'shared-refused': return blockedBecause ? `It could not be loaded from the project: ${blockedBecause.replace(/\.$/, '')}.` : 'It could not be loaded from the project.';
    case 'missing': case 'other-version': return 'Not installed on this device.';
    default: return null;
  }
}

/** The page notice a state entered while the page plays gives (once, as it is entered), or null. */
export function estStateNotice(s: EstInstanceState): string | null {
  switch (s) {
    case 'stalled': return 'A plugin stalled the audio and was stopped.';
    case 'slow-stopped': return 'A plugin was too slow for the audio and was stopped.';
    default: return null;
  }
}

// ---------------------------------------------------------------- the live table

/** One live instance's record. */
export interface EstInstanceRecord {
  /** This instance's own id (a slot rebuilt has a new one; Follow's old instance keeps its own). */
  id: number;
  stripId: string;
  slotId: string;
  /** The plugin version it runs (its hash: the marks, the trial and the library key on it). */
  hash: string;
  state: EstInstanceState;
  /** The cause of the last move (absent at the start). */
  cause?: EstInstanceCause;
  /** 1.794: `'shared'`, a bundle the open project offered (shared.ts), held as a trial is (never in the library). */
  source: 'installed' | 'trial' | 'shared';
  frame: 'own' | 'fallback';
  /** `Date.now()` of the last move. */
  at: number;
}

const keyOf = (stripId: string, slotId: string) => `${stripId}|${slotId}`;
const byId = new Map<number, EstInstanceRecord>();
/** The newest live instance of each slot (by its id). */
const bySlot = new Map<string, number>();
const listeners = new Set<(r: EstInstanceRecord) => void>();
let nextId = 0;
let clock = (): number => Date.now();

const tell = (r: EstInstanceRecord) => { for (const fn of listeners) { try { fn(r); } catch { /* one listener never stops the others */ } } };

export interface EstInstanceStart {
  stripId: string;
  slotId: string;
  hash: string;
  /** `'handing-over'` for Follow's rebuild, else `'resolving'`. */
  state?: 'resolving' | 'handing-over';
  /** An offline render's instance: refused (the live table holds live instances only). */
  offline?: boolean;
}

/**
 * A live instance begins (its host was built): its record, the slot's newest. Returns its id, or
 * null for an offline render's instance (never in the live table) or without a strip.
 */
export function beginEstInstance(o: EstInstanceStart): number | null {
  if (o.offline || !o.stripId) return null;
  const r: EstInstanceRecord = { id: ++nextId, stripId: o.stripId, slotId: o.slotId, hash: o.hash, state: o.state ?? 'resolving', source: 'installed', frame: 'own', at: clock() };
  byId.set(r.id, r);
  bySlot.set(keyOf(o.stripId, o.slotId), r.id);
  tell(r);
  return r.id;
}

/** Move a live instance (by its id) by `cause`. Returns the state it is in after (unchanged when refused), or null for an unknown id. */
export function fireEstInstance(id: number | null, cause: EstInstanceCause): EstInstanceState | null {
  const r = id === null ? undefined : byId.get(id);
  if (!r) return null;
  const { state, ok } = stepEstInstance(r.state, cause, `${r.stripId}/${r.slotId}`);
  if (!ok || state === r.state) return r.state;
  r.state = state;
  r.cause = cause;
  r.at = clock();
  if (state === 'disposed') {
    byId.delete(r.id);
    const k = keyOf(r.stripId, r.slotId);
    if (bySlot.get(k) === r.id) bySlot.delete(k);
  }
  tell(r);
  return state;
}

/** The hash a live instance runs changed (a version switch keeps the instance's record only through a rebuild; this is for a resolved trial). */
export function noteEstInstanceSource(id: number | null, source: 'installed' | 'trial' | 'shared'): void {
  const r = id === null ? undefined : byId.get(id);
  if (!r || r.source === source) return;
  // A trial becomes installed; an installed version never turns back into a trial while it runs.
  if (r.source === 'installed' && source !== 'installed' && r.state !== 'resolving' && r.state !== 'loading' && r.state !== 'handing-over' && r.state !== 'loading-shared') {
    illegalLog?.(r.state, 'resolved', `${r.stripId}/${r.slotId} (installed → ${source})`);
    return;
  }
  r.source = source;
  tell(r);
}

/** The library now holds `hash`: every live instance running it as a trial is installed (the state unchanged). Returns how many moved. */
export function noteEstTrialInstalled(hash: string): number {
  let n = 0;
  for (const r of byId.values()) if (r.hash === hash && (r.source === 'trial' || r.source === 'shared')) { r.source = 'installed'; n++; tell(r); }
  return n;
}

/** 1.630: the plugin's own window could not be reached (`'fallback'`) or was again (`'own'`). Never moves the state. */
export function noteEstInstanceFrame(stripId: string, slotId: string, frame: 'own' | 'fallback'): void {
  const r = estInstanceOf(stripId, slotId);
  if (!r || r.frame === frame) return;
  r.frame = frame;
  tell(r);
}

/** The newest live instance of a slot, or null (none built, disposed, or a render's). */
export function estInstanceOf(stripId: string, slotId: string): EstInstanceRecord | null {
  const id = bySlot.get(keyOf(stripId, slotId));
  return id === undefined ? null : byId.get(id) ?? null;
}
/** A live instance by its id. */
export const estInstanceById = (id: number | null): EstInstanceRecord | null => (id === null ? null : byId.get(id) ?? null);
/** Every live instance (Diagnostics), newest last. */
export const estInstances = (): readonly EstInstanceRecord[] => [...byId.values()];

/** Hear every move (a record begun, moved, its source or frame changed). Returns the unsubscribe. */
export function onEstInstance(fn: (r: EstInstanceRecord) => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

/** Tests only. */
export function resetEstInstancesForTests(now?: () => number): void {
  byId.clear();
  bySlot.clear();
  nextId = 0;
  clock = now ?? (() => Date.now());
}
