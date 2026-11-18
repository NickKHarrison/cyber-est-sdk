#!/usr/bin/env node
/**
 * 1.800 (the easiest-workflow order, stream 1): every assistant file the kit hands out, made from ONE
 * source, `sdk/docs/for-agents.md`, so that none can drift.
 *
 *   node sdk/agents/generate.mjs           write every file below
 *   node sdk/agents/generate.mjs --check   write nothing; name each file that differs, exit 1 if any
 *
 * The source is cut into its marked sections (`<!-- agents:begin name -->` … `<!-- agents:end name -->`).
 * A **part** (`sdk/agents/parts/<name>.md`: one per template, and `cookbook.md` for the recipes) is the
 * short text only that folder has (its title, its files, what it starts as) with `<!-- include: name -->`
 * lines where the shared sections go. A line that ends `<!-- only:a,b -->` is kept only when the part's
 * tags (its language, its kinds, `folder`) hold one of them.
 *
 * What it writes (all committed; `sdk/tests/agents.test.ts` and `node scripts/regen.mjs --check` hold
 * each to this file's output):
 * - `sdk/templates/<name>/AGENTS.md`, `CLAUDE.md`, `.cursor/rules/est.mdc`, `llms.txt`;
 * - `sdk/cookbook-agents/` the same four, which `est new <recipe>` copies into a recipe's folder;
 * - `sdk/agents/sections/window-ui.md` and `window-app.md`: what `est new --ui` and `--app` put in place
 *   of the short window section;
 * - `sdk/docs/ONE_PROMPT.md` and `shared/estOnePrompt.mjs`: the one prompt for a chat assistant with no
 *   folder (the app imports the module; it may not import `sdk/`).
 *
 * Pure but for the reads and the writes: the same commit makes the same bytes.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const SOURCE = 'sdk/docs/for-agents.md';
export const PARTS_DIR = 'sdk/agents/parts';
export const SECTIONS_DIR = 'sdk/agents/sections';
/** The part the recipes share, and the folder its files land in. */
export const COOKBOOK_PART = 'cookbook';
export const COOKBOOK_OUT = 'sdk/cookbook-agents';
export const PROMPT_DOC = 'sdk/docs/ONE_PROMPT.md';
export const PROMPT_MODULE = 'shared/estOnePrompt.mjs';
/** The kit's docs on the web: what a folder's llms.txt links instead of pages it does not hold. */
export const WEB_DOCS = 'https://github.com/NickKHarrison/cyber-est-sdk/blob/main/sdk/docs/';
export const WEB_SPEC = 'https://github.com/NickKHarrison/cyber-est-sdk/blob/main/docs/est/EST_SPECIFICATION_DRAFT.md';

/** The marks `est new` fills: the person's sentence, and the window section (`--ui`, `--app`). */
export const IDEA_OPEN = '<!-- est:idea -->';
export const IDEA_CLOSE = '<!-- /est:idea -->';
export const WINDOW_OPEN = '<!-- est:window -->';
export const WINDOW_CLOSE = '<!-- /est:window -->';
/** The line of the one prompt a person replaces with their sentence. */
export const PROMPT_PLACEHOLDER = 'What I want it to do: <one sentence>';

/** The two pointers: no content of their own, so they cannot drift. */
export const POINTER_LINE = 'Read [AGENTS.md](AGENTS.md): what to build, this plugin\'s files, the rules and the build, validate, fix loop.';
export const POINTERS = Object.freeze({
  'CLAUDE.md': `${POINTER_LINE}\n`,
  '.cursor/rules/est.mdc': `---\ndescription: How to build this EST plugin\nalwaysApply: true\n---\n${POINTER_LINE}\n`,
});

const read = (root, rel) => readFileSync(join(root, rel), 'utf8');

/** The source's marked sections, by name. @param {string} text */
export function sectionsOf(text) {
  const out = new Map();
  const re = /<!-- agents:begin ([a-z0-9-]+) -->\n([\s\S]*?)\n<!-- agents:end \1 -->/g;
  for (const m of text.matchAll(re)) {
    if (out.has(m[1])) throw new Error(`${SOURCE}: two sections named ${m[1]}`);
    out.set(m[1], m[2]);
  }
  const begins = [...text.matchAll(/<!-- agents:begin ([a-z0-9-]+) -->/g)].map((m) => m[1]);
  const open = begins.filter((n) => !out.has(n));
  if (open.length) throw new Error(`${SOURCE}: section ${open.join(', ')} has no matching end`);
  return out;
}

/** Keeps a line with an `only:` mark only when a tag matches, and takes the mark off. @param {string} text @param {Set<string>} tags */
export function onlyFor(text, tags) {
  const out = [];
  for (const line of text.split('\n')) {
    const m = / ?<!-- only:([a-z0-9,-]+) -->\s*$/.exec(line);
    if (!m) { out.push(line); continue; }
    if (m[1].split(',').some((t) => tags.has(t))) out.push(line.slice(0, m.index));
  }
  return out.join('\n');
}

/** A part: its header (`key: value` lines in a leading comment) and its body. @param {string} text @param {string} name */
export function parsePart(text, name) {
  const m = /^<!--\n([\s\S]*?)\n-->\n/.exec(text);
  if (!m) throw new Error(`${PARTS_DIR}/${name}.md: no header comment`);
  const meta = {};
  for (const line of m[1].split('\n')) {
    const k = /^([a-z]+):\s*(.*)$/.exec(line);
    if (!k) throw new Error(`${PARTS_DIR}/${name}.md: header line "${line}" is not "key: value"`);
    meta[k[1]] = k[2].trim();
  }
  for (const need of ['title', 'lang', 'kinds', 'source']) if (!meta[need]) throw new Error(`${PARTS_DIR}/${name}.md: header has no ${need}`);
  const tags = new Set([meta.lang, ...meta.kinds.split(',').map((s) => s.trim()), 'folder']);
  return { name, meta, tags, body: text.slice(m[0].length) };
}

/** A part's AGENTS.md: its body with each include filled and each `only:` line decided. */
export function renderPart(part, sections) {
  const body = part.body.replace(/^<!-- include: ([a-z0-9-]+) -->$/gm, (_all, name) => {
    const s = sections.get(name);
    if (s === undefined) throw new Error(`${PARTS_DIR}/${part.name}.md includes "${name}", which ${SOURCE} does not have`);
    return s;
  });
  return `${onlyFor(body, part.tags).replace(/\n{3,}/g, '\n\n').trim()}\n`;
}

/** The files `est new` copies in beside est.json, whatever the template. */
const CONTRACT = [
  ['est-manifest-1.schema.json', 'the manifest\'s JSON Schema (est.json\'s `$schema`)'],
  ['est-validator-rules.json', 'every validator rule: `id` (EST-M, -B, -W, -C, -U, -P), `title`, `explain`, `fix`, `severity`'],
  ['est-abi-1.0.json', 'the ABI for EST 1.0: every CLAP struct\'s layout on wasm32 (only for code written without the kit\'s runtime)'],
  ['est-abi-1.1.json', 'the same for EST 1.1'],
  ['est-ui.d.ts', 'the types of the window\'s page library (`window.EstUI`)'],
];
const LIBRARY = {
  as: ['est/index.ts', 'this folder\'s copy of the kit\'s AssemblyScript library (the blocks are in `est/dsp/`)'],
  rust: ['est/src/lib.rs', 'this folder\'s copy of the kit\'s Rust crate (the blocks are in `est/src/dsp/`)'],
};
const WEB_PAGES = [
  ['dev-host.md', '`est dev` and `est dev --json`'],
  ['concepts.md', 'blocks, events, parameters, state, the sandbox'],
  ['ui.md', 'a window of your own'],
  ['manifest.md', 'every est.json field, as a page'],
  ['validator-rules.md', 'every rule, as a page'],
  ['PUBLISH_ON_THE_EST_STORE.md', 'publishing'],
];

/** A folder's llms.txt: files the folder holds, then pages on the web, marked as such. */
export function llmsText(part) {
  const lib = LIBRARY[part.meta.lang];
  return [
    `# EST plugin: ${part.meta.title}`,
    '',
    '> An EST plugin is a CLAP 1.2 plugin compiled to WebAssembly (wasm32, no imports), packed with its manifest into a `.est` bundle that a host such as Cyber checks and runs in a sandbox. Start with AGENTS.md. Every file under the first three headings is in this folder (`est new` made it). The pages under "On the web" are not in this folder.',
    '',
    '## This plugin',
    '',
    '- [AGENTS.md](AGENTS.md): what to build, the loop, the rules, the library on one page, what costs time',
    '- [est.json](est.json): the manifest',
    `- [${part.meta.source}](${part.meta.source}): the plugin`,
    '- [test/golden.json](test/golden.json): the golden render\'s spec (its events name parameters by id)',
    '- [package.json](package.json): the kit, pinned, and the scripts',
    '',
    '## The contract, machine-readable',
    '',
    ...CONTRACT.map(([f, what]) => `- [${f}](${f}): ${what}`),
    '',
    ...(lib ? ['## The library', '', `- [${lib[0]}](${lib[0]}): ${lib[1]}`, ''] : []),
    '## On the web (not in this folder)',
    '',
    ...WEB_PAGES.map(([f, what]) => `- ${WEB_DOCS}${f} : ${what}`),
    `- ${WEB_SPEC} : the EST specification (background; not needed to write a plugin)`,
    '',
  ].join('\n');
}

/** A template's source as the prompt shows it: without its header comment. */
function exampleSource(text) {
  const lines = text.split('\n');
  let i = 0;
  while (i < lines.length && (lines[i].startsWith('//') || lines[i].trim() === '')) i++;
  return lines.slice(i).join('\n').trim();
}
/** A template's est.json as the prompt shows it: without `$schema`, which only a folder has. */
function exampleManifest(text) {
  return text.replace(/^\s*"\$schema":[^\n]*\n/m, '').trim();
}

/** The one prompt for a chat assistant with no folder. @param {string} root @param {Map<string, string>} sections */
export function onePrompt(root, sections) {
  const tags = new Set(['as', 'effect', 'instrument', 'notes', 'prompt']);
  const example = (name) => [
    '--- assembly/index.ts ---',
    exampleSource(read(root, `sdk/templates/${name}/assembly/index.ts`)),
    '',
    '--- est.json ---',
    exampleManifest(read(root, `sdk/templates/${name}/est.json`)),
  ].join('\n');
  const library = onlyFor(sections.get('library-as') ?? '', tags).split('\n').filter((l) => !l.startsWith('## ')).join('\n').replace(/\n{3,}/g, '\n\n').trim();
  return [
    'I want an audio plugin for Cyber (an "EST plugin"): AssemblyScript compiled to WebAssembly, run in a sandbox.',
    'Write me TWO files, each whole, in its own code block: `assembly/index.ts` and `est.json`. I will paste them into Cyber\'s plugin playground, or into a folder made by the kit\'s `est new`, which compiles and plays them. No other files, no build steps.',
    '',
    PROMPT_PLACEHOLDER,
    '',
    onlyFor(sections.get('prompt-rules') ?? '', tags).trim(),
    '',
    'A whole working effect (a gain into a filter). For an effect, change this one into mine:',
    '',
    example('effect-as'),
    '',
    'A whole working instrument (four voices of a saw through a filter, each shaped by an envelope). For an instrument, change this one into mine:',
    '',
    example('instrument-as'),
    '',
    'The "est" library (everything you may import):',
    '',
    library,
    '',
  ].join('\n');
}

/** The prompt's page in the docs. */
function promptDoc(prompt) {
  if (prompt.includes('````')) throw new Error('the one prompt holds a four-backtick fence');
  return [
    '# The one prompt',
    '',
    'For a chat assistant with no folder and no tools. Copy everything in the block below into the chat and replace `<one sentence>` with what the plugin should do.',
    'The assistant answers with two files, `assembly/index.ts` and `est.json`: paste them into Cyber\'s plugin playground, or over the same two files in a folder made by `npx @cyber-est/cli new`.',
    '',
    'This page is generated from [for-agents.md](for-agents.md) and the `effect-as` and `instrument-as` templates by `node sdk/agents/generate.mjs`: change those, never this.',
    '',
    '````text',
    prompt.trimEnd(),
    '````',
    '',
  ].join('\n');
}

/** The prompt as a module the app imports (`shared/`: the app may not import `sdk/`). */
function promptModule(prompt) {
  return [
    '// Generated by `node sdk/agents/generate.mjs` from sdk/docs/for-agents.md and the effect-as and',
    '// instrument-as templates (1.800): the one prompt that makes a chat assistant with no folder write a',
    '// whole EST plugin as two files. Change the source, never this file; `--check` and',
    '// sdk/tests/agents.test.ts fail while it differs. Pure: no DOM, no Node, no store.',
    '',
    '/** The line a person replaces with what the plugin should do. */',
    `export const EST_ONE_PROMPT_PLACEHOLDER = ${JSON.stringify(PROMPT_PLACEHOLDER)};`,
    '',
    '/** The prompt, with the placeholder line still in it. */',
    `export const EST_ONE_PROMPT = ${JSON.stringify(prompt)};`,
    '',
    '/**',
    ' * The prompt with the person\'s sentence in the placeholder\'s place (one line: line breaks become',
    ' * spaces). An empty sentence leaves the placeholder.',
    ' * @param {string} sentence',
    ' * @returns {string}',
    ' */',
    'export function onePromptFor(sentence) {',
    '  const line = String(sentence ?? \'\').replace(/\\s+/g, \' \').trim();',
    '  return line ? EST_ONE_PROMPT.replace(EST_ONE_PROMPT_PLACEHOLDER, () => `What I want it to do: ${line}`) : EST_ONE_PROMPT;',
    '}',
    '',
  ].join('\n');
}

/** The parts, by name. @param {string} root */
export function partsOf(root = ROOT) {
  return readdirSync(join(root, PARTS_DIR)).filter((f) => f.endsWith('.md')).sort()
    .map((f) => parsePart(read(root, `${PARTS_DIR}/${f}`), f.replace(/\.md$/, '')));
}

/** Every generated file: its path from the repository's root → its text. @param {string} [root] */
export function generated(root = ROOT) {
  const sections = sectionsOf(read(root, SOURCE));
  const out = new Map();
  const parts = partsOf(root);
  const templates = readdirSync(join(root, 'sdk/templates')).filter((n) => existsSync(join(root, 'sdk/templates', n, 'est.json'))).sort();
  const missing = templates.filter((t) => !parts.some((p) => p.name === t));
  if (missing.length) throw new Error(`${PARTS_DIR}: no part for the template ${missing.join(', ')}`);
  for (const part of parts) {
    if (part.name !== COOKBOOK_PART && !templates.includes(part.name)) throw new Error(`${PARTS_DIR}/${part.name}.md is for no template`);
    const dir = part.name === COOKBOOK_PART ? COOKBOOK_OUT : `sdk/templates/${part.name}`;
    out.set(`${dir}/AGENTS.md`, renderPart(part, sections));
    for (const [file, text] of Object.entries(POINTERS)) out.set(`${dir}/${file}`, text);
    out.set(`${dir}/llms.txt`, llmsText(part));
  }
  for (const name of ['window-ui', 'window-app']) out.set(`${SECTIONS_DIR}/${name}.md`, `${sections.get(name).trim()}\n`);
  const prompt = onePrompt(root, sections);
  out.set(PROMPT_DOC, promptDoc(prompt));
  out.set(PROMPT_MODULE, promptModule(prompt));
  return out;
}

/** The generated files whose committed copy differs (or is missing). @param {string} [root] */
export function stale(root = ROOT) {
  const out = [];
  for (const [rel, text] of generated(root)) {
    let had = null;
    try { had = read(root, rel); } catch { /* missing */ }
    if (had !== text) out.push(rel);
  }
  return out;
}

/** Writes every generated file that differs; the paths written. @param {string} [root] */
export function write(root = ROOT) {
  const gen = generated(root);
  const changed = stale(root);
  for (const rel of changed) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), gen.get(rel));
  }
  return changed;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--check')) {
    const bad = stale();
    for (const f of bad) console.error(`stale: ${f}`);
    if (bad.length) { console.error(`${bad.length} generated assistant file(s) differ from ${SOURCE} and ${PARTS_DIR}/: run node sdk/agents/generate.mjs`); process.exit(1); }
    console.log('the assistant files match their source');
  } else {
    const changed = write();
    console.log(changed.length ? `wrote ${changed.length} file(s):\n${changed.map((f) => `  ${f}`).join('\n')}` : 'nothing to write: the assistant files match their source');
  }
}
