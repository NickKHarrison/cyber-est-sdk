import { describe, expect, it } from 'vitest';
import { isBlack, keepsKeys, midiAction, noteForKey, noteName, octaveForKey } from './keys';

describe('the dev host keys', () => {
  it('maps the home row to notes from C', () => {
    expect(noteForKey('KeyA', 4)).toBe(60);
    expect(noteForKey('KeyW', 4)).toBe(61);
    expect(noteForKey('KeyK', 4)).toBe(72);
    expect(noteForKey('KeyQ', 4)).toBeNull();
    expect(noteForKey('KeyA', 9)).toBe(120);
    expect(noteForKey('KeyK', 9)).toBeNull();
    expect(octaveForKey('KeyZ', 4)).toBe(3);
    expect(octaveForKey('KeyX', 8)).toBe(8);
    expect(noteName(60)).toBe('C4');
    expect(noteName(61)).toBe('C♯4');
    expect(isBlack(61)).toBe(true);
  });

  it('leaves typing and controls their keys', () => {
    const input = document.createElement('input');
    const knob = document.createElement('div');
    knob.setAttribute('role', 'slider');
    const div = document.createElement('div');
    document.body.append(input, knob, div);
    expect(keepsKeys(input)).toBe(true);
    expect(keepsKeys(knob)).toBe(true);
    expect(keepsKeys(div)).toBe(false);
    expect(keepsKeys(null)).toBe(false);
  });

  it('reads MIDI', () => {
    expect(midiAction([0x90, 60, 100])).toEqual({ type: 'on', key: 60, velocity: 100 });
    expect(midiAction([0x90, 60, 0])).toEqual({ type: 'off', key: 60 });
    expect(midiAction([0x81, 60, 0])).toEqual({ type: 'off', key: 60 });
    expect(midiAction([0xe0, 0, 64])).toEqual({ type: 'bend', value: 0 });
    expect(midiAction([0xb0, 64, 127])).toEqual({ type: 'cc', num: 64, value: 127 });
    expect(midiAction([0xf8])).toBeNull();
  });
});
