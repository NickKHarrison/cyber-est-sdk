import type { EstCommand } from '../command';
import { buildAndPack, shown } from '../build';

/** `est pack [dir] [--no-build] [--json]`: build with the template's build, then pack to `dist/<id>-<version>.est`. */
const command: EstCommand = {
  name: 'pack',
  summary: 'Build a plugin folder and pack it to dist/<id>-<version>.est',
  usage: [
    'est pack [dir] [--no-build] [--json]',
    '',
    '  dir         a plugin folder (default .)',
    '  --no-build  pack the module the last build wrote',
    '  --json      print { file, hash, bytes, id, version }',
    '',
    'The archive is canonical: the same files always give the same bytes and the same content hash.',
  ].join('\n'),
  async run(args, ctx) {
    const p = buildAndPack(args.positional[0] ?? '.', ctx, { noBuild: args.flags['no-build'] === true });
    if (args.flags.json) ctx.out(JSON.stringify({ file: p.file, hash: p.hash, bytes: p.bytes.length, id: p.id, version: p.version }));
    else ctx.out(`packed ${shown(ctx.cwd, p.file)} (${p.bytes.length} bytes)\n  ${p.id} ${p.version}\n  sha256 ${p.hash}\nNext: est validate`);
    return 0;
  },
};
export default command;
