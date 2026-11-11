/**
 * `<est-knob>` and `<est-slider>`: a parameter's control, bound by its `param` attribute (the CLAP
 * id) to the page's connection, or to any `ParamSource` set as its `source` property.
 *
 * Each is one focusable `role="slider"` with a name (`label`, else the parameter's name) and ARIA
 * values (`aria-valuenow` the plain value, `aria-valuetext` with its unit). Keys: the arrows step
 * (Shift for a fine step), Page Up and Page Down step by a tenth, Home and End go to the ends.
 * A drag (pointer events, so mouse, touch and pen alike) sends `est:gesture` begin and end around
 * its changes, so the host writes it once, one undo step; Escape during a drag puts the value
 * back; a double click returns the default.
 *
 * Attributes: `param`, `label` (the visible text), `name` (the accessible name, default the label), `unit` (Hz, dB, %, ms …), `scale` ("log" or "linear"; without it, the parameter's own from est.json),
 * `labels` (a stepped parameter's choices, comma-separated), and on the knob `size` (px).
 * Colours: `--est-bg`, `--est-fg`, `--est-accent` (defaults: Cyber's dark look), and `--est-dim`,
 * `--est-track` for the quieter parts.
 */
import { currentConnection, whenConnected, type ParamSource } from './connect';
import { formatValue, fromNorm, toNorm, type Scale } from './format';
import { FLAGS, type EstUiParam } from './protocol';

const Base: typeof HTMLElement = typeof HTMLElement === 'undefined' ? (class {} as unknown as typeof HTMLElement) : HTMLElement;

// Written compactly: it ships in every plugin page that uses the library.
const STYLE = ':host{--_bg:var(--est-bg,#14161b);--_fg:var(--est-fg,#e8eaf0);--_accent:var(--est-accent,#5ad1c3);'
  + '--_dim:var(--est-dim,#a9afbd);--_track:var(--est-track,#343a46);display:inline-flex;flex-direction:column;'
  + 'align-items:center;gap:4px;color:var(--_fg);font:12px/1.3 system-ui,sans-serif;touch-action:none;user-select:none;'
  + '-webkit-user-select:none;cursor:grab;border-radius:6px;outline:none}'
  + ':host(:focus-visible){outline:2px solid var(--_accent);outline-offset:2px}'
  + ':host([aria-disabled="true"]){opacity:.55;cursor:default}'
  + '.label{color:var(--_dim);white-space:nowrap}.value{font-variant-numeric:tabular-nums;white-space:nowrap}'
  + 'svg{display:block;overflow:visible}.track{stroke:var(--_track)}.fill{stroke:var(--_accent)}.dot{fill:var(--_fg)}';

abstract class EstControl extends Base {
  static get observedAttributes() { return ['param', 'label', 'name', 'unit', 'scale', 'labels', 'size']; }

  protected readonly _root: ShadowRoot;
  private _src: ParamSource | null = null;
  private _explicitSource = false;
  private _unsubscribe: (() => void) | null = null;
  private _unwait: (() => void) | null = null;
  private _drag: { id: number; start: number; startNorm: number; x: number; y: number; pointer: number } | null = null;

  constructor() {
    super();
    this._root = this.attachShadow({ mode: 'open' });
    this._root.innerHTML = `<style>${STYLE}${this._extraStyle()}</style>${this._template()}`;
    const on = (type: string, fn: (e: never) => void) => this.addEventListener(type, e => fn(e as never));
    on('keydown', (e: KeyboardEvent) => this._onKey(e));
    on('pointerdown', (e: PointerEvent) => this._onDown(e));
    on('pointermove', (e: PointerEvent) => this._onMove(e));
    for (const t of ['pointerup', 'pointercancel', 'lostpointercapture']) on(t, (e: PointerEvent) => this._onUp(e));
    on('dblclick', () => this.reset());
  }

  protected abstract _template(): string;
  protected _extraStyle(): string { return ''; }
  /** Draw the position (0…1). */
  protected abstract _draw(norm: number): void;
  /** The drag's position from a pointer event (null: relative to where it started). */
  protected abstract _pointerNorm(e: PointerEvent, start: { norm: number; x: number; y: number }): number;
  protected abstract readonly _orientation: 'vertical' | 'horizontal';

  connectedCallback() {
    if (!this.hasAttribute('role')) this.setAttribute('role', 'slider');
    if (!this.hasAttribute('tabindex')) this.tabIndex = 0;
    this.setAttribute('aria-orientation', this._orientation);
    if (!this._explicitSource && !this._src) {
      const c = currentConnection();
      if (c) this._attach(c);
      else this._unwait = whenConnected(conn => { if (!this._explicitSource) this._attach(conn); });
    }
    this._render();
  }

  disconnectedCallback() {
    this._cancelDrag(false);
    this._unwait?.();
    this._unwait = null;
  }

  attributeChangedCallback() { if (this.isConnected) this._render(); }

  /** The values this control reads and writes (the page's connection unless set). */
  get source(): ParamSource | null { return this._src; }
  set source(s: ParamSource | null) {
    this._explicitSource = !!s;
    this._unwait?.();
    this._unwait = null;
    this._attach(s);
  }

  private _attach(s: ParamSource | null) {
    this._unsubscribe?.();
    this._unsubscribe = null;
    this._src = s;
    if (s) this._unsubscribe = s.subscribe(id => { if (id === null || id === this.paramId) this._render(); });
    this._render();
  }

  /** The CLAP id from the `param` attribute (null without one). */
  get paramId(): number | null {
    const a = this.getAttribute('param');
    if (a === null || a.trim() === '') return null;
    const n = Number(a);
    return Number.isInteger(n) && n >= 0 ? n : null;
  }
  set paramId(id: number | null) {
    if (id === null) this.removeAttribute('param');
    else this.setAttribute('param', String(id));
  }

  get info(): EstUiParam | undefined {
    const id = this.paramId;
    return id === null ? undefined : this._src?.param(id);
  }
  get value(): number | undefined {
    const id = this.paramId;
    return id === null ? undefined : this._src?.get(id);
  }
  set value(v: number | undefined) {
    const id = this.paramId;
    if (id !== null && v !== undefined) this._src?.set(id, v);
  }

  /** The `scale` attribute when given ("log" or "linear"), else the parameter's own (est.json's hint, D-44). */
  private get _scale(): Scale {
    const a = this.getAttribute('scale');
    if (a === 'log' || a === 'linear') return a;
    return this.info?.scale === 'log' ? 'log' : 'linear';
  }
  private get _labels(): string[] | undefined {
    const l = this.getAttribute('labels');
    return l ? l.split(',').map(s => s.trim()) : undefined;
  }
  private _editable(p: EstUiParam | undefined): p is EstUiParam {
    return !!p && !(p.flags & FLAGS.READONLY) && p.max > p.min;
  }

  /** The text shown and announced for the current value. */
  get valueText(): string {
    const p = this.info;
    const v = this.value;
    if (!p || v === undefined) return '';
    return formatValue(p, v, this.getAttribute('unit') ?? '', this._labels);
  }

  protected _render() {
    const p = this.info;
    const v = this.value;
    const label = this.getAttribute('label') || p?.name || (this.paramId !== null ? `Parameter ${this.paramId}` : 'Parameter');
    // `name`: the accessible name when the visible label is short ("Q" in a band's group).
    const name = this.getAttribute('name') || label;
    const ok = !!p && v !== undefined;
    const text = ok ? this.valueText : '';
    /** An `aria-*` attribute set, or removed for null. */
    const aria = (k: string, x: string | number | null) => (x === null ? this.removeAttribute(`aria-${k}`) : this.setAttribute(`aria-${k}`, String(x)));
    aria('label', name);
    aria('valuemin', ok ? p.min : 0);
    aria('valuemax', ok ? p.max : 1);
    aria('valuenow', ok ? v : 0);
    aria('valuetext', ok ? text : null);
    aria('disabled', this._editable(p) ? null : 'true');
    aria('readonly', p && p.flags & FLAGS.READONLY ? 'true' : null);
    const show = (sel: string, t: string) => { const el = this._root.querySelector(sel); if (el) el.textContent = t; };
    show('.label', label);
    show('.value', ok ? text : '–');
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
    const p = this.info;
    const v = this.value;
    if (e.key === 'Escape' && this._drag) { e.preventDefault(); this._cancelDrag(true); return; }
    if (!this._editable(p) || v === undefined || e.altKey || e.ctrlKey || e.metaKey) return;
    const next = this._keyValue(e, p, v);
    if (next === null) return;
    e.preventDefault();
    this._src!.set(p.id, next);
  }

  private _onDown(e: PointerEvent) {
    const p = this.info;
    const v = this.value;
    if (e.button !== 0 || !this._editable(p) || v === undefined || this._drag) return;
    e.preventDefault();
    this.focus();
    try { this.setPointerCapture(e.pointerId); } catch { /* a synthetic event */ }
    const start = { norm: toNorm(p, v, this._scale), x: e.clientX, y: e.clientY };
    this._drag = { id: p.id, start: v, startNorm: start.norm, x: e.clientX, y: e.clientY, pointer: e.pointerId };
    this._src!.begin(p.id);
    this._src!.set(p.id, fromNorm(p, this._pointerNorm(e, start), this._scale));
  }

  private _onMove(e: PointerEvent) {
    const d = this._drag;
    const p = this.info;
    if (!d || e.pointerId !== d.pointer || !p) return;
    this._src!.set(d.id, fromNorm(p, this._pointerNorm(e, { norm: d.startNorm, x: d.x, y: d.y }), this._scale));
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
    if (restore) this._src?.set(d.id, d.start);
    this._src?.end(d.id);
    try { this.releasePointerCapture(d.pointer); } catch { /* already released */ }
  }

  /** Back to the parameter's default. */
  reset() {
    const p = this.info;
    if (!this._editable(p)) return;
    this._src!.set(p.id, p.def);
  }
}

/** A rotary control: drag up or down (Shift for fine), 200 px over the whole range. */
export class EstKnob extends EstControl {
  protected readonly _orientation = 'vertical' as const;
  protected _template() {
    const arc = (c: string) => `<path class="${c}" fill="none" stroke-width="4" stroke-linecap="round"/>`;
    return `<span class="label" aria-hidden="true"></span><svg viewBox="0 0 48 48" aria-hidden="true">${arc('track')}${arc('fill')}`
      + '<circle class="dot" r="3"/></svg><span class="value" aria-hidden="true"></span>';
  }
  protected _extraStyle() { return 'svg{width:var(--_size,48px);height:var(--_size,48px)}'; }
  attributeChangedCallback() {
    const s = Number(this.getAttribute('size'));
    if (Number.isFinite(s) && s > 0) this.style.setProperty('--_size', `${s}px`);
    super.attributeChangedCallback();
  }
  protected _draw(norm: number) {
    const a0 = Math.PI * 0.75;
    const sweep = Math.PI * 1.5;
    const at = (t: number) => {
      const a = a0 + sweep * t;
      return [24 + 18 * Math.cos(a), 24 + 18 * Math.sin(a)] as const;
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

/** A horizontal fader: the position under the pointer. */
export class EstSlider extends EstControl {
  protected readonly _orientation = 'horizontal' as const;
  protected _template() {
    return '<span class="row"><span class="label" aria-hidden="true"></span><span class="value" aria-hidden="true"></span></span>'
      + '<span class="bar" aria-hidden="true"><span class="fillbar"></span><span class="thumb"></span></span>';
  }
  protected _extraStyle() {
    return ':host{align-items:stretch;min-width:120px}.row{display:flex;justify-content:space-between;gap:8px}'
      + '.bar{position:relative;height:6px;margin:6px 0;border-radius:3px;background:var(--_track)}'
      + '.fillbar{position:absolute;inset:0 auto 0 0;border-radius:3px;background:var(--_accent)}'
      + '.thumb{position:absolute;top:50%;width:14px;height:14px;margin:-7px 0 0 -7px;border-radius:50%;background:var(--_fg)}';
  }
  protected _draw(norm: number) {
    const pct = `${(Math.min(1, Math.max(0, norm)) * 100).toFixed(2)}%`;
    (this._root.querySelector('.fillbar') as HTMLElement | null)?.style.setProperty('width', pct);
    (this._root.querySelector('.thumb') as HTMLElement | null)?.style.setProperty('left', pct);
  }
  protected _pointerNorm(e: PointerEvent) {
    const bar = this._root.querySelector('.bar') as HTMLElement | null;
    const r = (bar ?? this).getBoundingClientRect();
    return r.width > 0 ? (e.clientX - r.left) / r.width : 0;
  }
}

/** Register `<est-knob>` and `<est-slider>` (idempotent; done when the library loads). */
export function defineElements(registry: CustomElementRegistry | undefined = typeof customElements === 'undefined' ? undefined : customElements) {
  if (!registry) return;
  if (!registry.get('est-knob')) registry.define('est-knob', EstKnob);
  if (!registry.get('est-slider')) registry.define('est-slider', EstSlider);
}

declare global {
  interface HTMLElementTagNameMap {
    'est-knob': EstKnob;
    'est-slider': EstSlider;
  }
}
