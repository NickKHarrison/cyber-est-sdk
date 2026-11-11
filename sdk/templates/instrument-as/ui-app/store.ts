// The app's state: every parameter's value, and what the plugin reports it is playing (the
// readout). The app reads and writes only this; the engine module (engine.ts in a plain browser,
// bridge.ts in the built window) keeps it in step with the host.

/** A parameter as the app knows it (the host's `est:init` gives these; the stand-in makes them up). */
export interface Param {
  id: number;
  name: string;
  module: string;
  min: number;
  max: number;
  def: number;
  flags: number;
}

/** CLAP's parameter flags (the same numbers as `EstUI.FLAGS`). */
export const FLAGS = { STEPPED: 1, PERIODIC: 2, HIDDEN: 4, READONLY: 8, BYPASS: 16, AUTOMATABLE: 32 } as const;

/** Who changed a value: the host (an `est:init`, automation, a preset, Cyber's own knob) or this app. */
export type Source = 'host' | 'app';
type Listener = (id: number | null, source: Source) => void;
type Writer = { set(id: number, value: number): void; begin(id: number): void; end(id: number): void };

export interface Store {
  params(): Param[];
  param(id: number): Param | undefined;
  get(id: number): number;
  /** The decoded readout (bridge.ts's `decodeReadout`): names to numbers, for meters and step lights. */
  readout(): Readonly<Record<string, number>>;
  /** The app's own change: kept here, then written to the host. */
  set(id: number, value: number): void;
  /** A drag: the host keeps the changes between `begin` and `end` as one undo step. */
  begin(id: number): void;
  end(id: number): void;
  /** `id` null after the whole list changed. Returns the unsubscribe. */
  subscribe(fn: Listener): () => void;
  // For the engine module only:
  /** Every parameter and value at once (an `est:init`). */
  load(params: Param[], values: Map<number, number>): void;
  /** One value from the host. */
  fromHost(id: number, value: number): void;
  setReadout(r: Record<string, number>): void;
  /** Where the app's own changes go (the host, or nowhere in the stand-in). */
  attach(w: Writer): void;
}

export function createStore(): Store {
  let list: Param[] = [];
  const byId = new Map<number, Param>();
  const values = new Map<number, number>();
  let readout: Record<string, number> = {};
  const listeners = new Set<Listener>();
  let writer: Writer | null = null;
  const emit = (id: number | null, source: Source) => { for (const fn of listeners) fn(id, source); };
  const clamp = (p: Param, v: number) => {
    const c = Math.min(p.max, Math.max(p.min, v));
    return p.flags & FLAGS.STEPPED ? Math.round(c) : c;
  };
  return {
    params: () => list,
    param: id => byId.get(id),
    get: id => values.get(id) ?? byId.get(id)?.def ?? 0,
    readout: () => readout,
    set(id, value) {
      const p = byId.get(id);
      if (!p || p.flags & FLAGS.READONLY) return; // a read-only parameter is the plugin's to set
      const v = clamp(p, value);
      if (values.get(id) === v) return;
      values.set(id, v);
      writer?.set(id, v);
      emit(id, 'app');
    },
    begin: id => writer?.begin(id),
    end: id => writer?.end(id),
    subscribe(fn) { listeners.add(fn); return () => { listeners.delete(fn); }; },
    load(params, vals) {
      list = params;
      byId.clear();
      values.clear();
      for (const p of params) { byId.set(p.id, p); values.set(p.id, vals.get(p.id) ?? p.def); }
      emit(null, 'host');
    },
    fromHost(id, value) {
      if (!byId.has(id) || values.get(id) === value) return;
      values.set(id, value);
      emit(id, 'host');
    },
    setReadout(r) { readout = r; emit(null, 'host'); },
    attach(w) { writer = w; },
  };
}
