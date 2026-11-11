import { describe, expect, it, vi } from 'vitest';
import { ParamModel } from './model';

const P = [
  { id: 0, name: 'Gain', module: '', min: -60, max: 12, def: 0, flags: 32, value: 0 },
  { id: 1, name: 'Wave', module: 'Osc', min: 0, max: 2, def: 0, flags: 33, value: 0 },
];

describe("the dev host's parameter model", () => {
  it('one change reaches the instance, the knobs, the frame and the log, clamped', () => {
    const m = new ParamModel();
    const sink = vi.fn();
    const log = vi.fn();
    const knob = vi.fn();
    m.sink = sink;
    m.onChange = log;
    m.reset(P);
    m.subscribe(knob);
    m.set(0, 99);
    expect(sink).toHaveBeenCalledWith(0, 12);
    expect(log).toHaveBeenCalledWith(0, 12, 'generated');
    expect(knob).toHaveBeenCalledWith(0, 'ui');
    expect(m.values()).toEqual({ 0: 12, 1: 0 });
    m.apply(1, 1.6, 'list');
    expect(m.get(1)).toBe(2);
    // The instance's own report is not sent back to it.
    sink.mockClear();
    m.apply(0, -6, 'plugin', false);
    expect(sink).not.toHaveBeenCalled();
    expect(m.get(0)).toBe(-6);
  });

  it("is what Cyber's frame edits", () => {
    const m = new ParamModel();
    m.reset(P);
    const writes: Record<string, number>[] = [];
    const edit = m.frameEdit(p => writes.push(p));
    expect(edit.values).toEqual({ 0: 0, 1: 0 });
    edit.preview({ 0: -3 });
    expect(m.get(0)).toBe(-3);
    edit.write({ 0: -4 });
    expect(writes).toEqual([{ 0: -4 }]);
    expect(m.list().find(p => p.id === 0)?.value).toBe(-4);
  });
});
