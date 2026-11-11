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
  const made = est(['new', template, dir, '--id', `com.example.${template}`, '--name', `Trial ${template}`]);
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
  // Only a template with its own page (the visualiser) has ui/ without --ui.
  expect(existsSync(join(dir, 'ui'))).toBe(existsSync(join(TEMPLATES, template, 'ui')));
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
  it('has the cookbook\'s ten recipes to run', () => { expect(recipes).toHaveLength(10); });
  for (const t of recipes) it(`the cookbook's ${t} (AssemblyScript)`, () => scaffoldPackValidate(t), 240_000);
  for (const t of rustTemplates) it.skipIf(!rust)(`${t} (Rust; skipped where cargo or the wasm32-unknown-unknown target is missing)`, () => scaffoldPackValidate(t), 240_000);

  it('--ui adds the template\'s example UI (ui/index.html, ui.js, style.css: @cyber-est/ui knobs on its parameters) and it passes EST-U', () => {
    const t = asTemplates.find(x => x.startsWith('effect')) ?? 'effect-as';
    const dir = join(tmp, 'with-ui');
    const made = est(['new', t, dir, '--id', 'com.example.knobs', '--name', 'Knobs', '--ui']);
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

  it('refuses a bad id, an unknown template and a folder that is not empty', () => {
    expect(est(['new', 'instrument-as', join(tmp, 'bad-id'), '--id', 'Not An Id'])).toMatchObject({ code: 1 });
    const unknown = est(['new', 'no-such', join(tmp, 'x')]);
    expect(unknown.code).toBe(1);
    expect(unknown.err).toMatch(/no template "no-such" \(the templates: .*instrument-as/);
    mkdirSync(join(tmp, 'full'));
    writeFileSync(join(tmp, 'full', 'a.txt'), 'x');
    expect(est(['new', 'instrument-as', join(tmp, 'full')]).err).toMatch(/is not empty/);
    expect(est(['new', 'instrument-as'])).toMatchObject({ code: 2 });
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
      expect(v.code, `${f.name}: ${v.err}`).toBe(1);
      const report = JSON.parse(v.out) as { ok: boolean; checks: { rule: string; status: string }[] };
      expect(report.ok).toBe(false);
      got[f.name] = report.checks.find(c => c.status === 'fail' && c.rule === f.rule)?.rule ?? null;
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
    expect(est(['new', t, dir]).code).toBe(0);
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
