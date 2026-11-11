/**
 * `bind(el, paramId)`: one element follows one parameter and writes it.
 *
 * - `<est-knob>`, `<est-slider>`: its `param` and `source` are set.
 * - `<input type="range">` and `<input type="number">`: min, max and step from the parameter;
 *   a pointer drag on it is a gesture (`est:gesture` begin and end). A range over a parameter
 *   est.json marks `"scale": "log"` runs 0…1 and moves geometrically (`toNorm`, `fromNorm`).
 * - `<input type="checkbox">`: checked is the top of the range, unchecked the bottom.
 * - `<select>`: each option's value is a parameter value.
 * - anything else: its text shows the value (`format`, else the plain number).
 *
 * Returns the unbind.
 */
import { currentConnection, type ParamSource } from './connect';
import { EstKnob, EstSlider } from './controls';
import { formatNumber, fromNorm, toNorm } from './format';
import { FLAGS, type EstUiParam } from './protocol';

export interface BindOptions {
  source?: ParamSource;
  /** The text of a display element (`bind` on a span or an `<output>`). */
  format?: (value: number, param: EstUiParam) => string;
}

export function bind(el: Element, paramId: number, opts: BindOptions = {}): () => void {
  const source = opts.source ?? currentConnection();
  if (!source) throw new Error('@est/ui: bind() needs a source; call connect() first');
  if (el instanceof EstKnob || el instanceof EstSlider) {
    const c = el as EstKnob | EstSlider;
    c.paramId = paramId;
    c.source = source;
    return () => { c.source = null; };
  }
  const tag = el.tagName.toLowerCase();
  const input = tag === 'input' ? (el as HTMLInputElement) : null;
  const select = tag === 'select' ? (el as HTMLSelectElement) : null;
  const kind = input ? (input.type === 'checkbox' ? 'check' : 'input') : select ? 'select' : 'text';

  /** A range input over a log parameter moves along 0…1, geometrically (D-44). */
  const logRange = (p: EstUiParam) => !!input && input.type === 'range' && p.scale === 'log' && p.min > 0 && p.max > p.min;
  const show = () => {
    const p = source.param(paramId);
    const v = source.get(paramId);
    if (!p || v === undefined) return;
    if (kind === 'input' && input && logRange(p)) {
      input.min = '0';
      input.max = '1';
      input.step = 'any';
      input.value = String(toNorm(p, v, 'log'));
      input.disabled = (p.flags & FLAGS.READONLY) !== 0;
    } else if (kind === 'input' && input) {
      input.min = String(p.min);
      input.max = String(p.max);
      input.step = p.flags & FLAGS.STEPPED ? '1' : 'any';
      if (document.activeElement !== input || input.type === 'range') input.value = String(v);
      input.disabled = (p.flags & FLAGS.READONLY) !== 0;
    } else if (kind === 'check' && input) {
      input.checked = v > (p.min + p.max) / 2;
    } else if (kind === 'select' && select) {
      select.value = String(Math.round(v));
    } else {
      el.textContent = opts.format ? opts.format(v, p) : formatNumber(v);
    }
  };

  const read = (): number | null => {
    const p = source.param(paramId);
    if (!p) return null;
    if (kind === 'check' && input) return input.checked ? p.max : p.min;
    const raw = Number((input ?? select)?.value);
    if (!Number.isFinite(raw)) return null;
    return logRange(p) ? fromNorm(p, raw, 'log') : raw;
  };
  const write = () => {
    const v = read();
    if (v !== null) source.set(paramId, v);
  };

  let dragging = false;
  const down = (e: Event) => {
    if ((e as PointerEvent).button !== 0 || dragging) return;
    dragging = true;
    source.begin(paramId);
    window.addEventListener('pointerup', up, true);
    window.addEventListener('pointercancel', up, true);
  };
  const up = () => {
    if (!dragging) return;
    dragging = false;
    window.removeEventListener('pointerup', up, true);
    window.removeEventListener('pointercancel', up, true);
    write();
    source.end(paramId);
  };

  const offs: (() => void)[] = [source.subscribe(id => { if (id === null || id === paramId) show(); })];
  if (kind !== 'text') {
    const ev = kind === 'input' ? 'input' : 'change';
    el.addEventListener(ev, write);
    offs.push(() => el.removeEventListener(ev, write));
    if (kind === 'input') {
      el.addEventListener('change', write);
      el.addEventListener('pointerdown', down);
      offs.push(() => { el.removeEventListener('change', write); el.removeEventListener('pointerdown', down); up(); });
    }
  }
  show();
  return () => { for (const off of offs) off(); };
}
