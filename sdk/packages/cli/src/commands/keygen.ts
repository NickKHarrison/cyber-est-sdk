import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { writeRegistryKey } from '../../../tools/src/registry.mjs';
import { flagString, REPO_DIR, type EstCommand } from '../command';

/**
 * `est keygen` (EST Phase 5b, 1.305; docs/est/EST_REGISTRY_RUNBOOK.md §1): a new Ed25519 key for the
 * registry. The private key is written outside the repository (mode 600; never overwritten); the
 * public key printed is what the app pins (`EST_REGISTRY_PUBLIC_KEY` on cyber-audio).
 */
const command: EstCommand = {
  name: 'keygen',
  summary: 'Make the registry\'s Ed25519 signing key (outside the repository)',
  owner: 'Make the registry\'s Ed25519 signing key (outside the repository; a developer key: --out ~/.est/developer-key.pem)',
  ownerOnly: true,
  usage: [
    'est keygen [--out <file>] [--json]',
    '',
    '  --out  where the private key goes (default ~/.est/registry-signing-key.pem; never inside the repository)',
  ].join('\n'),
  valueFlags: ['out'],
  async run(args, ctx) {
    const out = resolve(ctx.cwd, flagString(args, 'out') ?? join(homedir(), '.est', 'registry-signing-key.pem'));
    const k = writeRegistryKey(out, REPO_DIR);
    if (args.flags.json) { ctx.out(JSON.stringify({ file: out, publicKey: k.publicKey, keyId: k.keyId, fingerprint: k.fingerprint })); return 0; }
    ctx.out([
      `wrote the private key to ${out} (keep it there; back it up offline; never commit it)`,
      `  public key  ${k.publicKey}`,
      `  key id      ${k.keyId}`,
      `  fingerprint ${k.fingerprint}`,
      'Pin it in the app: fly secrets set EST_REGISTRY_PUBLIC_KEY=<public key> -a cyber-audio',
    ].join('\n'));
    return 0;
  },
};
export default command;
