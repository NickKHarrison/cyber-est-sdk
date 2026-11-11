#!/usr/bin/env node
/**
 * EST Phase 4 (4-A): the broken fixture `start.wasm`, Phase 1's EST Gain
 * (src/audio/est/fixtures/gain.wasm, reused as built) with a start function added by Binaryen:
 * a start function runs at instantiation, before the host can give the metered module fuel, so it
 * traps and the plugin never boots (EST-W015). Run by build.sh; reproducible (Binaryen's output
 * depends only on its input and its version, the `binaryen` dev dependency).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import binaryen from 'binaryen';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..', '..', '..');
const mod = binaryen.readBinary(new Uint8Array(readFileSync(join(root, 'src', 'audio', 'est', 'fixtures', 'gain.wasm'))));
mod.addFunction('est_broken_start', binaryen.none, binaryen.none, [], mod.nop());
mod.setStart(mod.getFunction('est_broken_start'));
if (!mod.validate()) throw new Error('start.wasm does not validate');
const out = mod.emitBinary();
mod.dispose();
writeFileSync(join(here, 'wasm', 'start.wasm'), out);
console.log(`built start.wasm (${out.length} bytes)`);
