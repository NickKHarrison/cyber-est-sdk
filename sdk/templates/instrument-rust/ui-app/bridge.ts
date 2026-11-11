// The engine in the built window: the app's store kept in step with the host through
// `EstUI.connect()` (est-ui.js, a classic script the page loads first; `est pack` copies it into
// the bundle). vite.config.ts swaps this in for `./engine` at build time: same `start`, no sound
// of its own (sdk/docs/ui.md, "The engine becomes the link"). The host plays the plugin and owns
// the transport, the keys, MIDI, tempo and files.
//
// Four parts:
// - connect: the page's one connection to the host;
// - applyHost: what the host sends (its `est:init`, then each change from automation, a preset,
//   Cyber's own knob, a collaborator) written into the store;
// - pushStore: the app's own changes written to the host, a drag as one gesture (one undo step);
// - decodeReadout: the plugin's read-only parameters (what it is playing, set by the DSP about 30
//   times a second) turned into the numbers the app draws.
import type { EstConnection, EstUiParam } from '../est-ui';
import { FLAGS, type Param, type Store } from './store';

const toParam = (p: EstUiParam): Param => ({ id: p.id, name: p.name, module: p.module, min: p.min, max: p.max, def: p.def, flags: p.flags });

/**
 * The readout from the read-only parameters. Each is shown under its own name; change this to
 * decode your plugin's: for example a hidden read-only parameter holding the playing step and an
 * envelope level in two 10-bit fields is `const [step, level] = unpackFields(v, 10, 2)` (bits.ts,
 * which also packs the app's own data into hidden parameters with `packFields`).
 */
export function decodeReadout(params: readonly Param[], get: (id: number) => number): Record<string, number> {
  const out: Record<string, number> = {};
  for (const p of params) {
    if (!(p.flags & FLAGS.READONLY)) continue;
    out[p.name] = get(p.id);
  }
  return out;
}

/** Whether a parameter is part of the readout. */
const isReadout = (p: Param | undefined) => !!p && (p.flags & FLAGS.READONLY) !== 0;

export function start(store: Store): void {
  // connect
  const est: EstConnection = EstUI.connect();

  // applyHost
  const applyHost = (id: number | null) => {
    if (id === null) {
      const params = est.params();
      store.load(params.map(toParam), new Map(params.map(p => [p.id, p.value])));
    } else {
      const v = est.get(id);
      if (v !== undefined) store.fromHost(id, v);
      if (!isReadout(store.param(id))) return;
    }
    store.setReadout(decodeReadout(store.params(), i => store.get(i)));
  };
  est.subscribe((id, source) => { if (source === 'host') applyHost(id); });

  // pushStore
  store.attach({
    set: (id, value) => est.set(id, value),
    begin: id => est.begin(id),
    end: id => est.end(id),
  });

  void est.ready.then(() => {
    applyHost(null);
    document.documentElement.dataset.host = 'connected';
  });
}
