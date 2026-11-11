import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { inspect } from '../../../tools/src/index';
import { UsageError, type EstCommand } from '../command';

/** `est inspect file.est [--json] [--no-meter]`: what a bundle holds, as Cyber reads it. */
const command: EstCommand = {
  name: 'inspect',
  summary: 'Show a .est bundle\'s manifest, files and module (imports, exports, memory, metering)',
  usage: [
    'est inspect <file.est> [--json] [--no-meter]',
    '',
    '  --json      print the inspection as JSON',
    '  --no-meter  do not meter the module (faster)',
  ].join('\n'),
  async run(args, ctx) {
    const file = args.positional[0];
    if (!file) throw new UsageError('name a .est file');
    const i = await inspect(new Uint8Array(readFileSync(resolve(ctx.cwd, file))), { meter: args.flags['no-meter'] !== true });
    if (args.flags.json) { ctx.out(JSON.stringify(i, null, 2)); return i.refusal ? 1 : 0; }
    const m = i.manifest as { id?: string; version?: string; name?: string; kind?: string; limits?: { memoryPagesMax?: number } } | null;
    const lines = [`${m?.name ?? '?'} (${m?.id ?? '?'} ${m?.version ?? '?'}, ${m?.kind ?? '?'})`, `  sha256 ${i.hash}, ${i.bytes} bytes`];
    if (i.refusal) lines.push(`  REFUSED ${i.refusal.rule}: ${i.refusal.message}`);
    lines.push('  files:');
    for (const f of i.files) lines.push(`    ${f.path}  ${f.bytes} bytes`);
    if (i.module) {
      const mod = i.module;
      lines.push(`  module ${mod.path}: ${mod.bytes} bytes`);
      lines.push(`    imports: ${mod.imports.length ? mod.imports.map(x => `${x.module}.${x.name} (${x.kind})`).join(', ') : 'none'}`);
      lines.push(`    exports: ${mod.exports.map(x => `${x.name} (${x.kind})`).join(', ')}`);
      if (mod.memory) lines.push(`    memory: ${mod.memory.min} to ${mod.memory.max ?? 'unbounded'} pages${mod.memory.imported ? ', imported' : ''}${mod.memory.shared ? ', shared' : ''} (est.json allows ${m?.limits?.memoryPagesMax ?? 256})`);
      lines.push(`    tables: ${mod.tables}${mod.start ? ', a start function' : ''}`);
      if (mod.metered) lines.push('error' in mod.metered ? `    metering: refused (${mod.metered.rule}: ${mod.metered.error})` : `    metered: ${mod.metered.bytes} bytes (+${mod.metered.bytes - mod.bytes}), ${mod.metered.points} points`);
    }
    ctx.out(lines.join('\n'));
    return i.refusal ? 1 : 0;
  },
};
export default command;
