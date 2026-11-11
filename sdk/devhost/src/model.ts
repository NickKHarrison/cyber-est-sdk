/**
 * The dev host's parameter values, one place for the parameter list, the generated UI (`@cyber-est/ui`'s
 * knobs, through this as their `ParamSource`) and the custom UI's frame (Cyber's `EstPluginFrame`,
 * through `frameEdit`). A change from any of them reaches the instance and the others.
 */
import type { EstParam } from '@/audio/est/EstNode';
import type { EstEdit } from '@/components/est/estHooks';
import type { ParamListener, ParamSource } from '../../packages/ui/src/connect';
import { clampValue, type EstUiParam } from '../../packages/ui/src/protocol';

export type Origin = 'generated' | 'list' | 'frame' | 'plugin' | 'preset' | 'state' | 'command';

export class ParamModel implements ParamSource {
  private map = new Map<number, EstUiParam>();
  private listeners = new Set<ParamListener>();
  private changeListeners = new Set<() => void>();
  private snapshot: Readonly<Record<string, number>> = {};
  /** The instance's side: a write goes here (null in a UI preview). */
  sink: ((id: number, value: number) => void) | null = null;
  /** Every accepted change, with where it came from (the event log). */
  onChange: ((id: number, value: number, origin: Origin) => void) | null = null;
  private gestures = new Set<number>();

  /** Replace the list (a new instance, a UI preview). */
  reset(params: readonly EstParam[]) {
    this.map = new Map(params.map(p => [p.id, { id: p.id, name: p.name, module: p.module, min: p.min, max: p.max, def: p.def, flags: p.flags, value: p.value }]));
    this.refresh();
    for (const fn of [...this.listeners]) fn(null, 'host');
  }

  private refresh() {
    this.snapshot = Object.fromEntries([...this.map.values()].map(p => [String(p.id), p.value]));
    for (const fn of [...this.changeListeners]) fn();
  }

  list(): EstParam[] { return [...this.map.values()].map(p => ({ ...p })); }
  values(): Readonly<Record<string, number>> { return this.snapshot; }

  /** One value from `origin`; `toInstance: false` when the instance itself reported it. */
  apply(id: number, value: number, origin: Origin, toInstance = true) {
    const p = this.map.get(id);
    if (!p) return;
    const v = clampValue(p, value);
    if (v === p.value) return;
    p.value = v;
    if (toInstance) this.sink?.(id, v);
    this.refresh();
    for (const fn of [...this.listeners]) fn(id, origin === 'generated' ? 'ui' : 'host');
    this.onChange?.(id, v, origin);
  }

  /** Follow every change (React's `useSyncExternalStore`). */
  watch(fn: () => void) {
    this.changeListeners.add(fn);
    return () => { this.changeListeners.delete(fn); };
  }

  // ParamSource (the generated UI's knobs)
  param(id: number) { return this.map.get(id); }
  params() { return [...this.map.values()]; }
  get(id: number) { return this.map.get(id)?.value; }
  set(id: number, value: number) { this.apply(id, value, 'generated'); }
  begin(id: number) { this.gestures.add(id); }
  end(id: number) { this.gestures.delete(id); }
  subscribe(fn: ParamListener) {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  }

  /** What Cyber's `EstPluginFrame` edits: heard at once, and written (logged) when the gesture ends. */
  frameEdit(onWrite: (patch: Record<string, number>) => void): EstEdit {
    const apply = (patch: Record<string, number>) => { for (const [k, v] of Object.entries(patch)) this.apply(Number(k), v, 'frame'); };
    return {
      values: this.snapshot,
      change: apply,
      preview: apply,
      write: patch => { apply(patch); onWrite(patch); },
      bind: { onPointerDownCapture: () => {} },
    };
  }
}
