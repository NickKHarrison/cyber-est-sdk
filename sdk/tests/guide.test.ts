/**
 * 1.400 (P3): `sdk/docs/BUILD_AN_EST_PLUGIN.md`, the first-plugin guide. Its code is tested code:
 * the effect-as template, scaffolded as the guide's step 1 does, with the guide's `assembly/index.ts`,
 * its est.json parameters and its golden events, builds with asc (a dev dependency), passes every
 * check Cyber's install runs and renders the same twice. The guide stays under 1500 words, the
 * kit's llms.txt points at it first, the README links it, and its rules name what the validator
 * says (EST-W004's `env.seed`, EST-C013's allocating in render()).
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { scaffold } from '../packages/cli/src/scaffold';
import { findAsc, readProject, render, validate, pack } from '../packages/tools/src/index';
import { repo } from './helpers';

const GUIDE = readFileSync(repo('sdk/docs/BUILD_AN_EST_PLUGIN.md'), 'utf8');
const blocks = (lang: string) => [...GUIDE.matchAll(new RegExp('```' + lang + '\\n([\\s\\S]*?)```', 'g'))].map(m => m[1]!);
const tmp = mkdtempSync(join(tmpdir(), 'est-guide-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

describe('the first-plugin guide', () => {
  it('is under 1500 words, first in llms.txt, linked from the README, with the assistant block', () => {
    expect(GUIDE.split(/\s+/).filter(Boolean).length).toBeLessThan(1500);
    const llms = readFileSync(repo('sdk/llms.txt'), 'utf8');
    const firstLink = /\]\(([^)]+)\)/.exec(llms.slice(llms.indexOf('## Docs')))?.[1];
    expect(firstLink).toBe('docs/BUILD_AN_EST_PLUGIN.md');
    expect(readFileSync(repo('sdk/README.md'), 'utf8')).toContain('(docs/BUILD_AN_EST_PLUGIN.md)');
    expect(GUIDE).toContain('## Paste this into your assistant');
    expect(GUIDE).toContain('npx @cyber-est/cli new effect-as my-fx');
    for (const rule of ['EST-W004', 'env.seed', 'EST-C013', 'allocating in render()', 'validator-rules.md']) expect(GUIDE).toContain(rule);
  });

  it("its effect builds from the template and passes every check Cyber's install runs", async () => {
    const dir = join(tmp, 'my-fx');
    scaffold({ template: 'effect-as', dest: dir, templatesDir: repo('sdk/templates'), id: 'com.example.my-fx', name: 'My FX' });
    const [source] = blocks('ts');
    writeFileSync(join(dir, 'assembly', 'index.ts'), source!);
    const json = blocks('json').map(b => JSON.parse(`{${b.trim().replace(/,$/, '')}}`) as Record<string, unknown>);
    const manifest = JSON.parse(readFileSync(join(dir, 'est.json'), 'utf8')) as Record<string, unknown>;
    writeFileSync(join(dir, 'est.json'), JSON.stringify({ ...manifest, ...json[0] }, null, 2));
    const golden = JSON.parse(readFileSync(join(dir, 'test', 'golden.json'), 'utf8')) as Record<string, unknown>;
    writeFileSync(join(dir, 'test', 'golden.json'), JSON.stringify({ ...golden, ...json[1] }, null, 2));
    const project = readProject(dir);
    const asc = findAsc(dir);
    expect(asc).toBeTruthy();
    const built = spawnSync(asc!, project.build!.args, { cwd: dir, encoding: 'utf8' });
    expect(built.status, built.stderr).toBe(0);
    const v = await validate({ dir }, { seconds: 2 });
    expect(v.checks.filter(c => c.status === 'fail'), JSON.stringify(v.checks.filter(c => c.status === 'fail'))).toEqual([]);
    expect(v.plugin).toMatchObject({ id: 'com.example.my-fx', name: 'My FX', kind: 'effect' });
    // The two knobs, as declared.
    expect(v.conformance?.params.map(p => p.name)).toEqual(['Drive', 'Output']);
    const bytes = pack(dir).bytes;
    const a = await render(bytes, { seconds: 0.2, input: { kind: 'sine', amp: 0.5 } });
    const b = await render(bytes, { seconds: 0.2, input: { kind: 'sine', amp: 0.5 } });
    expect(a.error).toBeNull();
    expect(Math.max(...a.left.map(Math.abs))).toBeGreaterThan(0.05);
    expect(a.left).toEqual(b.left);
  }, 120_000);
});
