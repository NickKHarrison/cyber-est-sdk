import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { keygenReport, writeDeveloperKey } from '../developerKit';
import { flagString, type EstCommand } from '../command';

/**
 * The published CLI's `est keygen` (1.322, DEV-C follow-up): your developer key. The private key is
 * written to `--out` (default ~/.est/developer-key.pem; mode 600, never overwritten, never inside a
 * git repository) and the public key printed is what you paste into Cyber's Settings → Plugins →
 * Developer → Keys. The clone's `est keygen` makes the registry owner's key instead.
 */
const command: EstCommand = {
  name: 'keygen',
  summary: 'Make your developer signing key (outside any repository); paste its public key into Cyber',
  usage: [
    'est keygen [--out <file>] [--json]',
    '',
    '  --out  where the private key goes (default ~/.est/developer-key.pem; never inside a git repository)',
  ].join('\n'),
  valueFlags: ['out'],
  async run(args, ctx) {
    const k = writeDeveloperKey(resolve(ctx.cwd, flagString(args, 'out') ?? join(homedir(), '.est', 'developer-key.pem')));
    if (args.flags.json) { ctx.out(JSON.stringify(k)); return 0; }
    ctx.out(keygenReport(k));
    return 0;
  },
};
export default command;
