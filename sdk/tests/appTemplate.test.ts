/**
 * R-D (1.335): the window as an app. `est new <instrument-*|effect-*> <dir> --app` adds `ui-app/`
 * (sdk/docs/ui.md, "A whole app as the window") and a root package.json whose `build:ui` writes
 * `ui/`; built with Vite (here the repository's own, as a developer without the network would),
 * the folder passes `est validate`, the EST-U rules included. And the rule the scaffold exists for,
 * EST-U005: its broken fixture fails with it and nothing else.
 */
import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { scaffold } from '../packages/cli/src/scaffold';
import { validate } from '../packages/tools/src/index';
import { BROKEN, packFixture } from '../fixtures/broken/index.mjs';
import { packFields, unpackFields } from '../templates/instrument-as/ui-app/bits';
import { repo } from './helpers';

const APP_TEMPLATES = ['instrument-as', 'instrument-rust', 'effect-as', 'effect-rust'];
const tmp = mkdtempSync(join(tmpdir(), 'est-app-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));
const VITE = repo('node_modules/vite/bin/vite.js');
const TSC = repo('node_modules/typescript/bin/tsc');

/** The template's own id: the built module in sdk/fixtures/templates/ names it, so a folder that keeps it validates against that module. */
const idOf = (template: string) => (JSON.parse(readFileSync(repo(`sdk/templates/${template}/est.json`), 'utf8')) as { id: string }).id;
const make = (template: string, dir: string, opts: { app?: boolean; ui?: boolean; id?: string } = { app: true }) => scaffold({
  template, dest: join(tmp, dir), id: `com.example.${dir}`, name: `App ${dir}`, templatesDir: repo('sdk/templates'),
  extras: [repo('sdk/packages/ui/est-ui.d.ts')], ...opts,
});
const buildUi = (dir: string) => spawnSync(process.execPath, [VITE, 'build', '--config', 'ui-app/vite.config.ts'], { cwd: dir, encoding: 'utf8', timeout: 120_000 });
const uiChecks = async (dir: string, template: string) => {
  const v = await validate({ dir }, { module: repo(`sdk/fixtures/templates/${template}.wasm`) });
  return { v, failed: v.checks.filter(c => c.status === 'fail' || (c.status === 'warn' && c.rule !== 'EST-P001')).map(c => `${c.rule}: ${c.message}`) };
};

describe('est new --app', () => {
  it('the four templates carry the same ui-app/, but for the page\'s title (their own name, which est new renames)', () => {
    const base = repo('sdk/templates/instrument-as/ui-app');
    const names = readdirSync(base).sort();
    expect(names).toEqual(['bits.ts', 'bridge.ts', 'engine.ts', 'env.d.ts', 'fonts.ts', 'index.html', 'main.ts', 'package.json', 'store.ts', 'style.css', 'tsconfig.json', 'vite.config.ts']);
    for (const t of APP_TEMPLATES) {
      const dir = repo(`sdk/templates/${t}/ui-app`);
      expect(readdirSync(dir).sort(), t).toEqual(names);
      const name = (JSON.parse(readFileSync(repo(`sdk/templates/${t}/est.json`), 'utf8')) as { name: string }).name;
      for (const f of names) {
        const text = readFileSync(join(dir, f), 'utf8');
        if (f === 'index.html') expect(text, t).toContain(`<title>${name}</title>`);
        else expect(text, `${t}/${f}`).toBe(readFileSync(join(base, f), 'utf8'));
      }
      expect(readFileSync(repo(`sdk/templates/${t}/AGENTS.md`), 'utf8'), t).toContain('## The window as an app');
    }
  });

  it('adds ui-app/, a root package.json with build:ui, node_modules/ in .gitignore and est.json\'s ui entry; without --app none of it', () => {
    const r = make('instrument-as', 'appinst');
    expect(r.app).toBe(true);
    const dir = r.dir;
    expect(existsSync(join(dir, 'ui-app', 'package.json'))).toBe(false);
    const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as { scripts: Record<string, string>; devDependencies: Record<string, string> };
    expect(pkg.scripts['build:ui']).toBe('vite build --config ui-app/vite.config.ts');
    expect(pkg.devDependencies.vite).toMatch(/^\d+\.\d+\.\d+$/);
    expect(readFileSync(join(dir, '.gitignore'), 'utf8')).toMatch(/^node_modules\/$/m);
    expect(readFileSync(join(dir, 'ui-app', 'index.html'), 'utf8')).toContain('<title>App appinst</title>');
    const m = JSON.parse(readFileSync(join(dir, 'est.json'), 'utf8')) as { ui: unknown };
    expect(m.ui).toEqual({ path: 'ui/index.html', size: { w: 560, h: 300 } });
    expect(existsSync(join(dir, 'ui'))).toBe(false);

    const plain = make('instrument-as', 'plaininst', {});
    for (const f of ['ui-app', 'package.json', 'ui']) expect(existsSync(join(plain.dir, f)), f).toBe(false);
    expect(() => make('effect-as', 'both', { app: true, ui: true })).toThrow(/choose one/);
    expect(() => make('visualiser-as', 'vis')).toThrow(/no app window/);
  });

  it('builds with Vite into one classic deferred script (no module script, crossorigin or modulepreload) and passes est validate, EST-U included', async () => {
    const { dir } = make('instrument-as', 'built', { app: true, id: idOf('instrument-as') });
    // The app's sources typecheck against the UI library's types.
    const tsc = spawnSync(process.execPath, [TSC, '-p', join(dir, 'ui-app', 'tsconfig.json')], { encoding: 'utf8', timeout: 120_000 });
    expect(tsc.status, tsc.stdout + tsc.stderr).toBe(0);
    const b = buildUi(dir);
    expect(b.status, b.stdout + b.stderr).toBe(0);
    expect(readdirSync(join(dir, 'ui')).sort()).toEqual(['assets', 'index.html']);
    expect(readdirSync(join(dir, 'ui', 'assets')).sort()).toEqual(['app.js', 'style.css']);
    const page = readFileSync(join(dir, 'ui', 'index.html'), 'utf8');
    expect(page).toMatch(/<script defer src="\.\/assets\/app\.js"><\/script>/);
    expect(page).toContain('<script src="est-ui.js"></script>');
    expect(page).not.toMatch(/type="module"|crossorigin|modulepreload/);
    // The bridge, not the stand-in: the build swapped the engine.
    const js = readFileSync(join(dir, 'ui', 'assets', 'app.js'), 'utf8');
    expect(js).toContain('EstUI.connect');
    expect(js).not.toContain(idOf('instrument-as')); // the stand-in reads est.json; the bridge does not
    expect(js).not.toMatch(/^\s*(import|export)\s/m);
    const { v, failed } = await uiChecks(dir, 'instrument-as');
    expect(failed).toEqual([]);
    expect(v.ok).toBe(true);
    for (const r of ['EST-U001', 'EST-U002', 'EST-U003', 'EST-U004', 'EST-U005']) expect(v.checks.find(c => c.rule === r)?.status, r).toBe('pass');
  }, 180_000);

  it('carries fonts in the script and cuts external hosts: a ?base64 font, its @font-face and font file dropped, a URL string cut, a namespace kept', async () => {
    const { dir } = make('effect-as', 'fonts', { app: true, id: idOf('effect-as') });
    const fontBytes = Buffer.from('wOF2-test-font-bytes');
    mkdirSync(join(dir, 'ui-app', 'fonts'));
    writeFileSync(join(dir, 'ui-app', 'fonts', 'test.woff2'), fontBytes);
    appendFileSync(join(dir, 'ui-app', 'main.ts'), [
      '',
      "import testFont from './fonts/test.woff2?base64';",
      "import { registerFonts } from './fonts';",
      "void registerFonts([{ family: 'Test', data: testFont }]);",
      "const help = 'https://react.dev/errors/' + String(document.title.length);",
      "const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');",
      'console.debug(help, svg);',
      '',
    ].join('\n'));
    appendFileSync(join(dir, 'ui-app', 'style.css'), "\n/*! a banner https://tailwindcss.com */\n@font-face { font-family: Test; src: url('./fonts/test.woff2') format('woff2'); }\nbody { font-family: Test, system-ui; }\n");
    const b = buildUi(dir);
    expect(b.status, b.stdout + b.stderr).toBe(0);
    expect(b.stdout + b.stderr).toMatch(/cut the external URL https:\/\/react\.dev\/errors\//);
    expect(readdirSync(join(dir, 'ui', 'assets')).sort()).toEqual(['app.js', 'style.css']);
    const js = readFileSync(join(dir, 'ui', 'assets', 'app.js'), 'utf8');
    const css = readFileSync(join(dir, 'ui', 'assets', 'style.css'), 'utf8');
    expect(js).toContain(fontBytes.toString('base64'));
    expect(js).not.toContain('react.dev');
    expect(js).toContain('http://www.w3.org/2000/svg');
    expect(css).not.toMatch(/@font-face|tailwindcss/);
    expect(css).toContain('Test');
    const { failed } = await uiChecks(dir, 'effect-as');
    expect(failed).toEqual([]);
  }, 180_000);

  it('bits.ts packs whole numbers below 2^53 exactly: five 10-bit steps in one value, and back', () => {
    const steps = [1023, 0, 512, 7, 999];
    const v = packFields(steps, 10);
    expect(v).toBeLessThan(2 ** 53);
    expect(unpackFields(v, 10, 5)).toEqual(steps);
    expect(unpackFields(packFields([1, 1, 1, 1, 1], 10), 10, 5)).toEqual([1, 1, 1, 1, 1]);
    expect(() => packFields([0, 0, 0, 0, 0, 0], 10)).toThrow(RangeError);
    expect(() => packFields([1024], 10)).toThrow(RangeError);
  });
});

describe('EST-U005 (1.335)', () => {
  it('the broken fixture ui-module-script fails EST-U005 and nothing else, and installs (a validator-only rule)', async () => {
    const f = BROKEN.find(x => x.name === 'ui-module-script')!;
    expect(f).toMatchObject({ rule: 'EST-U005', install: false });
    const v = await validate(packFixture(f).bytes, { seconds: 2 });
    expect(v.ok).toBe(false);
    const failing = v.checks.filter(c => c.status === 'fail');
    expect([...new Set(failing.map(c => c.rule))]).toEqual(['EST-U005']);
    expect(failing).toHaveLength(2); // the module script (with its crossorigin) and the module preload
    expect(failing.map(c => c.message).join('\n')).toMatch(/a module script[\s\S]*a module preload|a module preload[\s\S]*a module script/);
    expect(failing[0]!.fix).toMatch(/classic script/);
    expect(v.checks.filter(c => c.status === 'warn' && c.rule !== 'EST-P001')).toEqual([]);
  }, 60_000);
});
