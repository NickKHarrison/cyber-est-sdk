// The stand-in engine, for working on the app in a plain browser (`npm run dev:ui`): no host, no
// sound, the parameters from est.json with a 0 to 1 range. The build never ships it: vite.config.ts
// resolves `./engine` to `./bridge.ts`, which has the same `start`. Keep the two in step.
import manifest from '../est.json';
import type { Param, Store } from './store';

interface ManifestParam { id: number; name: string; module?: string }

export function start(store: Store): void {
  const params: Param[] = ((manifest as { parameters?: ManifestParam[] }).parameters ?? [])
    .map(p => ({ id: p.id, name: p.name, module: p.module ?? '', min: 0, max: 1, def: 0.5, flags: 32 }));
  store.load(params, new Map());
  store.attach({ set() {}, begin() {}, end() {} });
  document.documentElement.dataset.host = 'none';
}
