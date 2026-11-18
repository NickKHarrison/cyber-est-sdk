import type { EstCommand } from '../command';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { readProject } from '../../../tools/src/index';
import { buildAndPack, shown } from '../build';

/**
 * `est pack [dir] [--no-build] [--json] [--print]`: build with the template's build, then pack to `dist/<id>-<version>.est`.
 * 1.786 (V6): `--print` prints the build's commands instead (a C/C++ folder's exact clang lines, through
 * the kit's own `cpp/build.mjs --print`), so a porter needs no Cyber clone for their own build system.
 */
const command: EstCommand = {
  name: 'pack',
  summary: 'Build a plugin folder and pack it to dist/<id>-<version>.est',
  usage: [
    'est pack [dir] [--no-build] [--json] [--print]',
    '',
    '  dir         a plugin folder (default .)',
    '  --no-build  pack the module the last build wrote',
    '  --json      print { file, hash, bytes, id, version }',
    '  --print     print the build\'s commands (C/C++: the exact clang lines) and build nothing',
    '',
    'The archive is canonical: the same files always give the same bytes and the same content hash.',
  ].join('\n'),
  async run(args, ctx) {
    if (args.flags.print) {
      const d = resolve(ctx.cwd, args.positional[0] ?? '.');
      if (!existsSync(join(d, 'est.json'))) throw new Error(`no est.json in ${d} (a plugin folder; \`est new\` makes one)`);
      const project = readProject(d);
      if (!project.build) { ctx.out(`${project.kind}: nothing to build (the module is ${shown(ctx.cwd, project.wasm)})`); return 0; }
      if (project.kind === 'cpp') {
        const r = spawnSync(project.build.cmd, [...project.build.args, '--print'], { cwd: d, encoding: 'utf8' });
        if (r.status !== 0) throw new Error((r.stderr || r.stdout || 'the C/C++ build could not plan').trim());
        ctx.out(`${r.stdout}${r.stderr}`.trim());
        return 0;
      }
      ctx.out([project.build.cmd, ...project.build.args].map(a => (/\s/.test(a) ? JSON.stringify(a) : a)).join(' '));
      return 0;
    }
    const p = buildAndPack(args.positional[0] ?? '.', ctx, { noBuild: args.flags['no-build'] === true });
    if (args.flags.json) ctx.out(JSON.stringify({ file: p.file, hash: p.hash, bytes: p.bytes.length, id: p.id, version: p.version }));
    else ctx.out(`packed ${shown(ctx.cwd, p.file)} (${p.bytes.length} bytes)\n  ${p.id} ${p.version}\n  sha256 ${p.hash}\nNext: est validate`);
    return 0;
  },
};
export default command;
