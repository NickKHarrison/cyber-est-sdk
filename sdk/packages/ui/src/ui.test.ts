/**
 * `@cyber-est/ui` in jsdom: the knob and the slider driven through the frame protocol, every message the
 * library sends checked by Cyber's own host checker (`checkFrameMessage` in
 * src/components/est/estFrameProtocol.ts), every message the host sends built by the host's own
 * builders (`initMessage`, `paramMessage`); the keys, the gestures, ARIA, and the refusals.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { checkFrameMessage, initMessage, MAX_PER_SECOND, meterMessage, paramMessage as hostParam, spectrumMessage, themeMessage } from '../../../../src/components/est/estFrameProtocol';
import type { EstParam } from '../../../../src/audio/est/EstNode';
import { bind, connect, EstKnob, EstSlider, type Connection } from './index';
import { checkHostMessage, FLAGS, type FrameMessage } from './protocol';
import { formatValue, fromNorm, toNorm } from './format';

const NONCE = 'a'.repeat(32);
const PARAMS: EstParam[] = [
  { id: 0, name: 'Gain', module: '', min: -60, max: 12, def: 0, flags: FLAGS.AUTOMATABLE, value: 0 },
  { id: 7, name: 'Cutoff', module: 'Filter', min: 20, max: 20000, def: 1000, flags: FLAGS.AUTOMATABLE, value: 1000 },
  { id: 9, name: 'Wave', module: 'Osc', min: 0, max: 2, def: 0, flags: FLAGS.STEPPED | FLAGS.AUTOMATABLE, value: 0 },
];

interface Rig { conn: Connection; sent: FrameMessage[]; deliver: (m: unknown, ok?: boolean) => void; frames: (() => void)[]; tick: () => void; clock: { t: number } }

function rig(): Rig {
  const sent: FrameMessage[] = [];
  const frames: (() => void)[] = [];
  const clock = { t: 0 };
  let listener: ((d: unknown, ok: boolean) => void) | null = null;
  const conn = connect({
    nonce: NONCE,
    transport: { post: m => sent.push(m), listen: fn => { listener = fn; return () => { listener = null; }; } },
    schedule: fn => frames.push(fn),
    now: () => clock.t,
  });
  return {
    conn, sent, frames, clock,
    deliver: (m, ok = true) => listener?.(m, ok),
    tick: () => { const f = frames.splice(0); for (const fn of f) fn(); },
  };
}

/** Every message sent, through the host's own checker (null where it refused). */
const hostView = (sent: FrameMessage[]) => sent.map(m => checkFrameMessage(JSON.parse(JSON.stringify(m)), NONCE, PARAMS));

function knob(r: Rig, id: number, attrs: Record<string, string> = {}): EstKnob {
  const el = document.createElement('est-knob');
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  el.setAttribute('param', String(id));
  el.source = r.conn;
  document.body.append(el);
  return el;
}

const key = (el: Element, k: string, o: KeyboardEventInit = {}) => el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...o }));
const ptr = (el: Element, type: string, o: PointerEventInit) => el.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 1, button: 0, ...o }));

beforeEach(() => { document.body.innerHTML = ''; });
afterEach(() => { document.body.innerHTML = ''; });

describe('@cyber-est/ui and the host', () => {
  it('opens with est:ready, which the host accepts, and takes est:init', async () => {
    const r = rig();
    expect(hostView(r.sent)).toEqual([{ type: 'est:ready', v: 3 }]);
    expect(r.conn.initialised).toBe(false);
    r.deliver(initMessage(NONCE, PARAMS));
    await expect(r.conn.ready).resolves.toHaveLength(3);
    expect(r.conn.get(7)).toBe(1000);
    expect(r.conn.param(9)?.name).toBe('Wave');
    expect(r.conn.rejected).toBe(0);
  });

  it('a knob has a name, ARIA values and its text', () => {
    const r = rig();
    const el = knob(r, 7, { unit: 'Hz', scale: 'log' });
    expect(el.getAttribute('role')).toBe('slider');
    expect(el.tabIndex).toBe(0);
    expect(el.getAttribute('aria-disabled')).toBe('true');
    r.deliver(initMessage(NONCE, PARAMS));
    expect(el.getAttribute('aria-label')).toBe('Cutoff');
    expect(el.getAttribute('aria-valuemin')).toBe('20');
    expect(el.getAttribute('aria-valuemax')).toBe('20000');
    expect(el.getAttribute('aria-valuenow')).toBe('1000');
    expect(el.getAttribute('aria-valuetext')).toBe('1 kHz');
    expect(el.getAttribute('aria-disabled')).toBeNull();
    expect(el.shadowRoot?.querySelector('.value')?.textContent).toBe('1 kHz');
    el.setAttribute('label', 'Filter cutoff');
    expect(el.getAttribute('aria-label')).toBe('Filter cutoff');
  });

  it('keys step the value; every message is one the host accepts', () => {
    const r = rig();
    r.deliver(initMessage(NONCE, PARAMS));
    const el = knob(r, 0, { unit: 'dB' });
    r.sent.length = 0;
    key(el, 'End');
    expect(el.value).toBe(12);
    r.tick();
    key(el, 'Home');
    r.tick();
    key(el, 'PageUp');
    r.tick();
    key(el, 'ArrowUp');
    key(el, 'ArrowUp');
    r.tick();
    const seen = hostView(r.sent);
    expect(seen.every(Boolean)).toBe(true);
    // Two arrows in one frame are one message (coalesced); 10 % then 2 × 1 % of 72 dB.
    expect(seen.map(m => m && 'value' in m ? Math.round(m.value * 100) / 100 : null)).toEqual([12, -60, -52.8, -51.36]);
    key(el, 'ArrowDown', { shiftKey: true });
    expect(el.value).toBeCloseTo(-51.36 - 0.072, 6);
    // A key it does not use is left alone (the page's own keys), and so is a modifier chord.
    expect(key(el, 'a')).toBe(true);
    expect(key(el, 'ArrowUp', { ctrlKey: true })).toBe(true);
  });

  it('a stepped parameter steps by one and shows its labels', () => {
    const r = rig();
    r.deliver(initMessage(NONCE, PARAMS));
    const el = knob(r, 9, { labels: 'Saw, Square, Sine' });
    expect(el.getAttribute('aria-valuetext')).toBe('Saw');
    key(el, 'ArrowRight');
    expect(el.value).toBe(1);
    expect(el.getAttribute('aria-valuetext')).toBe('Square');
    key(el, 'PageUp');
    expect(el.value).toBe(2);
    key(el, 'ArrowUp');
    expect(el.value).toBe(2);
  });

  it('a drag is begin, its changes, end, in that order; Escape puts the value back', () => {
    const r = rig();
    r.deliver(initMessage(NONCE, PARAMS));
    const el = knob(r, 0);
    r.sent.length = 0;
    ptr(el, 'pointerdown', { clientX: 10, clientY: 100 });
    ptr(el, 'pointermove', { clientX: 10, clientY: 80 });
    r.tick();
    ptr(el, 'pointermove', { clientX: 10, clientY: 60 });
    ptr(el, 'pointerup', { clientX: 10, clientY: 60 });
    const seen = hostView(r.sent);
    expect(seen.every(Boolean)).toBe(true);
    expect(seen.map(m => m?.type)).toEqual(['est:gesture', 'est:param', 'est:param', 'est:gesture']);
    expect(seen[0]).toEqual({ type: 'est:gesture', v: 1, id: 0, phase: 'begin' });
    expect(seen[3]).toEqual({ type: 'est:gesture', v: 1, id: 0, phase: 'end' });
    // 40 px of 200 is a fifth of the range up from 0 dB.
    expect(el.value).toBeCloseTo(fromNorm(PARAMS[0]!, toNorm(PARAMS[0]!, 0) + 0.2), 6);

    r.sent.length = 0;
    ptr(el, 'pointerdown', { clientX: 10, clientY: 100 });
    ptr(el, 'pointermove', { clientX: 10, clientY: 0 });
    key(el, 'Escape');
    r.tick();
    const back = hostView(r.sent);
    expect(back.at(-1)).toEqual({ type: 'est:gesture', v: 1, id: 0, phase: 'end' });
    expect(el.value).toBeCloseTo(fromNorm(PARAMS[0]!, toNorm(PARAMS[0]!, 0) + 0.2), 6);
  });

  it('a double click returns the default', () => {
    const r = rig();
    r.deliver(initMessage(NONCE, PARAMS.map(p => ({ ...p, value: p.max }))));
    const el = knob(r, 7);
    el.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    expect(el.value).toBe(1000);
  });

  it('a change from the host moves the control; nothing is echoed back', () => {
    const r = rig();
    r.deliver(initMessage(NONCE, PARAMS));
    const el = knob(r, 7, { unit: 'Hz' });
    r.sent.length = 0;
    r.deliver(hostParam(NONCE, 7, 440));
    expect(el.getAttribute('aria-valuenow')).toBe('440');
    expect(el.getAttribute('aria-valuetext')).toBe('440 Hz');
    r.tick();
    expect(r.sent).toEqual([]);
  });

  it('refuses what the host would refuse from a frame', () => {
    const r = rig();
    r.deliver(initMessage(NONCE, PARAMS));
    const bad: unknown[] = [
      { ...hostParam(NONCE, 7, 440), nonce: 'b'.repeat(32) },
      { ...hostParam(NONCE, 7, 440), extra: 1 },
      hostParam(NONCE, 7, 1e9),
      hostParam(NONCE, 7, Number.NaN),
      hostParam(NONCE, 99, 1),
      { ...hostParam(NONCE, 7, 440), v: 4 },
      { v: 1, type: 'est:meter', nonce: NONCE, id: 7, value: 1 },
      { v: 1, type: 'est:init', nonce: NONCE, params: [{ id: 1 }] },
      { v: 1, type: 'est:init', nonce: NONCE, params: 'x'.repeat(70_000) },
      [1, 2, 3],
      'est:param',
    ];
    for (const m of bad) r.deliver(m);
    r.deliver(hostParam(NONCE, 7, 440), false);
    expect(r.conn.rejected).toBe(bad.length + 1);
    expect(r.conn.get(7)).toBe(1000);
  });

  it('1.331: an est:init of 512 parameters with long names (about 250 KB) is taken; one past 512 KiB, and any other message over 64 KiB, is refused', () => {
    const param = (i: number, len: number) => ({ id: i, name: `P${i} ${'n'.repeat(len)}`, module: 'm'.repeat(len), min: 0, max: 2 ** 53 - 1, def: 0, flags: 4 | 32, value: 0 });
    const init = { v: 1, type: 'est:init', nonce: NONCE, params: Array.from({ length: 512 }, (_, i) => param(i, 200)) };
    const bytes = JSON.stringify(init).length;
    expect(bytes).toBeGreaterThan(64 * 1024);
    expect(bytes).toBeLessThan(512 * 1024);
    const ok = checkHostMessage(init, NONCE, new Map());
    expect(ok?.type === 'est:init' ? ok.params.length : null).toBe(512);
    const huge = { ...init, params: Array.from({ length: 2000 }, (_, i) => param(i, 200)) };
    expect(JSON.stringify(huge).length).toBeGreaterThan(512 * 1024);
    expect(checkHostMessage(huge, NONCE, new Map())).toBeNull();
    expect(checkHostMessage({ v: 3, type: 'est:spectrum', nonce: NONCE, bins: Array.from({ length: 16000 }, () => -120), rms: [0, 0] }, NONCE, new Map())).toBeNull();
  });

  it('checks est:init entries strictly and clamps a value into its range', () => {
    const init = initMessage(NONCE, PARAMS);
    expect(checkHostMessage(init, NONCE, new Map())?.type).toBe('est:init');
    const dup = { ...init, params: [init.params[0], init.params[0]] };
    expect(checkHostMessage(dup, NONCE, new Map())).toBeNull();
    const wide = { ...init, params: [{ ...init.params[0]!, value: 99 }] };
    const ok = checkHostMessage(wide, NONCE, new Map());
    expect(ok && ok.type === 'est:init' ? ok.params[0]!.value : null).toBe(12);
  });

  it('stays under the host rate limit and never drops a gesture', () => {
    const r = rig();
    r.deliver(initMessage(NONCE, PARAMS));
    r.sent.length = 0;
    // 600 changes, each in its own frame, within one second.
    for (let i = 0; i < 600; i++) {
      r.conn.begin(0);
      r.conn.set(0, -60 + (i % 70));
      r.conn.end(0);
      r.clock.t = i;
      r.tick();
    }
    expect(r.sent.length).toBeLessThan(MAX_PER_SECOND);
    // A second later the rest goes, in order: each begin has its end.
    for (let s = 1; s <= 12; s++) { r.clock.t = 1000 * s; r.tick(); }
    const seen = hostView(r.sent);
    expect(seen.every(Boolean)).toBe(true);
    const begins = seen.filter(m => m?.type === 'est:gesture' && m.phase === 'begin').length;
    const ends = seen.filter(m => m?.type === 'est:gesture' && m.phase === 'end').length;
    expect(begins).toBe(600);
    expect(ends).toBe(600);
  });

  it('a slider follows the pointer along its bar', () => {
    const r = rig();
    r.deliver(initMessage(NONCE, PARAMS));
    const el = document.createElement('est-slider') as EstSlider;
    el.setAttribute('param', '0');
    el.source = r.conn;
    document.body.append(el);
    expect(el.getAttribute('aria-orientation')).toBe('horizontal');
    const bar = el.shadowRoot!.querySelector('.bar') as HTMLElement;
    bar.getBoundingClientRect = () => ({ left: 100, width: 200, top: 0, height: 6, right: 300, bottom: 6, x: 100, y: 0, toJSON: () => ({}) });
    ptr(el, 'pointerdown', { clientX: 150, clientY: 3 });
    expect(el.value).toBeCloseTo(-60 + 0.25 * 72, 6);
    ptr(el, 'pointermove', { clientX: 400, clientY: 3 });
    expect(el.value).toBe(12);
    ptr(el, 'pointerup', { clientX: 400, clientY: 3 });
    r.tick();
    expect(hostView(r.sent).every(Boolean)).toBe(true);
  });

  it('bind() drives a range input and a text display', () => {
    const r = rig();
    r.deliver(initMessage(NONCE, PARAMS));
    const range = document.createElement('input');
    range.type = 'range';
    const out = document.createElement('output');
    document.body.append(range, out);
    bind(range, 7, { source: r.conn });
    bind(out, 7, { source: r.conn, format: (v, p) => formatValue(p, v, 'Hz') });
    expect(range.min).toBe('20');
    expect(range.max).toBe('20000');
    expect(out.textContent).toBe('1 kHz');
    r.sent.length = 0;
    range.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }));
    range.value = '5000';
    range.dispatchEvent(new Event('input', { bubbles: true }));
    window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
    r.tick();
    expect(hostView(r.sent).map(m => m?.type)).toEqual(['est:gesture', 'est:param', 'est:gesture']);
    expect(out.textContent).toBe('5 kHz');
    r.deliver(hostParam(NONCE, 7, 300));
    expect(range.value).toBe('300');
  });

  it('the scale hint (D-44): est:init carries scale only on a log parameter; a knob, a slider and a range input then move geometrically', () => {
    const LOG: EstParam[] = [{ ...PARAMS[1]!, scale: 'log' }, PARAMS[0]!];
    const init = initMessage(NONCE, LOG);
    // The host sends the key only where est.json put it, so a frame built before the hint never sees one.
    expect(init.params.map(p => Object.keys(p).includes('scale'))).toEqual([true, false]);
    expect(Object.keys(initMessage(NONCE, PARAMS).params[1]!)).not.toContain('scale');
    const checked = checkHostMessage(init, NONCE, new Map());
    expect(checked?.type === 'est:init' ? checked.params.map(p => p.scale) : null).toEqual(['log', undefined]);
    // An unknown scale is refused like any other bad entry.
    expect(checkHostMessage({ ...init, params: [{ ...init.params[0]!, scale: 'exp' }] }, NONCE, new Map())).toBeNull();
    const r = rig();
    r.deliver(init);
    expect(r.conn.rejected).toBe(0);
    expect(r.conn.param(7)?.scale).toBe('log');
    // No attribute: the knob follows the parameter's scale; the attribute still wins.
    const k = knob(r, 7);
    key(k, 'Home');
    key(k, 'PageUp');
    expect(k.value).toBeCloseTo(fromNorm({ min: 20, max: 20000, flags: 0 }, 0.1, 'log'), 6);
    const lin = knob(r, 7, { scale: 'linear' });
    key(lin, 'Home');
    key(lin, 'PageUp');
    expect(lin.value).toBeCloseTo(20 + 0.1 * 19980, 6);
    // A slider at half its bar is the geometric middle.
    const el = document.createElement('est-slider') as EstSlider;
    el.setAttribute('param', '7');
    el.source = r.conn;
    document.body.append(el);
    const bar = el.shadowRoot!.querySelector('.bar') as HTMLElement;
    bar.getBoundingClientRect = () => ({ left: 0, width: 200, top: 0, height: 6, right: 200, bottom: 6, x: 0, y: 0, toJSON: () => ({}) });
    ptr(el, 'pointerdown', { clientX: 100, clientY: 3 });
    ptr(el, 'pointerup', { clientX: 100, clientY: 3 });
    expect(el.value).toBeCloseTo(Math.sqrt(20 * 20000), 6);
    // A range input over it runs 0…1.
    const range = document.createElement('input');
    range.type = 'range';
    document.body.append(range);
    bind(range, 7, { source: r.conn });
    expect([range.min, range.max, Number(range.value)]).toEqual(['0', '1', 0.5]);
    range.value = '1';
    range.dispatchEvent(new Event('input', { bubbles: true }));
    expect(r.conn.get(7)).toBeCloseTo(20000, 6);
    // A linear parameter's range input is unchanged.
    const gain = document.createElement('input');
    gain.type = 'range';
    bind(gain, 0, { source: r.conn });
    expect([gain.min, gain.max]).toEqual(['-60', '12']);
    r.tick();
    expect(hostView(r.sent).every(Boolean)).toBe(true);
  });

  it('formats units', () => {
    const p = { min: -60, max: 12, flags: 0 };
    expect(formatValue(p, 3, 'dB')).toBe('+3 dB');
    expect(formatValue(p, -12.5, 'dB')).toBe('-12.5 dB');
    expect(formatValue({ min: 20, max: 20000, flags: 0 }, 12500, 'Hz')).toBe('12.5 kHz');
    expect(formatValue({ min: 0, max: 100, flags: 0 }, 50, '%')).toBe('50 %');
    expect(fromNorm({ min: 20, max: 20000, flags: 0 }, 0.5, 'log')).toBeCloseTo(Math.sqrt(20 * 20000), 6);
  });
});

describe('@cyber-est/ui protocol 2 (EST Phase 5a, 5-B)', () => {
  const THEME = { bg: '#0a0c0f', fg: '#e1e4ea', accent: '#ffb647' };
  const target = () => document.createElement('div');

  function rig2(themeTarget: HTMLElement | null = null) {
    const sent: FrameMessage[] = [];
    let listener: ((d: unknown, ok: boolean) => void) | null = null;
    const conn = connect({
      nonce: NONCE, themeTarget,
      transport: { post: m => sent.push(m), listen: fn => { listener = fn; return () => { listener = null; }; } },
      schedule: fn => fn(),
    });
    return { conn, sent, deliver: (m: unknown) => listener?.(JSON.parse(JSON.stringify(m)), true) };
  }

  it('says est:ready in version 3 (EST 1.1); a version-2 est:init gives the rate, the theme (as CSS variables) and meters', () => {
    const el = target();
    const r = rig2(el);
    expect(r.sent).toEqual([{ v: 3, type: 'est:ready', nonce: NONCE }]);
    expect([r.conn.version, r.conn.rate, r.conn.theme, r.conn.meters]).toEqual([3, null, null, false]);
    const themes: unknown[] = [];
    r.conn.onTheme(t => themes.push(t));
    r.deliver(initMessage(NONCE, PARAMS, { rate: 44100, theme: THEME, meters: true }));
    expect([r.conn.version, r.conn.rate, r.conn.meters]).toEqual([2, 44100, true]);
    expect(r.conn.theme).toEqual(THEME);
    expect(el.style.getPropertyValue('--est-bg')).toBe(THEME.bg);
    expect(el.style.getPropertyValue('--est-fg')).toBe(THEME.fg);
    expect(el.style.getPropertyValue('--est-accent')).toBe(THEME.accent);
    // est:theme on a change.
    r.deliver(themeMessage(NONCE, { ...THEME, accent: '#00ff00' }));
    expect(el.style.getPropertyValue('--est-accent')).toBe('#00ff00');
    expect(themes).toEqual([THEME, { ...THEME, accent: '#00ff00' }]);
    expect(r.conn.rejected).toBe(0);
  });

  it('hands each est:meter to its listeners, and stops on unsubscribe', () => {
    const r = rig2();
    r.deliver(initMessage(NONCE, PARAMS, { rate: 48000, theme: THEME, meters: true }));
    const got: unknown[] = [];
    const off = r.conn.onMeter(m => got.push(m));
    r.deliver(meterMessage(NONCE, [0.5, 0.25]));
    r.deliver(meterMessage(NONCE, [0.1, 0.2], [0.3, 0.4]));
    off();
    r.deliver(meterMessage(NONCE, [1, 1]));
    expect(got).toEqual([{ in: null, out: [0.5, 0.25] }, { in: [0.3, 0.4], out: [0.1, 0.2] }]);
    expect(r.conn.rejected).toBe(0);
  });

  it('resize() sends est:resize in version 2 (clamped to the bounds), which a resizable host takes', () => {
    const r = rig2();
    r.deliver(initMessage(NONCE, PARAMS, { rate: 48000, theme: THEME, meters: false }));
    expect(r.conn.resize(500.4, 9999)).toBe(true);
    const last = r.sent.at(-1)!;
    expect(last).toEqual({ v: 2, type: 'est:resize', nonce: NONCE, w: 500, h: 1400 });
    expect(checkFrameMessage(last, NONCE, PARAMS, true)).toEqual({ type: 'est:resize', v: 2, w: 500, h: 1400 });
    expect(checkFrameMessage(last, NONCE, PARAMS, false)).toBeNull();
  });

  it('speaks version 1 to a host from before protocol 2 (a version-1 est:init), and 2 again after a version-2 one', () => {
    const r = rig2();
    r.deliver(initMessage(NONCE, PARAMS));
    expect([r.conn.version, r.conn.rate, r.conn.theme, r.conn.meters]).toEqual([1, null, null, false]);
    expect(r.conn.resize(400, 300)).toBe(false);
    r.conn.set(0, -6);
    r.conn.flush();
    expect(r.sent.at(-1)).toEqual({ v: 1, type: 'est:param', nonce: NONCE, id: 0, value: -6 });
    // A version-1 host's own check takes it (v: 1, exactly its keys).
    expect(checkFrameMessage(r.sent.at(-1), NONCE, PARAMS)).toEqual({ type: 'est:param', v: 1, id: 0, value: -6 });
    r.deliver(initMessage(NONCE, PARAMS, { rate: 96000, theme: THEME, meters: true }));
    expect([r.conn.version, r.conn.rate]).toEqual([2, 96000]);
    r.conn.begin(0);
    expect(r.sent.at(-1)).toMatchObject({ v: 2, type: 'est:gesture', phase: 'begin' });
  });

  it('version 3 (EST 1.1): audio() asks a host that offers it, takes each est:spectrum, and stops', () => {
    const r = rig2();
    const got: unknown[] = [];
    // Before any est:init (or from a host without ui.audio) nothing is asked.
    const early = r.conn.audio({ fftSize: 1000, rate: 60 }, s => got.push(s));
    expect(r.sent.filter(m => (m as { type: string }).type === 'est:audio')).toEqual([]);
    r.deliver(initMessage(NONCE, PARAMS, { rate: 48000, theme: THEME, meters: true, audio: true }));
    expect([r.conn.version, r.conn.audioAvailable]).toEqual([3, true]);
    const ask = r.sent.at(-1);
    expect(ask).toEqual({ v: 3, type: 'est:audio', nonce: NONCE, fftSize: 1024, rate: 30 });
    expect(checkFrameMessage(ask, NONCE, PARAMS, false, true)).toEqual({ type: 'est:audio', v: 3, fftSize: 1024, rate: 30 });
    r.deliver(spectrumMessage(NONCE, new Float32Array(512).fill(-40), new Float32Array([0.5, 0.25])));
    expect(got).toHaveLength(1);
    expect(got[0]).toMatchObject({ rms: [0.5, 0.25] });
    early();
    expect(r.sent.at(-1)).toEqual({ v: 3, type: 'est:audio', nonce: NONCE, fftSize: 1024, rate: 0 });
    // A spectrum of the wrong size, or with a fraction, is refused.
    r.deliver({ v: 3, type: 'est:spectrum', nonce: NONCE, bins: [0, 0, 0], rms: [0, 0] });
    r.deliver({ v: 3, type: 'est:spectrum', nonce: NONCE, bins: new Array(32).fill(-1.5), rms: [0, 0] });
    expect(r.conn.rejected).toBe(2);
  });

  it('version 3 from a host that does not offer audio: audioAvailable is false and nothing is asked', () => {
    const r = rig2();
    r.deliver(initMessage(NONCE, PARAMS, { rate: 48000, theme: THEME, meters: false, audio: false }));
    r.conn.audio({}, () => {});
    expect(r.conn.audioAvailable).toBe(false);
    expect(r.sent.some(m => (m as { type: string }).type === 'est:audio')).toBe(false);
  });

  it('refuses a version-2 message that is not well formed, and a meter or theme before any version-2 host', () => {
    const r = rig2();
    r.deliver({ v: 2, type: 'est:meter', nonce: NONCE, in: null, out: [5, 0] });
    r.deliver({ v: 2, type: 'est:theme', nonce: NONCE, theme: { bg: 'red', fg: '#000000', accent: '#000000' } });
    r.deliver({ v: 2, type: 'est:resize', nonce: NONCE, w: 300, h: 200 });
    r.deliver({ v: 1, type: 'est:meter', nonce: NONCE, in: null, out: [0, 0] });
    expect(r.conn.rejected).toBe(4);
    expect(r.conn.theme).toBeNull();
  });
});
