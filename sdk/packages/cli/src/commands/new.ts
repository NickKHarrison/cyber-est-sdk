import { readdirSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { COOKBOOK_DIR, TEMPLATES_DIR, UsageError, flagString, type EstCommand } from '../command';
import { shown } from '../build';
import { scaffold } from '../scaffold';
import { SPEC_FILES } from '../../../tools/src/index';
import { EST_UI_TYPES } from '../../../ui/copyRule.mjs';

/** The plugin folders in `dir` (each with an est.json). */
const folders = (dir: string) => (existsSync(dir) ? readdirSync(dir).filter(n => existsSync(join(dir, n, 'est.json'))).sort() : []);

/** `est new <template> <dir> [--id <id>] [--name <name>] [--ui | --app]`. */
const command: EstCommand = {
  name: 'new',
  summary: 'Make a plugin folder from a template (effect, instrument, sampler, midi-effect, visualiser: -rust or -as, cpp-clap) or a cookbook recipe',
  get usage() {
    const have = folders(TEMPLATES_DIR), recipes = folders(COOKBOOK_DIR);
    return [
      'est new <template> <dir> [--id <reverse-dns id>] [--name <name>] [--ui | --app]',
      '',
      `  template  one of: ${have.join(', ') || '(none found)'}`,
      `            or a cookbook recipe (sdk/docs/cookbook.md): ${recipes.join(', ') || '(none found)'}`,
      '  dir       a new or empty folder',
      '  --id      the plugin\'s id (default org.example.<dir>)',
      '  --name    its name as Cyber shows it (default from <dir>)',
      '  --ui      add a custom UI: ui/index.html, ui/ui.js and ui/style.css, @cyber-est/ui knobs bound to',
      '            the template\'s parameters, and est.json\'s "ui" entry',
      '  --app     (instrument-* and effect-*) the window as an app instead: ui-app/, a Vite build with a',
      '            bridge to the host and a small example app, and package.json, whose npm run build:ui',
      '            writes ui/ (npm install first, or a Cyber clone\'s Vite: AGENTS.md); est.json\'s "ui" entry',
      '',
      'The template is copied with its id, its name, its crate and its plugin type renamed from the id;',
      'the SDK code it uses is copied in, and beside est.json the manifest schema, the validator\'s rules',
      '(est-validator-rules.json), the ABI (est-abi-1.0.json, and est-abi-1.1.json for EST 1.1) and the UI',
      'library\'s types (est-ui.d.ts),',
      'so the folder stands alone. Then: est doctor, then est validate (it builds and packs first).',
    ].join('\n');
  },
  valueFlags: ['id', 'name'],
  async run(args, ctx) {
    const [template, dir] = args.positional;
    if (!template || !dir) throw new UsageError('name a template and a folder');
    // A template by that name first, else a cookbook recipe (DEV-F, 1.321).
    const templatesDir = !existsSync(join(TEMPLATES_DIR, template, 'est.json')) && existsSync(join(COOKBOOK_DIR, template, 'est.json')) ? COOKBOOK_DIR : TEMPLATES_DIR;
    const r = scaffold({
      template, dest: resolve(ctx.cwd, dir), id: flagString(args, 'id'), name: flagString(args, 'name'), templatesDir,
      schema: SPEC_FILES.schema, extras: [SPEC_FILES.rules, SPEC_FILES.abi, SPEC_FILES.abi11, EST_UI_TYPES], ui: args.flags.ui === true, app: args.flags.app === true,
    });
    const named = [r.crate && `crate ${r.crate}`, r.type && `type ${r.type}`, r.ui && 'a custom UI in ui/', r.app && 'the window as an app in ui-app/'].filter(Boolean).join(', ');
    const next = r.app
      ? `Next: cd ${shown(ctx.cwd, r.dir)} && npm install && npm run build:ui && est validate   (the window builds into ui/; read AGENTS.md, "The window as an app")`
      : `Next: cd ${shown(ctx.cwd, r.dir)} && est doctor && est validate   (it builds and packs first; read AGENTS.md)`;
    ctx.out([
      `made ${shown(ctx.cwd, r.dir)} from ${template}: ${r.name} (${r.id}), ${r.files} files${named ? ` (${named})` : ''}${r.vendored.length ? `; the SDK code it uses copied into ${r.vendored.join(', ')}` : ''}`,
      next,
      // A bare `npx est` where @cyber-est/cli is not installed fetches npm's unrelated package `est`.
      'Where est is not installed, write npx @cyber-est/cli <command> (never a bare npx est).',
    ].join('\n'));
    return 0;
  },
};
export default command;
