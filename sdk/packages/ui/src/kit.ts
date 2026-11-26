/**
 * The window kit: the rest of the elements a plugin's window is made of. The page declares and
 * styles; each element finds its parameter and does the wiring (both ways) by itself.
 *
 *   <est-window name="Glow Filter" theme="ember" meter>
 *     <est-spectrum></est-spectrum>
 *     <est-row>
 *       <est-knob param="Cutoff"></est-knob>
 *       <est-xy x="Cutoff" y="Resonance"></est-xy>
 *       <est-select param="Mode"></est-select>
 *       <est-switch param="Drive On"></est-switch>
 *     </est-row>
 *   </est-window>
 *
 * - `<est-window name theme meter>`: the page's root. It fills the frame at any size (a column of
 *   rows that share the height), carries the theme (`studio`, `neon`, `paper`, `ember`, `moss`; the
 *   page overrides any `--est-*` variable) and keeps text readable (4.5:1) whatever colours it is given.
 * - `<est-row>`, `<est-panel label>`: layout. A row's children share its width; a panel is a titled group.
 * - `<est-switch param>`: on/off. `<est-select param>`: a stepped parameter's choices as buttons
 *   (`menu`: a drop-down). `<est-xy x y>`: two parameters on a pad. `<est-value param>`: a readout.
 * - `<est-meter>`: the output level (`in`: the input's). `<est-spectrum>`: the plugin's output as a
 *   spectrum where the host offers it (est.json's `ui.audio`), else a level trace. Never samples.
 * - `<est-all>`: a control for every parameter no other element shows (`params="3,4"`: just those).
 * - `display(canvas, draw)`: a canvas of the page's own, kept crisp and redrawn on every change.
 *
 * Everything draws through refs on change or on the host's messages; nothing lays out per frame.
 */
import { EstBound, controlFor, editable, resolveParam, shownParams } from './bound';
import { currentConnection, whenConnected, type Connection, type ParamSource } from './connect';
import { ensureContrast, onColour, parseColour, toHex, type Rgb } from './contrast';
import { BASE_STYLE, EstKnob, EstSlider } from './controls';
import { formatValue, fromNorm, toNorm, type Scale } from './format';
import { FLAGS, type EstUiParam } from './protocol';

const Base: typeof HTMLElement = typeof HTMLElement === 'undefined' ? (class {} as unknown as typeof HTMLElement) : HTMLElement;
const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

// ── The themes and the page's styles ────────────────────────────────────────────────────────────────

/** The built-in themes: every text colour at 4.5:1 or better on its background and panel (`kit.test.ts`). */
export const THEMES: Record<string, Record<string, string>> = {
  studio: { bg: '#14171c', panel: '#1d222a', fg: '#eef1f6', dim: '#a8b0bf', accent: '#5ad1c3', track: '#39414f', cap: '#262d38', radius: '8px', font: 'system-ui,sans-serif', tracking: '0' },
  neon: { bg: '#0b0714', panel: '#160d26', fg: '#f6efff', dim: '#b9a6dc', accent: '#ff4fd8', track: '#3a2560', cap: '#1d1233', radius: '4px', font: 'ui-monospace,Menlo,Consolas,monospace', tracking: '.06em' },
  paper: { bg: '#f1ebdd', panel: '#fbf7ec', fg: '#23201a', dim: '#5e574a', accent: '#b3341f', track: '#cfc6b1', cap: '#e6dfcd', radius: '2px', font: 'Georgia,"Times New Roman",serif', tracking: '.02em' },
  ember: { bg: '#1a120e', panel: '#261a14', fg: '#fbeee2', dim: '#c9ac97', accent: '#ff8a3d', track: '#4a3327', cap: '#33231a', radius: '12px', font: 'system-ui,sans-serif', tracking: '.04em' },
  moss: { bg: '#e9efe6', panel: '#f6f9f3', fg: '#1b261d', dim: '#4c5d4f', accent: '#1f7a4d', track: '#bccabc', cap: '#dde6da', radius: '16px', font: '"Trebuchet MS",Verdana,sans-serif', tracking: '0' },
};
export const DEFAULT_THEME = 'studio';

const vars = (t: Record<string, string>) => Object.entries(t).map(([k, v]) => `--est-${k}:${v}`).join(';');

/** The page's stylesheet, added once (zero specificity past the element names, so the page's own CSS wins). */
export const PAGE_STYLE = [
  ':where(html:has(est-window),html:has(est-window) body){margin:0;width:100%;height:100%;overflow:hidden}',
  `:where(est-window){${vars(THEMES[DEFAULT_THEME]!)};display:flex;flex-direction:column;gap:6px;box-sizing:border-box;width:100%;height:100%;padding:6px;overflow:hidden;`
    + 'background:var(--est-bg);color:var(--est-fg);font:12px/1.3 var(--est-font);accent-color:var(--est-accent)}',
  ...Object.entries(THEMES).map(([name, t]) => `:where(est-window[theme="${name}"]){${vars(t)}}`),
  ':where(est-window *){box-sizing:border-box}',
  ':where(est-window)>:where(header.est-head){flex:none;display:flex;align-items:center;justify-content:space-between;gap:12px;min-height:24px}',
  ':where(header.est-head) :where(h1){margin:0;font-size:14px;font-weight:800;letter-spacing:.24em;text-transform:uppercase;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
  ':where(header.est-head) :where(est-meter){flex:0 1 120px}',
  ':where(est-row){display:flex;flex:1 1 0;gap:8px;align-items:stretch}',
  ':where(est-row)>:where(*){flex:1 1 0}',
  // A panel flows its controls side by side and wraps them (a row inside it takes a whole line), so a
  // panel written as a plain list of controls is a row of them, never a tall stack.
  ':where(est-panel){display:flex;flex-flow:row wrap;align-content:stretch;flex:1 1 0;gap:4px 6px;padding:4px 6px;background:var(--est-panel);border:1px solid var(--est-track);border-radius:var(--est-radius)}',
  ':where(est-panel)>:where(.est-panel-label){flex:0 0 100%;color:var(--est-dim);font-size:10px;letter-spacing:.18em;text-transform:uppercase}',
  ':where(est-panel)>:where(:not(.est-panel-label)){flex:1 1 0}',
  ':where(est-panel)>:where(est-row,est-panel,est-spectrum,canvas,est-slider:not([vertical])){flex:1 1 100%}',
  // A display is part of the window, never most of it (under 40 % of the frame: scripts/estWindowFill.mjs' backdrop rule).
  ':where(est-window)>:where(est-spectrum,canvas,est-xy){flex:.8 1 0;max-height:38%}',
  // What each element needs at the least: a window too small for its content is scaled to fit (EstWindow._fit), never squashed.
  ':where(est-window est-knob){min-width:60px;min-height:84px}:where(est-window est-switch){min-width:56px;min-height:64px}',
  ':where(est-window est-slider){min-width:110px;min-height:38px}:where(est-window est-slider[vertical]){min-width:46px;min-height:104px}',
  ':where(est-window est-select){min-width:80px;min-height:54px}:where(est-window est-xy){min-width:96px;min-height:110px}',
  ':where(est-window est-spectrum,est-window canvas){min-width:0;min-height:56px}',
  ':where(est-window){transform-origin:0 0;--est-text-w:0;--est-text-min:100%}',
  ':where(est-window)>:where(est-slider:not([vertical])){flex:none}',
  ':where(est-row,est-panel)>:where(est-switch,est-meter[vertical]){flex:.5 1 0}',
  ':where(est-window canvas){display:block;width:100%;border-radius:var(--est-radius);background:var(--est-panel)}',
  ':where(est-all){display:contents}',
].join('');

let styled = false;
function addPageStyle() {
  if (styled || typeof document === 'undefined' || !document.head) return;
  styled = true;
  const s = document.createElement('style');
  s.setAttribute('data-est-kit', '');
  s.textContent = PAGE_STYLE;
  document.head.prepend(s);
}

const TEXT_VARS = ['fg', 'dim'] as const;

/**
 * Keep a window's text readable: the colours it ends up with (its theme, its own CSS) are read back
 * and, where one is under 4.5:1 on the background or the panel, moved just far enough. `--est-on-accent`
 * is the ink for text on the accent colour.
 */
export function guardContrast(win: HTMLElement) {
  if (typeof getComputedStyle !== 'function') return;
  const probe = document.createElement('span');
  probe.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden;pointer-events:none';
  win.append(probe);
  const read = (name: string): Rgb | null => {
    probe.style.color = '';
    probe.style.color = `var(--est-${name})`;
    return parseColour(getComputedStyle(probe).color);
  };
  for (const k of [...TEXT_VARS, 'on-accent']) win.style.removeProperty(`--est-${k}`);
  const bg = read('bg'), panel = read('panel'), accent = read('accent');
  if (bg) {
    const bgs = panel ? [bg, panel] : [bg];
    for (const k of TEXT_VARS) {
      const c = read(k);
      if (!c) continue;
      const fixed = ensureContrast(c, bgs);
      if (fixed !== c) win.style.setProperty(`--est-${k}`, toHex(fixed));
    }
  }
  if (accent) win.style.setProperty('--est-on-accent', toHex(onColour(accent)));
  probe.remove();
}

// ── Layout elements (light DOM) ─────────────────────────────────────────────────────────────────────

/** The page's root: theme, fill, an optional header (`name`, `meter`), the contrast guard. */
export class EstWindow extends Base {
  static get observedAttributes() { return ['name', 'theme', 'meter']; }
  private _mo: MutationObserver | null = null;
  private _kids: MutationObserver | null = null;
  private _queued = 0;
  private readonly _later = () => { if (!this._queued && typeof requestAnimationFrame === 'function') this._queued = requestAnimationFrame(() => { this._queued = 0; this._fit(); }); };
  /**
   * The window's content at its least (every control at its minimum size) may need more room than the
   * frame gives: then the whole window is laid out larger and scaled down to the frame by one factor,
   * so nothing overlaps or is cut off. With room to spare it is left alone (the rows share the space).
   * Measured on a resize or when elements come and go, never per frame.
   */
  private _fit() {
    if (!this.isConnected) return;
    const st = this.style;
    const W = document.documentElement.clientWidth, H = document.documentElement.clientHeight;
    st.width = st.height = st.transform = '';
    if (W < 1 || H < 1) return;
    let k = 1;
    for (let i = 0; i < 5; i++) {
      const w = W / k, h = H / k;
      if (k < 1) { st.width = `${w}px`; st.height = `${h}px`; }
      const needW = this.scrollWidth, needH = this.scrollHeight;
      if (needW <= w + 1 && needH <= h + 1) break;
      k = Math.max(0.4, k * Math.min(w / needW, h / needH) * 0.985);
    }
    if (k < 1) st.transform = `scale(${k.toFixed(4)})`;
    if (k < 1) this.setAttribute('data-est-scaled', k.toFixed(2)); else this.removeAttribute('data-est-scaled');
  }
  connectedCallback() {
    addPageStyle();
    addEventListener('resize', this._later);
    if (typeof MutationObserver !== 'undefined') {
      this._kids = new MutationObserver(this._later);
      this._kids.observe(this, { childList: true, subtree: true });
    }
    if (document.readyState !== 'complete') addEventListener('load', this._later, { once: true });
    // Again once the host's values are in (generated controls and readouts have their sizes then).
    whenConnected(c => { c.subscribe(id => { if (id === null) this._later(); }); });
    this._later();
    if (!this.hasAttribute('role')) this.setAttribute('role', 'main');
    this._head();
    const guard = () => guardContrast(this);
    // Once now and once the page's own stylesheet has had its say.
    guard();
    if (document.readyState !== 'complete') addEventListener('load', guard, { once: true });
    if (typeof MutationObserver !== 'undefined') {
      this._mo = new MutationObserver(guard);
      this._mo.observe(this, { attributes: true, attributeFilter: ['theme', 'class'] });
    }
    if (!currentConnection()) probeConnect(this);
  }
  disconnectedCallback() { this._mo?.disconnect(); this._kids?.disconnect(); this._mo = this._kids = null; removeEventListener('resize', this._later); }
  attributeChangedCallback() { if (this.isConnected) this._head(); }
  private _head() {
    const name = this.getAttribute('name');
    let head = this.querySelector(':scope > header.est-head');
    if (!name) { head?.remove(); return; }
    if (!head) {
      head = document.createElement('header');
      head.className = 'est-head';
      head.append(document.createElement('h1'));
      this.prepend(head);
    }
    const h1 = head.querySelector('h1')!;
    if (h1.textContent !== name) h1.textContent = name;
    const meter = head.querySelector('est-meter');
    if (this.hasAttribute('meter') && !meter) head.append(document.createElement('est-meter'));
    else if (!this.hasAttribute('meter') && meter) meter.remove();
  }
}

/** An empty bound element is enough to start the page's connection when it has no script of its own. */
function probeConnect(win: HTMLElement) {
  if (win.querySelector('est-value[data-est-probe]')) return;
  const v = document.createElement('est-value');
  v.setAttribute('data-est-probe', '');
  v.hidden = true;
  win.append(v);
}

/** A titled group. */
export class EstPanel extends Base {
  static get observedAttributes() { return ['label']; }
  // A panel is a drawn box: it counts as the window's content (`data-fill`, scripts/estWindowFill.mjs).
  connectedCallback() { addPageStyle(); this.setAttribute('data-fill', ''); this._label(); }
  attributeChangedCallback() { if (this.isConnected) this._label(); }
  private _label() {
    const label = this.getAttribute('label');
    let el = this.querySelector(':scope > .est-panel-label');
    if (!label) { el?.remove(); this.removeAttribute('role'); return; }
    if (!el) {
      el = document.createElement('div');
      el.className = 'est-panel-label';
      el.setAttribute('aria-hidden', 'true');
      this.prepend(el);
    }
    if (el.textContent !== label) el.textContent = label;
    this.setAttribute('role', 'group');
    this.setAttribute('aria-label', label);
  }
}

/** A row: its children share its width. Only styles. */
export class EstRow extends Base {
  connectedCallback() { addPageStyle(); }
}

// ── est-switch ──────────────────────────────────────────────────────────────────────────────────────

const shadow = (el: HTMLElement, style: string, html: string) => {
  const root = el.attachShadow({ mode: 'open' });
  root.innerHTML = `<style>${BASE_STYLE}${style}</style>${html}`;
  return root;
};

/** On/off: the top of the parameter's range, or the bottom. Click, Space or Enter. */
export class EstSwitch extends EstBound {
  static get observedAttributes() { return ['param', 'label', 'name']; }
  private readonly _root = shadow(this, ':host{cursor:pointer}.sw{width:36px;height:20px;border-radius:10px;background:var(--_track);position:relative;flex:none}'
    + '.sw i{position:absolute;top:3px;left:3px;width:14px;height:14px;border-radius:50%;background:var(--_fg)}'
    + ':host([aria-checked="true"]) .sw{background:var(--_accent)}:host([aria-checked="true"]) .sw i{left:19px;background:var(--est-on-accent,var(--_bg))}',
  '<span class="label" aria-hidden="true"></span><span class="sw" aria-hidden="true"><i></i></span><span class="value" aria-hidden="true"></span>');
  constructor() {
    super();
    this.addEventListener('click', () => this.toggle());
    this.addEventListener('keydown', e => {
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); this.toggle(); } else if (e.key === 'Delete' || e.key === 'Backspace') {
        const p = this.info;
        if (editable(p)) { e.preventDefault(); this._commit(p.id, p.def); }
      }
    });
  }
  protected _connected() {
    if (!this.hasAttribute('role')) this.setAttribute('role', 'switch');
    if (!this.hasAttribute('tabindex')) this.tabIndex = 0;
  }
  get on(): boolean {
    const p = this.info, v = this.value;
    return !!p && v !== undefined && v > (p.min + p.max) / 2;
  }
  toggle() {
    const p = this.info;
    if (!editable(p)) return;
    this._commit(p.id, this.on ? p.min : p.max);
  }
  protected _render() {
    const bound = this._mark();
    const p = this.info;
    const label = this.getAttribute('label') || p?.name || this.getAttribute('param') || 'Switch';
    const name = this.getAttribute('name') || label;
    this.setAttribute('aria-label', bound ? name : `${name} (not connected)`);
    this.setAttribute('aria-checked', String(this.on));
    if (editable(p)) this.removeAttribute('aria-disabled'); else this.setAttribute('aria-disabled', 'true');
    const labels = this._labels;
    const text = !p ? (bound ? '–' : '?') : labels?.[this.on ? labels.length - 1 : 0] ?? (this.on ? 'On' : 'Off');
    const set = (sel: string, t: string) => { const el = this._root.querySelector(sel); if (el && el.textContent !== t) el.textContent = t; };
    set('.label', label);
    set('.value', text);
  }
}

// ── est-select ──────────────────────────────────────────────────────────────────────────────────────

/** A stepped parameter's choices: a row of buttons (a radio group), or with `menu` a drop-down. */
export class EstSelect extends EstBound {
  static get observedAttributes() { return ['param', 'label', 'name', 'labels', 'menu', 'unit']; }
  private readonly _root = shadow(this, ':host{align-items:stretch;cursor:default}.label{text-align:center}'
    + '.opts{display:flex;flex-wrap:wrap;gap:4px;justify-content:center}'
    + 'button,select{font:inherit;color:var(--_dim);background:transparent;border:1px solid var(--_track);border-radius:var(--est-radius,6px);padding:5px 9px;cursor:pointer;min-height:26px;touch-action:manipulation}'
    + 'button{flex:1 1 auto}button[aria-checked="true"]{background:var(--_accent);border-color:var(--_accent);color:var(--est-on-accent,var(--_bg));font-weight:700}'
    + 'button:focus-visible,select:focus-visible{outline:2px solid var(--_fg);outline-offset:1px}select{color:var(--_fg);background:var(--_bg)}'
    + '@media (pointer:coarse){button,select{min-height:44px;min-width:44px}}',
  '<span class="label" aria-hidden="true"></span><span class="opts"></span>');
  private _key = '';
  protected _connected() { this.setAttribute('data-fill', ''); }
  constructor() {
    super();
    this._root.addEventListener('click', e => {
      const b = (e.target as Element | null)?.closest?.('button');
      const p = this.info;
      if (b && editable(p)) this._commit(p.id, Number(b.getAttribute('data-v')));
    });
    this._root.addEventListener('change', e => {
      const p = this.info;
      const t = e.target as HTMLSelectElement | null;
      if (t && t.tagName === 'SELECT' && editable(p)) this._commit(p.id, Number(t.value));
    });
    // A drop-down's own keys (type-ahead) stay with it (see the knob's field).
    for (const t of ['keydown', 'keyup']) this._root.addEventListener(t, ev => { if ((ev.target as Element | null)?.tagName === 'SELECT') ev.stopPropagation(); });
    this._root.addEventListener('keydown', ev => {
      const e = ev as KeyboardEvent;
      const p = this.info, v = this.value;
      if (!editable(p) || v === undefined || this.hasAttribute('menu') || e.altKey || e.ctrlKey || e.metaKey) return;
      const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
      const to = step ? Math.round(v) + step : e.key === 'Home' ? p.min : e.key === 'End' ? p.max : e.key === 'Delete' || e.key === 'Backspace' ? p.def : null;
      if (to === null) return;
      e.preventDefault();
      const next = Math.min(p.max, Math.max(p.min, to));
      if (next !== v) this._commit(p.id, next);
      (this._root.querySelector(`button[data-v="${next}"]`) as HTMLElement | null)?.focus();
    });
  }
  protected _render() {
    const bound = this._mark();
    const p = this.info, v = this.value;
    const label = this.getAttribute('label') || p?.name || this.getAttribute('param') || 'Choice';
    const name = this.getAttribute('name') || label;
    const lab = this._root.querySelector('.label')!;
    if (lab.textContent !== label) lab.textContent = label;
    const opts = this._root.querySelector('.opts') as HTMLElement;
    const menu = this.hasAttribute('menu');
    const labels = this._labels;
    const key = p ? `${menu}|${p.id}|${p.min}|${p.max}|${labels?.join('\u0001') ?? ''}|${this._unit}|${name}|${editable(p)}` : `none|${bound}`;
    if (key !== this._key) {
      this._key = key;
      opts.textContent = '';
      if (!p) {
        const s = document.createElement('span');
        s.className = 'value';
        s.textContent = bound ? '–' : '?';
        opts.append(s);
      } else {
        const lo = Math.round(p.min), n = Math.min(128, Math.round(p.max) - lo + 1);
        const text = (i: number) => labels?.[i] ?? formatValue({ ...p, flags: p.flags | FLAGS.STEPPED }, lo + i, this._unit);
        if (menu) {
          const sel = document.createElement('select');
          sel.setAttribute('aria-label', name);
          sel.disabled = !editable(p);
          for (let i = 0; i < n; i++) { const o = document.createElement('option'); o.value = String(lo + i); o.textContent = text(i); sel.append(o); }
          opts.append(sel);
        } else {
          opts.setAttribute('role', 'radiogroup');
          opts.setAttribute('aria-label', name);
          for (let i = 0; i < n; i++) {
            const b = document.createElement('button');
            b.type = 'button';
            b.setAttribute('role', 'radio');
            b.setAttribute('data-v', String(lo + i));
            b.disabled = !editable(p);
            b.textContent = text(i);
            opts.append(b);
          }
        }
      }
    }
    if (!p || v === undefined) return;
    const now = Math.round(v);
    const sel = opts.querySelector('select');
    if (sel) { if (sel.value !== String(now)) sel.value = String(now); return; }
    for (const b of Array.from(opts.querySelectorAll('button'))) {
      const onNow = Number(b.getAttribute('data-v')) === now;
      b.setAttribute('aria-checked', String(onNow));
      b.tabIndex = onNow ? 0 : -1;
    }
  }
}

// ── est-xy ──────────────────────────────────────────────────────────────────────────────────────────

/** Two parameters on a pad: `x` across, `y` up. Arrow keys move it; a drag is one gesture on both. */
export class EstXY extends EstBound {
  static get observedAttributes() { return ['x', 'y', 'label', 'name', 'x-unit', 'y-unit']; }
  private readonly _root = shadow(this, ':host{cursor:crosshair;align-items:stretch;min-width:88px;min-height:88px}'
    + '.pad{position:relative;flex:1 1 0;min-height:60px;border:1px solid var(--_track);border-radius:var(--est-radius,6px);background:'
    + 'linear-gradient(var(--_track),var(--_track)) 50% 0/1px 100% no-repeat,linear-gradient(var(--_track),var(--_track)) 0 50%/100% 1px no-repeat,var(--est-panel,var(--_bg));overflow:hidden}'
    + '.dot{position:absolute;width:14px;height:14px;margin:-7px 0 0 -7px;border-radius:50%;background:var(--_accent);box-shadow:0 0 0 2px var(--_fg)}'
    + '.value{text-align:center}',
  '<span class="label" aria-hidden="true"></span><span class="pad" aria-hidden="true"><span class="dot"></span></span><span class="value" aria-hidden="true"></span>');
  private _drag: { pointer: number; ids: number[]; start: number[] } | null = null;
  constructor() {
    super();
    const on = (type: string, fn: (e: never) => void) => this.addEventListener(type, e => fn(e as never));
    on('pointerdown', (e: PointerEvent) => this._down(e));
    on('pointermove', (e: PointerEvent) => { if (this._drag && e.pointerId === this._drag.pointer) this._at(e); });
    for (const t of ['pointerup', 'pointercancel', 'lostpointercapture']) on(t, (e: PointerEvent) => { if (this._drag && e.pointerId === this._drag.pointer) this._end(false); });
    on('keydown', (e: KeyboardEvent) => this._key(e));
    on('dblclick', () => { for (const p of this._pair()) if (editable(p)) this._commit(p.id, p.def); });
  }
  protected _connected() {
    if (!this.hasAttribute('role')) this.setAttribute('role', 'slider');
    if (!this.hasAttribute('tabindex')) this.tabIndex = 0;
  }
  protected _disconnected() { this._end(false); }
  protected _concerns(id: number) { return this._pair().some(p => p?.id === id); }
  private _pair(): [EstUiParam | undefined, EstUiParam | undefined] { return [this._lookup('x'), this._lookup('y')]; }
  private _scale(p: EstUiParam): Scale { return p.scale === 'log' ? 'log' : 'linear'; }
  private _down(e: PointerEvent) {
    const s = this.source;
    const ps = this._pair().filter(editable);
    if (e.button !== 0 || !s || !ps.length || this._drag) return;
    e.preventDefault();
    this.focus();
    try { this.setPointerCapture(e.pointerId); } catch { /* a synthetic event */ }
    this._drag = { pointer: e.pointerId, ids: ps.map(p => p.id), start: ps.map(p => s.get(p.id) ?? p.def) };
    for (const p of ps) s.begin(p.id);
    this._at(e);
  }
  private _at(e: PointerEvent) {
    const s = this.source;
    const r = (this._root.querySelector('.pad') as HTMLElement).getBoundingClientRect();
    if (!s || r.width <= 0 || r.height <= 0) return;
    const [x, y] = this._pair();
    if (editable(x)) s.set(x.id, fromNorm(x, (e.clientX - r.left) / r.width, this._scale(x)));
    if (editable(y)) s.set(y.id, fromNorm(y, (r.bottom - e.clientY) / r.height, this._scale(y)));
  }
  private _end(restore: boolean) {
    const d = this._drag, s = this.source;
    if (!d) return;
    this._drag = null;
    d.ids.forEach((id, i) => { if (restore) s?.set(id, d.start[i]!); s?.end(id); });
    try { this.releasePointerCapture(d.pointer); } catch { /* already released */ }
  }
  private _key(e: KeyboardEvent) {
    if (e.key === 'Escape' && this._drag) { e.preventDefault(); this._end(true); return; }
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const [x, y] = this._pair();
    const s = this.source;
    const step = e.shiftKey ? 0.002 : 0.02;
    const move = (p: EstUiParam | undefined, d: number) => {
      if (!editable(p) || !s) return false;
      const v = s.get(p.id) ?? p.def;
      s.set(p.id, p.flags & FLAGS.STEPPED ? v + Math.sign(d) : fromNorm(p, toNorm(p, v, this._scale(p)) + d, this._scale(p)));
      return true;
    };
    const used = e.key === 'ArrowRight' ? move(x, step) : e.key === 'ArrowLeft' ? move(x, -step) : e.key === 'ArrowUp' ? move(y, step) : e.key === 'ArrowDown' ? move(y, -step)
      : e.key === 'Delete' || e.key === 'Backspace' ? [x, y].map(p => { if (editable(p)) this._commit(p.id, p.def); return editable(p); }).some(Boolean) : false;
    if (used) e.preventDefault();
  }
  protected _render() {
    const bound = this._mark(['x', 'y']);
    const [x, y] = this._pair();
    const s = this.source;
    const label = this.getAttribute('label') || [x?.name, y?.name].filter(Boolean).join(' / ') || 'Pad';
    const name = this.getAttribute('name') || label;
    const text = (p: EstUiParam | undefined, unit: string | null) => (p && s ? `${p.name} ${formatValue(p, s.get(p.id) ?? p.def, unit ?? '')}` : '');
    const value = [text(x, this.getAttribute('x-unit')), text(y, this.getAttribute('y-unit'))].filter(Boolean).join(', ');
    this.setAttribute('aria-label', bound ? name : `${name} (not connected)`);
    this.setAttribute('aria-valuemin', String(x?.min ?? 0));
    this.setAttribute('aria-valuemax', String(x?.max ?? 1));
    this.setAttribute('aria-valuenow', String((x && s?.get(x.id)) ?? 0));
    this.setAttribute('aria-valuetext', value || 'not connected');
    if (editable(x) || editable(y)) this.removeAttribute('aria-disabled'); else this.setAttribute('aria-disabled', 'true');
    const set = (sel: string, t: string) => { const el = this._root.querySelector(sel); if (el && el.textContent !== t) el.textContent = t; };
    set('.label', label);
    set('.value', value || (bound ? '–' : '?'));
    const dot = this._root.querySelector('.dot') as HTMLElement;
    const n = (p: EstUiParam | undefined) => (p && s ? toNorm(p, s.get(p.id) ?? p.def, this._scale(p)) : 0.5);
    dot.style.left = `${(n(x) * 100).toFixed(2)}%`;
    dot.style.top = `${((1 - n(y)) * 100).toFixed(2)}%`;
  }
}

// ── est-value ───────────────────────────────────────────────────────────────────────────────────────

/** A parameter's value as text (a readout; also how a read-only parameter is shown). */
export class EstValue extends EstBound {
  static get observedAttributes() { return ['param', 'unit', 'labels']; }
  protected _render() {
    if (this.hasAttribute('data-est-probe')) return;
    const bound = this._mark();
    const p = this.info, v = this.value;
    const t = p && v !== undefined ? formatValue(p, v, this._unit, this._labels) : bound ? '–' : '?';
    if (this.textContent !== t) this.textContent = t;
  }
}

// ── est-meter and est-spectrum ──────────────────────────────────────────────────────────────────────

/** Follows the page's connection without a parameter. */
abstract class EstLive extends Base {
  private _off: (() => void) | null = null;
  private _unwait: (() => void) | null = null;
  connectedCallback() {
    this._setup();
    this._unwait = whenConnected(c => { this._off = this._listen(c); });
    if (!currentConnection()) probeConnect(this.closest('est-window') ?? this);
  }
  disconnectedCallback() {
    this._unwait?.();
    this._off?.();
    this._off = this._unwait = null;
    this._teardown();
  }
  protected abstract _setup(): void;
  protected _teardown(): void {}
  protected abstract _listen(c: Connection): () => void;
}

/** dB (−60…0) as 0…1 along a meter. */
export const meterNorm = (peak: number) => (peak <= 0.001 ? 0 : Math.min(1, Math.max(0, 1 + (20 * Math.log10(peak)) / 60)));

/** The output's level (`in`: the input's), from the host's meters: about 30 a second, never per frame. */
export class EstMeter extends EstLive {
  private _bars: HTMLElement[] = [];
  private _said = 0;
  protected _setup() {
    if (!this.shadowRoot) {
      shadow(this, ':host{flex-direction:column;align-items:stretch;gap:2px;min-width:40px;cursor:default}'
        + '.m{height:4px;border-radius:2px;background:var(--_track);overflow:hidden}.m i{display:block;height:100%;width:0;background:var(--_accent)}'
        + ':host([vertical]){flex-direction:row;align-items:stretch;justify-content:center;gap:3px;min-width:14px;min-height:40px}'
        + ':host([vertical]) .m{height:auto;width:5px;flex:none;display:flex;align-items:flex-end}:host([vertical]) .m i{width:100%;height:0}',
      '<span class="m"><i></i></span><span class="m"><i></i></span>');
    }
    this._bars = Array.from(this.shadowRoot!.querySelectorAll('i'));
    this.setAttribute('role', 'meter');
    if (!this.hasAttribute('aria-label')) this.setAttribute('aria-label', this.hasAttribute('in') ? 'Input level' : 'Output level');
    this.setAttribute('aria-valuemin', '-60');
    this.setAttribute('aria-valuemax', '0');
    this.setAttribute('aria-valuenow', '-60');
  }
  protected _listen(c: Connection) {
    return c.onMeter(m => {
      const pair = this.hasAttribute('in') ? m.in : m.out;
      if (!pair) return;
      const vertical = this.hasAttribute('vertical');
      pair.forEach((peak, i) => {
        const bar = this._bars[i];
        if (!bar) return;
        const pct = `${(meterNorm(peak) * 100).toFixed(1)}%`;
        if (vertical) bar.style.height = pct; else bar.style.width = pct;
      });
      // Announced at most twice a second.
      const now = Date.now();
      if (now - this._said < 500) return;
      this._said = now;
      const peak = Math.max(pair[0], pair[1]);
      this.setAttribute('aria-valuenow', String(peak <= 0.001 ? -60 : Math.max(-60, Math.min(0, Math.round(20 * Math.log10(peak))))));
    });
  }
}

/** A canvas kept at the element's size and the screen's pixel ratio; `draw` gets CSS-pixel units. */
function fitCanvas(canvas: HTMLCanvasElement, redraw: () => void): () => void {
  const size = () => {
    const r = canvas.getBoundingClientRect();
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    const w = Math.max(1, Math.round(r.width * dpr)), h = Math.max(1, Math.round(r.height * dpr));
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    redraw();
  };
  if (typeof ResizeObserver === 'undefined') { size(); return () => {}; }
  const ro = new ResizeObserver(size);
  ro.observe(canvas);
  return () => ro.disconnect();
}

/**
 * The plugin's output as a spectrum, drawn from the host's own analysis (est.json's `ui.audio`; never
 * samples). Where the host offers none, the output level as a moving trace, so the display is never dead.
 */
export class EstSpectrum extends EstLive {
  private _canvas!: HTMLCanvasElement;
  private _unfit: (() => void) | null = null;
  private _bins: number[] | null = null;
  private _trace: number[] = [];
  protected _setup() {
    if (!this.shadowRoot) {
      shadow(this, ':host{align-items:stretch;min-height:48px;cursor:default}canvas{display:block;width:100%;height:100%;flex:1 1 0;min-height:0;border-radius:var(--est-radius,6px);background:var(--est-panel,var(--_bg));border:1px solid var(--_track);box-sizing:border-box}',
        '<canvas></canvas>');
    }
    this._canvas = this.shadowRoot!.querySelector('canvas')!;
    this.setAttribute('role', 'img');
    if (!this.hasAttribute('aria-label')) this.setAttribute('aria-label', 'The sound\'s spectrum');
    this._unfit = fitCanvas(this._canvas, () => this._draw());
  }
  protected _teardown() { this._unfit?.(); this._unfit = null; }
  protected _listen(c: Connection) {
    let stopAudio: (() => void) | null = null;
    const ask = () => {
      if (stopAudio || !c.audioAvailable) return;
      stopAudio = c.audio({ fftSize: 512, rate: reducedMotion() ? 8 : 24 }, s => { this._bins = s.bins; this._draw(); });
    };
    const offInit = c.subscribe(id => { if (id === null) ask(); });
    ask();
    const offMeter = c.onMeter(m => {
      if (this._bins) return;
      this._trace.push(meterNorm(Math.max(m.out[0], m.out[1])));
      if (this._trace.length > 120) this._trace.shift();
      this._draw();
    });
    return () => { offInit(); offMeter(); stopAudio?.(); };
  }
  private _draw() {
    const cv = this._canvas;
    const g = cv.getContext('2d');
    if (!g) return;
    const w = cv.width, h = cv.height;
    const cs = getComputedStyle(this);
    const accent = cs.getPropertyValue('--est-accent').trim() || '#5ad1c3';
    g.clearRect(0, 0, w, h);
    g.beginPath();
    const bins = this._bins;
    if (bins) {
      // A log frequency axis: bin 1 at the left, the last at the right.
      const n = bins.length;
      for (let x = 0; x <= w; x += 2) {
        const i = Math.min(n - 1, Math.max(1, Math.round(Math.pow(n - 1, x / w))));
        const y = h - Math.min(1, Math.max(0, (bins[i]! + 96) / 96)) * (h - 2) - 1;
        if (x === 0) g.moveTo(x, y); else g.lineTo(x, y);
      }
    } else {
      // The newest level at the right edge, older ones to its left.
      const t = this._trace;
      g.moveTo(0, h - 1);
      g.lineTo(Math.max(0, ((120 - t.length) / 119) * w), h - 1);
      t.forEach((v, i) => g.lineTo(((120 - t.length + i) / 119) * w, h - v * (h - 2) - 1));
      if (!t.length) g.lineTo(w, h - 1);
    }
    g.strokeStyle = accent;
    g.lineWidth = Math.max(1, (window.devicePixelRatio || 1) * 1.5);
    g.lineJoin = 'round';
    g.stroke();
    g.lineTo(w, h); g.lineTo(0, h); g.closePath();
    g.globalAlpha = 0.18;
    g.fillStyle = accent;
    g.fill();
    g.globalAlpha = 1;
  }
}

// ── est-all ─────────────────────────────────────────────────────────────────────────────────────────

const BOUND_SELECTOR = 'est-knob,est-slider,est-switch,est-select,est-value:not([data-est-probe])';

/** The ids the page's other kit elements already show. */
function shownIds(root: ParentNode, params: readonly EstUiParam[], skip: Element): Set<number> {
  const ids = new Set<number>();
  const add = (el: Element, attr: string) => {
    if (skip.contains(el)) return;
    const hit = resolveParam(el.getAttribute(attr), params);
    if (hit) ids.add(hit.id);
  };
  root.querySelectorAll(BOUND_SELECTOR).forEach(el => add(el, 'param'));
  root.querySelectorAll('est-xy').forEach(el => { add(el, 'x'); add(el, 'y'); });
  return ids;
}

/**
 * A control for every parameter the page shows nowhere else (a knob, or a switch or buttons for a
 * stepped one), so a window is never missing one. `params="3,4"`: only those ids.
 */
export class EstAll extends EstBound {
  static get observedAttributes() { return ['params']; }
  private _made = '';
  protected _concerns() { return false; }
  protected _render() {
    const s = this.source;
    if (!s) return;
    const all = shownParams(s.params());
    if (!all.length) return;
    const only = this.getAttribute('params');
    let want: EstUiParam[];
    if (only !== null) {
      const ids = only.split(',').map(x => Number(x.trim())).filter(x => Number.isInteger(x));
      want = all.filter(p => ids.includes(p.id));
    } else {
      const have = shownIds(this.getRootNode() as ParentNode, all, this);
      want = all.filter(p => !have.has(p.id));
    }
    const key = want.map(p => `${p.id}:${controlFor(p)}`).join(',');
    if (key === this._made) return;
    this._made = key;
    this.textContent = '';
    for (const p of want) {
      const el = document.createElement(controlFor(p));
      el.setAttribute('param', String(p.id));
      if (s !== currentConnection()) (el as unknown as { source: ParamSource | null }).source = s;
      this.append(el);
    }
  }
}

// ── display() ───────────────────────────────────────────────────────────────────────────────────────

export interface DisplayOptions {
  /** Redraw every animation frame (a moving display). Under reduced motion it still redraws only on a change. */
  animate?: boolean;
}

/**
 * A canvas of the page's own: sized to its box at the screen's pixel ratio, and `draw(g, w, h, t)`
 * called (in CSS pixels; `t` in seconds) after every parameter change, whoever made it, and on every
 * resize. With `animate`, every frame too. Returns the stop.
 */
export function display(target: HTMLCanvasElement | string, draw: (g: CanvasRenderingContext2D, w: number, h: number, t: number) => void, opts: DisplayOptions = {}): () => void {
  const canvas = typeof target === 'string' ? document.querySelector(target) : target;
  if (!canvas || canvas.tagName !== 'CANVAS') { console.error('[est-ui] display(): no such canvas', target); return () => {}; }
  const cv = canvas as HTMLCanvasElement;
  if (!cv.hasAttribute('role')) { cv.setAttribute('role', 'img'); if (!cv.hasAttribute('aria-label')) cv.setAttribute('aria-label', 'Display'); }
  let queued = 0, stopped = false;
  const paint = () => {
    queued = 0;
    if (stopped) return;
    const g = cv.getContext('2d');
    if (!g) return;
    const dpr = cv.width / Math.max(1, cv.getBoundingClientRect().width) || 1;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, cv.width / dpr, cv.height / dpr);
    try { draw(g, cv.width / dpr, cv.height / dpr, performance.now() / 1000); } catch (err) { console.error('[est-ui] a display threw', err); }
    if (opts.animate && !reducedMotion()) later();
  };
  function later() { if (!queued && !stopped) queued = requestAnimationFrame(paint); }
  const unfit = fitCanvas(cv, later);
  let off: (() => void) | null = null;
  const unwait = whenConnected(c => { off = c.subscribe(later); });
  later();
  return () => { stopped = true; if (queued) cancelAnimationFrame(queued); unfit(); unwait(); off?.(); };
}

/** Register the kit's elements (idempotent; done when the library loads). */
export function defineElements(registry: CustomElementRegistry | undefined = typeof customElements === 'undefined' ? undefined : customElements) {
  if (!registry) return;
  const all: Record<string, CustomElementConstructor> = {
    'est-knob': EstKnob, 'est-slider': EstSlider, 'est-switch': EstSwitch, 'est-select': EstSelect, 'est-xy': EstXY, 'est-value': EstValue,
    'est-meter': EstMeter, 'est-spectrum': EstSpectrum, 'est-all': EstAll, 'est-row': EstRow, 'est-panel': EstPanel, 'est-window': EstWindow,
  };
  for (const [name, ctor] of Object.entries(all)) if (!registry.get(name)) registry.define(name, ctor);
}

/** The kit's element names. */
export const KIT_ELEMENTS = ['est-window', 'est-row', 'est-panel', 'est-knob', 'est-slider', 'est-switch', 'est-select', 'est-xy', 'est-value', 'est-meter', 'est-spectrum', 'est-all'] as const;

declare global {
  interface HTMLElementTagNameMap {
    'est-switch': EstSwitch;
    'est-select': EstSelect;
    'est-xy': EstXY;
    'est-value': EstValue;
    'est-meter': EstMeter;
    'est-spectrum': EstSpectrum;
    'est-all': EstAll;
    'est-window': EstWindow;
    'est-panel': EstPanel;
    'est-row': EstRow;
  }
}
