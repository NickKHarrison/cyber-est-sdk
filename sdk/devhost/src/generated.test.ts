/**
 * 1.804 (value text): `est dev` shows a stepped parameter's labels by the rule Cyber's generated
 * knobs follow: the plugin's own text for the step (the instance's `labels`), else the number.
 */
import { describe, expect, it } from 'vitest';
import { formatValue } from '../../packages/ui/src/format';
import { knobLabels } from './Generated';

describe('est dev: a stepped parameter\'s labels', () => {
  it('the knob is given the labels (its attribute is comma-separated); none, or a comma in one, leaves the number', () => {
    expect(knobLabels({ labels: ['Sine', 'Saw', 'Square'] })).toBe('Sine,Saw,Square');
    expect(knobLabels({ labels: ['Off', '', 'On'] })).toBe('Off,,On');
    expect(knobLabels({})).toBeUndefined();
    expect(knobLabels({ labels: ['', ''] })).toBeUndefined();
    expect(knobLabels({ labels: ['1/8, dotted', '1/4'] })).toBeUndefined();
  });

  it('the parameter list prints the label of the value', () => {
    const p = { min: 0, max: 2, flags: 1 };
    expect(formatValue(p, 1, '', ['Sine', 'Saw', 'Square'])).toBe('Saw');
    expect(formatValue(p, 1, '', ['Sine', '', 'Square'])).toBe('1');
    expect(formatValue(p, 1, '')).toBe('1');
  });
});
