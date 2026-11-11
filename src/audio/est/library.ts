/**
 * EST Phase 2 foundation (docs/est/EST_Phase2_Work_Order.md §0.1): the seam between the install
 * pipeline (stream 2-D provides it) and everything that uses an installed plugin (the mixer insert
 * 2-A, the UI 2-C). Until a provider is set, nothing is installed, so every EST slot is a
 * missing-plugin placeholder that passes audio. Light: types and a setter only.
 *
 * Decisions this rests on: D-11 (installed per account, referenced per project), D-13 (opening a
 * project, joining a room or receiving a share never installs or fetches plugin code: `module()`
 * reads the local store only), D-27 (modules are compiled in the compiling Worker, never from
 * bytes in the page or the worklet), D-30 (every module is metered at install).
 */

import type { EstMigrateEntry, EstRef } from './slot';

export type EstKind = 'effect' | 'instrument';

/** What the pipeline kept of a bundle's `est.json` (spec §1), validated. */
export interface EstManifestInfo {
  id: string;
  version: string;
  name: string;
  vendor: string;
  description: string;
  kind: EstKind;
  features: string[];
  /** The UI page's path in the bundle, when it has one (served from the plugin origin). */
  ui: { path: string; w: number; h: number; resizable: boolean } | null;
  audio: { inputs: number; outputs: number };
  limits: { maxLatencyFrames: number; memoryPagesMax: number; tailSeconds: number };
  /** EST Phase 3: the note ports `est.json` declares (an instrument has at least one input). Absent in records from before 1.283. */
  notes?: { inputs: number; outputs: number };
  /** EST Phase 3: how many presets the bundle carries (`presets/index.json`, spec §6). Absent: none known. */
  presets?: number;
  /** EST tidy (1.286, D-44): the parameter ids est.json marks `"scale": "log"`. Absent: none (every record before 1.286). */
  logParams?: number[];
  /** EST 1.1 (1.327, DEV-H, D-56): present only on a 1.1 bundle's record. */
  edition?: '1.1';
  /** EST 1.1: the sidechain input's channels (`audio.inputs[1]`); absent: none. */
  sidechain?: number;
  /** EST 1.1: the ids est.json marks `"modulatable": true` (Cyber's modulators send them `PARAM_MOD`). */
  modulatable?: number[];
  /** EST 1.1 (protocol v3): the UI may ask for an analysis of the output (`ui.audio`). */
  uiAudio?: true;
  /** 1.337 (R-F): est.json's `migrate` entries, when it has any (`migrate.ts` applies them on Use installed version). */
  migrate?: EstMigrateEntry[];
  /** 1.337 (R-F): the parameters est.json lists, by CLAP id (a decimal string), with their names: what a switch's toast calls them. Absent in records from before 1.337 and when est.json lists none. */
  paramNames?: Record<string, string>;
}

/**
 * EST Phase 3 (spec §6): one of a bundle's own presets, as the install pipeline validated it: `id`
 * is its path in the bundle (unique and stable for the version), `state` the base64 of its CLAP
 * state stream (at most `EST_STATE_INLINE_MAX` bytes, so it fits `EstSlotBlock.state` as it is).
 */
export interface EstPreset {
  id: string;
  name: string;
  tags: string[];
  state: string;
  /** EST 1.1: the preset's picture, a `data:image/webp` URL (validated at install, at most 64 KiB). */
  image?: string;
  /** EST 1.1: who made the preset. */
  author?: string;
}

/** One installed plugin version on this account (the local record; the server's lacks the bytes). */
export interface EstInstalled {
  ref: EstRef;
  manifest: EstManifestInfo;
  /** 'developer': loaded from localhost in developer mode, never shareable (security §8 tier 0). */
  /** 1.320 (DEV-B §4): `'studio'`, built in the Plugin Studio by this account: this device only, never offered to another account. */
  source: 'developer' | 'registry' | 'reference' | 'studio';
  installedAt: string;
  /** Whether the stored module is the metered build (D-30: always true once 2-D lands). */
  metered: boolean;
}

/** Why a slot cannot run its plugin; the placeholder card words each. 1.314 (EST-06): 'stopped', marked after a problem on this device until the card's Start (`running.ts`). */
export type EstUnavailable = 'not-installed' | 'other-version' | 'blocked' | 'refused' | 'budget' | 'crashed' | 'stopped';

export interface EstLibrary {
  /** Every installed plugin version, newest first. */
  installed(): readonly EstInstalled[];
  /** The installed record for exactly this reference (id, version and hash), or null. */
  find(ref: EstRef): EstInstalled | null;
  /**
   * The compiled module and its host shim for an installed reference, from the local store only
   * (compiled in the compiling Worker, then transferred). Rejects with an `EstUnavailable` reason
   * as the error's `message` when it cannot be had.
   */
  module(ref: EstRef): Promise<{ module: WebAssembly.Module; shim: WebAssembly.Module }>;
  /** Called with no arguments whenever `installed()` changes. Returns an unsubscribe. */
  subscribe(fn: () => void): () => void;
  /**
   * EST Phase 3: the bundle's presets for an installed reference, read from this device's stored
   * bundle (validated at install), in the index's order; empty when it has none. Optional, so a
   * library without it (an older fake) has none. Rejects with an `EstUnavailable` reason as the
   * error's `message` when the version is not installed.
   */
  presets?(ref: EstRef): Promise<readonly EstPreset[]>;
  /**
   * EST Phase 5a (5-B): the bundle's bytes as installed on this device (a developer bundle's UI is
   * uploaded from them for the session: `uiUrl.ts`), or null when it is not stored. Optional, so an
   * older fake has none.
   */
  bundle?(ref: EstRef): Promise<Uint8Array | null>;
  /**
   * EST Phase 5a (5-A, the Details sheet): what the install measured of an installed version on
   * this device: the bundle's size in bytes and the cost of a block in µs. Optional (older fakes).
   */
  stats?(ref: EstRef): { bundleBytes: number; blockUs: number } | null;
}

const NONE: EstLibrary = {
  installed: () => [],
  find: () => null,
  module: () => Promise.reject(new Error('not-installed' satisfies EstUnavailable)),
  subscribe: () => () => {},
};

let current: EstLibrary = NONE;
const listeners = new Set<() => void>();
let unsubscribeCurrent: () => void = () => {};

/** The library in use (the empty one until the install pipeline sets its own). */
export const estLibrary = (): EstLibrary => current;

/** EST Phase 3: an installed version's bundle presets through the library in use (none when it gives none). */
export function estPresets(ref: EstRef): Promise<readonly EstPreset[]> {
  return current.presets ? current.presets(ref) : Promise.resolve([]);
}

/** Whether a library has been set (the pipeline's, or a test's fake). */
export const estLibrarySet = (): boolean => current !== NONE;

/** The install pipeline (2-D) sets its library once loaded; tests set fakes. Null restores the empty one. */
export function setEstLibrary(lib: EstLibrary | null) {
  unsubscribeCurrent();
  current = lib ?? NONE;
  unsubscribeCurrent = current.subscribe(() => { for (const fn of listeners) fn(); });
  for (const fn of listeners) fn();
}

/** Follow the library: called when it is replaced or its installed list changes. */
export function onEstLibrary(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}
