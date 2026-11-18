import { existsSync } from 'node:fs';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { TEMPLATES_DIR, UsageError, flagString, type EstCommand } from '../command';
import { shown } from '../build';
import { PORT_CAPS, PORT_KINDS, scanPort, type PortKind } from '../port';
import { PORT_TEMPLATE, declared, writePort } from '../portWrite';
import { KIT } from './new';
import { SPEC_FILES } from '../../../tools/src/index';
import { EST_UI_TYPES } from '../../../ui/copyRule.mjs';

/**
 * `est port <folder>` (1.805, "Bring your plugin"): reads a C or C++ source tree and writes a new
 * plugin folder beside it: the cpp-clap template with the parameters it found, the original's DSP
 * files copied in, and PORT_PLAN.md, the steps for the person or their assistant. It reads text
 * only (`port.ts`): nothing in the tree is run, built or changed, and no link is followed.
 */
const command: EstCommand = {
  name: 'port',
  summary: 'Start a port: read a C or C++ source folder, write a new plugin folder with its parameters and a port plan',
  usage: [
    'est port <folder | file> [--out <dir>] [--id <reverse-dns id>] [--name <name>] [--json] [--dry-run]',
    '',
    '  folder     your plugin\'s C or C++ source (or one file). It is only read: nothing in it is run,',
    '             built or changed, and no symbolic link is followed.',
    '  --out      the new folder (default <folder>-est beside it); new or empty, never inside <folder>',
    '  --id       the plugin\'s id (default org.example.<name>)',
    '  --name     its name as Cyber shows it (default the audio class\'s name, else the folder\'s)',
    '  --json     print what was found as JSON',
    '  --dry-run  only report: write nothing',
    '',
    'The new folder is the cpp-clap template with the parameters est port found declared, the original\'s',
    'DSP files in src/original/, and PORT_PLAN.md: what was found (files, the classes that process audio,',
    'each parameter and where it was seen), the steps to finish, the maths a module has, the checks, and',
    'what does not port (a native window, threads, files, the network), each use by file and line.',
    'It builds and validates at once (the sound passes through), so the work left is the adapter.',
    `Limits: ${PORT_CAPS.files} source files of at most ${PORT_CAPS.fileBytes >> 20} MiB each; the rest is counted and said.`,
    'Port only code you wrote or whose licence lets you.',
  ].join('\n'),
  valueFlags: ['out', 'id', 'name'],
  async run(args, ctx) {
    const [source] = args.positional;
    if (!source) throw new UsageError('name the folder (or file) that holds the C or C++ source');
    const src = resolve(ctx.cwd, source);
    if (!existsSync(src)) throw new Error(`${source} is not there`);
    const scan = scanPort(src);
    const slug = basename(src, extname(src)).toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '') || 'plugin';
    const dest = resolve(ctx.cwd, flagString(args, 'out') ?? join(dirname(src), `${slug}-est`));
    const dry = args.flags['dry-run'] === true;
    // The same folder `est new cpp-clap` makes (the same scaffold, the same reference files beside est.json).
    const ported = dry ? null : writePort(scan, {
      source: src, dest, id: flagString(args, 'id'), name: flagString(args, 'name'), templatesDir: TEMPLATES_DIR,
      schema: SPEC_FILES.schema, extras: [SPEC_FILES.rules, SPEC_FILES.abi, SPEC_FILES.abi11, EST_UI_TYPES], kit: KIT,
    });
    const params = ported?.parameters ?? declared(scan);
    const kinds = [...new Set(scan.findings.map(f => f.kind))];
    if (args.flags.json) {
      ctx.out(JSON.stringify({
        from: scan.name, out: ported ? shown(ctx.cwd, ported.dir) : null, template: PORT_TEMPLATE,
        id: ported?.id ?? null, name: ported?.name ?? null,
        files: { read: scan.files.length, copied: ported?.copied ?? scan.copy.map(from => ({ from })), skipped: scan.skipped, unread: scan.unread },
        licences: scan.licences, classes: scan.classes, parameters: params, moreParameters: scan.moreParameters,
        doesNotPort: scan.findings.map(f => ({ ...f, what: PORT_KINDS[f.kind].title, instead: PORT_KINDS[f.kind].instead })), moreFindings: scan.moreFindings,
        std: scan.std, stdSeen: scan.stdSeen, caps: PORT_CAPS,
      }, null, 2));
      return 0;
    }
    const count = (k: PortKind) => scan.findings.filter(f => f.kind === k).length + (scan.moreFindings[k] ?? 0);
    ctx.out([
      `read ${scan.files.length} source file${scan.files.length === 1 ? '' : 's'} in ${shown(ctx.cwd, src)} (nothing run, nothing changed)`,
      `  classes that process audio: ${scan.classes.length ? scan.classes.slice(0, 6).map(c => c.name.replace(/[^\w]/g, '')).join(', ') : 'none recognised'}`,
      `  parameters: ${scan.parameters.length ? `${scan.parameters.length} found (${scan.parameters.filter(p => p.todo.length).length} with something to check)` : 'none found: one placeholder declared'}`,
      `  does not port: ${kinds.length ? kinds.map(k => `${PORT_KINDS[k].title.toLowerCase()} (${count(k)})`).join('; ') : 'nothing seen'}`,
      ...(ported ? [
        `made ${shown(ctx.cwd, ported.dir)}: ${ported.name} (${ported.id}), ${ported.copied.length} of the original's files in src/original/`,
        `Next: cd ${shown(ctx.cwd, ported.dir)} && npm install --save-dev --save-exact @cyber-est/cli && npx est validate`,
        '  It passes as it is: the sound goes through unchanged. Then give your assistant one line: "Follow PORT_PLAN.md."',
      ] : ['(--dry-run: nothing written)']),
    ].join('\n'));
    return 0;
  },
};
export default command;
