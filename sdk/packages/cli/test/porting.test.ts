/**
 * EST-DEV-3, DEV-G (1.326): the porting kits end to end, as a developer runs them
 * (`node sdk/packages/cli/bin/est.mjs`), in a temporary folder outside the repository:
 * - `est compare` on two bundles: the same bundle twice is identical (exit 0, no difference), and
 *   -6 dB on one side reads -6 dB in every band (exit 1); the HTML report and `--json` are written;
 *   `--write-input` writes the input; a usage error exits 2;
 * - where a clang for wasm32 is found (skipped with the reason otherwise, never failed):
 *   `est new cpp-clap` makes a folder that builds, validates and passes `est test` outside the
 *   repository, and the JUCE kit's EST half validates;
 * - where a native C++ compiler is found as well: the kit's reference renderer (the shared DSP built
 *   natively, the desktop build's stand-in) renders `--write-input`'s WAV, and `est compare` holds
 *   the EST module against it within -120 dBFS (the porting loop of porting-juce.md);
 * - `est doctor --json` reports the C++ toolchain.
 * The JUCE desktop plugin itself is never built here: it needs the developer's own JUCE checkout
 * (no JUCE source is in the repository), so the suite and CI leave it out.
 */
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { findWasmClang } from '../../../cpp/toolchain.mjs';

const BIN = fileURLToPath(new URL('../bin/est.mjs', import.meta.url));
const REPO = resolve(fileURLToPath(new URL('../../../../', import.meta.url)));
const GAIN = join(REPO, 'src/audio/est/fixtures/est-gain-1.0.1.est');
const tmp = mkdtempSync(join(tmpdir(), 'est-port-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

function est(args: string[], cwd = tmp) {
  const r = spawnSync(process.execPath, [BIN, ...args], { cwd, encoding: 'utf8', timeout: 240_000 });
  return { code: r.status, out: r.stdout, err: r.stderr };
}
const clang = findWasmClang();
const noClang = !clang.clang;
const cxx = ['c++', 'g++', 'clang++'].find(c => { const r = spawnSync(c, ['--version'], { encoding: 'utf8' }); return !r.error && r.status === 0; });
if (noClang) console.log(`EST-DEVG-SKIP no clang for wasm32: the cpp-clap and JUCE kit builds are skipped (${clang.tried.join('; ') || 'none found'})`);
if (!cxx) console.log('EST-DEVG-SKIP no native C++ compiler: the reference-renderer round trip is skipped');

describe('est compare', () => {
  it('the same bundle twice: identical, exit 0, the report written', () => {
    const r = est(['compare', GAIN, GAIN, '--seconds', '0.5', '--report', 'same.html', '--json']);
    expect(r.code, r.err).toBe(0);
    const j = JSON.parse(r.out) as { ok: boolean; worstDiffDb: number | null; channels: { diffPeakDb: number | null }[]; report: string };
    expect(j).toMatchObject({ ok: true, worstDiffDb: null });
    expect(j.channels.every(c => c.diffPeakDb === null)).toBe(true);
    expect(readFileSync(join(tmp, 'same.html'), 'utf8')).toContain('the same, within the tolerance');
  }, 120_000);

  it('-6 dB on one side: -6 dB in every band and in level, the first divergence at the event, exit 1', () => {
    const r = est(['compare', GAIN, GAIN, '--seconds', '1', '--events-b', '[{"type":"param","time":0.25,"id":0,"value":-6}]', '--report', 'six.html', '--json']);
    expect(r.code, r.err).toBe(1);
    const j = JSON.parse(r.out) as { ok: boolean; channels: { levelDiffDb: number; bands: { hz: number; diffDb: number }[]; firstDivergence: { frame: number } }[] };
    expect(j.ok).toBe(false);
    for (const c of j.channels) {
      // Three quarters of the second at -6 dB: 10·log10(0.25 + 0.75·10^(-0.6)) ≈ -4.06 dB in level.
      expect(c.levelDiffDb).toBeCloseTo(10 * Math.log10(0.25 + 0.75 * 10 ** -0.6), 1);
      expect(c.firstDivergence.frame).toBeGreaterThanOrEqual(12000);
      expect(c.firstDivergence.frame).toBeLessThan(12010);
    }
    const full = est(['compare', GAIN, GAIN, '--seconds', '1', '--events-b', '[{"type":"param","time":0,"id":0,"value":-6}]', '--json', '--report', 'six0.html']);
    for (const c of (JSON.parse(full.out) as { channels: { bands: { hz: number; diffDb: number }[] }[] }).channels) {
      for (const b of c.bands) expect(b.diffDb, `${b.hz} Hz`).toBeCloseTo(-6, 1);
    }
    expect(existsSync(join(tmp, 'six.html'))).toBe(true);
  }, 120_000);

  it('writes the input as a WAV, and refuses what it cannot compare (exit 2)', () => {
    const r = est(['compare', GAIN, GAIN, '--seconds', '0.25', '--input', 'sine', '--write-input', 'in/sine.wav', '--report', 'x.html']);
    expect(r.code, r.err).toBe(0);
    const wav = readFileSync(join(tmp, 'in', 'sine.wav'));
    expect(wav.subarray(0, 4).toString()).toBe('RIFF');
    expect(wav.length).toBe(44 + 12000 * 8);
    expect(est(['compare', GAIN]).code).toBe(2);
    expect(est(['compare', GAIN, join(tmp, 'x.html')]).code).toBe(2);
    expect(est(['compare', GAIN, GAIN, '--input', 'pink']).code).toBe(2);
  }, 120_000);
});

describe('the C++ kits', () => {
  it.skipIf(noClang)('est new cpp-clap: a folder outside the repository that builds, validates and passes est test (skipped without a clang for wasm32)', () => {
    const dir = join(tmp, 'my-port');
    const made = est(['new', 'cpp-clap', dir, '--id', 'com.example.my-port', '--name', 'My Port']);
    expect(made.code, made.err).toBe(0);
    for (const f of ['est-build.json', 'src/plugin.cpp', 'src/gain.hpp', 'est-abi-1.0.json', 'est-abi-1.1.json', 'AGENTS.md']) expect(existsSync(join(dir, f)), f).toBe(true);
    expect(readFileSync(join(dir, 'est-build.json'), 'utf8')).not.toContain(REPO);
    const v = est(['validate', '--json'], dir);
    const report = JSON.parse(v.out) as { ok: boolean; plugin: { id: string }; checks: { status: string }[] };
    expect(report.checks.filter(c => c.status === 'fail')).toEqual([]);
    expect(report).toMatchObject({ ok: true, plugin: { id: 'com.example.my-port' } });
    expect(readFileSync(join(dir, 'build', 'est_plugin.h'), 'utf8')).toContain('#define EST_PLUGIN_ID "com.example.my-port"');
    const t = est(['test', '--no-build'], dir);
    expect(t.code, t.out).toBe(0);
    expect(t.out).toMatch(/golden: within/);
  }, 240_000);

  it.skipIf(noClang || !cxx)('the JUCE kit: the EST half validates, and est compare holds it against the shared DSP built natively (skipped without clang for wasm32 or a native C++ compiler)', () => {
    const kit = join(tmp, 'juce-shared-dsp');
    cpSync(join(REPO, 'sdk/kits/juce-shared-dsp'), kit, { recursive: true, filter: s => !/[\\/](build|dist)$/.test(s) });
    const v = est(['validate', '--json'], join(kit, 'est'));
    expect((JSON.parse(v.out) as { ok: boolean }).ok, v.err).toBe(true);
    // The desktop build's stand-in: the shared header, natively, over the same input.
    mkdirSync(join(kit, 'build'), { recursive: true });
    const ref = join(kit, 'build', 'reference');
    const c = spawnSync(cxx!, ['-std=c++17', '-O2', '-ffp-contract=off', '-I', join(kit, 'dsp'), join(kit, 'reference', 'render.cpp'), '-o', ref], { encoding: 'utf8' });
    expect(c.status, c.stderr).toBe(0);
    const bundle = join(kit, 'est', 'dist', 'org.example.shared-gain-1.0.0.est');
    expect(est(['compare', bundle, bundle, '--seconds', '1', '--write-input', join(kit, 'build', 'input.wav'), '--report', 'w.html']).code).toBe(0);
    const run = spawnSync(ref, [join(kit, 'build', 'input.wav'), join(kit, 'build', 'reference.wav'), '--gain', '-6', '--at', '0.25'], { encoding: 'utf8' });
    expect(run.status, run.stderr).toBe(0);
    const r = est(['compare', bundle, join(kit, 'build', 'reference.wav'), '--input', join(kit, 'build', 'input.wav'), '--events', '[{"type":"param","time":0.25,"id":0,"value":-6}]', '--tolerance', '-120', '--json', '--report', 'port.html']);
    expect(r.code, r.out + r.err).toBe(0);
    const j = JSON.parse(r.out) as { ok: boolean; frames: number; worstDiffDb: number | null };
    expect(j).toMatchObject({ ok: true, frames: 48000 });
    console.log(`EST-DEVG-PORT the EST module against the native build: worst difference ${j.worstDiffDb === null ? 'none (bit for bit)' : `${j.worstDiffDb.toFixed(1)} dBFS`}`);
  }, 240_000);

  it('est doctor --json reports the C++ toolchain', () => {
    const r = est(['doctor', '--json']);
    const j = JSON.parse(r.out) as { probes: { name: string; ok: boolean; for: string }[]; ready: { cpp: boolean } };
    const p = j.probes.find(x => x.for === 'cpp' && /clang/.test(x.name));
    expect(p?.ok).toBe(!noClang);
    expect(j.ready.cpp).toBe(!noClang);
  }, 60_000);
});
