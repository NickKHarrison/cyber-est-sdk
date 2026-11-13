import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { canonicalJson } from '../../../../../shared/estRegistry.mjs';
import { keyFacts, publishRegistry, signBundle, signingKeyOf } from '../../../tools/src/registry.mjs';
import { signAsDeveloper } from '../developerKit';
import { readBundle } from '../../../../../src/audio/est/install/bundle';
import { flagString, REPO_DIR, UsageError, type EstCommand } from '../command';

/**
 * `est sign <file.est>` (EST Phase 5b, 1.305; registry §3 step 2 and 5): the bundle's signature as
 * the registry gives it (`{ alg, keyId, payload: { id, version, contentHash, tier, publishedAt }, sig }`),
 * written beside it as `<file>.signature.json`. `est publish` signs every version itself; this signs one
 * bundle (to check a key, or for a private registry built by hand).
 *
 * 1.322 (DEV-C): `--developer` signs as a developer instead (your key, `{ id, version, contentHash,
 * publishedAt }`), written as `<file>.developer.json`: what `est publish <file.est>` sends and every
 * Cyber checks at install against the key the registry lists for you.
 *
 * 1.508 (EST Store Phase B, stream 4): `--review <est-review-export.json>` signs an admin's review
 * approvals into the registry with the owner key: each approved bundle (beside the export, or in
 * `--bundles <dir>`) is checked against its approved hash, laid into est-plugins/ with its meta.json's
 * tier `reviewed` (scripts/est-review-apply.mjs, only in Cyber's clone), and the registry is signed as
 * `est publish` signs it. docs/est/EST_REGISTRY_RUNBOOK.md §7.
 */
const command: EstCommand = {
  name: 'sign',
  summary: 'Sign your .est bundle as its developer (--developer; writes <file>.developer.json for est publish)',
  owner: 'est sign <file.est> without --developer: sign a bundle with the registry key (<file>.signature.json)',
  usage: [
    'est sign <file.est> --developer [--key <file>] [--json]',
    'est sign <file.est> [--key <file>] [--tier curated|reviewed|community] [--json]   (the registry owner\'s)',
    'est sign --review <est-review-export.json> [--bundles <dir>] [--key <file>] [--json]   (the registry owner\'s)',
    '',
    '  --developer  sign as a developer with your own key (default $EST_DEVELOPER_KEY_FILE or',
    '          ~/.est/developer-key.pem); writes <file>.developer.json for est publish',
    '',
    'The registry owner\'s mode (without --developer):',
    '  --key   the Ed25519 private key (PEM or base64 PKCS8); default $EST_REGISTRY_SIGNING_KEY or',
    '          $EST_REGISTRY_SIGNING_KEY_FILE. Never in the repository.',
    '  --tier  the tier the signature states (default curated)',
    '  --review  sign an admin\'s review export into the registry as Reviewed (the bundles beside it,',
    '          or in --bundles), then commit est-plugins/ and deploy cyber-est as after est publish',
  ].join('\n'),
  valueFlags: ['key', 'tier', 'review', 'bundles'],
  async run(args, ctx) {
    const review = flagString(args, 'review');
    if (review) return signReview(review, args, ctx);
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

/** `est sign --review`: the review export laid into est-plugins/ and the registry signed with the owner key. */
async function signReview(exportFile: string, args: Parameters<EstCommand['run']>[0], ctx: Parameters<EstCommand['run']>[1]): Promise<number> {
  const script = join(REPO_DIR, 'scripts', 'est-review-apply.mjs');
  if (!existsSync(script)) throw new Error('est sign --review runs in Cyber\'s own clone (scripts/est-review-apply.mjs)');
  const keyFile = flagString(args, 'key') ?? process.env.EST_REGISTRY_SIGNING_KEY_FILE;
  // The key first: nothing is laid in without a key that can sign.
  const key = signingKeyOf(keyFile ? readFileSync(resolve(ctx.cwd, keyFile), 'utf8') : process.env.EST_REGISTRY_SIGNING_KEY);
  const bundles = flagString(args, 'bundles');
  const mod = await import(pathToFileURL(script).href) as { applyReviewExport(file: string, o?: { bundlesDir?: string }): { id: string; version: string; hash: string }[] };
  const done = mod.applyReviewExport(resolve(ctx.cwd, exportFile), bundles ? { bundlesDir: resolve(ctx.cwd, bundles) } : {});
  const r = publishRegistry({ distDir: join(REPO_DIR, 'est-plugins/dist'), sourceDir: join(REPO_DIR, 'est-plugins/registry'), outDir: join(REPO_DIR, 'est-plugins/registry-dist'), privateKey: key });
  const facts = keyFacts(key);
  if (args.flags.json) { ctx.out(JSON.stringify({ reviewed: done, keyId: r.keyId, versions: r.versions })); return 0; }
  ctx.out([
    ...done.map(d => `reviewed ${d.id} ${d.version} (sha256 ${d.hash})`),
    `signed the registry: ${r.index.plugins.length} plugins, ${r.versions} versions, key ${r.keyId} (fingerprint ${facts.fingerprint})`,
    'Next: commit est-plugins/, deploy cyber-est, then Admin → Store → Review queue → Check the registry again.',
  ].join('\n'));
  return 0;
}
export default command;
