/**
 * `<est-knob>` and `<est-slider>`: one parameter each, keyboard and pointer, a WAI-ARIA slider.
 *
 *   <est-knob param="0" unit="dB"></est-knob>
 *   <est-knob param="Cutoff" scale="log" unit="Hz" label="Cutoff"></est-knob>
 *   <est-slider param="7" unit="%"></est-slider>   <est-slider param="7" vertical></est-slider>
 *
 * Attributes: `param` (the parameter's id or its name), `label` (default: the parameter's name),
 * `unit` ("Hz", "dB", "%", "ms" …), `scale` ("linear" or "log": how the control moves over its
 * range), `labels` ("Sine,Saw,Square": a stepped parameter's choices), `size` (the knob's diameter in
 * CSS px; without one a knob inside `<est-window>` sizes itself to its cell).
 * Keys: arrows one step (Shift for a fine one), Page Up / Page Down a tenth, Home and End the ends,
 * Delete or Backspace the default, Enter (or a digit) to type a value. The mouse wheel steps it;
 * a double-click resets it; Escape during a drag puts the value back. They use the page's connection
 * (`connect()`, made by itself when the page has none) unless a `source` is given.
 *
 * Colours come from CSS variables with the host's theme as defaults: `--est-bg`, `--est-fg`,
 * `--est-accent` (set on the page by `connect()` from the host's theme), plus `--est-dim` and
 * `--est-track` for the quieter parts and `--est-cap` for a knob's body (none by default).
 */
import { EstBound, editable } from './bound';
import { formatValue, fromNorm, parseTyped, toNorm, wheelPixels, type Scale } from './format';
import { FLAGS, type EstUiParam } from './protocol';

// Written compactly: it ships in every plugin page that uses the library.
export const BASE_STYLE = ':host{--_bg:var(--est-bg,#14161b);--_fg:var(--est-fg,#e8eaf0);--_accent:var(--est-accent,#5ad1c3);'
  + '--_dim:var(--est-dim,#a9afbd);--_track:var(--est-track,#343a46);display:inline-flex;flex-direction:column;'
  + 'align-items:center;justify-content:center;gap:4px;color:var(--_fg);font:12px/1.3 var(--est-font,system-ui,sans-serif);touch-action:none;user-select:none;'
  + '-webkit-user-select:none;border-radius:var(--est-radius,6px);outline:none;box-sizing:border-box;position:relative}'
  + ':host(:focus-visible){outline:2px solid var(--_accent);outline-offset:2px}'
  + ':host([aria-disabled="true"]){opacity:.55;cursor:default}'
  + ':host([data-est-unbound]){opacity:.5;outline:1px dashed var(--_dim)}'
  + '.label{color:var(--_dim);white-space:nowrap;max-width:100%;overflow:hidden;text-overflow:ellipsis;letter-spacing:var(--est-tracking,0)}'
  + '.value{font-variant-numeric:tabular-nums;white-space:nowrap;max-width:100%;overflow:hidden;text-overflow:ellipsis}'
  // Inside <est-window> a caption never widens its control (so a changing value never moves the layout).
  + '.label,.value{width:var(--est-text-w,auto);min-width:var(--est-text-min,0);text-align:center}'
  + '@media (pointer:coarse){:host{min-width:44px;min-height:44px}}';

const STYLE = BASE_STYLE + ':host{cursor:grab}'
  + 'svg{display:block;overflow:visible}.track{stroke:var(--_track)}.fill{stroke:var(--_accent)}.dot{fill:var(--_fg)}'
  + '.cap{fill:var(--est-cap,transparent);stroke:var(--est-cap-edge,transparent)}'
  + '.entry{position:absolute;left:50%;bottom:0;transform:translateX(-50%);width:72px;max-width:100%;box-sizing:border-box;text-align:center;'
  + 'font:inherit;color:var(--_fg);background:var(--_bg);border:1px solid var(--_accent);border-radius:4px;padding:1px 2px;outline:none}';

interface Drag { id: number; start: number; startNorm: number; x: number; y: number; pointer: number }

export abstract class EstControl extends EstBound {
  static get observedAttributes() { return ['param', 'label', 'name', 'unit', 'scale', 'labels', 'size', 'vertical']; }

  protected readonly _root: ShadowRoot;
  private _drag: Drag | null = null;
  private _wheel: { id: number; acc: number; timer: ReturnType<typeof setTimeout> } | null = null;
  private _entry: HTMLInputElement | null = null;

  constructor() {
    super();
    this._root = this.attachShadow({ mode: 'open' });
    this._root.innerHTML = `<style>${STYLE}${this._extraStyle()}</style>${this._template()}`;
    const on = (type: string, fn: (e: never) => void, o?: AddEventListenerOptions) => this.addEventListener(type, e => fn(e as never), o);
    on('keydown', (e: KeyboardEvent) => this._onKey(e));
    on('pointerdown', (e: PointerEvent) => this._onDown(e));
    on('pointermove', (e: PointerEvent) => this._onMove(e));
    for (const t of ['pointerup', 'pointercancel', 'lostpointercapture']) on(t, (e: PointerEvent) => this._onUp(e));
    on('dblclick', () => this.reset());
    on('wheel', (e: WheelEvent) => this._onWheel(e), { passive: false });
  }

  protected abstract _template(): string;
  protected _extraStyle(): string { return ''; }
  /** Draw the position (0…1). */
  protected abstract _draw(norm: number): void;
  /** The drag's position from a pointer event. */
  protected abstract _pointerNorm(e: PointerEvent, start: { norm: number; x: number; y: number }): number;
  protected abstract get _orientation(): 'vertical' | 'horizontal';

  protected _connected() {
    if (!this.hasAttribute('role')) this.setAttribute('role', 'slider');
    if (!this.hasAttribute('tabindex')) this.tabIndex = 0;
  }

  protected _disconnected() {
    this._cancelDrag(false);
    this._endWheel();
    this._closeEntry(false);
  }

  /** The `scale` attribute when given ("log" or "linear"), else the parameter's own (est.json's hint, D-44). */
  private get _scale(): Scale {
    const a = this.getAttribute('scale');
    if (a === 'log' || a === 'linear') return a;
    return this.info?.scale === 'log' ? 'log' : 'linear';
  }

  /** The text shown and announced for the current value. */
  get valueText(): string {
    const p = this.info;
    const v = this.value;
    if (!p || v === undefined) return '';
    return formatValue(p, v, this._unit, this._labels);
  }

  protected _render() {
    const bound = this._mark();
    const p = this.info;
    const v = this.value;
    const ref = this.getAttribute('param');
    const label = this.getAttribute('label') || p?.name || (ref !== null && /^\s*\d+\s*$/.test(ref) ? `Parameter ${ref.trim()}` : ref || 'Parameter');
    // `name`: the accessible name when the visible label is short ("Q" in a band's group).
    const name = this.getAttribute('name') || label;
    const ok = !!p && v !== undefined;
    const text = ok ? this.valueText : '';
    /** An `aria-*` attribute set, or removed for null. */
    const aria = (k: string, x: string | number | null) => (x === null ? this.removeAttribute(`aria-${k}`) : this.setAttribute(`aria-${k}`, String(x)));
    this.setAttribute('aria-orientation', this._orientation);
    aria('label', bound ? name : `${name} (not connected)`);
    aria('valuemin', ok ? p.min : 0);
    aria('valuemax', ok ? p.max : 1);
    aria('valuenow', ok ? v : 0);
    aria('valuetext', ok ? text : null);
    aria('disabled', editable(p) ? null : 'true');
    aria('readonly', p && p.flags & FLAGS.READONLY ? 'true' : null);
    const show = (sel: string, t: string) => { const el = this._root.querySelector(sel); if (el && el.textContent !== t) el.textContent = t; };
    show('.label', label);
    show('.value', ok ? text : bound ? '–' : '?');
    this._draw(ok ? toNorm(p, v, this._scale) : 0);
  }

  /** One key step, as a new value (null: not a key of ours). */
  private _keyValue(e: KeyboardEvent, p: EstUiParam, v: number): number | null {
    const stepped = (p.flags & FLAGS.STEPPED) !== 0;
    const big = stepped ? Math.max(1, Math.round((p.max - p.min) / 10)) : 0.1;
    const small = stepped ? 1 : e.shiftKey ? 0.001 : 0.01;
    const by = (d: number) => (stepped ? v + d : fromNorm(p, toNorm(p, v, this._scale) + d, this._scale));
    switch (e.key) {
      case 'ArrowUp': case 'ArrowRight': return by(small);
      case 'ArrowDown': case 'ArrowLeft': return by(-small);
      case 'PageUp': return by(big);
      case 'PageDown': return by(-big);
      case 'Home': return p.min;
      case 'End': return p.max;
      default: return null;
    }
  }

  private _onKey(e: KeyboardEvent) {
    if (this._entry) return; // the field's own keys
    const p = this.info;
    const v = this.value;
    if (e.key === 'Escape' && this._drag) { e.preventDefault(); this._cancelDrag(true); return; }
    if (!editable(p) || v === undefined || e.altKey || e.ctrlKey || e.metaKey) return;
    if (e.key === 'Enter' || /^[0-9.-]$/.test(e.key)) {
      e.preventDefault();
      this._openEntry(e.key === 'Enter' ? null : e.key);
      return;
    }
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); this.reset(); return; }
    const next = this._keyValue(e, p, v);
    if (next === null) return;
    e.preventDefault();
    this.source!.set(p.id, next);
  }

  /** Type a value: a small field over the readout. Enter takes it, Escape leaves it. */
  private _openEntry(first: string | null) {
    const p = this.info;
    if (!editable(p) || this._entry) return;
    const input = document.createElement('input');
    input.className = 'entry';
    input.type = 'text';
    input.setAttribute('inputmode', 'decimal');
    input.setAttribute('aria-label', `${this.getAttribute('aria-label') ?? 'Value'}: type a value`);
    input.value = first ?? this.valueText.replace(/[^\d.+\-−k]/gi, '').replace('−', '-');
    // The field's keys stay in the field: outside the shadow root an event's target is the control
    // itself, so the host's key hand-back (the frame guard) could not tell it is typing.
    input.addEventListener('keydown', ev => {
      ev.stopPropagation();
      if (ev.key === 'Enter') { ev.preventDefault(); this._closeEntry(true); } else if (ev.key === 'Escape') { ev.preventDefault(); this._closeEntry(false); }
    });
    input.addEventListener('keyup', ev => ev.stopPropagation());
    input.addEventListener('blur', () => this._closeEntry(true));
    for (const t of ['pointerdown', 'dblclick', 'wheel']) input.addEventListener(t, ev => ev.stopPropagation());
    this._entry = input;
    this._root.append(input);
    input.focus();
    if (first === null) input.select();
  }

  private _closeEntry(take: boolean) {
    const input = this._entry;
    if (!input) return;
    this._entry = null;
    const p = this.info;
    const had = input === this._root.activeElement;
    if (take && editable(p)) {
      const v = parseTyped(input.value, p, this._labels);
      if (v !== null && v !== this.value) this._commit(p.id, v);
    }
    input.remove();
    if (had && this.isConnected) this.focus();
  }

  private _onDown(e: PointerEvent) {
    const p = this.info;
    const v = this.value;
    if (e.button !== 0 || !editable(p) || v === undefined || this._drag || this._entry) return;
    e.preventDefault();
    this.focus();
    try { this.setPointerCapture(e.pointerId); } catch { /* a synthetic event */ }
    const start = { norm: toNorm(p, v, this._scale), x: e.clientX, y: e.clientY };
    this._drag = { id: p.id, start: v, startNorm: start.norm, x: e.clientX, y: e.clientY, pointer: e.pointerId };
    this.source!.begin(p.id);
    this.source!.set(p.id, fromNorm(p, this._pointerNorm(e, start), this._scale));
  }

  private _onMove(e: PointerEvent) {
    const d = this._drag;
    const p = this.info;
    if (!d || e.pointerId !== d.pointer || !p) return;
    this.source!.set(d.id, fromNorm(p, this._pointerNorm(e, { norm: d.startNorm, x: d.x, y: d.y }), this._scale));
  }

  private _onUp(e: PointerEvent) {
    if (!this._drag || e.pointerId !== this._drag.pointer) return;
    this._cancelDrag(false);
  }

  /** End a drag (`restore`: put the value back first, Escape). */
  private _cancelDrag(restore: boolean) {
    const d = this._drag;
    if (!d) return;
    this._drag = null;
    if (restore) this.source?.set(d.id, d.start);
    this.source?.end(d.id);
    try { this.releasePointerCapture(d.pointer); } catch { /* already released */ }
  }

  /** The wheel: one gesture for a run of notches (ended after a quarter second of quiet). */
  private _onWheel(e: WheelEvent) {
    const p = this.info;
    const v = this.value;
    const s = this.source;
    if (!editable(p) || v === undefined || !s || this._drag || this._entry || e.ctrlKey) return;
    e.preventDefault();
    const px = wheelPixels(e);
    if (!this._wheel || this._wheel.id !== p.id) {
      this._endWheel();
      s.begin(p.id);
      this._wheel = { id: p.id, acc: 0, timer: setTimeout(() => this._endWheel(), 250) };
    } else {
      clearTimeout(this._wheel.timer);
      this._wheel.timer = setTimeout(() => this._endWheel(), 250);
    }
    if (p.flags & FLAGS.STEPPED) {
      this._wheel.acc -= px;
      const steps = Math.trunc(this._wheel.acc / 50);
      if (steps) { this._wheel.acc -= steps * 50; s.set(p.id, v + steps); }
    } else {
      s.set(p.id, fromNorm(p, toNorm(p, v, this._scale) - px / (e.shiftKey ? 10000 : 1000), this._scale));
    }
  }

  private _endWheel() {
    const w = this._wheel;
    if (!w) return;
    this._wheel = null;
    clearTimeout(w.timer);
    this.source?.end(w.id);
  }

  /** Back to the parameter's default (one undo step). */
  reset() {
    const p = this.info;
    if (!editable(p) || this._entry) return;
    if (this._drag) this.source!.set(p.id, p.def);
    else this._commit(p.id, p.def);
  }
}

/** A rotary control: drag up or down (Shift for fine), 200 px over the whole range. */
export class EstKnob extends EstControl {
  private _ro: ResizeObserver | null = null;
  private _size = 0;
  private _want = 0;
  private _sizing = 0;
  protected get _orientation() { return 'vertical' as const; }
  protected _template() {
    const arc = (c: string) => `<path class="${c}" fill="none" stroke-width="4" stroke-linecap="round"/>`;
    return `<span class="label" aria-hidden="true"></span><svg viewBox="0 0 48 48" aria-hidden="true"><circle class="cap" cx="24" cy="24" r="13"/>${arc('track')}${arc('fill')}`
      + '<circle class="dot" r="3"/></svg><span class="value" aria-hidden="true"></span>';
  }
  protected _extraStyle() { return 'svg{width:var(--_size,48px);height:var(--_size,48px);flex:none}'; }
  attributeChangedCallback(name?: string, old?: string | null, next?: string | null) {
    const s = Number(this.getAttribute('size'));
    if (Number.isFinite(s) && s > 0) this.style.setProperty('--_size', `${s}px`);
    super.attributeChangedCallback(name, old, next);
  }
  protected _connected() {
    super._connected();
    // Inside <est-window> a knob with no size of its own fills its cell (measured, never per frame).
    if (this.hasAttribute('size') || !this.closest('est-window') || typeof ResizeObserver === 'undefined') return;
    // The new size is applied in the next frame, never inside the observer's own callback: resizing what
    // an observer watches from its callback is a "ResizeObserver loop" error on the window (Safari reports
    // it as the page's error), and one frame later costs nothing a person sees.
    this._ro = new ResizeObserver(entries => {
      const r = entries[0]?.contentRect;
      if (!r) return;
      this._want = Math.max(28, Math.min(120, Math.floor(Math.min(r.width - 4, r.height - 40))));
      if (this._sizing || this._want === this._size) return;
      this._sizing = requestAnimationFrame(() => {
        this._sizing = 0;
        if (this._want === this._size) return;
        this._size = this._want;
        this.style.setProperty('--_size', `${this._size}px`);
      });
    });
    this._ro.observe(this);
  }
  protected _disconnected() {
    super._disconnected();
    this._ro?.disconnect();
    this._ro = null;
    if (this._sizing) cancelAnimationFrame(this._sizing);
    this._sizing = 0;
    this._size = 0;
  }
  protected _draw(norm: number) {
    const a0 = Math.PI * 0.75;
    const sweep = Math.PI * 1.5;
    const at = (t: number, r = 18) => {
      const a = a0 + sweep * t;
      return [24 + r * Math.cos(a), 24 + r * Math.sin(a)] as const;
    };
    const arc = (t: number) => {
      const [x0, y0] = at(0);
      const [x1, y1] = at(t);
      return `M${x0.toFixed(2)} ${y0.toFixed(2)}A18 18 0 ${sweep * t > Math.PI ? 1 : 0} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
    };
    const t = Math.min(1, Math.max(0, norm));
    this._root.querySelector('.track')?.setAttribute('d', arc(1));
    this._root.querySelector('.fill')?.setAttribute('d', t > 0.001 ? arc(t) : '');
    const [x, y] = at(t);
    const dot = this._root.querySelector('.dot');
    dot?.setAttribute('cx', x.toFixed(2));
    dot?.setAttribute('cy', y.toFixed(2));
  }
  protected _pointerNorm(e: PointerEvent, start: { norm: number; x: number; y: number }) {
    return start.norm + (start.y - e.clientY) / (e.shiftKey ? 1000 : 200);
  }
}

/** A fader: the position under the pointer. Horizontal, or `vertical`. */
export class EstSlider extends EstControl {
  protected get _orientation() { return this.hasAttribute('vertical') ? 'vertical' as const : 'horizontal' as const; }
  protected _template() {
    return '<span class="row"><span class="label" aria-hidden="true"></span><span class="value" aria-hidden="true"></span></span>'
      + '<span class="bar" aria-hidden="true"><span class="fillbar"></span><span class="thumb"></span></span>';
  }
  protected _extraStyle() {
    return ':host{align-items:stretch;min-width:120px;cursor:pointer}.row{display:flex;justify-content:space-between;gap:8px}.row .label,.row .value{width:auto;min-width:0}'
      + '.bar{position:relative;height:6px;margin:6px 0;border-radius:3px;background:var(--_track)}'
      + '.fillbar{position:absolute;inset:0 auto 0 0;border-radius:3px;background:var(--_accent)}'
      + '.thumb{position:absolute;top:50%;width:14px;height:14px;margin:-7px 0 0 -7px;border-radius:50%;background:var(--_fg)}'
      + ':host([vertical]){min-width:44px;min-height:96px;align-items:center}:host([vertical]) .row{flex-direction:column;align-items:center;gap:2px;order:2}'
      + ':host([vertical]) .bar{width:6px;height:auto;flex:1 1 0;min-height:48px;margin:6px 0}'
      + ':host([vertical]) .fillbar{inset:auto 0 0 0}:host([vertical]) .thumb{top:auto;left:50%;margin:0 0 -7px -7px}';
  }
  protected _draw(norm: number) {
    const pct = `${(Math.min(1, Math.max(0, norm)) * 100).toFixed(2)}%`;
    const fill = this._root.querySelector('.fillbar') as HTMLElement | null;
    const thumb = this._root.querySelector('.thumb') as HTMLElement | null;
    if (!fill || !thumb) return;
    const v = this.hasAttribute('vertical');
    fill.style.width = v ? '' : pct;
    fill.style.height = v ? pct : '';
    thumb.style.left = v ? '' : pct;
    thumb.style.bottom = v ? pct : '';
  }
  protected _pointerNorm(e: PointerEvent) {
    const bar = this._root.querySelector('.bar') as HTMLElement | null;
    const r = (bar ?? this).getBoundingClientRect();
    if (this.hasAttribute('vertical')) return r.height > 0 ? (r.bottom - e.clientY) / r.height : 0;
    return r.width > 0 ? (e.clientX - r.left) / r.width : 0;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'est-knob': EstKnob;
    'est-slider': EstSlider;
  }
}
