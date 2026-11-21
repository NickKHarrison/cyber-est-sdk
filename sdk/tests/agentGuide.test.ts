/**
 * 1.880: **the EST agent guide proves itself.** `sdk/docs/EST_AGENT_GUIDE.md` is the one file a person
 * drags into their AI coding agent. Its three `<!-- guide:run … -->` blocks (an effect, an instrument, an
 * effect with an app window) are followed here line by line from a clean folder, as an agent would, and
 * each ends with `est validate` passing and `est test` passing:
 *
 * - `npx @cyber-est/cli@<v> <args>` and `npx est <args>` run this repository's `est` in this process (the
 *   kit's source, which the published kit was built from), after checking `<v>` is the published version;
 * - `npm install --save-dev --save-exact @cyber-est/cli@<v>` records the pin as npm would (offline: the
 *   repository's own packages stand in for the download);
 * - a bare `npm install` is the repository's own `node_modules`, and `npm run build:ui` runs the folder's
 *   own script with the repository's Vite (as sdk/tests/appTemplate.test.ts does).
 *
 * A line the test does not know is a failure: the guide may only say what this test can follow.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import newCommand from '../packages/cli/src/commands/new';
import packCommand from '../packages/cli/src/commands/pack';
import testCommand from '../packages/cli/src/commands/test';
import validateCommand from '../packages/cli/src/commands/validate';
import { main } from '../packages/cli/src/main';
import { repo } from './helpers';

const GUIDE = readFileSync(repo('sdk/docs/EST_AGENT_GUIDE.md'), 'utf8');
const KIT = JSON.parse(readFileSync(repo('sdk/agents/published-kit.json'), 'utf8')) as { package: string; version: string };
const COMMANDS = [newCommand, packCommand, testCommand, validateCommand];
const VITE = repo('node_modules/vite/bin/vite.js');
const tmp = mkdtempSync(join(tmpdir(), 'est-agent-guide-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

/** The guide's runnable blocks, by name. */
function runBlocks(): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const m of GUIDE.matchAll(/<!-- guide:run ([a-z]+) -->\n```sh\n([\s\S]*?)```/g)) out.set(m[1]!, m[2]!.trim().split('\n'));
  return out;
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');

/** Follows one block from a clean folder; the log of what ran. */
async function follow(name: string, lines: string[]) {
  const home = join(tmp, name);
  rmSync(home, { recursive: true, force: true });
  let cwd = home;
  const log: string[] = [];
  const { mkdirSync } = await import('node:fs');
  mkdirSync(home, { recursive: true });
  const pinned = new RegExp(`^npx ${esc(KIT.package)}@(\\S+) (.+)$`);
  const pin = new RegExp(`^npm install --save-dev --save-exact ${esc(KIT.package)}@(\\S+)$`);
  for (const line of lines) {
    let m: RegExpExecArray | null;
    const est = async (args: string[]) => {
      let out = '';
      const code = await main(COMMANDS, args, { cwd, out: t => { out += `${t}\n`; }, err: t => { out += `${t}\n`; } });
      log.push(`$ ${line}\n${out}`);
      expect(code, `${line}\n${out}`).toBe(0);
    };
    if ((m = pinned.exec(line))) {
      expect(m[1], line).toBe(KIT.version);
      await est(m[2]!.split(/\s+/));
    } else if ((m = /^cd (\S+)$/.exec(line))) {
      cwd = join(cwd, m[1]!);
      expect(existsSync(cwd), line).toBe(true);
    } else if ((m = pin.exec(line))) {
      expect(m[1], line).toBe(KIT.version);
      const file = join(cwd, 'package.json');
      const pkg = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) as { devDependencies?: Record<string, string> } : {};
      pkg.devDependencies = { ...pkg.devDependencies, [KIT.package]: m[1]! };
      writeFileSync(file, `${JSON.stringify(pkg, null, 2)}\n`);
    } else if (line === 'npm install') {
      expect(existsSync(join(cwd, 'package.json')), line).toBe(true);
    } else if (line === 'npm run build:ui') {
      const pkg = JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf8')) as { scripts: Record<string, string> };
      const script = pkg.scripts['build:ui']!;
      expect(script, 'the folder has npm run build:ui').toMatch(/^vite build/);
      const r = spawnSync(process.execPath, [VITE, ...script.split(/\s+/).slice(1)], { cwd, encoding: 'utf8', timeout: 120_000 });
      expect(r.status, r.stderr || r.stdout).toBe(0);
    } else if ((m = /^npx est (.+)$/.exec(line))) {
      await est(m[1]!.split(/\s+/));
    } else {
      throw new Error(`the guide's "${name}" block has a line this test cannot follow: ${line}`);
    }
  }
  return { dir: cwd, log };
}

describe('the EST agent guide, followed from a clean folder', () => {
  const blocks = runBlocks();

  it('has the three runnable blocks, each making a folder, installing the published kit, validating and testing', () => {
    expect([...blocks.keys()]).toEqual(['effect', 'instrument', 'app']);
    for (const [name, lines] of blocks) {
      expect(lines[0], name).toMatch(new RegExp(`^npx ${esc(KIT.package)}@${esc(KIT.version)} new `));
      expect(lines, name).toContain(`npm install --save-dev --save-exact ${KIT.package}@${KIT.version}`);
      expect(lines.slice(-2), name).toEqual(['npx est validate', 'npx est test']);
    }
  });

  for (const [name, kind] of [['effect', 'effect'], ['instrument', 'instrument'], ['app', 'effect']] as const) {
    it(`the ${name} block ends with est validate passing and est test passing`, async () => {
      const lines = blocks.get(name);
      expect(lines, name).toBeTruthy();
      const { dir, log } = await follow(name, lines!);
      const v = JSON.parse(readFileSync(join(dir, 'dist', 'validation.json'), 'utf8')) as { ok: boolean; plugin: { kind: string }; checks: { rule: string; status: string; message: string }[] };
      expect(v.checks.filter(c => c.status === 'fail'), log.join('\n')).toEqual([]);
      expect(v.ok).toBe(true);
      expect(v.plugin.kind).toBe(kind);
      const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as { devDependencies: Record<string, string> };
      expect(pkg.devDependencies[KIT.package]).toBe(KIT.version);
      if (name === 'app') expect(existsSync(join(dir, 'ui', 'index.html'))).toBe(true);
    }, 300_000);
  }
});
