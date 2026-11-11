import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { publishAsDeveloper, publishFiles } from '../developerKit';
import { publishRegistry, signingKeyOf, keyFacts } from '../../../tools/src/registry.mjs';
import { flagString, REPO_DIR, type EstCommand } from '../command';

/**
 * `est publish` (EST Phase 5b, 1.305; docs/est/EST_REGISTRY_RUNBOOK.md): build and sign the registry's
 * `/est/v1/` files from the committed bundles and the registry's source folder. D-26: static files on
 * the plugin origin, signed with the owner's key; nothing is uploaded (deploying `cyber-est` serves them).
 *
 * 1.322 (DEV-C §2): `est publish <file.est>` is a developer's publish instead: the bundle and your
 * signature (`est sign --developer`'s file, or signed now with your key) go to Cyber's
 * POST /registry/publish with `est login`'s token; Cyber re-validates it, countersigns it as Community
 * and lists it as early. Without a file the command is the owner's registry build, as before.
 */
const command: EstCommand = {
  name: 'publish',
  summary: 'Publish your .est bundle to Cyber (est publish <file.est>; est login first, est validate it first)',
  owner: 'est publish without a file: build and sign the registry (/est/v1/) from est-plugins/dist and est-plugins/registry',
  usage: [
    'est publish <file.est> [--screenshots a.png b.png …] [--changelog <file>] [--homepage <url>] [--source-url <url>] [--support <url>]',
    '            [--key <your developer key>] [--early-only] [--to <url>] [--json]',
    'est publish [--key <file>] [--dist <dir>] [--source <dir>] [--out <dir>] [--expires-days <n>] [--json]   (the owner\'s registry build)',
    '',
    '  <file.est>    publish this bundle as a developer (est login first; est validate it first)',
    '  --key         with a file: your developer key (default $EST_DEVELOPER_KEY_FILE or ~/.est/developer-key.pem)',
    '  --early-only  never make this version latest for others (only people with early updates see it)',
    '  --screenshots the files after it are the plugin page\'s screenshots (PNG or WebP, at most 6 of 2 MB)',
    '  --changelog   the changelog file (default CHANGELOG.md here): its top section is the version\'s changes',
    '  --homepage, --source-url, --support   https links for the plugin\'s page',
    '  --to          Cyber\'s address (default $EST_CYBER_URL or https://cyber-audio.fly.dev)',
    '',
    'The registry owner\'s build (without a file):',
    '  --key     the Ed25519 private key (PEM or base64 PKCS8); default $EST_REGISTRY_SIGNING_KEY',
    '            (the key itself) or $EST_REGISTRY_SIGNING_KEY_FILE (its path). Never in the repository.',
    '  --dist    the bundles (default est-plugins/dist)',
    '  --source  the registry\'s source folder (default est-plugins/registry)',
    '  --out     where v1/ is written (default est-plugins/registry-dist)',
    '  --expires-days  how long the index and the blocklist stay good (default 7; 1.314, EST-11): republish within it',
    '',
    'A published version never changes: one already in --out with other bytes refuses the publish.',
    'Then: commit --out, deploy cyber-est, and check https://cyber-est.fly.dev/est/v1/index.json.',
  ].join('\n'),
  valueFlags: ['key', 'dist', 'source', 'out', 'expires-days', 'to', 'changelog', 'homepage', 'source-url', 'support'],
  async run(args, ctx) {
    // 1.323 (DEV-D): `--screenshots a.png b.png` takes the positionals that are not the bundle.
    const { bundleFile, shotFiles } = publishFiles(args);
    if (bundleFile) return publishAsDeveloper(args, ctx, bundleFile, shotFiles);
    const keyFile = flagString(args, 'key') ?? process.env.EST_REGISTRY_SIGNING_KEY_FILE;
    const raw = keyFile ? readFileSync(resolve(ctx.cwd, keyFile), 'utf8') : process.env.EST_REGISTRY_SIGNING_KEY;
    const key = signingKeyOf(raw);
    const at = (f: string, d: string) => resolve(flagString(args, f) ? ctx.cwd : REPO_DIR, flagString(args, f) ?? d);
    const days = Number(flagString(args, 'expires-days') ?? 7);
    if (!Number.isFinite(days) || days < 1 || days > 365) throw new Error('--expires-days is a whole number of days, 1 to 365');
    const r = publishRegistry({ distDir: at('dist', 'est-plugins/dist'), sourceDir: at('source', 'est-plugins/registry'), outDir: at('out', 'est-plugins/registry-dist'), privateKey: key, expiresDays: Math.floor(days) });
    const facts = keyFacts(key);
    if (args.flags.json) { ctx.out(JSON.stringify({ dir: r.dir, keyId: r.keyId, versions: r.versions, plugins: r.index.plugins.length, publicKey: facts.publicKey })); return 0; }
    ctx.out([
      `published ${r.index.plugins.length} plugins, ${r.versions} versions, to ${r.dir}`,
      `  key ${r.keyId} (fingerprint ${facts.fingerprint})`,
      `  blocklist: ${r.index.blocklist.length} entr${r.index.blocklist.length === 1 ? 'y' : 'ies'}; expires ${r.index.registry.expiresAt.slice(0, 10)} (republish before then)`,
      'Next: commit est-plugins/registry-dist, deploy cyber-est (fly deploy -c fly.est.toml), check /est/v1/index.json.',
    ].join('\n'));
    return 0;
  },
};
export default command;
