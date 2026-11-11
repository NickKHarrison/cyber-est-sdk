/**
 * 1.434: `sdk/docs/PROMPT_KIT.md` and `sdk/docs/SHARING.md` name only what exists. Every `est`
 * command they name is one of the CLI's (the clone's commands, the published CLI's developer
 * versions, `help`), every `--flag` after one is in that command's source, every `new <name>` is a
 * template or a recipe, every rule id is in the rules table, the pinned kit version is the CLI's,
 * every relative link resolves; the prompt kit has a prompt per template family and per recipe, and
 * the README, llms.txt (after the guide) and the guide's last section link both.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { EST_RULES } from '../../src/audio/est/install/rules';
import { repo } from './helpers';

const DOCS = ['sdk/docs/PROMPT_KIT.md', 'sdk/docs/SHARING.md'] as const;
const text = (p: string) => readFileSync(repo(p), 'utf8');
const ts = (dir: string) => readdirSync(repo(dir)).filter(f => /\.ts$/.test(f) && !/\.test\.ts$/.test(f)).map(f => f.replace(/\.ts$/, ''));

const COMMANDS = new Set([...ts('sdk/packages/cli/src/commands'), ...ts('sdk/packages/cli/src/developer'), 'help']);
/** The source text a command's flags are read from. */
const sourceOf = (cmd: string): string => [
  `sdk/packages/cli/src/commands/${cmd}.ts`, `sdk/packages/cli/src/developer/${cmd}.ts`,
  ...(cmd === 'dev' ? ['sdk/devhost/cli/dev.mjs'] : []),
].filter(p => existsSync(repo(p))).map(text).join('\n');
const folders = (dir: string) => readdirSync(repo(dir)).filter(n => existsSync(repo(join(dir, n, 'est.json'))));
const STARTS = new Set([...folders('sdk/templates'), ...folders('sdk/cookbook')]);
const RULES = new Set(EST_RULES.map(r => r.id));
const CLI_VERSION = (JSON.parse(text('sdk/packages/cli/package.json')) as { version: string }).version;

/** Each `est <command> <rest of the line>` a doc names (`npx est`, `npx @cyber-est/cli`, or `est` in code). */
function commandsIn(md: string): { cmd: string; rest: string }[] {
  const out: { cmd: string; rest: string }[] = [];
  for (const m of md.matchAll(/(?:npx est|npx @cyber-est\/cli(?:@[\d.]+)?|`est) ([a-z][a-z-]*)([^\n`]*)/g)) out.push({ cmd: m[1]!, rest: m[2]! });
  return out;
}

describe('the prompt kit and the sharing guide name only what exists', () => {
  for (const doc of DOCS) {
    const md = text(doc);
    it(`${doc}: every command, flag and starting point is the CLI's`, () => {
      const found = commandsIn(md);
      expect(found.length, doc).toBeGreaterThan(doc.includes('PROMPT') ? 40 : 2);
      for (const { cmd, rest } of found) {
        expect(COMMANDS.has(cmd), `${doc}: est ${cmd}`).toBe(true);
        const src = sourceOf(cmd);
        for (const f of rest.matchAll(/(?<![\w-])--[a-z][a-z-]*/g)) expect(src.includes(`'${f[0]}`) || src.includes(`${f[0]} `) || src.includes(`${f[0]}\``), `${doc}: est ${cmd} ${f[0]}`).toBe(true);
        if (cmd === 'new') {
          const name = /^\s+([a-z][\w-]*)/.exec(rest)?.[1];
          if (name) expect(STARTS.has(name), `${doc}: est new ${name}`).toBe(true);
        }
      }
    });
    it(`${doc}: every rule id is in the rules table`, () => {
      for (const id of md.match(/EST-[A-Z]\d{3}/g) ?? []) expect(RULES.has(id), `${doc}: ${id}`).toBe(true);
    });
    it(`${doc}: the pinned kit version is the CLI's, and every relative link resolves`, () => {
      for (const v of md.matchAll(/@cyber-est\/cli@([\d.]+)/g)) expect(v[1], doc).toBe(CLI_VERSION);
      for (const l of md.matchAll(/\]\(([^)#:]+)(#[^)]*)?\)/g)) expect(existsSync(join(dirname(repo(doc)), l[1]!)), `${doc}: ${l[1]}`).toBe(true);
    });
  }

  it('a prompt for every template family and every recipe, each starting from est new and ending with est pack', () => {
    const md = text('sdk/docs/PROMPT_KIT.md');
    const families = new Set(folders('sdk/templates').map(n => n.replace(/-(as|rust)$/, '')));
    expect([...families].sort()).toEqual(['cpp-clap', 'effect', 'instrument', 'midi-effect', 'sampler', 'visualiser']);
    for (const f of families) expect(md, f).toMatch(new RegExp(`npx @cyber-est/cli new ${f === 'cpp-clap' ? f : `${f}-as`} `));
    for (const r of folders('sdk/cookbook')) {
      expect(md, r).toContain(`### ${r}\n`);
      expect(md, r).toContain(`npx @cyber-est/cli new ${r} `);
    }
    const prompts = [...md.matchAll(/```\n([\s\S]*?)```/g)].map(m => m[1]!).filter(p => p.startsWith('Make ') || p.startsWith('Port '));
    expect(prompts).toHaveLength(6);
    for (const p of prompts) {
      for (const must of ['npx @cyber-est/cli new ', 'No allocation', 'xorshift', 'sample rate', 'range', 'npx est validate', 'npx est test', 'npx est pack']) expect(p, must).toContain(must);
    }
    for (const follow of ['### Add 8 presets', '### Make the UI look like X', '### It clicks when I move the knob', '### est validate says EST-W004']) expect(md).toContain(follow);
  });

  it('linked from the README, llms.txt (right after the guide) and the guide', () => {
    const readme = text('sdk/README.md');
    expect(readme).toContain('(docs/PROMPT_KIT.md)');
    expect(readme).toContain('(docs/SHARING.md)');
    const links = [...text('sdk/llms.txt').matchAll(/\]\(([^)]+)\)/g)].map(m => m[1]);
    expect(links.slice(0, 3)).toEqual(['docs/BUILD_AN_EST_PLUGIN.md', 'docs/PROMPT_KIT.md', 'docs/SHARING.md']);
    const guide = text('sdk/docs/BUILD_AN_EST_PLUGIN.md');
    const last = guide.slice(guide.lastIndexOf('\n## '));
    expect(last).toContain('(PROMPT_KIT.md)');
    expect(last).toContain('(SHARING.md)');
  });
});
