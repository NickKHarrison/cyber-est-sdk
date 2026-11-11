/**
 * The types of `est-ui.js`, the classic script a plugin's UI loads (`<script src="est-ui.js">`,
 * copied into the bundle by `est pack`): the library on `window.EstUI`. `est new` copies this file
 * into the plugin's folder; a UI written in TypeScript names it once:
 *
 *   /// <reference path="../est-ui.d.ts" />
 *   const est = EstUI.connect();
 *
 * MIT. The SDK's typecheck keeps it in step with the library.
 */

/** A parameter as `est:init` gives it: plain values (Hz, dB …), CLAP flags. */
export interface EstUiParam {
  id: number;
  name: string;
  module: string;
  min: number;
  max: number;
  def: number;
  flags: number;
  value: number;
  /** Since EST 1.286: 'log' when est.json marks the parameter `"scale": "log"`; absent, linear. */
  scale?: 'linear' | 'log';
}

/** Since protocol 2: the host's colours, `#rrggbb`. */
export interface EstUiTheme { bg: string; fg: string; accent: string }
/** Since protocol 2: the strip's levels, linear peaks [left, right]; `in` is null where the host meters no input. */
export interface EstUiMeter { in: [number, number] | null; out: [number, number] }
/** Since protocol 3 (EST 1.1): the plugin's output, analysed by the host: magnitudes in whole dB (−120…0, fftSize / 2 of them) and the RMS [l, r]. Never samples. */
export interface EstUiSpectrum { bins: number[]; rms: [number, number] }

/** Who made a change: the host (est:init, est:param) or this page. */
export type EstChangeSource = 'host' | 'ui';
export type EstParamListener = (id: number | null, source: EstChangeSource) => void;

/** What a control reads and writes: the page's connection, or any object with these methods. */
export interface EstParamSource {
  param(id: number): EstUiParam | undefined;
  params(): EstUiParam[];
  get(id: number): number | undefined;
  /** Clamped to the range (whole for a stepped parameter); sent on the next animation frame. */
  set(id: number, value: number): void;
  /** A gesture: the host writes the changes between `begin` and `end` once (one undo step). */
  begin(id: number): void;
  end(id: number): void;
  /** `id` is null after an `est:init`. Returns the unsubscribe. */
  subscribe(fn: EstParamListener): () => void;
}

export interface EstConnection extends EstParamSource {
  readonly nonce: string;
  /** The first est:init: every parameter with its value. */
  readonly ready: Promise<EstUiParam[]>;
  /** Inbound messages dropped (not the host's, a wrong nonce or shape, an unknown parameter …). */
  readonly rejected: number;
  readonly initialised: boolean;
  /** Since protocol 2: the version this page speaks now (that of the last est:init; 2 before any). */
  readonly version: 1 | 2 | 3;
  /** Since protocol 2: the host's sample rate (Hz), or null. */
  readonly rate: number | null;
  /** Since protocol 2: the host's colours (also the CSS variables --est-bg, --est-fg, --est-accent), or null. */
  readonly theme: EstUiTheme | null;
  /** Since protocol 2: whether the host sends meters. */
  readonly meters: boolean;
  /** Since protocol 2: each est:meter (at most 30 a second). Returns the unsubscribe. */
  onMeter(fn: (m: EstUiMeter) => void): () => void;
  /** Since protocol 2: each theme the host gives. Returns the unsubscribe. */
  onTheme(fn: (t: EstUiTheme) => void): () => void;
  /** Since protocol 2: ask the host to size the frame (taken only when est.json's ui.resizable); false when not sent. */
  resize(w: number, h: number): boolean;
  /** Since protocol 3 (EST 1.1): whether the host answers audio() (est.json's ui.audio: true). */
  readonly audioAvailable: boolean;
  /** Since protocol 3 (EST 1.1): the plugin's output as spectra (fftSize 64…2048, rate 1…30 a second); returns the stop. */
  audio(options: { fftSize?: number; rate?: number }, fn: (s: EstUiSpectrum) => void): () => void;
  flush(): void;
  close(): void;
}

export interface EstConnectOptions {
  nonce?: string;
  hostOrigin?: string;
  onInit?: (params: EstUiParam[]) => void;
}

export interface EstBindOptions {
  source?: EstParamSource;
  /** The text of a display element (a span, an `<output>`). */
  format?: (value: number, param: EstUiParam) => string;
}

export type EstScale = 'linear' | 'log';
type EstRange = Pick<EstUiParam, 'min' | 'max' | 'flags'>;

/** `<est-knob>` and `<est-slider>`: attributes param, label, name, unit, scale ("log" or "linear"; default the parameter's own), labels, size (knob). */
export interface EstControlElement extends HTMLElement {
  source: EstParamSource | null;
  readonly paramId: number | null;
  readonly value: number | undefined;
  readonly valueText: string;
  reset(): void;
}

export interface EstUIApi {
  /** The page's connection (the first call makes it; later calls return it). */
  connect(options?: EstConnectOptions): EstConnection;
  currentConnection(): EstConnection | null;
  whenConnected(fn: (c: EstConnection) => void): () => void;
  /** One element follows one parameter and writes it; returns the unbind. */
  bind(el: Element, paramId: number, options?: EstBindOptions): () => void;
  formatValue(p: EstRange, v: number, unit?: string, labels?: readonly string[]): string;
  formatNumber(v: number): string;
  toNorm(p: EstRange, v: number, scale?: EstScale): number;
  fromNorm(p: EstRange, u: number, scale?: EstScale): number;
  readonly FLAGS: { readonly STEPPED: 1; readonly PERIODIC: 2; readonly HIDDEN: 4; readonly READONLY: 8; readonly BYPASS: 16; readonly AUTOMATABLE: 32 };
  /** The frame protocol's newest version (3). */
  readonly EST_UI_PROTOCOL: number;
}

declare global {
  /** `est-ui.js`'s global (also `window.EstUI`). */
  // eslint-disable-next-line no-var
  var EstUI: EstUIApi;
}
