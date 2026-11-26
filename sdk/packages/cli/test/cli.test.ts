/**
 * EST Phase 4 (4-A): `est` end to end, as a developer runs it (`node sdk/packages/cli/bin/est.mjs`,
 * the launcher bundling the source), in a temporary folder outside the repository:
 * - `new`, `pack` and a full `validate` pass for each AssemblyScript template (asc is a dev
 *   dependency), and for each Rust template where `cargo` and the wasm32 target exist (skipped,
 *   never failed, where they do not);
 * - the new folder holds no path back into the repository;
 * - `validate --json` on every broken fixture fails with the fixture's rule (the same id the
 *   compiling Worker gives: sdk/fixtures/broken/broken.test.ts), exit 1, validation.json written;
 * - `inspect`, `doctor`, `test` with the template's golden render, `dev` registered, `help` and
 *   the usage errors.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { BROKEN, packFixture } from '../../../fixtures/broken/index.mjs';
import { EST_RULES } from '../../../../src/audio/est/install/rules';
import { parseArgs, UsageError } from '../src/command';
import { crateNameOf, renameInCode, scaffold, typeNameOf } from '../src/scaffold';

const BIN = fileURLToPath(new URL('../bin/est.mjs', import.meta.url));
const REPO = resolve(fileURLToPath(new URL('../../../../', import.meta.url)));
const TEMPLATES = join(REPO, 'sdk', 'templates');
const tmp = mkdtempSync(join(tmpdir(), 'est-cli-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

function est(args: string[], cwd = tmp) {
  const r = spawnSync(process.execPath, [BIN, ...args], { cwd, encoding: 'utf8', timeout: 240_000 });
  return { code: r.status, out: r.stdout, err: r.stderr };
}
const has = (cmd: string, args: string[]) => { const r = spawnSync(cmd, args, { encoding: 'utf8' }); return !r.error && r.status === 0 ? r.stdout : null; };
const rust = !!has('cargo', ['--version']) && (has('rustup', ['target', 'list', '--installed']) ?? '').split(/\s+/).includes('wasm32-unknown-unknown');
const templates = readdirSync(TEMPLATES).filter(n => existsSync(join(TEMPLATES, n, 'est.json'))).sort();
const asTemplates = templates.filter(t => t.endsWith('-as'));
const rustTemplates = templates.filter(t => t.endsWith('-rust'));
/** DEV-F (1.321): the cookbook's recipes, AssemblyScript all, which `est new` takes by name too. */
const recipes = readdirSync(join(REPO, 'sdk', 'cookbook')).filter(n => existsSync(join(REPO, 'sdk', 'cookbook', n, 'est.json'))).sort();
const isAs = (t: string) => t.endsWith('-as') || recipes.includes(t);

function allText(dir: string): string[] {
  const out: string[] = [];
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) { if (!['target', 'build', 'dist', 'node_modules'].includes(n)) out.push(...allText(p)); } else out.push(readFileSync(p, 'utf8'));
  }
  return out;
}

/** The new plugin, built outside the repository, must pass every rule (every template and recipe passes Cyber's conformance run). */
function scaffoldPackValidate(template: string) {
  const dir = join(tmp, `t-${template}`);
  const made = est(['new', template, dir, '--id', `com.example.${template}`, '--name', `Trial ${template}`, '--no-install']);
  expect(made.code, made.err).toBe(0);
  expect(made.out).toMatch(new RegExp(`from ${template}: Trial ${template} \\(com\\.example\\.${template}\\)`));
  // The SDK's library is copied in as est/ (either language), and nothing leads back into the repository.
  expect(existsSync(join(dir, 'est', isAs(template) ? 'index.ts' : 'Cargo.toml'))).toBe(true);
  for (const t of allText(dir)) {
    expect(t).not.toContain(REPO);
    expect(t).not.toMatch(/\.\.\/(\.\.\/)*(effect-rust|instrument-rust|templates|rust|as)\/est/);
  }
  const m = JSON.parse(readFileSync(join(dir, 'est.json'), 'utf8')) as { id: string; name: string };
  expect(m).toMatchObject({ id: `com.example.${template}`, name: `Trial ${template}` });
  // The manifest schema beside est.json (a `$schema` naming it points there), never packed; and the
  // other files an agent reads, so no doc has to point outside the folder.
  for (const f of ['est-manifest-1.schema.json', 'est-validator-rules.json', 'est-abi-1.0.json', 'est-abi-1.1.json', 'est-ui.d.ts']) expect(existsSync(join(dir, f)), f).toBe(true);
  expect(existsSync(join(dir, 'ui-example'))).toBe(false);
  // Only a start with its own page (the visualiser templates, 1.672's spectrum-tilt recipe) has ui/ without --ui.
  const from = recipes.includes(template) ? join(REPO, 'sdk', 'cookbook', template) : join(TEMPLATES, template);
  expect(existsSync(join(dir, 'ui'))).toBe(existsSync(join(from, 'ui')));
  // The crate and the plugin's type are named from the id, not the template.
  const type = typeNameOf(`com.example.${template}`);
  const source = readFileSync(join(dir, isAs(template) ? 'assembly/index.ts' : 'src/lib.rs'), 'utf8');
  expect(source).toMatch(new RegExp(`\\bclass ${type}\\b|\\bstruct ${type}\\b`));
  expect(renameInCode(source, 'Template', 'X')).toBe(source);
  expect(source).not.toMatch(/the EST (effect|instrument|sampler|midi effect|visualiser) template \(/i);
  if (template.endsWith('-rust')) {
    const cargo = readFileSync(join(dir, 'Cargo.toml'), 'utf8');
    expect(cargo).toContain(`name = "${crateNameOf(`com.example.${template}`)}"`);
    expect(cargo).toContain(`module = "target/wasm32-unknown-unknown/release/${crateNameOf(`com.example.${template}`).replace(/-/g, '_')}.wasm"`);
    expect(readFileSync(join(dir, 'Cargo.lock'), 'utf8')).toContain(`name = "${crateNameOf(`com.example.${template}`)}"`);
    expect(cargo).not.toContain('template');
  }
  const packed = est(['pack', '--json'], dir);
  expect(packed.code, packed.err).toBe(0);
  const p = JSON.parse(packed.out) as { file: string; hash: string; id: string };
  expect(p.file).toBe(join(dir, 'dist', `com.example.${template}-1.0.0.est`));
  expect(existsSync(p.file)).toBe(true);
  const v = est(['validate', '--no-build', '--json'], dir);
  const report = JSON.parse(v.out) as { ok: boolean; plugin: { id: string; hash: string }; checks: { rule: string; status: string; message: string }[] };
  const failed = report.checks.filter(c => c.status === 'fail');
  expect(failed, template).toEqual([]);
  expect(report.ok).toBe(true);
  expect(v.code).toBe(0);
  expect(report).toMatchObject({ plugin: { id: `com.example.${template}`, hash: p.hash } });
  expect(JSON.parse(readFileSync(join(dir, 'dist', 'validation.json'), 'utf8'))).toMatchObject({ ok: report.ok, plugin: { hash: p.hash } });
  // Packing twice gives the same bytes.
  expect(JSON.parse(est(['pack', '--no-build', '--json'], dir).out).hash).toBe(p.hash);
}

describe('est new, pack and validate', () => {
  it('has the AssemblyScript templates to run', () => { expect(asTemplates).toContain('instrument-as'); });
  for (const t of asTemplates) it(`${t} (AssemblyScript)`, () => scaffoldPackValidate(t), 240_000);
  it('has the cookbook\'s eleven recipes to run (1.672: the spectrum tilt)', () => { expect(recipes).toHaveLength(11); });
  for (const t of recipes) it(`the cookbook's ${t} (AssemblyScript)`, () => scaffoldPackValidate(t), 240_000);
  // 1.789 (V5): a recipe's folder carries the cookbook's AGENTS.md and CLAUDE.md (est new's "read AGENTS.md" names a file that is there).
  it('a recipe\'s folder has AGENTS.md and CLAUDE.md', () => {
    const dir = join(tmp, 'recipe-agents');
    expect(est(['new', 'chorus', dir, '--no-install']).code).toBe(0);
    expect(readFileSync(join(dir, 'AGENTS.md'), 'utf8')).toContain('cookbook');
    expect(readFileSync(join(dir, 'CLAUDE.md'), 'utf8')).toContain('AGENTS.md');
  });
  for (const t of rustTemplates) it.skipIf(!rust)(`${t} (Rust; skipped where cargo or the wasm32-unknown-unknown target is missing)`, () => scaffoldPackValidate(t), 240_000);

  // 1.786 (V3): the Rust SDK reports a sidechain (EST 1.1) and reads it: `Effect::SIDECHAIN_CHANNELS`, `io.sidechain`.
  // Before, its glue had one input port, so a manifest's sidechain failed EST-C003 and no Rust plugin could take a key.
  it.skipIf(!rust)('effect-rust with a sidechain: SIDECHAIN_CHANNELS and io.sidechain pass validate (skipped without cargo and wasm32)', () => {
    const dir = join(tmp, 'rust-sidechain');
    expect(est(['new', 'effect-rust', dir, '--id', 'com.example.rust-sidechain', '--name', 'Rust Sidechain', '--no-install']).code).toBe(0);
    const mf = join(dir, 'est.json');
    // 1.803: edited as JSON. (est new writes est.json on several lines, so the text replaces this test
    // made before never matched: the manifest stayed EST 1.0 with no sidechain, and nothing checked it.)
    const manifest = JSON.parse(readFileSync(mf, 'utf8')) as { abi: { est: string }; audio: { inputs: unknown[] } };
    manifest.abi.est = '1.1';
    manifest.audio.inputs = [{ channels: 2 }, { channels: 2, role: 'sidechain' }];
    writeFileSync(mf, JSON.stringify(manifest, null, 2));
    const lib = join(dir, 'src', 'lib.rs');
    writeFileSync(lib, readFileSync(lib, 'utf8')
      .replace('const STATE_MAGIC: u32', 'const SIDECHAIN_CHANNELS: u32 = 2;\n    const STATE_MAGIC: u32')
      .replace('let y = self.filters[c].process(io.input(c, n) as f64) * g;', 'let key = if io.side_live { io.sidechain(c, n) as f64 } else { 0.0 };\n                let y = self.filters[c].process(io.input(c, n) as f64) * g * (1.0 - 0.5 * key.abs().min(1.0));'));
    const v = est(['validate', '--json'], dir);
    const report = JSON.parse(v.out) as { ok: boolean; checks: { id?: string; status: string; message?: string }[] };
    expect(report.checks.filter(c => c.status === 'fail'), v.err).toEqual([]);
    expect(report.ok).toBe(true);
    expect((JSON.parse(est(['inspect', join(dir, 'dist', 'com.example.rust-sidechain-1.0.0.est'), '--json'], dir).out) as { manifest: { sidechain: number; edition: string } }).manifest).toMatchObject({ sidechain: 2, edition: '1.1' });
    // 1.803: the golden spec's `key` feeds that sidechain. Before, est test fed it silence, so this
    // plugin's ducking was never played: a render with a key now differs from the one without.
    const golden = join(dir, 'test', 'golden.json');
    const spec = JSON.parse(readFileSync(golden, 'utf8')) as Record<string, unknown>;
    const silent = est(['test', '--no-build', '--update', '--seconds', '2'], dir);
    expect(silent.code, silent.out).toBe(0);
    expect(silent.out).not.toMatch(/golden key/);
    const before = readFileSync(join(dir, 'test', 'golden.f32'));
    writeFileSync(golden, JSON.stringify({ ...spec, key: { kind: 'bursts', level: 0.9 } }, null, 2));
    const keyed = est(['test', '--no-build', '--seconds', '2'], dir);
    expect(keyed.out).toMatch(/\. golden key: bursts into the sidechain/);
    expect(keyed.out).toMatch(/x golden: differs by/);
    expect(keyed.code).toBe(1);
    expect(est(['test', '--no-build', '--update', '--seconds', '2'], dir).code).toBe(0);
    expect(est(['test', '--no-build', '--seconds', '2'], dir).code).toBe(0);
    expect(readFileSync(join(dir, 'test', 'golden.f32')).equals(before)).toBe(false);
    // est demo --key plays the test loop's drums into it.
    const demo = est(['demo', '--no-build', '--seconds', '2', '--key', 'kick'], dir);
    expect(demo.code, demo.err).toBe(0);
    expect(demo.err).not.toMatch(/--key ignored/);
    expect(est(['demo', '--no-build', '--seconds', '2', '--key', 'loud'], dir).code).toBe(2);
  }, 240_000);

  it('--ui adds the template\'s example UI (ui/index.html, ui.js, style.css: @cyber-est/ui knobs on its parameters) and it passes EST-U', () => {
    const t = asTemplates.find(x => x.startsWith('effect')) ?? 'effect-as';
    const dir = join(tmp, 'with-ui');
    const made = est(['new', t, dir, '--id', 'com.example.knobs', '--name', 'Knobs', '--ui', '--no-install']);
    expect(made.code, made.err).toBe(0);
    expect(made.out).toMatch(/a custom UI in ui\//);
    expect(readdirSync(join(dir, 'ui')).sort()).toEqual(['index.html', 'style.css', 'ui.js']);
    const page = readFileSync(join(dir, 'ui', 'index.html'), 'utf8');
    expect(page).toContain('<title>Knobs</title>');
    const m = JSON.parse(readFileSync(join(dir, 'est.json'), 'utf8')) as { ui: { path: string; size: { w: number; h: number } }; parameters: { id: number }[] };
    expect(m.ui).toEqual({ path: 'ui/index.html', size: { w: 440, h: 180 } });
    // A knob for every parameter of the template.
    for (const p of m.parameters) expect(page).toMatch(new RegExp(`<est-knob param="${p.id}"`));
    const v = est(['validate', '--json'], dir);
    const report = JSON.parse(v.out) as { ok: boolean; checks: { rule: string; status: string }[] };
    expect(report.checks.filter(c => c.status === 'fail')).toEqual([]);
    for (const r of ['EST-U001', 'EST-U002', 'EST-U003', 'EST-U004']) expect(report.checks.find(c => c.rule === r)?.status, r).toBe('pass');
    expect(v.code).toBe(0);
    const files = (JSON.parse(est(['inspect', join(dir, 'dist', 'com.example.knobs-1.0.0.est'), '--json', '--no-meter']).out) as { files: { path: string }[] }).files.map(f => f.path);
    for (const f of ['ui/index.html', 'ui/ui.js', 'ui/style.css', 'ui/est-ui.js']) expect(files, f).toContain(f);
  }, 240_000);

  it('names the crate and the type from the id, and renames only code', () => {
    expect(crateNameOf('org.example.my-chorus')).toBe('my-chorus');
    expect(crateNameOf('org.example.3osc')).toBe('est-3osc');
    expect(crateNameOf('org.example.est')).toBe('est-plugin');
    expect(typeNameOf('org.example.my-chorus')).toBe('MyChorus');
    expect(typeNameOf('com.acme.filter')).toBe('FilterPlugin');
    const src = '// the Template\nstruct Template { s: &\'static str }\nlet a = "Template";\nimpl Effect for Template {}\nlet c = \'T\';\n/* Template */';
    expect(renameInCode(src, 'Template', 'MyChorus')).toBe('// the Template\nstruct MyChorus { s: &\'static str }\nlet a = "Template";\nimpl Effect for MyChorus {}\nlet c = \'T\';\n/* Template */');
  });

  it('1.918: --email writes est.json\'s contact (optional, recommended); a bad address is refused', () => {
    const dir = join(tmp, 'with-email');
    expect(est(['new', 'effect-as', dir, '--id', 'com.example.mailed', '--name', 'Mailed', '--email', 'maker@example.com', '--no-install']).code).toBe(0);
    expect(JSON.parse(readFileSync(join(dir, 'est.json'), 'utf8')).contact).toEqual({ email: 'maker@example.com' });
    const plain = join(tmp, 'no-email');
    expect(est(['new', 'effect-as', plain, '--id', 'com.example.plain', '--name', 'Plain', '--no-install']).code).toBe(0);
    expect(JSON.parse(readFileSync(join(plain, 'est.json'), 'utf8')).contact).toBeUndefined();
    const bad = est(['new', 'effect-as', join(tmp, 'bad-email'), '--email', 'not-an-address', '--no-install']);
    expect(bad.code).toBe(2); // a usage error
    expect(bad.err).toMatch(/--email not-an-address is not an email address/);
  });

  it('refuses a bad id, an unknown template and a folder that is not empty', () => {
    expect(est(['new', 'instrument-as', join(tmp, 'bad-id'), '--id', 'Not An Id', '--no-install'])).toMatchObject({ code: 1 });
    const unknown = est(['new', 'no-such', join(tmp, 'x'), '--no-install']);
    expect(unknown.code).toBe(1);
    expect(unknown.err).toMatch(/no template "no-such" \(the templates: .*instrument-as/);
    mkdirSync(join(tmp, 'full'));
    writeFileSync(join(tmp, 'full', 'a.txt'), 'x');
    expect(est(['new', 'instrument-as', join(tmp, 'full'), '--no-install']).err).toMatch(/is not empty/);
    expect(est(['new', 'instrument-as', '--no-install'])).toMatchObject({ code: 2 });
  });
});

describe('est validate and inspect on the broken fixtures', () => {
  it('fail with each fixture\'s rule, exit 1, and write validation.json beside the bundle', () => {
    const got: Record<string, string | null> = {};
    for (const f of BROKEN) {
      const dir = join(tmp, 'broken', f.name);
      mkdirSync(dir, { recursive: true });
      const file = join(dir, `${f.name}.est`);
      writeFileSync(file, packFixture(f).bytes);
      const v = est(['validate', file, '--json', '--seconds', '2']);
      const report = JSON.parse(v.out) as { ok: boolean; checks: { rule: string; status: string }[] };
      // 1.652: a behaviour check of warning severity flags its fixture `warn` and exits 0 (a warning never fails).
      const warning = EST_RULES.find(r => r.id === f.rule)?.severity === 'warning';
      expect(v.code, `${f.name}: ${v.err}`).toBe(warning ? 0 : 1);
      expect(report.ok).toBe(warning);
      got[f.name] = report.checks.find(c => c.status === (warning ? 'warn' : 'fail') && c.rule === f.rule)?.rule ?? null;
      expect(JSON.parse(readFileSync(join(dir, 'validation.json'), 'utf8'))).toEqual(JSON.parse(v.out));
    }
    expect(got).toEqual(Object.fromEntries(BROKEN.map(f => [f.name, f.rule])));
  }, 600_000);

  it('inspect describes a bundle the host refuses, with the rule', () => {
    const f = BROKEN.find(x => x.name === 'forbidden-import')!;
    const file = join(tmp, 'broken', 'forbidden-import', 'forbidden-import.est');
    if (!existsSync(file)) { mkdirSync(join(tmp, 'broken', 'forbidden-import'), { recursive: true }); writeFileSync(file, packFixture(f).bytes); }
    const r = est(['inspect', file]);
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/REFUSED EST-W004: the module imports env\.host_fetch \(function\), which EST does not allow/);
    expect(r.out).toMatch(/imports: env\.host_fetch \(function\)/);
    const j = JSON.parse(est(['inspect', file, '--json', '--no-meter']).out) as { refusal: { rule: string } };
    expect(j.refusal.rule).toBe('EST-W004');
  });
});

describe('est test, doctor, help', () => {
  it("test plays the template's golden render (test/golden.json) and compares it; a changed render fails until --update", () => {
    const t = asTemplates.find(x => x.startsWith('effect')) ?? 'instrument-as';
    const dir = join(tmp, 'golden');
    expect(est(['new', t, dir, '--no-install']).code).toBe(0);
    const first = est(['test', '--seconds', '2'], dir);
    expect(first.code, first.err + first.out).toBe(0);
    expect(first.out).toMatch(/\. golden: within 0\.000001 \(largest difference/);
    expect(first.out).toMatch(/est test: all passed/);
    const file = join(dir, 'test', 'golden.f32');
    const g = readFileSync(file);
    g.writeFloatLE(g.readFloatLE(4000) + 0.5, 4000);
    writeFileSync(file, g);
    const bad = est(['test', '--no-build', '--seconds', '2'], dir);
    expect(bad.code).toBe(1);
    expect(bad.out).toMatch(/x golden: differs by 5\.00e-1 at frame 1000 \(left\)/);
    const update = est(['test', '--no-build', '--update', '--seconds', '2'], dir);
    expect(update.code, update.out).toBe(0);
    expect(update.out).toMatch(/\+ golden: test[\\/]golden\.f32 written \(12288 frames\)/);
    expect(est(['test', '--no-build', '--seconds', '2'], dir).code).toBe(0);
    // Any failed check fails the run: here the conformance run's (est.json's parameters no longer
    // match the module's: EST-C008), with the golden render still passing.
    const m = JSON.parse(readFileSync(join(dir, 'est.json'), 'utf8')) as { parameters: unknown[] };
    writeFileSync(join(dir, 'est.json'), JSON.stringify({ ...m, parameters: m.parameters.slice(1) }, null, 2));
    const conformance = est(['test', '--no-build', '--seconds', '2'], dir);
    expect(conformance.out).toMatch(/\. golden: within/);
    expect(conformance.out).toMatch(/EST-C008/);
    expect(conformance.out).toMatch(/est test: 1 failed/);
    expect(conformance.code).toBe(1);
  }, 240_000);

  // 1.803 (the loop): every one of validate, test and doctor ends with one line, "Next: …",
  // decided by one function (sdk/tests/next.test.ts); here, that the commands print it.
  it('validate, test and doctor end with one Next: line; a build error names the file and line; --json gains a field', () => {
    const t = asTemplates.find(x => x.startsWith('effect')) ?? 'instrument-as';
    const dir = join(tmp, 'next-line');
    expect(est(['new', t, dir, '--id', 'com.example.next-line']).code).toBe(0);
    const last = (text: string) => text.trimEnd().split('\n').at(-1)!;
    // Before any build: doctor says so, and what to run.
    const fresh = est(['doctor', '--json'], dir);
    const fj = JSON.parse(fresh.out) as { probes: unknown[]; ready: { as: boolean }; next: string; folder: { kind: string; canBuild: boolean; checks: { id: string; status: string; fix?: string }[] } };
    expect(fresh.code).toBe(0);
    expect(fj.probes.length).toBeGreaterThan(5);
    expect(fj.folder).toMatchObject({ kind: 'as', canBuild: true });
    expect(fj.folder.checks.filter(c => c.status === 'fix').map(c => c.id)).toEqual(['bundle']);
    expect(fj.next).toBe('Next: npx est validate');
    // A pass: the next step.
    const ok = est(['validate', '--seconds', '2'], dir);
    expect(ok.code, ok.err).toBe(0);
    expect(last(ok.out)).toBe('Next: npx est dev to hear it, or drop dist/com.example.next-line-1.0.0.est on Cyber: Home → EST PLUGINS → Add a plugin');
    const okJson = JSON.parse(est(['validate', '--no-build', '--seconds', '2', '--json'], dir).out) as { ok: boolean; next: string; checks: unknown[] };
    expect(okJson).toMatchObject({ ok: true, next: last(ok.out) });
    expect((JSON.parse(readFileSync(join(dir, 'dist', 'validation.json'), 'utf8')) as { next: string }).next).toBe(okJson.next);
    expect(last(est(['test', '--no-build', '--seconds', '2'], dir).out)).toBe(last(ok.out));
    expect(last(est(['doctor'], dir).out)).toBe(last(ok.out));
    // A compiler error: its file and line; nothing on standard output but the line (and with --json, nothing).
    const source = join(dir, 'assembly', 'index.ts');
    const good = readFileSync(source, 'utf8');
    writeFileSync(source, good.replace('this.gain.next()', 'this.gain.nxt()'));
    const at = good.split('\n').findIndex(l => l.includes('this.gain.next()')) + 1;
    for (const cmd of ['validate', 'test']) {
      const broken = est([cmd], dir);
      expect(broken.code, cmd).toBe(1);
      expect(broken.out.trim(), cmd).toBe(`Next: fix assembly/index.ts:${at}: Property 'nxt' does not exist on type '~lib/est/dsp/smoother/Smoother'. (TS2339)`);
      expect(broken.err, cmd).toContain(`est ${cmd}: the build failed (asc exited with 1)`);
      // The compiler's own output is still shown, whole (read without its colours: asc colours it where the
      // environment asks, as CI's FORCE_COLOR does, which puts codes inside `ERROR TS2339`).
      expect(broken.err.replace(new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g'), ''), cmd).toContain('ERROR TS2339');
    }
    const brokenJson = est(['validate', '--json'], dir);
    expect(brokenJson.code).toBe(1);
    expect(brokenJson.out).toBe('');
    expect(brokenJson.err).toContain(`Next: fix assembly/index.ts:${at}:`);
    // A failed check: the first one's rule id, where, and its fix; doctor then names the same rule from dist/.
    writeFileSync(source, good.replace('new Descriptor("com.example.next-line"', 'new Descriptor("com.example.another"'));
    const idDoctor = JSON.parse(est(['doctor', '--json'], dir).out) as { next: string; folder: { checks: { id: string; status: string; text: string }[] } };
    expect(idDoctor.folder.checks.find(c => c.id === 'id')).toMatchObject({ status: 'fix', text: `the code says the id is "com.example.another" (assembly/index.ts:${good.split('\n').findIndex(l => l.includes('new Descriptor(')) + 1}) and est.json says "com.example.next-line"` });
    expect(idDoctor.next).toMatch(/^Next: edit assembly\/index\.ts:\d+: make the id "com\.example\.next-line"/);
    const failed = est(['validate', '--seconds', '2'], dir);
    expect(failed.code).toBe(1);
    expect(last(failed.out)).toMatch(/^Next: fix EST-C001 \[phase:boot\]: Check that est\.json's `id` is the descriptor's id/);
    writeFileSync(source, good);
    // 1.803: a key in the golden spec of a plugin with no sidechain is ignored, said in a line, and nothing fails.
    const golden = join(dir, 'test', 'golden.json');
    writeFileSync(golden, JSON.stringify({ ...(JSON.parse(readFileSync(golden, 'utf8')) as Record<string, unknown>), key: { kind: 'bursts' } }, null, 2));
    const ignored = est(['test', '--seconds', '2'], dir);
    expect(ignored.out).toMatch(/- golden key: ignored \(this plugin has no sidechain input/);
    expect(ignored.out).toMatch(/\. golden: within/);
    expect(ignored.code, ignored.out).toBe(0);
    const demo = est(['demo', '--no-build', '--seconds', '2', '--key', 'sine'], dir);
    expect(demo.code).toBe(0);
    expect(demo.err).toMatch(/est demo: --key ignored: this plugin has no sidechain input/);
  }, 240_000);

  it('dev is a command: est help lists it and its usage names the dev host', () => {
    expect(est(['help']).out).toMatch(/^ {2}dev\s+Play a plugin in the dev host/m);
    expect(est(['help', 'dev']).out).toMatch(/--json\s+headless/);
  });

  // Its own limit: the Playwright probe (doctor.ts `playwrightProbe`) may take up to its 20 s cap
  // importing @playwright/test cold on a busy runner (28 s once on CI, its usual 4 s plus that cap),
  // and the rest of the probes about 4 s: 20 + 4, with a margin, is 40 s (the 20 s default is a hang guard).
  it('doctor checks the toolchains and installs nothing', () => {
    const r = est(['doctor', '--json']);
    const j = JSON.parse(r.out) as { version: string; probes: { name: string; ok: boolean; fix: string | null; for: string }[]; ready: { rust: boolean; as: boolean; devJson: boolean } };
    // 1.326 (DEV-G): the C++ toolchain too; `emcc` is listed only where it is installed (porting.test.ts).
    expect(j.probes.map(p => p.name).filter(n => !/emcc/.test(n))).toEqual(['Node 20 or newer', 'binaryen (the meter)', 'rustup', 'the wasm32-unknown-unknown target', 'cargo', 'asc (AssemblyScript)', 'clang for wasm32, with wasm-ld (C and C++)', "Playwright's Chromium (only for est dev --json)"]);
    expect(j.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(j.ready.as).toBe(true);
    // 1.319 (DEV-A): Playwright is an optional peer, reported but never counted as ready or not.
    expect(j.probes.find(p => p.for === 'dev')?.fix ?? 'npx playwright install chromium').toMatch(/playwright/);
    expect(typeof j.ready.devJson).toBe('boolean');
    expect(j.ready.rust).toBe(rust);
    for (const p of j.probes) if (!p.ok) expect(p.fix).toBeTruthy();
    expect(r.code).toBe(0);
  }, 40_000);

  it('help lists the commands (1.305: keygen, sign and publish; 1.322: login and yank); an unknown command is a usage error', () => {
    const h = est(['help']);
    expect(h.code).toBe(0);
    for (const c of ['new', 'validate', 'pack', 'test', 'doctor', 'inspect', 'dev', 'keygen', 'sign', 'publish', 'login', 'yank']) expect(h.out).toMatch(new RegExp(`^  ${c}\\s`, 'm'));
    expect(est(['help', 'validate']).out).toMatch(/est validate \[dir \| file\.est\]/);
    // 1.322: yank needs <id>@<version> (a usage error), and publish <file.est> needs est login first.
    expect(est(['yank'])).toMatchObject({ code: 2 });
    expect(est(['publish', 'nothing.est', '--to', 'http://127.0.0.1:9']).code).toBe(1);
    // Without a key, publish refuses (never a default key).
    expect(est(['publish']).code).toBe(1);
    expect(est(['--version']).out.trim()).toMatch(/^\d+\.\d+\.\d+$/);
    // 1.319 (DEV-A §4): `est version` names the oldest Cyber the kit's bundles are for.
    expect(est(['version']).out.trim()).toMatch(/^est \d+\.\d+\.\d+ \(EST 1\.0, for Cyber 1\.\d+\.\d+ or newer\)$/);
  });

  it('1.686: est release is the owner\'s (listed apart), runs scripts/est-release.mjs, and reads an empty content store as nothing live', () => {
    const h = est(['help']).out;
    const ownerPart = h.slice(h.indexOf("Cyber's own registry"));
    expect(ownerPart).toMatch(/^ {2}release\s+build, verify, sign, push, status or revert/m);
    expect(h.slice(0, h.indexOf("Cyber's own registry"))).not.toMatch(/^ {2}release\s/m);
    expect(est(['help', 'release']).out).toMatch(/est release push\s+\[--dry-run\]/);
    expect(est(['release']).code).toBe(2);
    const bucket = join(tmp, 'release-bucket');
    mkdirSync(bucket, { recursive: true });
    // Any Ed25519 public key will do for an empty store: nothing is there to verify.
    const r = est(['release', 'status', '--to', bucket, '--public-key', 'MCowBQYDK2VwAyEAGb9ECWmEzf6FQbrBZ9w7lshQhqowtrbLDFw4rXAxZuE=']);
    expect(r.out + r.err).toMatch(/Nothing is live yet/);
    expect(r.code).toBe(0);
    expect(est(['release', 'nonsense', '--to', bucket]).code).toBe(2);
  }, 60_000);

  it("a template's .gitignore, packed as _gitignore (npm never packs .gitignore), comes back under its own name", () => {
    const templatesDir = join(tmp, 'packed-templates');
    mkdirSync(join(templatesDir, 'mini'), { recursive: true });
    writeFileSync(join(templatesDir, 'mini', 'est.json'), JSON.stringify({ id: 'org.example.mini', name: 'Mini' }));
    writeFileSync(join(templatesDir, 'mini', '_gitignore'), 'build/\n');
    const r = scaffold({ template: 'mini', dest: join(tmp, 'from-packed'), templatesDir, id: 'com.example.from-packed' });
    expect(readFileSync(join(r.dir, '.gitignore'), 'utf8')).toBe('build/\n');
    expect(existsSync(join(r.dir, '_gitignore'))).toBe(false);
  });

  it('parses flags: values, booleans, --a=b, -h and --', () => {
    expect(parseArgs(['x', '--id', 'a.b', '--json', '--name=N', '-h', '--', '--y'], ['id'])).toEqual({ positional: ['x', '--y'], flags: { id: 'a.b', json: true, name: 'N', help: true } });
    expect(() => parseArgs(['--id'], ['id'])).toThrow(UsageError);
  });
});

describe('a plugin\'s source packed as a .est (1.909)', () => {
  it('est validate refuses it under EST-B017 with Cyber\'s sentence, and est pack says what it is and what to do', async () => {
    const { pyZip } = await import('../../../testing/sourceEstZip');
    const { SOURCE_EST_WORDS } = await import('../../../../shared/estSourceEst.mjs');
    const d = mkdtempSync(join(tmp, 'source-est-'));
    const file = join(d, 'glow.est');
    writeFileSync(file, pyZip({ 'est.json': '{ "id": "com.example.glow" }', 'assembly/index.ts': 'import { Effect } from "est";' }, { deflate: true }));
    const v = est(['validate', '--json', file], d);
    expect(v.code).toBe(1);
    const report = JSON.parse(v.out) as { checks: { rule: string; status: string; message: string }[] };
    const failed = report.checks.find(c => c.status === 'fail');
    expect(failed?.rule).toBe('EST-B017');
    expect(failed?.message).toContain(SOURCE_EST_WORDS);
    const p = est(['pack', file], d);
    expect(p.code).not.toBe(0);
    expect(`${p.out}${p.err}`).toContain(SOURCE_EST_WORDS);
    expect(`${p.out}${p.err}`).toMatch(/unzip glow\.est into a folder and run `est pack`/);
  }, 120_000);
});
