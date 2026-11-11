/**
 * EST Phase 2 (2-D, D-30): the names the meter (`estMeter.ts`) adds to a module, and the check that a
 * compiled module carries them. Light (no Binaryen), so the compiling Worker's compile path and
 * the tests can use it without loading the meter.
 */
export const FUEL_GLOBAL = 'est_fuel';
export const REFUEL_EXPORT = 'refuel';
export const FUEL_LEFT_EXPORT = 'fuel_left';

/** Whether a module carries the fuel exports (a metered build). */
export function isMetered(module: WebAssembly.Module): boolean {
  const ex = WebAssembly.Module.exports(module);
  return ex.some(e => e.name === REFUEL_EXPORT && e.kind === 'function') && ex.some(e => e.name === FUEL_LEFT_EXPORT && e.kind === 'function');
}
