/**
 * 1.800 (the easiest-workflow order, stream 1: one sentence to a plugin).
 *
 * - Every assistant file the kit hands out is what `sdk/agents/generate.mjs` makes from the one source,
 *   `sdk/docs/for-agents.md`, and each template's part: a committed copy that differs fails here.
 * - A generated AGENTS.md stands alone: every link in a folder `est new` makes leads to a file the folder
 *   holds (or to the web), it carries what the fourteen test builders had to dig for, and it stays short.
 * - Every name the library pages list exists in that language's library source.
 * - `est new`: the person's sentence in "What to build", the window's rules with `--ui` and `--app`, a
 *   `package.json` with the kit pinned, the default id, the name, the three questions, and the install.
 * - The one prompt: its two example programs compile and pass `est validate`.
 */
import { readVibeText, textOf } from '../../src/components/est/vibe/vibeFiles';
import { repairManifest } from '../../src/components/est/vibe/vibeRepair';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { PassThrough } from 'node:stream';
import { afterAll, describe, expect, it } from 'vitest';
import {
  COOKBOOK_OUT, COOKBOOK_PART, IDEA_CLOSE, IDEA_OPEN, POINTER_LINE, PROMPT_DOC, PROMPT_MODULE, PROMPT_PLACEHOLDER, SOURCE, WINDOW_CLOSE, WINDOW_OPEN,
  generated, onlyFor, partsOf, sectionsOf, stale,
} from '../agents/generate.mjs';
import { EST_ONE_PROMPT, EST_ONE_PROMPT_PLACEHOLDER, onePromptFor } from '../../shared/estOnePrompt.mjs';
import newCommand, { KIT, kindOf } from '../packages/cli/src/commands/new';
import promptCommand from '../packages/cli/src/commands/prompt';
import { main } from '../packages/cli/src/main';
import { IDEA_MARKS, WINDOW_MARKS, ideaLine, kebab, titleOf } from '../packages/cli/src/scaffold';
import { repo } from './helpers';

const BIN = repo('sdk/packages/cli/bin/est.mjs');
const tmp = mkdtempSync(join(tmpdir(), 'est-agents-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

const text = (p: string) => readFileSync(repo(p), 'utf8');
const words = (t: string) => t.split(/\s+/).filter(Boolean).length;
const parts = partsOf();
const outDir = (name: string) => (name === COOKBOOK_PART ? COOKBOOK_OUT : `sdk/templates/${name}`);

/** `est new …` in this process (never a network install: every call passes --no-install unless it tests the install). */
async function est(args: string[], opts: { input?: NodeJS.ReadableStream & { isTTY?: boolean }; cwd?: string } = {}) {
  let out = '', err = '';
  const code = await main([newCommand], ['new', ...args], { cwd: opts.cwd ?? tmp, out: t => { out += `${t}\n`; }, err: t => { err += `${t}\n`; }, input: opts.input });
  return { code, out, err };
}
/** Every file under a folder, relative to it. */
function files(dir: string, base = dir): string[] {
  return readdirSync(dir).flatMap(n => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? (n === 'node_modules' ? [] : files(p, base)) : [p.slice(base.length + 1)];
  });
}

describe('the assistant files come from one source', () => {
  it('every committed copy is what sdk/agents/generate.mjs makes (run it and commit, never edit a copy)', () => {
    expect(stale()).toEqual([]);
  });

  it('writes the four files for every template and for the recipes, the two window sections and the one prompt', () => {
    const made = [...generated().keys()];
    const templates = readdirSync(repo('sdk/templates')).filter(n => existsSync(repo(`sdk/templates/${n}/est.json`)));
    expect(templates).toHaveLength(11);
    for (const dir of [...templates.map(t => `sdk/templates/${t}`), COOKBOOK_OUT]) {
      for (const f of ['AGENTS.md', 'CLAUDE.md', '.cursor/rules/est.mdc', 'llms.txt']) expect(made, `${dir}/${f}`).toContain(`${dir}/${f}`);
    }
    for (const f of ['sdk/agents/sections/window-ui.md', 'sdk/agents/sections/window-app.md', PROMPT_DOC, PROMPT_MODULE]) expect(made).toContain(f);
  });

  it('the pointers are one line pointing at AGENTS.md (the rules file after its front matter, always applied)', () => {
    for (const p of parts) {
      const dir = outDir(p.name);
      expect(text(`${dir}/CLAUDE.md`)).toBe(`${POINTER_LINE}\n`);
      expect(text(`${dir}/.cursor/rules/est.mdc`).split('\n')).toEqual(['---', expect.stringMatching(/^description: /), 'alwaysApply: true', '---', POINTER_LINE, '']);
    }
    expect(POINTER_LINE).toContain('AGENTS.md');
  });

  it('the marks est new fills are the generator\'s', () => {
    expect([...IDEA_MARKS]).toEqual([IDEA_OPEN, IDEA_CLOSE]);
    expect([...WINDOW_MARKS]).toEqual([WINDOW_OPEN, WINDOW_CLOSE]);
  });

  it('an only: line is kept for its language or kind alone, and its mark is taken off', () => {
    const src = 'all\nas <!-- only:as -->\nrust or cpp <!-- only:rust,cpp -->\nnotes <!-- only:notes -->';
    expect(onlyFor(src, new Set(['as', 'effect']))).toBe('all\nas');
    expect(onlyFor(src, new Set(['cpp', 'notes']))).toBe('all\nrust or cpp\nnotes');
  });
});

describe.each(parts.map(p => ({ name: p.name, lang: String((p.meta as Record<string, unknown>).lang), tags: p.tags })))('the generated AGENTS.md of $name', ({ name, lang, tags }) => {
  const agents = text(`${outDir(name)}/AGENTS.md`);

  it('opens with what to build, to be filled by est new, and says to ask when nobody has said', () => {
    const lines = agents.split('\n');
    expect(lines[0]).toMatch(/^# An EST /);
    const at = agents.indexOf('## What to build');
    expect(at).toBeGreaterThan(0);
    // Nothing but the folder's opening paragraph comes before it.
    expect(agents.slice(0, at).split('\n## ')).toHaveLength(1);
    expect(agents).toContain(`${IDEA_OPEN}\nNobody has said yet what this plugin should do. Ask the person for one sentence`);
    expect(agents).toContain(IDEA_CLOSE);
  });

  it('carries what the test builders had to dig for', () => {
    // The loop, the rules table's field, the cost warning and that it varies, the subnormal rule, noise, the install step.
    for (const must of ['npx est validate', 'dist/validation.json', 'npx est test', '`explain`', 'EST-P001', 'best of three runs', 'EST-C027', '1e-20', 'xorshift', 'npx est demo', 'Playwright\'s Chromium']) expect(agents, must).toContain(must);
    expect(agents).toContain('In Cyber, on Home: **EST PLUGINS → Add a plugin**, and drop `dist/<id>-<version>.est` there.');
    expect(agents).not.toMatch(/admin/i);
    expect(agents).toContain('"scale": "log"');
    if (lang !== 'cpp') {
      // The library on one page, and which of its blocks cost time.
      expect(agents).toMatch(/## The library on one page \((AssemblyScript|Rust)\)/);
      for (const must of ['Smoother', 'Filter', 'Biquad', 'DelayLine', 'Oscillator', 'Lfo', 'Envelope', 'before', lang === 'as' ? 'sinTurns' : 'sin_turns', lang === 'as' ? 'setSmoothing(0)' : 'set_smoothing(0.0)', 'every 16 frames', '.log()', lang === 'as' ? 'tail(): u32' : 'tail(&self) -> u32']) expect(agents, must).toContain(must);
      if (tags.has('notes')) for (const must of ['Voices', lang === 'as' ? 'noteId: i32' : 'note_id: i32', 'There is no `id` field', 'key: i16', 'velocity: f64']) expect(agents, must).toContain(must);
    } else {
      for (const must of ['est_exp', 'est_sin', 'emcc', 'EST_CLANG', 'npx est compare']) expect(agents, must).toContain(must);
    }
    if (agents.includes('## Following the song')) {
      expect(agents).toContain('{ "type": "transport", "time": 0, "tempo": 120, "beat": 0, "seconds": 0, "num": 4, "den": 4, "barStart": 0, "barNumber": 0, "playing": true }');
      expect(agents).toContain('as of the block\'s first sample');
    }
    if (agents.includes('## A delay or a reverb')) {
      for (const must of ['limits.memoryPagesMax', 'EST-C028', '60 at most']) expect(agents, must).toContain(must);
      if (lang === 'as') expect(agents).toContain('Raise `maximumMemory` in `asconfig.json` and `limits.memoryPagesMax` in `est.json` **together**');
    }
  });

  it('is for this folder only: no other language\'s section, no generator marks, no page of the kit\'s docs', () => {
    expect(agents).not.toMatch(/<!-- (only|include|agents):/);
    expect(agents).not.toContain('sdk/docs/');
    const others = { as: ['(Rust)', '(C and C++)', 'est::', 'param_changed'], rust: ['(AssemblyScript)', '(C and C++)', 'paramChanged', 'asconfig.json'], cpp: ['(AssemblyScript)', '(Rust)', 'paramChanged', 'param_changed'] }[lang]!;
    for (const no of others) expect(agents, no).not.toContain(no);
    // A folder with no ui/ keeps its window section to a pointer; the long rules arrive with --ui or --app.
    expect(agents).not.toContain('est-ui-size');
  });

  it('stays short', () => {
    // The order's aim was about 1800 words. Counted as `wc -w` counts, a signature such as
    // `io.output(c, n, v: f32)` is four words, and the one-page library alone is about 420 to 520 of them;
    // the files measure 1690 (cpp-clap) to 2260 (a note effect, with its notes-in-notes-out section).
    // The bound is that measure plus room for a sentence, so a section added without one taken out fails.
    expect(words(agents)).toBeLessThanOrEqual(2300);
  });
});

describe('every name the library pages list is in the library', () => {
  const sourceOf = (dir: string): string => files(repo(dir)).filter(f => /\.(ts|rs|hpp)$/.test(f)).map(f => text(`${dir}/${f}`)).join('\n');
  const sections = sectionsOf(text(SOURCE));
  /** The code spans of a section. */
  const spans = (t: string) => [...t.matchAll(/`([^`]+)`/g)].map(m => m[1]!);
  const has = (src: string, word: string) => new RegExp(`(?<![A-Za-z0-9_])${word}(?![A-Za-z0-9_])`).test(src);
  /** Names that are the language's or the example's own, not the library's. */
  const OWN = new Set(['Math', 'sqrt', 'abs', 'sin', 'tanh', 'pow', 'random', 'powf', 'MyVoice', 'T', 'N', 'A', 'B', 'Name', 'Group', 'Self', 'Fn', 'StaticArray', 'f64', 'f32', 'u32', 'i32', 'i16', 'u16', 'usize', 'bool', 'void', 'dB', 'new', 'make', 'core']);

  it.each([
    { lang: 'as', dir: 'sdk/as/est' },
    { lang: 'rust', dir: 'sdk/rust/est/src' },
  ])('$lang: every function, type and field', ({ lang, dir }) => {
    const src = sourceOf(dir);
    const page = onlyFor(sections.get(`library-${lang}`)!, new Set([lang, 'effect', 'instrument', 'notes', 'folder']));
    const names = new Set<string>();
    for (const s of spans(page)) {
      // Calls (`setCutoff(hz)`), types (`FilterMode`), and what follows a dot or `::` (`io.frames`, `Wave::Sine`).
      for (const m of s.matchAll(/([A-Za-z_][A-Za-z0-9_]*)(?=\(|!)/g)) names.add(m[1]!);
      for (const m of s.matchAll(/(?<![A-Za-z0-9_])([A-Z][A-Za-z0-9_]*)/g)) names.add(m[1]!);
      for (const m of s.matchAll(/(?:\.|::)([A-Za-z_][A-Za-z0-9_]*)/g)) names.add(m[1]!);
    }
    // The fields of Note, Transport and Event: the name before each colon on those lines.
    for (const line of page.split('\n').filter(l => /^- \*\*`(Note|Transport|Event)`\*\* fields/.test(l))) {
      for (const s of spans(line)) { const m = /^([A-Za-z_][A-Za-z0-9_]*)(?::|$)/.exec(s); if (m) names.add(m[1]!); }
    }
    const missing = [...names].filter(n => !OWN.has(n) && !has(src, n)).sort();
    expect(missing, `${lang}: listed on the library page but not in ${dir}`).toEqual([]);
    expect(names.size).toBeGreaterThan(90);
    // And the costs section's names.
    const costs = onlyFor(sections.get('costs')!, new Set([lang]));
    for (const s of spans(costs)) for (const m of s.matchAll(/([A-Za-z_][A-Za-z0-9_]*)(?=\()/g)) expect(has(src, m[1]!), `${lang} costs: ${m[1]}`).toBe(true);
  });

  it('cpp: every runtime function and constant', () => {
    const src = text('sdk/cpp/include/est/runtime.hpp');
    const page = sections.get('library-cpp')! + onlyFor(sections.get('costs')!, new Set(['cpp']));
    const names = new Set([...page.matchAll(/\b(est_[a-z_0-9]+|EST_[A-Z0-9_]+)\b/g)].map(m => m[1]!));
    names.delete('est_name');
    expect([...names].filter(n => !has(src, n))).toEqual([]);
    expect(names.size).toBeGreaterThanOrEqual(18);
  });

  it('a note has no `id` field in either library (the one prompt\'s first failure)', () => {
    expect(text('sdk/as/est/plugin.ts')).toMatch(/export class Note \{\n {2}time: i32 = 0;\n {2}noteId: i32 = -1;\n {2}port: i16 = -1;\n {2}channel: i16 = -1;\n {2}key: i16 = -1;\n {2}velocity: f64 = 0;/);
  });
});

describe('a folder est new makes', () => {
  const made = new Map<string, string>();
  /** One folder per template, and one recipe's. */
  async function folder(name: string): Promise<string> {
    if (!made.has(name)) {
      const dir = join(tmp, `links-${name}`);
      const r = await est([name === COOKBOOK_PART ? 'chorus' : name, dir, '--no-install']);
      expect(r.code, r.err).toBe(0);
      made.set(name, dir);
    }
    return made.get(name)!;
  }

  it.each(parts.map(p => p.name))('%s: no link in its assistant files leads to a file the folder lacks', async (name) => {
    const dir = await folder(name);
    for (const f of ['AGENTS.md', 'CLAUDE.md', '.cursor/rules/est.mdc', 'llms.txt']) {
      const t = readFileSync(join(dir, f), 'utf8');
      const links = [...t.matchAll(/\]\(([^)\s]+)\)/g)].map(m => m[1]!);
      for (const link of links) {
        if (/^https:\/\//.test(link)) continue;
        expect(existsSync(join(dir, link.replace(/#.*$/, ''))), `${name}/${f} links ${link}`).toBe(true);
      }
      if (f === 'llms.txt') {
        expect(links.length).toBeGreaterThan(8);
        // What the folder does not hold is a web address, said to be on the web.
        expect(t).toContain('## On the web (not in this folder)');
        expect(t.slice(t.indexOf('## On the web')).split('\n').filter(l => l.startsWith('- ')).every(l => l.startsWith('- https://github.com/NickKHarrison/cyber-est-sdk/'))).toBe(true);
        expect(t.slice(0, t.indexOf('## On the web'))).not.toMatch(/https?:\/\//);
      }
    }
    // The files AGENTS.md's table names are there.
    const agents = readFileSync(join(dir, 'AGENTS.md'), 'utf8');
    const table = agents.slice(agents.indexOf('## The files'), agents.indexOf('## The loop'));
    for (const m of table.matchAll(/`([A-Za-z0-9_./-]+\.(?:json|ts|rs|toml|md|f32|mjs|html|js|css|hpp|cpp))`/g)) {
      if (m[1]!.includes('*')) continue;
      expect(existsSync(join(dir, m[1]!)), `${name}: AGENTS.md's table names ${m[1]}`).toBe(true);
    }
    expect(existsSync(join(dir, 'est'))).toBe(name !== 'cpp-clap');
  });

  it('carries the person\'s sentence in "What to build" (--idea, with any template or recipe), as one plain line', async () => {
    const dir = join(tmp, 'idea');
    const r = await est(['effect-as', dir, '--no-install', '--idea', 'a tape echo\nwhose repeats <!-- get --> darker']);
    expect(r.code, r.err).toBe(0);
    const agents = readFileSync(join(dir, 'AGENTS.md'), 'utf8');
    expect(agents).toContain(`${IDEA_OPEN}\n> a tape echo whose repeats get darker\n\nThat sentence is the person's own.`);
    expect(agents).not.toContain('Nobody has said yet');
    expect(agents.split(IDEA_OPEN)).toHaveLength(2);
    expect(r.out).toContain('your sentence is in AGENTS.md');
    const recipe = join(tmp, 'idea-recipe');
    expect((await est(['chorus', recipe, '--no-install', '--idea', 'a slow, wide chorus'])).code).toBe(0);
    expect(readFileSync(join(recipe, 'AGENTS.md'), 'utf8')).toContain('> a slow, wide chorus');
    expect(ideaLine('  a\n b  ')).toBe('a b');
    expect(ideaLine('x'.repeat(900))).toHaveLength(500);
  });

  it('without a sentence the section tells the assistant to ask, and est new says where it goes', async () => {
    const dir = await folder('effect-as');
    expect(readFileSync(join(dir, 'AGENTS.md'), 'utf8')).toContain('Nobody has said yet what this plugin should do. Ask the person for one sentence');
    const again = await est(['effect-as', join(tmp, 'no-idea'), '--no-install']);
    expect(again.out).toContain('AGENTS.md has the place');
  });

  it('--ui and --app put the window\'s rules in AGENTS.md; without them it is a pointer', async () => {
    const plain = readFileSync(join(await folder('effect-as'), 'AGENTS.md'), 'utf8');
    expect(plain).toContain('This folder has no window of its own');
    const ui = join(tmp, 'win-ui');
    expect((await est(['effect-as', ui, '--no-install', '--ui'])).code).toBe(0);
    const withUi = readFileSync(join(ui, 'AGENTS.md'), 'utf8');
    expect(withUi).toContain(`${WINDOW_OPEN}\nThis folder has a window in \`ui/\``);
    expect(withUi).not.toContain('This folder has no window of its own');
    expect(withUi).toContain('<est-knob>');
    const app = join(tmp, 'win-app');
    expect((await est(['instrument-as', app, '--no-install', '--app'])).code).toBe(0);
    const withApp = readFileSync(join(app, 'AGENTS.md'), 'utf8');
    expect(withApp).toContain(`${WINDOW_OPEN}\nThis folder's window is an app: \`ui-app/\` is its source`);
    for (const f of ['ui-app/bridge.ts', 'ui-app/vite.config.ts', 'ui-app/bits.ts']) { expect(withApp).toContain(f); expect(existsSync(join(app, f)), f).toBe(true); }
    expect(withApp).toContain('EST-U005');
  });

  it('writes package.json: private, the kit pinned exactly at this est\'s own version, the four scripts; node_modules ignored', async () => {
    const dir = await folder('effect-as');
    const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as { private: boolean; scripts: Record<string, string>; devDependencies: Record<string, string>; name: string };
    expect(pkg.private).toBe(true);
    expect(pkg.devDependencies).toEqual({ [KIT.name]: KIT.version });
    expect(KIT.name).toBe('@cyber-est/cli');
    expect(KIT.version).toBe((JSON.parse(text('sdk/packages/cli/package.json')) as { version: string }).version);
    expect(KIT.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(pkg.scripts).toEqual({ validate: 'est validate', test: 'est test', dev: 'est dev', pack: 'est pack' });
    expect(readFileSync(join(dir, '.gitignore'), 'utf8')).toMatch(/^node_modules\/$/m);
    // Every template and a recipe get one (Rust and C++ too: the command is the same).
    for (const name of ['effect-rust', 'cpp-clap', COOKBOOK_PART]) expect(existsSync(join(await folder(name), 'package.json')), name).toBe(true);
    // An --app folder already has one for its window's build: the kit and the scripts join it.
    const app = join(tmp, 'pkg-app');
    expect((await est(['effect-as', app, '--no-install', '--app'])).code).toBe(0);
    const appPkg = JSON.parse(readFileSync(join(app, 'package.json'), 'utf8')) as typeof pkg;
    expect(appPkg.scripts).toMatchObject({ validate: 'est validate', 'build:ui': 'vite build --config ui-app/vite.config.ts' });
    expect(appPkg.devDependencies).toMatchObject({ [KIT.name]: KIT.version, vite: expect.any(String) as string });
    expect(appPkg.private).toBe(true);
  });

  it('the default id is com.example.<name in kebab-case>, and --id without --name names it from the id', async () => {
    const id = (dir: string) => (JSON.parse(readFileSync(join(dir, 'est.json'), 'utf8')) as { id: string; name: string });
    expect(id(await folder('effect-as'))).toMatchObject({ id: 'com.example.links-effect-as', name: 'Links Effect As' });
    const named = join(tmp, 'folder-x');
    expect((await est(['effect-as', named, '--no-install', '--name', 'Tape Echo!'])).code).toBe(0);
    expect(id(named)).toMatchObject({ id: 'com.example.tape-echo', name: 'Tape Echo!' });
    // 1.789's report: a folder called "plugin" with --id named the plugin "Plugin".
    const plugin = join(tmp, 'plugin');
    const r = await est(['effect-as', plugin, '--no-install', '--id', 'dev.a1b2c3d4e5.shimmer-verb']);
    expect(r.code, r.err).toBe(0);
    expect(id(plugin)).toEqual(expect.objectContaining({ id: 'dev.a1b2c3d4e5.shimmer-verb', name: 'Shimmer Verb' }));
    expect(readFileSync(join(plugin, 'assembly', 'index.ts'), 'utf8')).toContain('"dev.a1b2c3d4e5.shimmer-verb", "Shimmer Verb"');
    expect(kebab('  Tape Echo! 2 ')).toBe('tape-echo-2');
    expect(kebab('!!!')).toBe('');
    expect(titleOf('shimmer-verb')).toBe('Shimmer Verb');
  });

  it('ends with what to do next in three lines: the assistant, est dev, then the drop on Home → EST PLUGINS → Add a plugin', async () => {
    const r = await est(['instrument-as', join(tmp, 'next'), '--no-install', '--name', 'Glass Pad', '--idea', 'a glassy pad']);
    const lines = r.out.trim().split('\n');
    expect(lines[0]).toMatch(/^made next from instrument-as: Glass Pad \(com\.example\.glass-pad\)/);
    expect(lines[1]).toBe('The kit is not installed there yet. Run: cd next && npm install');
    expect(lines.slice(2)).toEqual([
      '1. Open next in your AI assistant and say "build it" (your sentence is in AGENTS.md), or edit assembly/index.ts yourself.',
      '2. cd next && npx est dev   to hear it.',
      '3. Drop dist/com.example.glass-pad-1.0.0.est on Cyber: Home → EST PLUGINS → Add a plugin.',
    ]);
  });
});

describe('est new with no template: three questions', () => {
  /** A stand-in terminal that types the answers. */
  const terminal = (answers: string[], tty = true) => {
    const s = new PassThrough() as PassThrough & { isTTY?: boolean };
    s.isTTY = tty;
    s.end(answers.map(a => `${a}\n`).join(''));
    return s;
  };
  const cwd = join(tmp, 'ask');
  mkdirSync(cwd, { recursive: true });

  it('asks what it does, instrument or effect, and a name; picks the AssemblyScript template, the folder and the id; writes the sentence', async () => {
    const r = await est(['--no-install'], { cwd, input: terminal(['a tremolo that can also pan', 'effect', 'Wobble Pan']) });
    expect(r.code, r.err).toBe(0);
    expect(r.out.split('\n').slice(0, 3)).toEqual(['What should the plugin do? (one sentence)', 'An instrument (it plays notes) or an effect (it changes sound)? [instrument/effect]', 'What is it called?']);
    expect(r.out).toContain('made wobble-pan from effect-as: Wobble Pan (com.example.wobble-pan)');
    const dir = join(cwd, 'wobble-pan');
    expect(JSON.parse(readFileSync(join(dir, 'est.json'), 'utf8'))).toMatchObject({ id: 'com.example.wobble-pan', name: 'Wobble Pan', kind: 'effect' });
    expect(readFileSync(join(dir, 'AGENTS.md'), 'utf8')).toContain('> a tremolo that can also pan');
  });

  it('an instrument, and an answer that is neither is asked again', async () => {
    const r = await est(['--no-install'], { cwd, input: terminal(['a kick where every key is a pitch', 'drum', 'i', 'Thud']) });
    expect(r.code, r.err).toBe(0);
    expect(r.out).toContain('Type instrument or effect.');
    expect(JSON.parse(readFileSync(join(cwd, 'thud', 'est.json'), 'utf8'))).toMatchObject({ id: 'com.example.thud', kind: 'instrument' });
    expect(kindOf('Synth')).toBe('instrument');
    expect(kindOf(' FX ')).toBe('effect');
    expect(kindOf('both')).toBeNull();
  });

  it('a flag answers its question: only what is missing is asked', async () => {
    const r = await est(['--no-install', '--kind', 'effect', '--idea', 'an old telephone'], { cwd, input: terminal(['Phone Line']) });
    expect(r.code, r.err).toBe(0);
    expect(r.out.split('\n')[0]).toBe('What is it called?');
    expect(readFileSync(join(cwd, 'phone-line', 'AGENTS.md'), 'utf8')).toContain('> an old telephone');
  });

  it('with --kind and --name it asks nothing, terminal or not', async () => {
    const r = await est(['--no-install', '--kind', 'instrument', '--name', 'Glass Pad', '--idea', 'two detuned saws'], { cwd, input: terminal([], false) });
    expect(r.code, r.err).toBe(0);
    expect(r.out).not.toContain('?');
    expect(existsSync(join(cwd, 'glass-pad', 'assembly', 'index.ts'))).toBe(true);
  });

  it('where there is no terminal and an answer is missing it prints the usage and exits 2: it never waits', async () => {
    const r = await est([], { cwd, input: terminal([], false) });
    expect(r.code).toBe(2);
    expect(r.err).toContain('standard input is not a terminal');
    expect(r.err).toContain('est new --kind <instrument|effect> --name <name>');
    // The real command with standard input closed (as a script or a CI job runs it), within the test's time.
    const spawned = spawnSync(process.execPath, [BIN, 'new'], { cwd, encoding: 'utf8', input: '', timeout: 120_000 });
    expect(spawned.status).toBe(2);
    expect(spawned.stderr).toContain('standard input is not a terminal');
    // A terminal that closes before the answers: a usage error too.
    const cut = await est(['--no-install'], { cwd, input: terminal(['only the sentence']) });
    expect(cut.code).toBe(2);
    expect(cut.err).toContain('the questions were not answered');
    // A template with no folder, a kind beside a template, a kind that is neither.
    expect((await est(['effect-as'])).code).toBe(2);
    expect((await est(['effect-as', join(tmp, 'k'), '--kind', 'effect'])).code).toBe(2);
    expect((await est(['--kind', 'both', '--name', 'X'])).code).toBe(2);
  }, 150_000);
});

describe('est new installs the kit', () => {
  const npm = (name: string, script: string) => { const p = join(tmp, name); writeFileSync(p, `#!/bin/sh\n${script}\n`); chmodSync(p, 0o755); return p; };
  const withNpm = async (path: string, run: () => Promise<void>) => {
    const was = { npm: process.env.EST_NPM, off: process.env.EST_NO_INSTALL };
    process.env.EST_NPM = path;
    delete process.env.EST_NO_INSTALL;
    try { await run(); } finally {
      if (was.npm === undefined) delete process.env.EST_NPM; else process.env.EST_NPM = was.npm;
      if (was.off !== undefined) process.env.EST_NO_INSTALL = was.off;
    }
  };

  it.skipIf(process.platform === 'win32')('runs npm install in the folder; once it has, no command is left to run', async () => {
    await withNpm(npm('npm-ok', 'echo "$@" > npm-ran.txt'), async () => {
      const r = await est(['effect-as', join(tmp, 'inst-ok'), '--install']);
      expect(r.code, r.err).toBe(0);
      expect(readFileSync(join(tmp, 'inst-ok', 'npm-ran.txt'), 'utf8').trim()).toBe('install --no-audit --no-fund');
      expect(r.out).not.toContain('npm install');
      expect(r.err).toContain(`installing the kit (${KIT.name}@${KIT.version})`);
    });
  });

  it.skipIf(process.platform === 'win32')('a failed install keeps the folder, exits 0 and prints the one command', async () => {
    await withNpm(npm('npm-fail', 'echo "npm ERR! no network" >&2; exit 1'), async () => {
      const dir = join(tmp, 'inst-fail');
      const r = await est(['effect-as', dir, '--install']);
      expect(r.code).toBe(0);
      expect(existsSync(join(dir, 'est.json'))).toBe(true);
      expect(existsSync(join(dir, 'package.json'))).toBe(true);
      expect(r.out).toContain('npm install did not finish; the folder is made. Run: cd inst-fail && npm install');
      expect(r.err).toContain('npm ERR! no network');
    });
  });

  it.skipIf(process.platform === 'win32')('--no-install and EST_NO_INSTALL=1 run nothing; nor does the clone\'s est without --install', async () => {
    await withNpm(npm('npm-never', 'echo ran > npm-ran.txt'), async () => {
      for (const [name, args, env] of [['skip-flag', ['--no-install', '--install'], undefined], ['skip-env', ['--install'], '1'], ['skip-clone', [], undefined]] as const) {
        if (env) process.env.EST_NO_INSTALL = env; else delete process.env.EST_NO_INSTALL;
        const r = await est(['effect-as', join(tmp, name), ...args]);
        expect(r.code, r.err).toBe(0);
        expect(existsSync(join(tmp, name, 'npm-ran.txt')), name).toBe(false);
        expect(r.out).toContain(`The kit is not installed there yet. Run: cd ${name} && npm install`);
      }
      delete process.env.EST_NO_INSTALL;
    });
  });
});

describe('the one prompt', () => {
  const doc = text(PROMPT_DOC);

  it('is the same text in the module the app imports and in the docs page, with one placeholder line', () => {
    expect(EST_ONE_PROMPT_PLACEHOLDER).toBe(PROMPT_PLACEHOLDER);
    expect(EST_ONE_PROMPT.split(PROMPT_PLACEHOLDER)).toHaveLength(2);
    expect(EST_ONE_PROMPT.split('\n')).toContain('What I want it to do: <one sentence>');
    const block = /````text\n([\s\S]*?)\n````/.exec(doc)?.[1];
    expect(block).toBe(EST_ONE_PROMPT.trimEnd());
    // The module stands alone: the app may not import sdk/.
    expect(text(PROMPT_MODULE)).not.toMatch(/^import /m);
  });

  it('onePromptFor puts the sentence on the placeholder\'s line, as one line', () => {
    const p = onePromptFor('  a chorus\nwith rate, depth and mix ');
    expect(p).toContain('\nWhat I want it to do: a chorus with rate, depth and mix\n');
    expect(p).not.toContain('<one sentence>');
    expect(p.length).toBe(EST_ONE_PROMPT.length - '<one sentence>'.length + 'a chorus with rate, depth and mix'.length);
    expect(onePromptFor('$& $1')).toContain('What I want it to do: $& $1\n');
    expect(onePromptFor('   ')).toBe(EST_ONE_PROMPT);
  });

  it('est prompt prints it, with the sentence when one is given', async () => {
    const run = async (args: string[]) => { let out = ''; const code = await main([promptCommand], ['prompt', ...args], { cwd: tmp, out: t => { out += `${t}\n`; }, err: () => {} }); return { code, out }; };
    expect(await run([])).toEqual({ code: 0, out: `${EST_ONE_PROMPT.trimEnd()}\n` });
    const withIdea = await run(['a chorus', 'with rate and depth']);
    expect(withIdea.out).toBe(`${onePromptFor('a chorus with rate and depth').trimEnd()}\n`);
    expect(withIdea.out).toContain('What I want it to do: a chorus with rate and depth');
  });

  it('shows an instrument as well as an effect, a note\'s real fields, and the library', () => {
    expect(EST_ONE_PROMPT).toContain('A WHOLE WORKING EXAMPLE');
    expect(EST_ONE_PROMPT).toContain('THE SAME FOR AN INSTRUMENT');
    expect(EST_ONE_PROMPT).toContain('There is no `note.id`');
    expect(EST_ONE_PROMPT).toContain('`noteId: i32`');
    expect(EST_ONE_PROMPT).toContain('**`DelayLine`**');
    expect(EST_ONE_PROMPT).toContain('com.example.<name-in-kebab-case>');
    // 1.898: one answer, with the plugin's own window: the marker lines Cyber's reader looks for, the window's rules and its example.
    for (const must of ['ONE code block', '=== file: est.json ===', '=== file: assembly/index.ts ===', '=== file: ui/index.html ===', '=== file: ui/style.css ===', '=== file: ui/ui.js ===', 'THE WINDOW', '<script src="est-ui.js"></script>', 'EstUI.connect()', 'est.subscribe', 'est.onMeter']) expect(EST_ONE_PROMPT, must).toContain(must);
    // Nothing a chat with no folder cannot use.
    for (const no of ['AGENTS.md', '$schema', 'est/`', 'npx est', '<!--']) expect(EST_ONE_PROMPT, no).not.toContain(no);
  });

  /**
   * The two files of an example in the prompt, est.json made whole as Cyber's builder makes it (the
   * prompt's est.json is the few facts an assistant decides: `repairManifest`, the app's own tidy-up).
   */
  function example(which: 'effect' | 'instrument'): { source: string; manifest: string } {
    const from = EST_ONE_PROMPT.indexOf(which === 'effect' ? 'A WHOLE WORKING EXAMPLE' : 'THE SAME FOR AN INSTRUMENT');
    const to = which === 'effect' ? EST_ONE_PROMPT.indexOf('THE SAME FOR AN INSTRUMENT') : EST_ONE_PROMPT.indexOf('THE "est" LIBRARY');
    const src = readVibeText(EST_ONE_PROMPT.slice(from, to));
    // The kit's folder has no window here: the two files alone, as before.
    for (const p of [...src.files.keys()]) if (p.startsWith('ui/')) src.files.delete(p);
    const problems = repairManifest(src);
    if (problems.length || !src.files.has('assembly/index.ts')) throw new Error(`no ${which} example in the prompt`);
    const m = [textOf(src, 'assembly/index.ts'), textOf(src, 'est.json')];
    return { source: m[0]!, manifest: m[1]! };
  }

  it.each(['effect', 'instrument'] as const)('its %s example compiles and passes est validate as it stands (two files over a new folder, as the playground takes them)', async (which) => {
    const dir = join(tmp, `prompt-${which}`);
    expect((await est([`${which}-as`, dir, '--no-install', '--name', 'Folder Name'])).code).toBe(0);
    const { source, manifest } = example(which);
    expect((JSON.parse(manifest) as { kind: string }).kind).toBe(which);
    // The whole of both files comes from the prompt: nothing of the folder's own two files is left.
    writeFileSync(join(dir, 'assembly', 'index.ts'), `${source}\n`);
    writeFileSync(join(dir, 'est.json'), `${manifest}\n`);
    const v = spawnSync(process.execPath, [BIN, 'validate', '--json'], { cwd: dir, encoding: 'utf8', timeout: 220_000 });
    const report = JSON.parse(v.stdout) as { ok: boolean; checks: { rule?: string; status: string; message?: string }[] };
    expect(report.checks.filter(c => c.status === 'fail'), v.stderr).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.checks.length).toBeGreaterThan(60);
    expect(v.status).toBe(0);
  }, 240_000);
});

// The source page says where each file goes: keep that list honest.
describe('the source page', () => {
  it('names the generator, the parts and what is written', () => {
    const page = text(SOURCE);
    for (const must of ['node sdk/agents/generate.mjs', 'sdk/agents/parts/', 'sdk/cookbook-agents/', 'sdk/agents/sections/', 'ONE_PROMPT.md', 'shared/estOnePrompt.mjs']) expect(page, must).toContain(must);
    expect(existsSync(dirname(repo('sdk/agents/parts/effect-as.md')))).toBe(true);
  });
});
