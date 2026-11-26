/**
 * What every element of the window kit shares: finding the page's connection by itself, resolving a
 * `param` attribute to a parameter, and redrawing on every change, whoever made it.
 *
 * A `param` attribute is the parameter's id (`param="1"`) or its name (`param="Cutoff"`; letters and
 * digits compared, case ignored), so a window written by hand or by an assistant binds either way. An
 * attribute that names nothing the plugin has leaves the element marked `data-est-unbound` and drawn
 * disabled with "?": never a control that looks alive and does nothing.
 *
 * Hints the page may carry (`<meta name="est-params" content='[{"id":1,"unit":"Hz","labels":[…]}]'>`,
 * written by Cyber's builder from the sound code): a parameter's unit and a stepped one's labels, used
 * when the element gives none of its own. Pure parts first; the DOM class after.
 */
import { connect, currentConnection, whenConnected, type ParamSource } from './connect';
import { FLAGS, type EstUiParam } from './protocol';

/** A name as compared: lower-case letters and digits only. */
export const foldName = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '');

/**
 * The parameter a `param` attribute names: an id (whole number) first, else a name. Undefined when
 * the attribute is empty or names nothing (or more than one parameter by name).
 */
export function resolveParam(ref: string | null | undefined, params: readonly EstUiParam[]): EstUiParam | undefined {
  if (ref === null || ref === undefined) return undefined;
  const t = ref.trim();
  if (!t) return undefined;
  if (/^\d+$/.test(t)) return params.find(p => p.id === Number(t));
  const want = foldName(t);
  if (!want) return undefined;
  const hits = params.filter(p => foldName(p.name) === want);
  return hits.length === 1 ? hits[0] : undefined;
}

/** A hint about one parameter, from the page's `est-params` meta. */
export interface ParamHint { id: number; unit?: string; labels?: string[] }

/** The `est-params` meta's content as hints (anything malformed is left out). */
export function readHints(json: string | null | undefined): Map<number, ParamHint> {
  const out = new Map<number, ParamHint>();
  if (!json) return out;
  let raw: unknown;
  try { raw = JSON.parse(json); } catch { return out; }
  if (!Array.isArray(raw)) return out;
  for (const r of raw.slice(0, 512)) {
    if (!r || typeof r !== 'object') continue;
    const { id, unit, labels } = r as Record<string, unknown>;
    if (typeof id !== 'number' || !Number.isInteger(id) || id < 0) continue;
    const h: ParamHint = { id };
    if (typeof unit === 'string' && unit.length <= 16) h.unit = unit;
    if (Array.isArray(labels) && labels.length <= 128 && labels.every(l => typeof l === 'string')) h.labels = (labels as string[]).map(l => l.slice(0, 64));
    out.set(id, h);
  }
  return out;
}

/** Whether a person may change the parameter from the window. */
export const editable = (p: EstUiParam | undefined): p is EstUiParam => !!p && !(p.flags & FLAGS.READONLY) && p.max > p.min;

/** What kind of control suits a parameter (used by `<est-all>`). */
export function controlFor(p: EstUiParam): 'est-switch' | 'est-select' | 'est-knob' {
  if (p.flags & FLAGS.STEPPED) {
    const n = Math.round(p.max - p.min) + 1;
    if (n === 2) return 'est-switch';
    if (n <= 8) return 'est-select';
  }
  return 'est-knob';
}

/** The parameters a window shows: not hidden, not the host's bypass. */
export const shownParams = (params: readonly EstUiParam[]) => params.filter(p => !(p.flags & (FLAGS.HIDDEN | FLAGS.BYPASS)));

const Base: typeof HTMLElement = typeof HTMLElement === 'undefined' ? (class {} as unknown as typeof HTMLElement) : HTMLElement;

let hints: Map<number, ParamHint> | null = null;
/** The page's hints (read once). */
export function pageHints(): Map<number, ParamHint> {
  if (hints) return hints;
  const el = typeof document === 'undefined' ? null : document.querySelector('meta[name="est-params"]');
  hints = readHints(el?.getAttribute('content'));
  return hints;
}
/** Tests: forget the page's hints. */
export const forgetHints = () => { hints = null; };

let autoQueued = false;
/**
 * A kit element is on the page and nothing has connected: connect once the page's own scripts have
 * had their turn (so a page with no script of its own still works).
 */
function autoConnect() {
  if (autoQueued || currentConnection() || typeof location === 'undefined') return;
  autoQueued = true;
  const go = () => { autoQueued = false; if (!currentConnection() && /[#&]n=/.test(location.hash)) connect(); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', go, { once: true });
  else setTimeout(go, 0);
}

/** An element that follows the page's connection (or a `source` given to it). */
export abstract class EstBound extends Base {
  private _src: ParamSource | null = null;
  private _explicitSource = false;
  private _unsubscribe: (() => void) | null = null;
  private _unwait: (() => void) | null = null;

  connectedCallback() {
    if (!this._explicitSource && !this._src) {
      const c = currentConnection();
      if (c) this._attach(c);
      else {
        this._unwait = whenConnected(conn => { if (!this._explicitSource) this._attach(conn); });
        autoConnect();
      }
    }
    this._connected();
    this._render();
  }

  disconnectedCallback() {
    this._unwait?.();
    this._unwait = null;
    this._disconnected();
  }

  attributeChangedCallback(_name?: string, _old?: string | null, _next?: string | null) { if (this.isConnected) this._render(); }

  protected _connected(): void {}
  protected _disconnected(): void {}
  /** Draw from the current values. */
  protected abstract _render(): void;
  /** Whether a change of parameter `id` concerns this element. */
  protected _concerns(id: number): boolean { return id === this.paramId; }

  /** The values this element reads and writes (the page's connection unless set). */
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
    if (s) this._unsubscribe = s.subscribe(id => { if (id === null || this._concerns(id)) this._render(); });
    if (this.isConnected) this._render();
  }

  /** The parameter an attribute names (by id or name). */
  protected _lookup(attr: string): EstUiParam | undefined {
    const s = this._src;
    return s ? resolveParam(this.getAttribute(attr), s.params()) : undefined;
  }

  /** The CLAP id the `param` attribute resolves to (null without one, or before the host's values). */
  get paramId(): number | null {
    const a = this.getAttribute('param');
    if (a === null || a.trim() === '') return null;
    if (/^\s*\d+\s*$/.test(a)) return Number(a);
    return this._lookup('param')?.id ?? null;
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

  /** The `unit` attribute, else the page's hint for the parameter. */
  protected get _unit(): string {
    const a = this.getAttribute('unit');
    if (a !== null) return a;
    const p = this.info;
    return (p && pageHints().get(p.id)?.unit) || '';
  }
  /** The `labels` attribute ("A, B, C"), else the page's hint. */
  protected get _labels(): string[] | undefined {
    const l = this.getAttribute('labels');
    if (l) return l.split(',').map(s => s.trim());
    const p = this.info;
    return p ? pageHints().get(p.id)?.labels : undefined;
  }

  /**
   * Mark the element as bound or not: `data-est-unbound` while its attribute names nothing the plugin
   * has (once the host's values are in), so the page, a test and a person can all see it.
   */
  protected _mark(attrs: string[] = ['param']): boolean {
    const s = this._src;
    const known = !!s && s.params().length > 0;
    const missing = known && attrs.some(a => this.hasAttribute(a) && !this._lookup(a));
    const none = known && !attrs.some(a => this.hasAttribute(a));
    if (missing || none) this.setAttribute('data-est-unbound', '');
    else this.removeAttribute('data-est-unbound');
    return !(missing || none);
  }

  /** One whole change as its own gesture (a click, a key, a typed value): one undo step in the host. */
  protected _commit(id: number, value: number) {
    const s = this._src;
    if (!s) return;
    s.begin(id);
    s.set(id, value);
    s.end(id);
  }
}
