import type { DynamicsParams, EQParams, MaximizerParams, SaturationParams } from './types';

/**
 * Default parameter factories for the active DSP modules. These are plain data
 * — kept out of engine.ts so the store/presets can import them without pulling
 * in the AudioEngine (and its AudioContext side effects).
 */

export function defaultEqParams(): EQParams {
  return {
    bands: [
      { id: 'b1', type: 'highpass', freq: 30, gain: 0, q: 0.7, enabled: false },
      { id: 'b2', type: 'lowshelf', freq: 100, gain: 0, q: 0.7, enabled: true },
      { id: 'b3', type: 'peaking', freq: 250, gain: 0, q: 1.0, enabled: true },
      { id: 'b4', type: 'peaking', freq: 1000, gain: 0, q: 1.0, enabled: true },
      { id: 'b5', type: 'peaking', freq: 3500, gain: 0, q: 1.0, enabled: true },
      { id: 'b6', type: 'peaking', freq: 8000, gain: 0, q: 1.0, enabled: true },
      { id: 'b7', type: 'highshelf', freq: 12000, gain: 0, q: 0.7, enabled: true },
      { id: 'b8', type: 'lowpass', freq: 18000, gain: 0, q: 0.7, enabled: false },
    ],
  };
}

/**
 * A new Limiter (1.715: the mastering Limiter, Transparent, 4× true-peak, Auto release, fully
 * linked). Anything saved before 1.715 has no `style` and loads as Legacy (`savedMaximizerTemplate`).
 */
export function defaultMaximizerParams(): MaximizerParams {
  return {
    threshold: 0,
    ceiling: -0.3,
    release: 100,
    style: 1,
    attack: 2,
    autoRelease: 1,
    oversample: 2,
    linkTransients: 100,
    linkRelease: 100,
    stereoMode: 0,
    audition: 0,
    target: 0,
  };
}

/**
 * The shape a saved Limiter is read against (1.715): the defaults with `style` 0 (Legacy), so a
 * project saved before the mastering Limiter, which has no `style`, keeps the Limiter it was made
 * with and sounds as it did.
 */
export function savedMaximizerTemplate(): MaximizerParams {
  return { ...defaultMaximizerParams(), style: 0 };
}

export function defaultSaturationParams(): SaturationParams {
  return { drive: 0, odd: 30, even: 15, mix: 35, tone: 0 };
}

export function defaultDynamicsParams(): DynamicsParams {
  return {
    threshold: -24,
    ratio: 3,
    attack: 10,
    release: 250,
    knee: 12,
    makeup: 0,
  };
}
