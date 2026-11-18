/**
 * 1.789 (order V, V5): `est quality` on a plugin with no presets printed an empty table and said nothing;
 * it now names why and the next step.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, expect, it } from 'vitest';

const BIN = fileURLToPath(new URL('../bin/est.mjs', import.meta.url));
const REPO = resolve(fileURLToPath(new URL('../../../../', import.meta.url)));
const tmp = mkdtempSync(join(tmpdir(), 'est-quality-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

it('no folder named: this one (1.789); no presets: says so and names the prompt that adds them', () => {
  const dir = join(tmp, 'synth');
  expect(spawnSync(process.execPath, [BIN, 'new', 'instrument-as', dir, '--no-install'], { encoding: 'utf8' }).status).toBe(0);
  symlinkSync(join(REPO, 'node_modules'), join(dir, 'node_modules'));
  const r = spawnSync(process.execPath, [BIN, 'quality'], { cwd: dir, encoding: 'utf8', timeout: 240_000 });
  expect(r.stderr).toMatch(/has no presets to measure/);
  expect(r.stderr).toMatch(/Add 8 presets/);
}, 240_000);
