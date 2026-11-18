/**
 * 1.803 (the loop): the block-cost check (`EST-P001`) takes the best of up to three runs before it
 * warns (`BLOCK_COST_RUNS` in src/audio/est/install/conformance.ts has the reasoning and the
 * arithmetic). The rule, its id and its budget are unchanged; these tests hold:
 * - the conformance run's figure is the faster of its two runs (which costs an install nothing: no
 *   run is added, counted here by the clock's reads);
 * - a third run happens only when both were over the budget, and only through the kit's validator;
 * - a plugin over the budget on every run still warns.
 */
import { describe, expect, it } from 'vitest';
import { BLOCK_COST_RUNS, bestBlockCost, blockCostAgain, runConformance } from '../../src/audio/est/install/conformance';
import { EST_BLOCK_BUDGET_US, estRule } from '../../src/audio/est/install/rules';
import { estShim } from '../testing/golden';
import { bytes, packed } from './helpers';

const SECONDS = 1;
const BLOCKS = Math.ceil((SECONDS * 48000) / 128);

/** A clock whose k-th timed run spends `perBlockUs[k]` in every block (two reads a block). */
function fakeClock(perBlockUs: number[]) {
  let reads = 0, now = 0;
  const clock = () => {
    const run = Math.min(perBlockUs.length - 1, Math.floor(reads / (2 * BLOCKS)));
    // The second read of a pair ends the block: the block's time has passed.
    if (reads % 2 === 1) now += perBlockUs[run]! / 1000;
    reads++;
    return now;
  };
  return { clock, runs: () => reads / (2 * BLOCKS) };
}

const plugin = async () => {
  const p = await packed('sdk/templates/effect-as', bytes('sdk/fixtures/templates/effect-as.wasm'));
  return { module: p.module, shim: estShim(), manifest: p.bundle.manifest, seconds: SECONDS };
};

describe('EST-P001: the best of three', () => {
  it('the budget and the rule are what they were', () => {
    expect(EST_BLOCK_BUDGET_US).toBe(100);
    expect(estRule('EST-P001')).toMatchObject({ severity: 'warning', install: false, step: 'performance' });
    expect(BLOCK_COST_RUNS).toBe(3);
  });

  it('the conformance run reports the faster of its two runs, and makes no third', async () => {
    const input = await plugin();
    // A busy first run (140 µs a block), a quiet second (30 µs): the figure is the second's.
    const busyFirst = fakeClock([140, 30]);
    const a = runConformance({ ...input, clock: busyFirst.clock });
    expect(a.ok).toBe(true);
    expect(a.blockUs).toBeCloseTo(30, 6);
    expect(busyFirst.runs()).toBe(2);
    // A quiet first run, a busy second: still the faster.
    const busySecond = fakeClock([30, 140]);
    expect(runConformance({ ...input, clock: busySecond.clock }).blockUs).toBeCloseTo(30, 6);
    // Over the budget both times: the figure stays over it (the smaller), and still only two runs at install.
    const slow = fakeClock([180, 150]);
    expect(runConformance({ ...input, clock: slow.clock }).blockUs).toBeCloseTo(150, 6);
    expect(slow.runs()).toBe(2);
  });

  it('one more run measures the same signal', async () => {
    const input = await plugin();
    const c = fakeClock([42]);
    expect(blockCostAgain({ ...input, clock: c.clock })).toBeCloseTo(42, 6);
    expect(c.runs()).toBe(1);
    const real = blockCostAgain(input);
    expect(real).toBeGreaterThan(0);
  });

  it('a third run only when the first two were over the budget; never more than three in all', () => {
    let calls = 0;
    const again = (us: number | null) => () => { calls++; return us; };
    // Under the budget already: nothing more is run (the common case costs nothing).
    expect(bestBlockCost(60, 100, again(10))).toBe(60);
    expect(bestBlockCost(100, 100, again(10))).toBe(100);
    expect(calls).toBe(0);
    // Over it: one more run, and the smallest wins.
    expect(bestBlockCost(140, 100, again(70))).toBe(70);
    expect(calls).toBe(1);
    // Over it on the third too: still a warning's figure, the smallest measured; and it stops at three.
    calls = 0;
    expect(bestBlockCost(140, 100, again(120))).toBe(120);
    expect(bestBlockCost(140, 100, again(160))).toBe(140);
    expect(calls).toBe(2);
    // A run that could not complete changes nothing.
    expect(bestBlockCost(140, 100, again(null))).toBe(140);
    // Given more runs to spend, it stops as soon as one is under the budget.
    calls = 0;
    expect(bestBlockCost(140, 100, again(90), 6, 2)).toBe(90);
    expect(calls).toBe(1);
  });
});
