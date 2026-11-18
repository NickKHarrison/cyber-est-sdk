/**
 * 1.803 (the loop): `est doctor` in a plugin folder (`sdk/packages/cli/src/folderDoctor.ts`): what
 * is wrong with this folder, each a line with the exact command or edit, and one `Next:` line.
 * The checks are hints computed without building; where a declaration cannot be read by a plain
 * pattern the check is skipped, never guessed. Run on copies of the real templates, each broken in
 * one way.
 */
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { checkLine, codeId, codeParamIds, folderChecks, isPluginFolder, type FolderCheck, type MachineProbe } from '../packages/cli/src/folderDoctor';

const SDK = resolve(fileURLToPath(new URL('..', import.meta.url)));
const tmp = mkdtempSync(join(tmpdir(), 'est-folder-doctor-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

let n = 0;
/** A copy of a template (or the cookbook's recipe) to break. */
function copyOf(template: string, from = 'templates'): string {
  const dir = join(tmp, `${template}-${n++}`);
  cpSync(join(SDK, from, template), dir, { recursive: true });
  return dir;
}
const edit = (file: string, f: (s: string) => string) => writeFileSync(file, f(readFileSync(file, 'utf8')));
const json = (file: string, f: (o: Record<string, unknown>) => void) => edit(file, s => { const o = JSON.parse(s) as Record<string, unknown>; f(o); return JSON.stringify(o, null, 2); });

const probe = (name: string, kind: MachineProbe['for'], ok = true, fix: string | null = null): MachineProbe => ({ name, for: kind, ok, fix: ok ? null : fix ?? `install ${name}` });
/** A machine with everything. */
const ALL: MachineProbe[] = [probe('Node 20 or newer', 'all'), probe('binaryen (the meter)', 'all'), probe('rustup', 'rust'), probe('the wasm32-unknown-unknown target', 'rust'), probe('cargo', 'rust'), probe('asc (AssemblyScript)', 'as'), probe('clang for wasm32, with wasm-ld (C and C++)', 'cpp'), probe("Playwright's Chromium (only for est dev --json)", 'dev')];
const without = (name: string, fix: string) => ALL.map(p => (p.name === name ? probe(p.name, p.for, false, fix) : p));

const run = (dir: string, o: { probes?: MachineProbe[]; clone?: boolean } = {}) => folderChecks({ dir, probes: o.probes ?? ALL, version: '0.9.9', clone: o.clone ?? true });
const by = (checks: FolderCheck[], id: string) => checks.filter(c => c.id === id);

describe('est doctor in a plugin folder', () => {
  it('knows a plugin folder from any other', () => {
    expect(isPluginFolder(join(SDK, 'templates', 'effect-as'))).toBe(true);
    expect(isPluginFolder(join(SDK, 'templates', 'effect-rust'))).toBe(true);
    expect(isPluginFolder(join(SDK, 'templates', 'cpp-clap'))).toBe(true);
    expect(isPluginFolder(tmp)).toBe(false);
    const rust = join(tmp, 'plain-rust');
    mkdirSync(rust);
    writeFileSync(join(rust, 'Cargo.toml'), '[package]\nname = "tool"\n');
    expect(isPluginFolder(rust)).toBe(false);
  });

  it('every template as it ships: nothing to fix but the build that has not run', () => {
    for (const t of ['effect-as', 'instrument-as', 'midi-effect-as', 'sampler-as', 'visualiser-as', 'effect-rust', 'instrument-rust', 'midi-effect-rust', 'sampler-rust', 'visualiser-rust', 'cpp-clap']) {
      const r = run(copyOf(t));
      expect(r.checks.filter(c => c.status === 'fix').map(c => c.id), t).toEqual(['bundle']);
      expect(r.canBuild, t).toBe(true);
      expect(r.next, t).toBe('Next: npx est validate');
    }
  });

  it('est.json missing or not JSON stops the build, with the place', () => {
    const none = copyOf('effect-as');
    rmSync(join(none, 'est.json'));
    const a = run(none);
    expect(a.canBuild).toBe(false);
    expect(by(a.checks, 'manifest')[0]).toMatchObject({ status: 'fix', blocks: true, command: true });
    expect(a.next).toBe('Next: npx @cyber-est/cli@0.9.9 new effect-as my-plugin');

    const bad = copyOf('effect-as');
    edit(join(bad, 'est.json'), s => s.replace('"version": "1.0.0",', '"version": "1.0.0"'));
    const b = run(bad);
    expect(b.canBuild).toBe(false);
    expect(by(b.checks, 'manifest')[0]!.text).toMatch(/^est\.json is not valid JSON: .*line 6/);
  });

  it('the kit not installed in the folder: the exact install command, with this version (never in the clone)', () => {
    const dir = copyOf('effect-as');
    const r = run(dir, { clone: false });
    expect(by(r.checks, 'kit')[0]).toMatchObject({ status: 'fix', fix: 'npm install --save-dev --save-exact @cyber-est/cli@0.9.9', command: true });
    expect(r.canBuild).toBe(true);
    expect(r.next).toBe('Next: npm install --save-dev --save-exact @cyber-est/cli@0.9.9');
    mkdirSync(join(dir, 'node_modules', '@cyber-est', 'cli'), { recursive: true });
    writeFileSync(join(dir, 'node_modules', '@cyber-est', 'cli', 'package.json'), '{"version":"0.9.9"}');
    expect(by(run(dir, { clone: false }).checks, 'kit')[0]!.status).toBe('ok');
    writeFileSync(join(dir, 'node_modules', '@cyber-est', 'cli', 'package.json'), '{"version":"0.1.0"}');
    expect(by(run(dir, { clone: false }).checks, 'kit')[0]).toMatchObject({ status: 'note' });
    expect(by(run(dir, { clone: true }).checks, 'kit')[0]!.status).toBe('note');
  });

  it("only THIS folder's toolchain is a problem; the others are a note", () => {
    const noTarget = without('the wasm32-unknown-unknown target', 'rustup target add wasm32-unknown-unknown');
    // An AssemblyScript folder does not care that Rust's target is missing.
    const as = run(copyOf('effect-as'), { probes: noTarget });
    expect(by(as.checks, 'toolchain').map(c => c.status)).toEqual(['ok']);
    expect(by(as.checks, 'other-toolchains')[0]!.text).toBe('not needed by this folder: Rust not set up; C or C++ ready');
    expect(as.canBuild).toBe(true);
    // A Rust folder does, and gets the command.
    const rust = run(copyOf('effect-rust'), { probes: noTarget });
    expect(by(rust.checks, 'toolchain')[0]).toMatchObject({ status: 'fix', blocks: true, command: true, fix: 'rustup target add wasm32-unknown-unknown' });
    expect(rust.canBuild).toBe(false);
    expect(rust.next).toBe('Next: rustup target add wasm32-unknown-unknown');
    // A C++ folder without clang; and an -as folder without asc.
    expect(run(copyOf('cpp-clap'), { probes: without('clang for wasm32, with wasm-ld (C and C++)', 'install clang') }).canBuild).toBe(false);
    expect(run(copyOf('effect-as'), { probes: without('asc (AssemblyScript)', 'npm install --save-dev --save-exact @cyber-est/cli@0.9.9') }).canBuild).toBe(false);
    expect(run(copyOf('effect-rust'), { probes: without('asc (AssemblyScript)', 'x') }).canBuild).toBe(true);
  });

  it('the id in the code against est.json, naming both and the line', () => {
    expect(codeId(join(SDK, 'templates', 'effect-as'), 'as')).toMatchObject({ id: 'org.example.est-effect-template-as', file: 'assembly/index.ts' });
    expect(codeId(join(SDK, 'templates', 'effect-rust'), 'rust')).toMatchObject({ id: 'org.example.est-effect-template', file: 'src/lib.rs' });
    expect(codeId(join(SDK, 'templates', 'midi-effect-rust'), 'rust')?.id).toBe('org.example.est-midi-effect-template');
    for (const [t, file] of [['effect-as', 'assembly/index.ts'], ['instrument-rust', 'src/lib.rs']] as const) {
      const dir = copyOf(t);
      json(join(dir, 'est.json'), o => { o.id = 'com.example.renamed'; });
      const c = by(run(dir).checks, 'id')[0]!;
      expect(c.status).toBe('fix');
      expect(c.text).toMatch(new RegExp(`^the code says the id is "org\\.example\\.[a-z-]+" \\(${file.replace('.', '\\.')}:\\d+\\) and est\\.json says "com\\.example\\.renamed"$`));
      expect(c.fix).toContain('"com.example.renamed"');
      expect(c.blocks).toBeUndefined();
    }
    // An id in a comment is not the code's.
    const dir = copyOf('effect-as');
    edit(join(dir, 'assembly', 'index.ts'), s => `// new Descriptor("com.example.in-a-comment", …)\n${s}`);
    expect(by(run(dir).checks, 'id')[0]!.status).toBe('ok');
  });

  it("the parameters the code declares against est.json's list; skipped rather than guessed", () => {
    expect(codeParamIds(join(SDK, 'templates', 'effect-as'), 'as')).toEqual([0, 1, 2, 3]);
    expect(codeParamIds(join(SDK, 'templates', 'effect-rust'), 'rust')).toEqual([0, 1, 2, 3]);
    // The step sequencer makes eight of its parameters in a loop: nothing is compared.
    expect(codeParamIds(join(SDK, 'cookbook', 'step-sequencer'), 'as')).toBeNull();
    expect(by(run(copyOf('step-sequencer', 'cookbook')).checks, 'parameters')).toEqual([]);

    const dir = copyOf('effect-as');
    json(join(dir, 'est.json'), o => { (o.parameters as { id: number }[]).pop(); (o.parameters as { id: number; name: string }[]).push({ id: 9, name: 'Nine' }); });
    const c = by(run(dir).checks, 'parameters')[0]!;
    expect(c).toMatchObject({ status: 'fix', text: 'the code declares id 3 that est.json does not list, and est.json lists id 9 that the code does not declare' });

    const twice = copyOf('effect-as');
    edit(join(twice, 'assembly', 'index.ts'), s => s.replace('const MODE: u32 = 3;', 'const MODE: u32 = 2;'));
    expect(by(run(twice).checks, 'parameters')[0]!.text).toBe('the code declares parameter id 2 more than once');
  });

  it('the golden spec: a parameter est.json does not list, a length that is not whole blocks, bad JSON', () => {
    const dir = copyOf('effect-as');
    json(join(dir, 'test', 'golden.json'), o => { (o.events as unknown[]).push({ type: 'param', time: 0.2, id: 7, value: 1 }); });
    expect(by(run(dir).checks, 'golden')[0]).toMatchObject({ status: 'fix', text: 'test/golden.json sets parameter id 7, which est.json does not list' });
    json(join(dir, 'test', 'golden.json'), o => { o.frames = 12000; });
    expect(by(run(dir).checks, 'golden')[0]!.fix).toBe('edit test/golden.json: set "frames" to 12032');
    writeFileSync(join(dir, 'test', 'golden.json'), '{ nope');
    expect(by(run(dir).checks, 'golden')[0]!.text).toMatch(/^test\/golden\.json is not valid JSON/);
  });

  it("AssemblyScript: asconfig.json's maximumMemory out of step with est.json's limit", () => {
    const dir = copyOf('effect-as');
    json(join(dir, 'est.json'), o => { (o.limits as { memoryPagesMax: number }).memoryPagesMax = 64; });
    expect(by(run(dir).checks, 'memory')[0]).toMatchObject({ status: 'fix', text: 'asconfig.json lets the module grow to 16 pages ("maximumMemory") and est.json allows 64 ("limits.memoryPagesMax")', fix: 'edit the smaller to 64: the two numbers are the same (a page is 64 KiB)' });
  });

  it('dist/: nothing built, a stale bundle, a validation.json that failed (its first rule and fix), a pass', () => {
    const dir = copyOf('effect-as');
    mkdirSync(join(dir, 'dist'));
    const bundle = join(dir, 'dist', 'org.example.fx-1.0.0.est');
    writeFileSync(bundle, 'x');
    const later = new Date(Date.now() + 60_000);
    utimesSync(bundle, later, later);
    // Built, never validated.
    expect(by(run(dir).checks, 'validation')[0]).toMatchObject({ status: 'fix', fix: 'npx est validate' });
    // A failed validate: the first failed rule, by the report's own id, and its fix.
    writeFileSync(join(dir, 'dist', 'validation.json'), JSON.stringify({ ok: false, checks: [
      { rule: 'EST-M002', status: 'pass', message: '', fix: '' },
      { rule: 'EST-C008', status: 'fail', message: "the parameters differ from est.json's list", fix: 'List every parameter the DSP declares. Then pack again.', where: 'phase:params' },
      { rule: 'EST-C013', status: 'fail', message: 'later', fix: 'later' },
    ] }));
    const failed = run(dir);
    expect(by(failed.checks, 'validation')[0]).toMatchObject({ status: 'fix', text: "the last validate failed EST-C008 [phase:params]: the parameters differ from est.json's list", fix: 'List every parameter the DSP declares; then npx est validate' });
    expect(failed.canBuild).toBe(true);
    expect(failed.next).toBe('Next: List every parameter the DSP declares; then npx est validate');
    // A pass: the next step is to hear it or drop it on Cyber.
    writeFileSync(join(dir, 'dist', 'validation.json'), JSON.stringify({ ok: true, checks: [] }));
    const passed = run(dir);
    expect(passed.checks.filter(c => c.status === 'fix')).toEqual([]);
    expect(passed.next).toBe('Next: npx est dev to hear it, or drop dist/org.example.fx-1.0.0.est on Cyber: Home → EST PLUGINS → Add a plugin');
    // The source changed after the build: the old report is not read as today's.
    const past = new Date(Date.now() - 3_600_000);
    utimesSync(bundle, past, past);
    const stale = run(dir);
    expect(by(stale.checks, 'bundle')[0]).toMatchObject({ status: 'fix', text: 'dist/org.example.fx-1.0.0.est is older than your last change', fix: 'npx est validate' });
  });

  it("Playwright's Chromium is only ever a note", () => {
    const r = run(copyOf('effect-as'), { probes: without("Playwright's Chromium (only for est dev --json)", 'npx playwright install chromium') });
    expect(by(r.checks, 'dev-json')[0]).toMatchObject({ status: 'note' });
    expect(r.canBuild).toBe(true);
  });

  it('each check prints as one line', () => {
    const dir = copyOf('effect-as');
    json(join(dir, 'est.json'), o => { o.id = 'com.example.renamed'; });
    for (const c of run(dir, { clone: false }).checks) {
      const line = checkLine(c);
      expect(line).not.toContain('\n');
      expect(line).toMatch(/^(ok {2}|fix |note) {2}\S/);
    }
  });
});
