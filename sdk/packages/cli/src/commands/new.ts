import { spawnSync } from 'node:child_process';
import { readdirSync, existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { COOKBOOK_DIR, SDK_DIR, TEMPLATES_DIR, UsageError, flagString, type CommandContext, type EstCommand } from '../command';
import { shown } from '../build';
import { kebab, scaffold, type Scaffolded } from '../scaffold';
import { SPEC_FILES, TOOL_VERSION } from '../../../tools/src/index';
import { EST_UI_TYPES } from '../../../ui/copyRule.mjs';

/** The plugin folders in `dir` (each with an est.json). */
const folders = (dir: string) => (existsSync(dir) ? readdirSync(dir).filter(n => existsSync(join(dir, n, 'est.json'))).sort() : []);

/** 1.800: the kit a new folder's package.json pins: this command's own package, at its own version. */
export const KIT = Object.freeze({ name: '@cyber-est/cli', version: TOOL_VERSION });
/** 1.800: the recipes' shared assistant files, and the window sections `--ui` and `--app` put in AGENTS.md (sdk/agents/generate.mjs writes both). */
const COOKBOOK_AGENTS = join(SDK_DIR, 'cookbook-agents');
const SECTIONS = join(SDK_DIR, 'agents', 'sections');
/**
 * Whether this is the clone's `est` (the source run from Cyber's repository) and not the installed
 * package: the package has no `packages/cli/src`. The clone's version may not be on npm, so there
 * `est new` installs nothing unless `--install`.
 */
const IN_CLONE = existsSync(join(SDK_DIR, 'packages', 'cli', 'src', 'main.ts'));

/** The two templates the questions choose between (AssemblyScript: no toolchain to install, so `est doctor` cannot fail them). */
export const KIND_TEMPLATES = Object.freeze({ effect: 'effect-as', instrument: 'instrument-as' });
export type Kind = keyof typeof KIND_TEMPLATES;

/** An answer to "instrument or effect?" (`i`, `synth`, `e`, `fx` …); null when it is neither. */
export function kindOf(answer: string): Kind | null {
  const a = answer.trim().toLowerCase();
  if (/^(e|fx|effect|an effect|audio effect)$/.test(a)) return 'effect';
  if (/^(i|inst|instrument|an instrument|synth|synthesizer|synthesiser)$/.test(a)) return 'instrument';
  return null;
}

export interface Answers { idea: string; kind: Kind; name: string }

/**
 * The three questions (what it does, instrument or effect, a name), each asked only when its flag
 * did not answer it. Node's own readline; an input that ends before the answers is a usage error.
 */
export async function ask(input: NodeJS.ReadableStream, out: (text: string) => void, have: Partial<Answers>): Promise<Answers> {
  const rl = createInterface({ input, crlfDelay: Infinity });
  const lines: string[] = [];
  let waiting: ((line: string | null) => void) | null = null;
  let closed = false;
  rl.on('line', (l) => { if (waiting) { const w = waiting; waiting = null; w(l); } else lines.push(l); });
  rl.on('close', () => { closed = true; if (waiting) { const w = waiting; waiting = null; w(null); } });
  const next = (): Promise<string | null> => new Promise((done) => {
    if (lines.length) done(lines.shift()!);
    else if (closed) done(null);
    else waiting = done;
  });
  const answer = async (question: string, ok: (a: string) => boolean, again: string): Promise<string> => {
    for (let tries = 0; tries < 3; tries++) {
      out(tries ? again : question);
      const a = await next();
      if (a === null) throw new UsageError('the questions were not answered (the input ended): name a template and a folder, or pass --kind, --name and --idea');
      if (ok(a.trim())) return a.trim();
    }
    throw new UsageError(again);
  };
  try {
    const idea = have.idea ?? await answer('What should the plugin do? (one sentence)', a => a.length > 0, 'One sentence, for example: a tape echo whose repeats get darker.');
    const kind = have.kind ?? kindOf(await answer('An instrument (it plays notes) or an effect (it changes sound)? [instrument/effect]', a => kindOf(a) !== null, 'Type instrument or effect.'))!;
    const name = have.name ?? await answer('What is it called?', a => kebab(a).length > 0, 'A name with at least one letter or digit, for example: Tape Echo.');
    return { idea, kind, name };
  } finally {
    rl.close();
  }
}

/** `npm install` in the new folder; true when it ran and succeeded. `EST_NPM` names another npm (the tests' stand-in). */
function install(dir: string, ctx: CommandContext): boolean {
  const npm = process.env.EST_NPM || (process.platform === 'win32' ? 'npm.cmd' : 'npm');
  ctx.err(`installing the kit (${KIT.name}@${KIT.version}) in ${shown(ctx.cwd, dir)} …`);
  const r = spawnSync(npm, ['install', '--no-audit', '--no-fund'], { cwd: dir, encoding: 'utf8', shell: process.platform === 'win32' });
  if (r.stdout) ctx.err(r.stdout.trimEnd());
  if (r.stderr) ctx.err(r.stderr.trimEnd());
  return !r.error && r.status === 0;
}

/** The file a person edits, for the closing lines. */
const sourceOf = (dir: string) => ['assembly/index.ts', 'src/lib.rs', 'src/plugin.cpp'].find(f => existsSync(join(dir, f))) ?? 'the source';

/** `est new` (three questions), or `est new <template> <dir> [--id <id>] [--name <name>] [--idea <sentence>] [--ui | --app] [--no-install]`. */
const command: EstCommand = {
  name: 'new',
  summary: 'Make a plugin folder: no arguments asks three questions; or name a template (effect, instrument, sampler, midi-effect, visualiser: -rust or -as, cpp-clap) or a cookbook recipe',
  get usage() {
    const have = folders(TEMPLATES_DIR), recipes = folders(COOKBOOK_DIR);
    return [
      'est new                                   three questions: what it does, instrument or effect, a name',
      'est new --kind <instrument|effect> --name <name> [--idea "<one sentence>"]   the same, with no questions',
      'est new <template> <dir> [--id <reverse-dns id>] [--name <name>] [--idea "<one sentence>"] [--ui | --app]',
      '',
      `  template  one of: ${have.join(', ') || '(none found)'}`,
      `            or a cookbook recipe: ${recipes.join(', ') || '(none found)'}`,
      '  dir       a new or empty folder (with no template: the name in kebab-case)',
      '  --idea    what the plugin should do, in one sentence: written into the folder\'s AGENTS.md ("What to build"),',
      '            so an AI assistant opened in the folder starts from it',
      '  --kind    instrument or effect: picks instrument-as or effect-as (AssemblyScript: nothing else to install)',
      '  --id      the plugin\'s id (default com.example.<name in kebab-case>: fine for your own account;',
      '            a published id starts with your dev.<10 hex> name, and is a rename when you publish)',
      '  --name    its name as Cyber shows it (default: from --id\'s last part, else from <dir>)',
      '  --ui      add a custom UI: ui/index.html, ui/ui.js and ui/style.css, @cyber-est/ui knobs bound to',
      '            the template\'s parameters, and est.json\'s "ui" entry',
      '  --app     (instrument-* and effect-*) the window as an app instead: ui-app/, a Vite build with a',
      '            bridge to the host and a small example app; npm run build:ui writes ui/',
      '  --no-install  do not run npm install in the new folder (also: EST_NO_INSTALL=1)',
      '  --install     run it even from a clone of Cyber\'s repository (where it is off: the clone\'s version may not be on npm)',
      '',
      'The folder stands alone: the template with its id, name, crate and plugin type renamed; the kit\'s library',
      '(est/); the manifest schema, the validator\'s rules, the ABI and the UI library\'s types beside est.json;',
      'AGENTS.md (and two one-line pointers to it) for an AI assistant; and package.json with the kit pinned',
      `(${KIT.name}@${KIT.version}) and the scripts validate, test, dev and pack, so npx est <command> works there.`,
      'With no terminal to ask in (standard input is not a terminal) and no template, pass --kind and --name.',
    ].join('\n');
  },
  valueFlags: ['id', 'name', 'idea', 'kind'],
  async run(args, ctx) {
    let [template, dir] = args.positional;
    let name = flagString(args, 'name');
    let idea = flagString(args, 'idea');
    if (template && !dir) throw new UsageError('name a folder after the template (or run est new with no arguments)');
    if (!template) {
      // 1.800: no template: the three questions, each only when its flag did not answer it; asked only at a terminal.
      const flagKind = flagString(args, 'kind');
      const kind = flagKind === undefined ? undefined : kindOf(flagKind);
      if (kind === null) throw new UsageError(`--kind ${flagKind} is neither instrument nor effect`);
      if (name !== undefined && !kebab(name)) throw new UsageError('--name needs at least one letter or digit');
      let got: Answers;
      if (kind && name) got = { kind, name, idea: idea ?? '' };
      else {
        const input = ctx.input ?? process.stdin;
        if (!(input as { isTTY?: boolean }).isTTY) throw new UsageError('nothing to ask the questions on (standard input is not a terminal): pass --kind and --name, or name a template and a folder');
        got = await ask(input, ctx.out, { idea, kind: kind ?? undefined, name });
      }
      template = KIND_TEMPLATES[got.kind];
      name = got.name;
      idea = got.idea;
      dir = kebab(got.name);
    } else if (args.flags.kind !== undefined) throw new UsageError('--kind picks the template when none is named: leave one of them out');
    // A template by that name first, else a cookbook recipe (DEV-F, 1.321).
    const templatesDir = !existsSync(join(TEMPLATES_DIR, template, 'est.json')) && existsSync(join(COOKBOOK_DIR, template, 'est.json')) ? COOKBOOK_DIR : TEMPLATES_DIR;
    const section = (f: string) => { const p = join(SECTIONS, f); return existsSync(p) ? readFileSync(p, 'utf8') : ''; };
    const r: Scaffolded = scaffold({
      template, dest: resolve(ctx.cwd, dir!), id: flagString(args, 'id'), name, templatesDir,
      schema: SPEC_FILES.schema,
      extras: [SPEC_FILES.rules, SPEC_FILES.abi, SPEC_FILES.abi11, EST_UI_TYPES],
      // 1.789 (V5), 1.800: a recipe gets the cookbook's shared AGENTS.md, its two pointers and llms.txt (a recipe folder carries only its README).
      overlay: templatesDir === COOKBOOK_DIR ? COOKBOOK_AGENTS : undefined,
      idea, windowText: { ui: section('window-ui.md'), app: section('window-app.md') }, kit: KIT,
      ui: args.flags.ui === true, app: args.flags.app === true,
    });
    const where = shown(ctx.cwd, r.dir);
    const named = [r.crate && `crate ${r.crate}`, r.type && `type ${r.type}`, r.ui && 'a custom UI in ui/', r.app && 'the window as an app in ui-app/'].filter(Boolean).join(', ');
    // The install: off with --no-install or EST_NO_INSTALL=1, and from a clone unless --install. A failed install
    // leaves the folder as made and exits 0: the folder exists, and one command finishes it.
    const skip = args.flags['no-install'] === true || process.env.EST_NO_INSTALL === '1' || (IN_CLONE && args.flags.install !== true);
    const installed = !skip && install(r.dir, ctx);
    const manifest = JSON.parse(readFileSync(join(r.dir, 'est.json'), 'utf8')) as { version: string };
    ctx.out([
      `made ${where} from ${template}: ${r.name} (${r.id}), ${r.files} files${named ? ` (${named})` : ''}${r.vendored.length ? `; the SDK code it uses copied into ${r.vendored.join(', ')}` : ''}`,
      ...(installed ? [] : [`${skip ? 'The kit is not installed there yet' : 'npm install did not finish; the folder is made'}. Run: cd ${where} && npm install`]),
      ...(r.app ? ['The window is an app: npm run build:ui builds it into ui/ (AGENTS.md, "The window").'] : []),
      `1. Open ${where} in your AI assistant and say "build it"${r.idea ? ' (your sentence is in AGENTS.md)' : ' (and what it should do: AGENTS.md has the place)'}, or edit ${sourceOf(r.dir)} yourself.`,
      `2. cd ${where} && npx est dev   to hear it.`,
      `3. Drop dist/${r.id}-${manifest.version}.est on Cyber: Home → EST PLUGINS → Add a plugin.`,
    ].join('\n'));
    return 0;
  },
};
export default command;
