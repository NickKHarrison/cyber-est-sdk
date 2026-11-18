/**
 * 1.803: the pure parts of `est dev`'s hand-over on a rebuild (handover.ts): which parameter
 * values the new instance takes, which keys it is sent, and the `reload` line.
 */
import { describe, expect, it } from 'vitest';
import type { EstParam } from '@/audio/est/EstNode';
import { EST_HANDOVER_FADE_S } from '@/audio/est/handover';
import { HANDOVER_FADE_S, HeldKeys, carriedParams, refusedState, reloadLine } from './handover';

const p = (id: number, min: number, max: number, value: number, flags = 0): EstParam => ({ id, name: `P${id}`, module: '', min, max, def: min, flags, value });

describe('est dev: a rebuild hands over', () => {
  it("the crossfade is Cyber's own", () => {
    expect(HANDOVER_FADE_S).toBe(EST_HANDOVER_FADE_S);
  });

  it('carries the values of the ids both builds have, clamped into the new range, never a read-only one', () => {
    const before = [p(0, -60, 12, -6), p(1, 20, 20000, 12000), p(2, 0, 1, 0.5), p(3, 0, 3, 2)];
    // The new build narrowed 1's range, dropped 2, made 3 a readout and added 4.
    const next = [p(0, -60, 12, 0), p(1, 20, 8000, 8000), p(3, 0, 3, 0, 8), p(4, 0, 1, 0)];
    expect(carriedParams(before, next)).toEqual([{ id: 0, value: -6 }, { id: 1, value: 8000 }]);
    expect(carriedParams([{ id: 0, value: NaN }], next)).toEqual([]);
    expect(carriedParams([], next)).toEqual([]);
  });

  it('knows a refused state from any other failure', () => {
    expect(refusedState(new Error('the plugin refused the state'))).toBe(true);
    expect(refusedState(new Error('init: unreachable'))).toBe(false);
  });

  it('remembers the keys still held, each with its velocity', () => {
    const h = new HeldKeys();
    h.on(60, 100, 'keys');
    h.on(64, 80, 'screen');
    h.on(67, 90, 'midi');
    h.off(64);
    expect(h.list()).toEqual([{ key: 60, velocity: 100, src: 'keys' }, { key: 67, velocity: 90, src: 'midi' }]);
    h.clear();
    expect(h.size).toBe(0);
  });

  it('the reload line: ok, ms and what was kept; a refused build keeps the old instance playing', () => {
    expect(reloadLine({ ok: true, ms: 41.6, kept: { notes: 2, params: 4, state: true }, hash: 'abc' })).toEqual({ type: 'reload', ok: true, ms: 42, kept: { notes: 2, params: 4, state: true }, hash: 'abc' });
    expect(reloadLine({ ok: false, ms: 900, message: 'EST-C013: it stopped', next: 'Next: fix EST-C013: …' })).toEqual({ type: 'reload', ok: false, ms: 900, kept: { notes: 0, params: 0, state: false }, message: 'EST-C013: it stopped', next: 'Next: fix EST-C013: …', playing: 'the last good build' });
  });
});
