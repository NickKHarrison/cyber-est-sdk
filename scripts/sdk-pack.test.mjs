/**
 * 1.319 (DEV-A, EST-16): the EST SDK packages' rules, without building them. The tarball checker
 * (`sdk-pack-check.mjs`) on hand-made packages, one broken rule each; the package build's helpers
 * (`sdk-build.mjs`); the publish script's guard (`sdk-publish.mjs`: CI only, trusted publishing
 * only, and since 1.403 (L13) only in the kit's public repository on a version tag); and the source manifests (the published names, exact pins, no
 * scripts, `private` kept in the source). The packed dev host is `sdk/devhost/packed.test.mjs`;
 * the whole path, installed into an empty folder, is `scripts/sdk-smoke.sh` (CI's `build` job).
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { CLONE_ONLY, commandFiles, developerFiles, entrySource } from '../sdk/packages/cli/entry.mjs';
import { CLI_DOCS, CLI_GUIDE, checkExternals, KIT_DOCS_URL, packageDirOf, packageOf, packedDoc, PACKAGES, REPO, SWAPS, thirdPartyLicenses } from './sdk-build.mjs';
import { checkUnpacked, specifiersOf } from './sdk-pack-check.mjs';
import { PUBLIC_REPO, publishRefusal, PUBLISH_WORKFLOW, sumsOf, tagRefusal, verifiedTarballs } from './sdk-publish.mjs';

/**
 * The publish workflow's file: at its own path in the public repository (1.403, L13), and under
 * scripts/sdk-mirror/ in Cyber's, from where scripts/sdk-export.mjs writes it.
 */
const WORKFLOW_FILE = existsSync(join(REPO, PUBLISH_WORKFLOW)) ? join(REPO, PUBLISH_WORKFLOW) : join(REPO, 'scripts', 'sdk-mirror', PUBLISH_WORKFLOW);

// The constants read from the TypeScript source as text (this plain-Node file never imports it).
const constant = (file, name) => new RegExp(`export const ${name} = '([^']+)'`).exec(readFileSync(join(REPO, file), 'utf8'))?.[1];
const TOOL_VERSION = constant('sdk/packages/tools/src/validate.ts', 'TOOL_VERSION');
const CYBER_TARGET = constant('sdk/packages/cli/src/main.ts', 'CYBER_TARGET');
const CLI_IS_TOOLS = /export const CLI_VERSION = TOOL_VERSION;/.test(readFileSync(join(REPO, 'sdk/packages/cli/src/main.ts'), 'utf8'));

const tmp = mkdtempSync(join(tmpdir(), 'sdk-pack-test-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

let n = 0;
/** A package folder: its manifest and files. */
function pkg(manifest, files) {
  const root = join(tmp, `p${n++}`);
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: '@cyber-est/x', version: '0.1.0', files: ['dist', 'README.md'], ...manifest }));
  for (const [f, text] of Object.entries({ 'README.md': '# x', ...files })) {
    mkdirSync(dirname(join(root, f)), { recursive: true });
    writeFileSync(join(root, f), text);
  }
  return root;
}
const good = { 'dist/index.mjs': 'import { a } from "node:fs";\nimport b from "binaryen";\nimport "./more.mjs";\nconst u = new URL("../assets/x.json", import.meta.url);\n', 'dist/more.mjs': '', 'assets/x.json': '{}' };
const goodManifest = { files: ['dist', 'assets', 'README.md'], dependencies: { binaryen: '132.0.0' } };

describe('sdk-pack-check: a tarball holds only what it should', () => {
  it('passes a self-contained package', () => {
    expect(checkUnpacked(pkg(goodManifest, good), { machinePaths: [] })).toEqual([]);
  });

  it('refuses a file outside "files", and one staged but dropped', () => {
    const root = pkg(goodManifest, { ...good, 'notes.txt': 'x' });
    expect(checkUnpacked(root, { machinePaths: [] })).toEqual(['@cyber-est/x: notes.txt is not under "files"']);
    const staged = pkg(goodManifest, { ...good, 'dist/lost.mjs': '' });
    expect(checkUnpacked(pkg(goodManifest, good), { staged, machinePaths: [] })).toEqual(['@cyber-est/x: dist/lost.mjs was staged but is not in the tarball (npm dropped it)']);
  });

  it('refuses TypeScript source, but not declarations or the AssemblyScript a plugin compiles', () => {
    const root = pkg(goodManifest, { ...good, 'dist/index.ts': '', 'dist/index.d.ts': '', 'assets/sdk/templates/effect-as/assembly/index.ts': '', 'assets/sdk/as/est/index.ts': '' });
    expect(checkUnpacked(root, { machinePaths: [] })).toEqual(['@cyber-est/x: dist/index.ts is TypeScript source']);
  });

  it('refuses a range, a dev dependency, private, and any scripts (install hooks named)', () => {
    const root = pkg({ ...goodManifest, dependencies: { binaryen: '^132.0.0' }, peerDependencies: { '@playwright/test': '~1.56.1' }, devDependencies: { x: '1.0.0' }, private: true, scripts: { postinstall: 'node x', build: 'y' } }, good);
    expect(checkUnpacked(root, { machinePaths: [] })).toEqual([
      '@cyber-est/x: dependencies.binaryen is "^132.0.0", not an exact version',
      '@cyber-est/x: peerDependencies.@playwright/test is "~1.56.1", not an exact version',
      '@cyber-est/x: declares devDependencies',
      '@cyber-est/x: is private',
      '@cyber-est/x: declares install scripts: postinstall',
    ]);
    expect(checkUnpacked(pkg({ ...goodManifest, scripts: { test: 'x' } }, good), { machinePaths: [] })).toEqual(['@cyber-est/x: declares scripts']);
  });

  it('refuses an import from outside: an undeclared package, a path out of the folder, a missing file, a URL out', () => {
    const root = pkg(goodManifest, {
      ...good,
      'dist/bad.mjs': 'import x from "esbuild";\nimport y from "../../src/audio/est/slot.ts";\nconst z = await import("./gone.mjs");\nconst u = new URL("../../../sdk/templates", import.meta.url);\nimport self from "@cyber-est/x/dist/more.mjs";\n',
    });
    expect(checkUnpacked(root, { machinePaths: [] })).toEqual([
      '@cyber-est/x: dist/bad.mjs imports esbuild, which is not a declared dependency',
      '@cyber-est/x: dist/bad.mjs imports ../../src/audio/est/slot.ts, outside the package',
      '@cyber-est/x: dist/bad.mjs imports ./gone.mjs, which the package does not hold',
      '@cyber-est/x: dist/bad.mjs reads ../../../sdk/templates, outside the package',
    ]);
  });

  it("refuses the build machine's path (a baked import.meta.url)", () => {
    const root = pkg(goodManifest, { ...good, 'dist/baked.mjs': `const here = "file://${REPO}/sdk/packages/tools/src/index.ts";\n` });
    expect(checkUnpacked(root)).toEqual([
      `@cyber-est/x: dist/baked.mjs contains the build machine's path ${REPO}`,
      '@cyber-est/x: dist/baked.mjs contains a file:/// URL',
    ]);
  });

  it('reads the specifiers esbuild writes', () => {
    expect(specifiersOf('import{a}from"node:fs";import("x/y");import "./z.mjs";require("w");new URL("./q", import.meta.url)')).toEqual({ imports: ['node:fs', 'x/y', './z.mjs', 'w'], urls: ['./q'] });
  });
});

describe('sdk-build: the helpers', () => {
  it('names the package a specifier imports, and refuses an undeclared one', () => {
    expect(packageOf('@cyber-est/ui/copy-rule')).toBe('@cyber-est/ui');
    expect(packageOf('binaryen')).toBe('binaryen');
    expect(() => checkExternals(['node:fs', 'fs', 'binaryen', '@playwright/test'], { name: 'p', dependencies: { binaryen: '1.0.0' }, peerDependencies: { '@playwright/test': '1.0.0' } }, 'p')).not.toThrow();
    expect(() => checkExternals(['vite'], { name: 'p' }, 'the dev host')).toThrow(/the dev host imports vite, which p does not declare/);
  });

  it('swaps only modules that have a .package.mjs sibling', () => {
    for (const s of SWAPS) expect(readFileSync(join(REPO, s.replace(/\.mjs$/, '.package.mjs')), 'utf8')).toMatch(/scripts\/sdk-build\.mjs/);
  });

  it("leaves Cyber's registry commands out of the published CLI", () => {
    expect(CLONE_ONLY).toEqual(['keygen', 'sign', 'publish']);
    const all = commandFiles(join(REPO, PACKAGES.cli.dir));
    const shipped = commandFiles(join(REPO, PACKAGES.cli.dir), { exclude: [...CLONE_ONLY] });
    expect(all.filter(f => !shipped.includes(f)).sort()).toEqual(['keygen.ts', 'publish.ts', 'sign.ts']);
    expect(shipped).toEqual(expect.arrayContaining(['dev.ts', 'doctor.ts', 'new.ts', 'pack.ts', 'validate.ts']));
  });

  it('1.322 (DEV-C follow-up): packs the developer versions of those three in their place', () => {
    const pkg = join(REPO, PACKAGES.cli.dir);
    expect(developerFiles(pkg)).toEqual(['keygen.ts', 'publish.ts', 'sign.ts']);
    const entry = entrySource(pkg, { exclude: [...CLONE_ONLY], developer: true });
    for (const c of CLONE_ONLY) {
      expect(entry).toContain(`'./src/developer/${c}.ts'`);
      expect(entry).not.toContain(`'./src/commands/${c}.ts'`);
    }
    // The clone's own entry keeps the owner's commands and adds no developer copies.
    const clone = entrySource(pkg);
    for (const c of CLONE_ONLY) expect(clone).toContain(`'./src/commands/${c}.ts'`);
    expect(clone).not.toContain('./src/developer/');
    expect(readFileSync(join(REPO, 'scripts/sdk-build.mjs'), 'utf8')).toMatch(/entrySource\(cliSrc, \{ exclude: CLONE_ONLY, developer: true \}\)/);
  });
});

describe('sdk-publish --from: only the three tarballs SHA256SUMS lists, with their hashes', () => {
  const dir = (files) => {
    const d = join(tmp, `from${n++}`);
    mkdirSync(d, { recursive: true });
    for (const [f, text] of Object.entries(files)) writeFileSync(join(d, f), text);
    return d;
  };
  const three = { 'cyber-est-tools-0.1.0.tgz': 't', 'cyber-est-ui-0.1.0.tgz': 'u', 'cyber-est-cli-0.1.0.tgz': 'c' };
  const withSums = (files, edit = (x) => x) => {
    const d = dir(files);
    writeFileSync(join(d, 'SHA256SUMS'), edit(sumsOf(Object.keys(files).map(f => join(d, f)))));
    return d;
  };

  it('returns them in publish order when everything matches', () => {
    expect(verifiedTarballs(withSums(three)).map(f => f.split('/').pop())).toEqual(['cyber-est-tools-0.1.0.tgz', 'cyber-est-ui-0.1.0.tgz', 'cyber-est-cli-0.1.0.tgz']);
  });

  it('refuses a changed tarball, a missing list, an extra or unlisted tarball, a missing one', () => {
    const d = withSums(three);
    writeFileSync(join(d, 'cyber-est-cli-0.1.0.tgz'), 'changed');
    expect(() => verifiedTarballs(d)).toThrow(/cyber-est-cli-0\.1\.0\.tgz does not have the hash/);
    expect(() => verifiedTarballs(dir(three))).toThrow(/no SHA256SUMS/);
    expect(() => verifiedTarballs(withSums({ ...three, 'cyber-est-cli-0.2.0.tgz': 'x' }))).toThrow(/lists 4 tarballs|one tarball for @cyber-est\/cli/);
    const extra = withSums(three);
    writeFileSync(join(extra, 'evil-1.0.0.tgz'), 'x');
    expect(() => verifiedTarballs(extra)).toThrow(/not in SHA256SUMS: evil-1\.0\.0\.tgz/);
    const two = Object.fromEntries(Object.entries(three).filter(([f]) => !f.startsWith('cyber-est-ui-')));
    expect(() => verifiedTarballs(withSums(two))).toThrow(/lists 2 tarballs/);
    expect(() => verifiedTarballs(withSums(three, t => `${t}garbage line\n`))).toThrow(/cannot read/);
  });
});

describe('THIRD_PARTY_LICENSES.md', () => {
  it('names each bundled package once, with its version, licence and licence text', () => {
    const files = ['react/cjs/react.production.js', 'react/index.js', 'scheduler/index.js', 'binaryen/index.js'].map(f => join(REPO, 'node_modules', f));
    expect(packageDirOf(files[0])).toEqual({ name: 'react', dir: join(REPO, 'node_modules', 'react') });
    const text = thirdPartyLicenses(files);
    for (const name of ['binaryen', 'react', 'scheduler']) {
      const v = JSON.parse(readFileSync(join(REPO, 'node_modules', name, 'package.json'), 'utf8')).version;
      expect(text.match(new RegExp(`^## ${name} `, 'gm'))).toHaveLength(1);
      expect(text).toContain(`## ${name} ${v}`);
    }
    expect(text).toMatch(/Licence: Apache-2\.0/);
    expect(text).toMatch(/Licence: MIT/);
    expect(text).toMatch(/### LICENSE/);
  });
});

describe('the source manifests', () => {
  const manifests = Object.entries(PACKAGES).map(([key, p]) => [key, JSON.parse(readFileSync(join(REPO, p.dir, 'package.json'), 'utf8'))]);

  it('are the published names at one version, the CLI\'s and the tools\'', () => {
    expect(manifests.map(([, m]) => m.name).sort()).toEqual(['@cyber-est/cli', '@cyber-est/tools', '@cyber-est/ui']);
    for (const [, m] of manifests) expect(m.version).toBe(TOOL_VERSION);
    expect(TOOL_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
    expect(CLI_IS_TOOLS).toBe(true);
    expect(CYBER_TARGET).toMatch(/^1\.\d+\.\d+$/);
    expect(Number(String(CYBER_TARGET).split('.')[1])).toBeLessThanOrEqual(Number(JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf8')).version.split('.')[1]));
  });

  it('stay private in the source (only the staged copy is publishable), MIT, naming the public repository (npm checks it against the provenance)', () => {
    for (const [, m] of manifests) {
      expect(m.private).toBe(true);
      expect(m.license).toBe('MIT');
      expect(m.repository).toMatchObject({ type: 'git', url: `git+https://github.com/${PUBLIC_REPO}.git` });
      expect(m.homepage).toContain(`github.com/${PUBLIC_REPO}/`);
      expect(m.bugs?.url).toBe(`https://github.com/${PUBLIC_REPO}/issues`);
      expect(m.files).toEqual(expect.arrayContaining(['README.md', 'LICENSE']));
    }
  });

  it("carry the CLI's docs at its root: the guide, the prompt kit and the sharing guide, each named in its files (1.400, 1.434)", () => {
    const cli = JSON.parse(readFileSync(join(REPO, PACKAGES.cli.dir, 'package.json'), 'utf8'));
    expect(CLI_DOCS[0]).toBe(CLI_GUIDE);
    expect(CLI_DOCS).toEqual(['sdk/docs/BUILD_AN_EST_PLUGIN.md', 'sdk/docs/PROMPT_KIT.md', 'sdk/docs/SHARING.md']);
    const named = cli.files.filter((f) => f.endsWith('.md') && !['README.md', 'THIRD_PARTY_LICENSES.md'].includes(f));
    expect(named.sort()).toEqual(CLI_DOCS.map((d) => d.split('/').pop()).sort());
    for (const d of CLI_DOCS) expect(existsSync(join(REPO, d)), d).toBe(true);
  });

  // 1.440 (rc-est 17): a packed doc links no page the package does not carry.
  it('the packed docs link the public docs for every page the package does not carry', () => {
    expect(KIT_DOCS_URL).toBe(`https://github.com/${PUBLIC_REPO}/blob/main/sdk/docs/`);
    const packed = CLI_DOCS.map((d) => d.split('/').pop());
    for (const d of CLI_DOCS) {
      const out = packedDoc(readFileSync(join(REPO, d), 'utf8'));
      for (const m of out.matchAll(/\]\(([^)#:\s]+)(#[^)]*)?\)/g)) expect(packed, `${d}: ${m[1]}`).toContain(m[1]);
      for (const m of out.matchAll(new RegExp(`\\]\\(${KIT_DOCS_URL.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}([^)#]+)`, 'g'))) expect(existsSync(join(REPO, 'sdk', 'docs', m[1])), `${d}: ${m[1]}`).toBe(true);
    }
    expect(packedDoc('see [rules](validator-rules.md#est-w004) and [kit](PROMPT_KIT.md) and [x](https://e.org/a.md)')).toBe(`see [rules](${KIT_DOCS_URL}validator-rules.md#est-w004) and [kit](PROMPT_KIT.md) and [x](https://e.org/a.md)`);
  });

  it('pin every dependency exactly, to the version the clone tests with, and declare no install script', () => {
    const lock = JSON.parse(readFileSync(join(REPO, 'package-lock.json'), 'utf8'));
    for (const [, m] of manifests) {
      for (const field of ['dependencies', 'peerDependencies']) {
        for (const [dep, v] of Object.entries(m[field] ?? {})) {
          expect(v, `${m.name} ${dep}`).toMatch(/^\d+\.\d+\.\d+$/);
          expect(v, `${m.name} ${dep} is not the clone's`).toBe(lock.packages[`node_modules/${dep}`].version);
        }
      }
      for (const s of ['preinstall', 'install', 'postinstall', 'prepare', 'prepack']) expect(m.scripts?.[s], `${m.name} ${s}`).toBeUndefined();
    }
  });
});

describe('sdk-publish: only from CI, through trusted publishing, from the public repository on a version tag', () => {
  const ci = {
    GITHUB_ACTIONS: 'true',
    GITHUB_REPOSITORY: PUBLIC_REPO,
    GITHUB_WORKFLOW_REF: `${PUBLIC_REPO}/${PUBLISH_WORKFLOW}@refs/tags/v0.1.0`,
    GITHUB_REF: 'refs/tags/v0.1.0',
    ACTIONS_ID_TOKEN_REQUEST_URL: 'https://token.actions.example/x',
  };
  const facts = { npmVersion: '11.6.2', event: { repository: { private: false } } };

  it('allows the public repository\'s workflow on a version tag with an OIDC token', () => {
    expect(PUBLIC_REPO).toBe('NickKHarrison/cyber-est-sdk');
    expect(PUBLISH_WORKFLOW).toBe('.github/workflows/publish.yml');
    expect(publishRefusal(ci, facts)).toBeNull();
  });

  it("refuses Cyber's own repository, whatever else holds, and any other repository", () => {
    const cyber = { ...ci, GITHUB_REPOSITORY: 'NickKHarrison/cyber', GITHUB_WORKFLOW_REF: `NickKHarrison/cyber/${PUBLISH_WORKFLOW}@refs/tags/v0.1.0` };
    expect(publishRefusal(cyber, facts)).toMatch(/only in the kit's public repository NickKHarrison\/cyber-est-sdk.*never publishes/);
    expect(publishRefusal({ ...cyber, GITHUB_WORKFLOW_REF: `NickKHarrison/cyber/.github/workflows/sdk-publish.yml@refs/heads/main`, GITHUB_REF: 'refs/heads/main' }, facts)).toMatch(/public repository/);
    expect(publishRefusal({ ...ci, GITHUB_REPOSITORY: 'someone/cyber-est-sdk' }, facts)).toMatch(/public repository/);
    expect(publishRefusal({ ...ci, GITHUB_REPOSITORY: undefined }, facts)).toMatch(/no repository/);
    // A fork's workflow names its own repository, not the public one.
    expect(publishRefusal({ ...ci, GITHUB_WORKFLOW_REF: `someone/cyber-est-sdk/${PUBLISH_WORKFLOW}@refs/tags/v0.1.0` }, facts)).toMatch(/only from NickKHarrison\/cyber-est-sdk's/);
  });

  it('refuses a developer machine, another workflow or ref, no OIDC, a token, a private repository, an old npm', () => {
    expect(publishRefusal({}, facts)).toMatch(/only in GitHub Actions/);
    expect(publishRefusal({ ...ci, GITHUB_WORKFLOW_REF: `${PUBLIC_REPO}/.github/workflows/check.yml@refs/tags/v0.1.0` }, facts)).toMatch(/only from .*\.github\/workflows\/publish\.yml/);
    expect(publishRefusal({ ...ci, GITHUB_REF: 'refs/heads/main' }, facts)).toMatch(/version tag/);
    expect(publishRefusal({ ...ci, GITHUB_REF: 'refs/tags/v0.1' }, facts)).toMatch(/version tag/);
    expect(publishRefusal({ ...ci, GITHUB_REF: 'refs/tags/release' }, facts)).toMatch(/version tag/);
    expect(publishRefusal({ ...ci, ACTIONS_ID_TOKEN_REQUEST_URL: '' }, facts)).toMatch(/OIDC/);
    expect(publishRefusal({ ...ci, NODE_AUTH_TOKEN: 'x' }, facts)).toMatch(/NODE_AUTH_TOKEN is set/);
    expect(publishRefusal({ ...ci, NPM_TOKEN: 'x' }, facts)).toMatch(/NPM_TOKEN is set/);
    expect(publishRefusal(ci, { ...facts, event: { repository: { private: true } } })).toMatch(/private/);
    expect(publishRefusal(ci, { ...facts, event: null })).toMatch(/private/);
    expect(publishRefusal(ci, { ...facts, npmVersion: '10.9.2' })).toMatch(/too old/);
    expect(publishRefusal(ci, { ...facts, npmVersion: '11.5.0' })).toMatch(/too old/);
    expect(publishRefusal(ci, { ...facts, npmVersion: '11.5.1' })).toBeNull();
  });

  it('publishes only the version the tag names, which all three tarballs carry', () => {
    expect(tagRefusal('refs/tags/v0.1.0', ['0.1.0', '0.1.0', '0.1.0'])).toBeNull();
    expect(tagRefusal('refs/tags/v0.2.0', ['0.1.0', '0.1.0', '0.1.0'])).toMatch(/the tag is v0\.2\.0 but the tarballs are 0\.1\.0/);
    expect(tagRefusal('refs/tags/v0.1.0', ['0.1.0', '0.1.1', '0.1.0'])).toMatch(/0\.1\.0, 0\.1\.1/);
    expect(tagRefusal('refs/heads/main', ['0.1.0'])).toMatch(/not a version tag/);
  });

  it('the workflow runs only on a version tag, off until the owner turns it on, and holds no token', () => {
    const wf = readFileSync(WORKFLOW_FILE, 'utf8');
    expect(wf).toMatch(/^on:\n {2}push:\n {4}tags:\n {6}- 'v\*\.\*\.\*'\n\n/m);
    expect(wf).not.toMatch(/^\s+(pull_request|pull_request_target|schedule|release|workflow_run|workflow_dispatch|branches):/m);
    expect((wf.match(/if: vars\.EST_NPM_PUBLISH == 'on' && startsWith\(github\.ref, 'refs\/tags\/v'\)/g) ?? []).length).toBe(2);
    expect(wf).toMatch(/id-token: write/);
    expect(wf).not.toMatch(/secrets\.|NODE_AUTH_TOKEN:|registry-url:/);
    expect(wf).toMatch(/node scripts\/sdk-publish\.mjs --publish --from sdk-tarballs/);
  });

  it('pins every action to a full commit SHA and never persists the checkout\'s credentials', () => {
    const wf = readFileSync(WORKFLOW_FILE, 'utf8');
    const uses = [...wf.matchAll(/uses: (\S+)(.*)/g)];
    expect(uses.length).toBeGreaterThanOrEqual(5);
    for (const [, ref, rest] of uses) {
      expect(ref, ref).toMatch(/^[\w.-]+\/[\w.-]+@[0-9a-f]{40}$/);
      expect(rest, ref).toMatch(/^ # v\d+\.\d+\.\d+$/);
    }
    const checkouts = (wf.match(/uses: actions\/checkout@/g) ?? []).length;
    expect((wf.match(/persist-credentials: false/g) ?? []).length).toBe(checkouts);
  });

  it('builds without the OIDC token, and publishes with it while installing and building nothing', () => {
    const wf = readFileSync(WORKFLOW_FILE, 'utf8');
    const build = wf.slice(wf.indexOf('\n  build:\n'), wf.indexOf('\n  publish:\n'));
    const publish = wf.slice(wf.indexOf('\n  publish:\n'));
    expect(build).not.toMatch(/id-token/);
    expect(build).toMatch(/npm ci/);
    expect(build).toMatch(/--pack-only --out sdk-tarballs/);
    expect(build).toMatch(/upload-artifact/);
    expect(publish).toMatch(/needs: build/);
    expect(publish).toMatch(/environment: npm/);
    expect(publish).toMatch(/id-token: write/);
    expect(publish).toMatch(/download-artifact/);
    expect(publish).not.toMatch(/npm ci|npm install(?! --global --ignore-scripts npm@\d+\.\d+\.\d+)|sdk-build|vitest|sdk-smoke/);
  });
});

const here = fileURLToPath(import.meta.url);
it('this file is the one sdk-publish.mjs runs', () => {
  expect(readFileSync(join(dirname(here), 'sdk-publish.mjs'), 'utf8')).toContain("'scripts/sdk-pack.test.mjs'");
});
