/**
 * The window kit in jsdom: every element bound through the frame protocol, each message the kit
 * sends checked by Cyber's own host checker (`checkFrameMessage`), each message from the host built
 * by the host's own builders. The pure parts (names, hints, typed values, contrast) first.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { checkFrameMessage, initMessage, paramMessage as hostParam } from '../../../../src/components/est/estFrameProtocol';
import type { EstParam } from '../../../../src/audio/est/EstNode';
import {
  meterNorm,
  connect, contrast, controlFor, ensureContrast, EstAll, EstKnob, EstSelect, EstSwitch, EstXY, formatValue, KIT_ELEMENTS, MIN_CONTRAST, onColour, parseColour,
  parseTyped, readHints, resolveParam, shownParams, THEMES, toHex, wheelPixels, type Connection, type Rgb,
} from './index';
import { forgetHints } from './bound';
import { FLAGS, type FrameMessage } from './protocol';

const NONCE = 'b'.repeat(32);
const A = FLAGS.AUTOMATABLE;
const PARAMS: EstParam[] = [
  { id: 0, name: 'Gain', module: '', min: -60, max: 12, def: 0, flags: A, value: 0 },
  { id: 1, name: 'Cutoff', module: 'Filter', min: 20, max: 20000, def: 1000, flags: A, value: 1000, scale: 'log' },
  { id: 2, name: 'Filter Mode', module: 'Filter', min: 0, max: 3, def: 0, flags: A | FLAGS.STEPPED, value: 0 },
  { id: 3, name: 'Drive On', module: '', min: 0, max: 1, def: 0, flags: A | FLAGS.STEPPED, value: 0 },
  { id: 4, name: 'Level Out', module: '', min: 0, max: 1, def: 0, flags: FLAGS.READONLY, value: 0.5 },
  { id: 5, name: 'Secret', module: '', min: 0, max: 1, def: 0, flags: A | FLAGS.HIDDEN, value: 0 },
];

interface Rig { conn: Connection; sent: FrameMessage[]; deliver: (m: unknown) => void; tick: () => void }
function rig(): Rig {
  const sent: FrameMessage[] = [];
  const frames: (() => void)[] = [];
  let listener: ((d: unknown, ok: boolean) => void) | null = null;
  const conn = connect({ nonce: NONCE, transport: { post: m => sent.push(m), listen: fn => { listener = fn; return () => { listener = null; }; } }, schedule: fn => frames.push(fn), now: () => 0 });
  const r: Rig = { conn, sent, deliver: m => listener?.(m, true), tick: () => { for (const fn of frames.splice(0)) fn(); } };
  r.deliver(initMessage(NONCE, PARAMS, { rate: 48000, theme: { bg: '#000000', fg: '#ffffff', accent: '#ff0000' }, meters: true, audio: false }));
  sent.length = 0;
  return r;
}
/** What the host makes of everything sent: every message must pass its checker. */
const hostView = (r: Rig) => { r.tick(); return r.sent.map(m => checkFrameMessage(JSON.parse(JSON.stringify(m)), NONCE, PARAMS)); };
const short = (r: Rig) => hostView(r).map(m => (!m ? 'REFUSED' : m.type === 'est:param' ? `set ${m.id}=${m.value}` : m.type === 'est:gesture' ? `${m.phase} ${m.id}` : m.type));

function make<T extends HTMLElement>(r: Rig, tag: string, attrs: Record<string, string>): T {
  const el = document.createElement(tag) as T;
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  (el as unknown as { source: Connection }).source = r.conn;
  document.body.append(el);
  return el;
}
const key = (el: Element, k: string, o: KeyboardEventInit = {}) => { const e = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, composed: true, ...o }); el.dispatchEvent(e); return e; };
const ptr = (el: Element, type: string, o: PointerEventInit = {}) => el.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 1, button: 0, ...o }));

beforeEach(() => { document.body.innerHTML = ''; document.head.querySelector('meta[name="est-params"]')?.remove(); forgetHints(); });
afterEach(() => { document.body.innerHTML = ''; });

describe('the pure parts', () => {
  it('resolves a param attribute by id, then by name (letters and digits, case ignored)', () => {
    expect(resolveParam('1', PARAMS)?.name).toBe('Cutoff');
    expect(resolveParam('cutoff', PARAMS)?.id).toBe(1);
    expect(resolveParam('filter-mode', PARAMS)?.id).toBe(2);
    expect(resolveParam('FilterMode', PARAMS)?.id).toBe(2);
    expect(resolveParam('99', PARAMS)).toBeUndefined();
    expect(resolveParam('nothing', PARAMS)).toBeUndefined();
    expect(resolveParam('', PARAMS)).toBeUndefined();
    expect(resolveParam(null, PARAMS)).toBeUndefined();
    // Two parameters of one name: a name picks neither.
    expect(resolveParam('x', [{ ...PARAMS[0]!, name: 'X' }, { ...PARAMS[1]!, name: 'x' }])).toBeUndefined();
  });

  it('reads the page\'s hints and leaves out anything malformed', () => {
    const h = readHints(JSON.stringify([{ id: 1, unit: 'Hz' }, { id: 2, labels: ['Low', 'Band'] }, { id: -1, unit: 'x' }, { id: 3, unit: 7 }, 'junk']));
    expect(h.get(1)).toEqual({ id: 1, unit: 'Hz' });
    expect(h.get(2)?.labels).toEqual(['Low', 'Band']);
    expect(h.has(-1)).toBe(false);
    expect(h.get(3)).toEqual({ id: 3 });
    expect(readHints('not json').size).toBe(0);
    expect(readHints(null).size).toBe(0);
  });

  it('picks a control for a parameter and leaves hidden ones out', () => {
    expect(controlFor(PARAMS[0]!)).toBe('est-knob');
    expect(controlFor(PARAMS[2]!)).toBe('est-select');
    expect(controlFor(PARAMS[3]!)).toBe('est-switch');
    expect(controlFor({ ...PARAMS[2]!, max: 40 })).toBe('est-knob');
    expect(shownParams(PARAMS).map(p => p.id)).toEqual([0, 1, 2, 3, 4]);
  });

  it('reads a typed value: a number, a unit, k for thousands, a label', () => {
    const cut = PARAMS[1]!, mode = PARAMS[2]!;
    expect(parseTyped('440', cut)).toBe(440);
    expect(parseTyped('1.2k', cut)).toBe(1200);
    expect(parseTyped('2,5 kHz', cut)).toBe(2500);
    expect(parseTyped('99999', cut)).toBe(20000);
    expect(parseTyped('−6 dB', PARAMS[0]!)).toBe(-6);
    expect(parseTyped('band', mode, ['Low', 'Band', 'High', 'Notch'])).toBe(1);
    expect(parseTyped('2.6', mode)).toBe(3);
    expect(parseTyped('loud', cut)).toBeNull();
    expect(parseTyped('', cut)).toBeNull();
  });

  it('reads a wheel in pixels whatever its delta mode', () => {
    expect(wheelPixels({ deltaY: 100, deltaMode: 0 })).toBe(100);
    expect(wheelPixels({ deltaY: 3, deltaMode: 1 })).toBe(48);
    expect(wheelPixels({ deltaY: 1, deltaMode: 2 })).toBe(400);
  });

  it('keeps text at 4.5:1: a colour that passes is untouched, one that fails is moved just far enough', () => {
    const bg = parseColour('#14171c')!;
    const ok = parseColour('#eef1f6')!;
    expect(ensureContrast(ok, bg)).toBe(ok);
    for (const bad of ['#30343c', '#5a2a2a', '#14171c', '#777777']) {
      const fixed = ensureContrast(parseColour(bad)!, bg);
      expect(contrast(fixed, bg), bad).toBeGreaterThanOrEqual(MIN_CONTRAST);
    }
    // On a light background it goes darker, and it passes on both the background and the panel.
    const light: Rgb[] = [parseColour('#f1ebdd')!, parseColour('#fbf7ec')!];
    const dark = ensureContrast(parseColour('#c9c2b0')!, light);
    for (const b of light) expect(contrast(dark, b)).toBeGreaterThanOrEqual(MIN_CONTRAST);
    expect(toHex(onColour(parseColour('#ff8a3d')!))).toBe('#101014');
    expect(toHex(onColour(parseColour('#1f3a8a')!))).toBe('#ffffff');
    expect(parseColour('rgb(10, 20, 30)')).toEqual([10, 20, 30]);
    expect(parseColour('rgba(10 20 30 / 0.5)')).toEqual([10, 20, 30]);
    expect(parseColour('#abc')).toEqual([170, 187, 204]);
    expect(parseColour('papayawhip')).toBeNull();
  });

  it('every built-in theme reads at 4.5:1: text and quiet text on the background and the panel, ink on the accent', () => {
    expect(Object.keys(THEMES).length).toBeGreaterThanOrEqual(5);
    for (const [name, t] of Object.entries(THEMES)) {
      const c = (k: string) => parseColour(t[k]!)!;
      for (const text of ['fg', 'dim']) for (const back of ['bg', 'panel']) expect(contrast(c(text), c(back)), `${name}: ${text} on ${back}`).toBeGreaterThanOrEqual(MIN_CONTRAST);
      expect(contrast(onColour(c('accent')), c('accent')), `${name}: ink on the accent`).toBeGreaterThanOrEqual(MIN_CONTRAST);
      // The accent draws arcs and fills: 3:1 against what it sits on (non-text contrast).
      for (const back of ['bg', 'panel']) expect(contrast(c('accent'), c(back)), `${name}: accent on ${back}`).toBeGreaterThanOrEqual(3);
    }
  });

  it('registers every element of the kit', () => {
    for (const name of KIT_ELEMENTS) expect(customElements.get(name), name).toBeTruthy();
  });
});

describe('binding', () => {
  it('a knob named by its parameter\'s name binds, takes its unit and labels from the page\'s hints, and reflects the host', () => {
    const meta = document.createElement('meta');
    meta.name = 'est-params';
    meta.content = JSON.stringify([{ id: 1, unit: 'Hz' }, { id: 2, labels: ['Low', 'Band', 'High', 'Notch'] }]);
    document.head.append(meta);
    const r = rig();
    const k = make<EstKnob>(r, 'est-knob', { param: 'cutoff' });
    expect(k.paramId).toBe(1);
    expect(k.hasAttribute('data-est-unbound')).toBe(false);
    expect(k.getAttribute('aria-label')).toBe('Cutoff');
    expect(k.getAttribute('aria-valuetext')).toBe('1 kHz');
    r.deliver(hostParam(NONCE, 1, 440));
    expect(k.getAttribute('aria-valuenow')).toBe('440');
    expect(k.getAttribute('aria-valuetext')).toBe('440 Hz');
    const m = make<EstKnob>(r, 'est-knob', { param: 'Filter Mode' });
    r.deliver(hostParam(NONCE, 2, 2));
    expect(m.getAttribute('aria-valuetext')).toBe('High');
  });

  it('an element naming a parameter the plugin lacks is marked, disabled and sends nothing', () => {
    const r = rig();
    const k = make<EstKnob>(r, 'est-knob', { param: 'Wobble' });
    const s = make<EstSwitch>(r, 'est-switch', { param: '42' });
    const x = make<EstXY>(r, 'est-xy', { x: 'Cutoff', y: 'Nope' });
    for (const el of [k, s, x]) expect(el.hasAttribute('data-est-unbound'), el.tagName).toBe(true);
    expect(k.getAttribute('aria-label')).toBe('Wobble (not connected)');
    expect(k.getAttribute('aria-disabled')).toBe('true');
    expect(k.shadowRoot!.querySelector('.value')!.textContent).toBe('?');
    key(k, 'ArrowUp'); s.click(); key(s, ' ');
    ptr(k, 'pointerdown', { clientX: 0, clientY: 0 }); ptr(k, 'pointerup');
    expect(short(r)).toEqual([]);
  });

  it('a read-only parameter is shown, follows the host and is never written', () => {
    const r = rig();
    const k = make<EstKnob>(r, 'est-knob', { param: '4' });
    expect(k.getAttribute('aria-readonly')).toBe('true');
    key(k, 'ArrowUp'); key(k, 'Delete'); key(k, 'Enter');
    ptr(k, 'pointerdown', { clientX: 0, clientY: 100 }); ptr(k, 'pointermove', { clientX: 0, clientY: 0 }); ptr(k, 'pointerup');
    k.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, bubbles: true, cancelable: true }));
    k.reset();
    expect(short(r)).toEqual([]);
    // The host's own readout arrives through est:init (a read-only value is the plugin's to report).
    r.deliver(initMessage(NONCE, PARAMS.map(p => (p.id === 4 ? { ...p, value: 0.9 } : p)), { rate: 48000, theme: { bg: '#000000', fg: '#ffffff', accent: '#ff0000' }, meters: true, audio: false }));
    expect(k.getAttribute('aria-valuenow')).toBe('0.9');
  });

  it('a drag is one gesture; Delete resets in a gesture of its own; a typed value is one too', () => {
    const r = rig();
    const k = make<EstKnob>(r, 'est-knob', { param: 'Gain', unit: 'dB' });
    ptr(k, 'pointerdown', { clientX: 0, clientY: 100 });
    ptr(k, 'pointermove', { clientX: 0, clientY: 50 });
    ptr(k, 'pointerup', { clientX: 0, clientY: 50 });
    const drag = short(r);
    expect(drag[0]).toBe('begin 0');
    expect(drag.at(-1)).toBe('end 0');
    expect(drag.filter(x => x.startsWith('set 0=')).length).toBeGreaterThan(0);
    expect(drag).not.toContain('REFUSED');
    r.sent.length = 0;
    expect(key(k, 'Delete').defaultPrevented).toBe(true);
    expect(short(r)).toEqual(['begin 0', 'set 0=0', 'end 0']);
    r.sent.length = 0;
    // Enter opens a field; a value with a unit is read; Enter takes it.
    key(k, 'Enter');
    const field = k.shadowRoot!.querySelector('input')!;
    expect(field).toBeTruthy();
    field.value = '-12 dB';
    key(field, 'Enter');
    expect(k.shadowRoot!.querySelector('input')).toBeNull();
    expect(short(r)).toEqual(['begin 0', 'set 0=-12', 'end 0']);
    r.sent.length = 0;
    // Escape leaves the value alone.
    key(k, '5');
    const again = k.shadowRoot!.querySelector('input')!;
    expect(again.value).toBe('5');
    key(again, 'Escape');
    expect(short(r)).toEqual([]);
  });

  it('the wheel is one gesture for a run of notches, in pixels whatever the delta mode', async () => {
    const r = rig();
    const k = make<EstKnob>(r, 'est-knob', { param: 'Gain' });
    const wheel = (deltaY: number, deltaMode = 0) => { const e = new WheelEvent('wheel', { deltaY, deltaMode, bubbles: true, cancelable: true }); k.dispatchEvent(e); return e; };
    expect(wheel(-100).defaultPrevented).toBe(true);
    wheel(-6, 1);
    await new Promise(res => setTimeout(res, 320));
    const out = short(r);
    expect(out[0]).toBe('begin 0');
    expect(out.at(-1)).toBe('end 0');
    expect(out.filter(x => x === 'begin 0').length).toBe(1);
    // 196 px up of 1000 over a 72 dB range: about +14 dB, clamped to the top.
    expect(k.value).toBeCloseTo(12, 5);
  });

  it('keys the kit does not use are left alone (the host gets them back): letters, Escape with no drag', () => {
    const r = rig();
    const k = make<EstKnob>(r, 'est-knob', { param: 'Gain' });
    const s = make<EstSwitch>(r, 'est-switch', { param: 'Drive On' });
    for (const el of [k, s]) for (const letter of ['a', 'z', 'Escape', 'Tab']) expect(key(el, letter).defaultPrevented, `${el.tagName} ${letter}`).toBe(false);
    expect(short(r)).toEqual([]);
  });
});

describe('the other controls', () => {
  it('a switch toggles between the ends of its range, one gesture a press', () => {
    const r = rig();
    const s = make<EstSwitch>(r, 'est-switch', { param: 'Drive On' });
    expect(s.getAttribute('role')).toBe('switch');
    expect(s.getAttribute('aria-checked')).toBe('false');
    s.click();
    expect(short(r)).toEqual(['begin 3', 'set 3=1', 'end 3']);
    expect(s.getAttribute('aria-checked')).toBe('true');
    r.sent.length = 0;
    expect(key(s, ' ').defaultPrevented).toBe(true);
    expect(short(r)).toEqual(['begin 3', 'set 3=0', 'end 3']);
    r.deliver(hostParam(NONCE, 3, 1));
    expect(s.getAttribute('aria-checked')).toBe('true');
  });

  it('a select is a radio group of the parameter\'s choices: click, arrows, the host', () => {
    const r = rig();
    const s = make<EstSelect>(r, 'est-select', { param: 'Filter Mode', labels: 'Low, Band, High, Notch' });
    const buttons = () => Array.from(s.shadowRoot!.querySelectorAll('button'));
    expect(buttons().map(b => b.textContent)).toEqual(['Low', 'Band', 'High', 'Notch']);
    expect(s.shadowRoot!.querySelector('[role="radiogroup"]')!.getAttribute('aria-label')).toBe('Filter Mode');
    expect(buttons().map(b => b.getAttribute('aria-checked'))).toEqual(['true', 'false', 'false', 'false']);
    buttons()[2]!.click();
    expect(short(r)).toEqual(['begin 2', 'set 2=2', 'end 2']);
    r.sent.length = 0;
    key(buttons()[2]!, 'ArrowRight');
    expect(short(r)).toEqual(['begin 2', 'set 2=3', 'end 2']);
    r.sent.length = 0;
    key(buttons()[3]!, 'ArrowRight'); // already at the end
    expect(short(r)).toEqual([]);
    r.deliver(hostParam(NONCE, 2, 1));
    expect(buttons().map(b => b.getAttribute('aria-checked'))).toEqual(['false', 'true', 'false', 'false']);
    expect(buttons().map(b => b.tabIndex)).toEqual([-1, 0, -1, -1]);
    // As a menu: a native select.
    const m = make<EstSelect>(r, 'est-select', { param: '2', menu: '', labels: 'Low, Band, High, Notch' });
    const sel = m.shadowRoot!.querySelector('select')!;
    expect(sel.value).toBe('1');
    sel.value = '0';
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    expect(short(r)).toEqual(['begin 2', 'set 2=0', 'end 2']);
  });

  it('an XY pad writes both parameters in one gesture each and follows the host', () => {
    const r = rig();
    const x = make<EstXY>(r, 'est-xy', { x: 'Cutoff', y: 'Gain' });
    const pad = x.shadowRoot!.querySelector('.pad') as HTMLElement;
    pad.getBoundingClientRect = () => ({ left: 0, top: 0, right: 100, bottom: 100, width: 100, height: 100, x: 0, y: 0, toJSON: () => '' });
    ptr(x, 'pointerdown', { clientX: 50, clientY: 50 });
    ptr(x, 'pointermove', { clientX: 100, clientY: 0 });
    ptr(x, 'pointerup', { clientX: 100, clientY: 0 });
    const out = short(r);
    expect(out.slice(0, 2)).toEqual(['begin 1', 'begin 0']);
    expect(out.slice(-2)).toEqual(['end 1', 'end 0']);
    expect(out).toContain('set 1=20000');
    expect(out).toContain('set 0=12');
    expect(out).not.toContain('REFUSED');
    r.sent.length = 0;
    expect(key(x, 'ArrowLeft').defaultPrevented).toBe(true);
    expect(short(r).every(m => m.startsWith('set 1='))).toBe(true);
    r.deliver(hostParam(NONCE, 0, -24));
    expect(x.getAttribute('aria-valuetext')).toContain('Gain -24');
  });

  it('est-all makes a control for every parameter shown nowhere else, and only those', () => {
    const r = rig();
    make<EstKnob>(r, 'est-knob', { param: 'Gain' });
    make<EstXY>(r, 'est-xy', { x: '1', y: '1' });
    const all = make<EstAll>(r, 'est-all', {});
    expect(Array.from(all.children).map(c => `${c.tagName.toLowerCase()}:${c.getAttribute('param')}`)).toEqual(['est-select:2', 'est-switch:3', 'est-knob:4']);
    const some = make<EstAll>(r, 'est-all', { params: '0, 3' });
    expect(Array.from(some.children).map(c => `${c.tagName.toLowerCase()}:${c.getAttribute('param')}`)).toEqual(['est-knob:0', 'est-switch:3']);
    (some.children[1] as EstSwitch).click();
    expect(short(r)).toEqual(['begin 3', 'set 3=1', 'end 3']);
  });

  it('a meter follows est:meter with ARIA values, never a parameter', () => {
    const r = rig();
    const m = document.createElement('est-meter');
    document.body.append(m);
    expect(m.getAttribute('role')).toBe('meter');
    expect(m.getAttribute('aria-label')).toBe('Output level');
    // The page's own connection is what a meter follows; without one it only waits.
    expect(short(r)).toEqual([]);
    expect(meterNorm(1)).toBe(1);
    expect(meterNorm(0)).toBe(0);
    expect(meterNorm(0.1)).toBeCloseTo(2 / 3, 5);
  });

  it('formats as the controls announce', () => {
    expect(formatValue(PARAMS[1]!, 2400, 'Hz')).toBe('2.4 kHz');
    expect(formatValue(PARAMS[0]!, 3, 'dB')).toBe('+3 dB');
  });
});

describe('<est-window>', () => {
  it('draws its header, takes a theme and marks the page', () => {
    const w = document.createElement('est-window');
    w.setAttribute('name', 'Glow Filter');
    w.setAttribute('theme', 'ember');
    w.setAttribute('meter', '');
    w.innerHTML = '<est-row><est-panel label="Tone"></est-panel></est-row>';
    document.body.append(w);
    expect(w.querySelector('header.est-head h1')!.textContent).toBe('Glow Filter');
    expect(w.querySelector('header.est-head est-meter')).toBeTruthy();
    expect(document.head.querySelector('style[data-est-kit]')!.textContent).toContain('est-window[theme="ember"]');
    const panel = w.querySelector('est-panel')!;
    expect(panel.getAttribute('role')).toBe('group');
    expect(panel.getAttribute('aria-label')).toBe('Tone');
    expect(panel.querySelector('.est-panel-label')!.textContent).toBe('Tone');
    w.setAttribute('name', 'Other');
    expect(w.querySelectorAll('header.est-head').length).toBe(1);
    expect(w.querySelector('h1')!.textContent).toBe('Other');
  });
});
