import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { canonicalJson } from '../../../../../shared/estRegistry.mjs';
import { signBundle, signingKeyOf } from '../../../tools/src/registry.mjs';
import { signAsDeveloper } from '../developerKit';
import { readBundle } from '../../../../../src/audio/est/install/bundle';
import { flagString, UsageError, type EstCommand } from '../command';

/**
 * `est sign <file.est>` (EST Phase 5b, 1.305; registry §3 step 2 and 5): the bundle's signature as
 * the registry gives it (`{ alg, keyId, payload: { id, version, contentHash, tier, publishedAt }, sig }`),
 * written beside it as `<file>.signature.json`. `est publish` signs every version itself; this signs one
 * bundle (to check a key, or for a private registry built by hand).
 *
 * 1.322 (DEV-C): `--developer` signs as a developer instead (your key, `{ id, version, contentHash,
 * publishedAt }`), written as `<file>.developer.json`: what `est publish <file.est>` sends and every
 * Cyber checks at install against the key the registry lists for you.
 */
const command: EstCommand = {
  name: 'sign',
  summary: 'Sign your .est bundle as its developer (--developer; writes <file>.developer.json for est publish)',
  owner: 'est sign <file.est> without --developer: sign a bundle with the registry key (<file>.signature.json)',
  usage: [
    'est sign <file.est> --developer [--key <file>] [--json]',
    'est sign <file.est> [--key <file>] [--tier curated|reviewed|community] [--json]   (the registry owner\'s)',
    '',
    '  --developer  sign as a developer with your own key (default $EST_DEVELOPER_KEY_FILE or',
    '          ~/.est/developer-key.pem); writes <file>.developer.json for est publish',
    '',
    'The registry owner\'s mode (without --developer):',
    '  --key   the Ed25519 private key (PEM or base64 PKCS8); default $EST_REGISTRY_SIGNING_KEY or',
    '          $EST_REGISTRY_SIGNING_KEY_FILE. Never in the repository.',
    '  --tier  the tier the signature states (default curated)',
  ].join('\n'),
  valueFlags: ['key', 'tier'],
  async run(args, ctx) {
    const file = args.positional[0];
    if (!file) throw new UsageError('name a .est file');
    if (args.flags.developer) return signAsDeveloper(args, ctx, file);
    const keyFile = flagString(args, 'key') ?? process.env.EST_REGISTRY_SIGNING_KEY_FILE;
    const key = signingKeyOf(keyFile ? readFileSync(resolve(ctx.cwd, keyFile), 'utf8') : process.env.EST_REGISTRY_SIGNING_KEY);
    const path = resolve(ctx.cwd, file);
    const bytes = new Uint8Array(readFileSync(path));
    const b = await readBundle(bytes);
    const tier = flagString(args, 'tier') ?? 'curated';
    if (!['curated', 'reviewed', 'community'].includes(tier)) throw new UsageError('--tier is curated, reviewed or community');
    const sig = signBundle(bytes, b.manifest, key, { tier });
    writeFileSync(`${path}.signature.json`, `${canonicalJson(sig)}\n`);
    if (args.flags.json) ctx.out(JSON.stringify(sig));
    else ctx.out(`signed ${b.manifest.id} ${b.manifest.version}\n  sha256 ${sig.payload.contentHash}\n  key ${sig.keyId}\n  wrote ${file}.signature.json`);
    return 0;
  },
};
export default command;
