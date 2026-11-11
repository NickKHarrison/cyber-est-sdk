/**
 * 1.322 (DEV-C follow-up): a developer's own key, signature and publish, shared by the clone's
 * `est keygen`, `est sign` and `est publish` (which also hold the registry owner's modes) and the
 * published CLI's developer-only versions of them (`src/developer/`, which `scripts/sdk-build.mjs`
 * packs in their place: `entrySource(pkg, { developer: true })`). Nothing here reads or writes Cyber's
 * repository.
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { canonicalJson } from '../../../../shared/estRegistry.mjs';
import { generateRegistryKey, signingKeyOf } from '../../tools/src/registry.mjs';
import { cyberUrl, developerSignature, publishBundle, publishMeta, readSession } from '../../tools/src/publishClient.mjs';
import { changelogTopSection } from '../../../../shared/estPluginMeta.mjs';
import { readBundle } from '../../../../src/audio/est/install/bundle';
import { flagString, type CommandContext, type ParsedArgs } from './command';

/** Where a developer's key is by default: `--key`, else `$EST_DEVELOPER_KEY_FILE`, else `~/.est/developer-key.pem`. */
export const developerKeyFile = (args: ParsedArgs, cwd: string): string =>
  resolve(cwd, flagString(args, 'key') ?? process.env.EST_DEVELOPER_KEY_FILE ?? join(homedir(), '.est', 'developer-key.pem'));

/** The git work tree `path` lies in (the nearest folder above with a `.git`), or null. */
export function gitWorkTreeOf(path: string): string | null {
  let dir = resolve(path);
  for (;;) {
    if (existsSync(join(dir, '.git'))) return dir;
    const up = dirname(dir);
    if (up === dir) return null;
    dir = up;
  }
}

/**
 * `est keygen` for a developer: a new Ed25519 key written to `out` (mode 600), never over a file
 * that is there and never inside a git repository (a key in a plugin's folder is one `git add .`
 * from being public). Returns what to paste into Cyber: the public key, its id and fingerprint.
 */
export function writeDeveloperKey(out: string): { file: string; publicKey: string; keyId: string; fingerprint: string } {
  const file = resolve(out);
  const repo = gitWorkTreeOf(dirname(file));
  if (repo) throw new Error(`${file} is inside the git repository at ${repo}: keep your developer key outside every repository (the default is ~/.est/developer-key.pem)`);
  if (existsSync(file)) throw new Error(`${file} exists: keygen never overwrites a key`);
  const k = generateRegistryKey();
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, k.privateKeyPem, { mode: 0o600 });
  try { chmodSync(file, 0o600); } catch { /* not on every file system */ }
  if (process.platform !== 'win32' && (statSync(file).mode & 0o077) !== 0) throw new Error(`${file} could be read by others: set it to mode 600 (chmod 600 ${file})`);
  return { file, publicKey: k.publicKey, keyId: k.keyId, fingerprint: k.fingerprint };
}

export function keygenReport(k: ReturnType<typeof writeDeveloperKey>): string {
  return [
    `wrote your developer key to ${k.file} (keep it there; back it up offline; never commit it)`,
    `  public key  ${k.publicKey}`,
    `  key id      ${k.keyId}`,
    `  fingerprint ${k.fingerprint}`,
    'Paste the public key into Cyber: Settings → Plugins → Developer → Keys.',
  ].join('\n');
}

/** `est sign <file.est> --developer`: your signature, written beside the bundle as `<file>.developer.json`. */
export async function signAsDeveloper(args: ParsedArgs, ctx: CommandContext, file: string): Promise<number> {
  const key = signingKeyOf(readFileSync(developerKeyFile(args, ctx.cwd), 'utf8'));
  const path = resolve(ctx.cwd, file);
  const bytes = new Uint8Array(readFileSync(path));
  const b = await readBundle(bytes);
  const sig = developerSignature(bytes, b.manifest, key);
  writeFileSync(`${path}.developer.json`, `${canonicalJson(sig)}\n`);
  if (args.flags.json) ctx.out(JSON.stringify(sig));
  else ctx.out(`signed ${b.manifest.id} ${b.manifest.version} as its developer\n  sha256 ${sig.payload.contentHash}\n  key ${sig.keyId}\n  wrote ${file}.developer.json`);
  return 0;
}

/**
 * `est publish <file.est>`: the bundle and your signature (`est sign --developer`'s file beside it,
 * or signed now with your key) to Cyber's POST /registry/publish with `est login`'s token. Cyber
 * re-validates it, countersigns it as Community and lists it as early.
 */
export async function publishAsDeveloper(args: ParsedArgs, ctx: CommandContext, file: string, shotFiles: string[] = []): Promise<number> {
  const url = cyberUrl(flagString(args, 'to') ?? '');
  const s = readSession(url);
  if (!s) throw new Error('not logged in (or the hour is up): run est login first');
  const path = resolve(ctx.cwd, file);
  const bytes = new Uint8Array(readFileSync(path));
  const b = await readBundle(bytes);
  const sigFile = `${path}.developer.json`;
  const signature: object = !flagString(args, 'key') && existsSync(sigFile)
    ? JSON.parse(readFileSync(sigFile, 'utf8')) as object
    : developerSignature(bytes, b.manifest, readFileSync(developerKeyFile(args, ctx.cwd), 'utf8'));
  const r = await publishBundle({ url, token: s.token, bytes, signature, earlyOnly: args.flags['early-only'] === true });
  // 1.323 (DEV-D §4): the page's material, sent after the bundle is in.
  const logFile = resolve(ctx.cwd, flagString(args, 'changelog') ?? 'CHANGELOG.md');
  const changelog = existsSync(logFile) ? changelogTopSection(readFileSync(logFile, 'utf8')) : '';
  const links: Record<string, string> = {};
  for (const [flag, key] of [['homepage', 'homepage'], ['source-url', 'source'], ['support', 'support']] as const) { const v = flagString(args, flag); if (v) links[key] = v; }
  const screenshots = shotFiles.map(f => new Uint8Array(readFileSync(resolve(ctx.cwd, f))));
  let meta: { screenshots: number } | null = null;
  if (screenshots.length || changelog || Object.keys(links).length) {
    meta = await publishMeta({ url, token: s.token, id: r.id, version: r.version, ...(changelog ? { changelog } : {}), ...(Object.keys(links).length ? { links } : {}), screenshots }) as { screenshots: number };
  }
  if (args.flags.json) { ctx.out(JSON.stringify(meta ? { ...r, meta } : r)); return 0; }
  ctx.out([
    `published ${r.id} ${r.version} to ${url} (Community, early)`,
    `  sha256 ${r.hash}`,
    r.stagedUntil ? `  staged: latest for others from ${r.stagedUntil} (people with early updates see it now)` : '  listed now (early: new, not reviewed by Cyber)',
    `  a version never changes: to fix something, publish ${r.id} with a new version; est yank ${r.id}@${r.version} hides this one`,
    ...(meta ? [`  its page: ${meta.screenshots} screenshot${meta.screenshots === 1 ? '' : 's'}${changelog ? ', the changelog from CHANGELOG.md' : ''}${Object.keys(links).length ? `, ${Object.keys(links).join(', ')}` : ''} (${url}/plugins/${r.id})`] : []),
  ].join('\n'));
  return 0;
}

/**
 * 1.323 (DEV-D): `est publish`'s positionals: the bundle, and with `--screenshots` the files that are
 * not the bundle (`--screenshots a.png b.png` takes them). Throws when --screenshots has no bundle.
 */
export function publishFiles(args: ParsedArgs): { bundleFile: string | undefined; shotFiles: string[] } {
  const shots = args.flags.screenshots === true;
  const bundleFile = shots ? args.positional.find(p => p.endsWith('.est')) : args.positional[0];
  if (shots && !bundleFile) throw new Error('--screenshots goes with a bundle: est publish <file.est> --screenshots a.png b.png');
  return { bundleFile, shotFiles: shots ? args.positional.filter(p => p !== bundleFile) : [] };
}

/** What the published CLI says to the registry owner's modes, which read and write Cyber's repository. */
export const OWNER_ONLY = (what: string) =>
  `${what} is the registry owner's, run from a clone of Cyber's repository (sdk/packages/cli/bin/est.mjs). This est publishes your own plugins: est keygen, est sign <file.est> --developer, est publish <file.est>.`;
