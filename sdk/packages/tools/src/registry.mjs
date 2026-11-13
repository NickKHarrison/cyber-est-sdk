// @cyber-est/tools: the registry publisher (EST Phase 5b, 1.305; docs/est/EST_REGISTRY_ARCHITECTURE.md §1,
// §3; D-26: static signed files on the plugin origin, published by Cyber with a key the owner holds).
// Node only. `est keygen`, `est sign` and `est publish` (sdk/packages/cli) are command lines over it;
// the browser specs and the server tests build a registry with a throwaway key through it.
//
// `publishRegistry` builds the whole `/est/v1/` tree from the committed bundles (`est-plugins/dist/`:
// reference.json and each `<sha256>/{bundle.est,est.json}`) and the registry's source folder
// (`est-plugins/registry/`: `registry.json` with the name and URL, `blocklist.json`, and per plugin
// `plugins/<id>/meta.json` with its tier, summary, tags, description and changelog):
//   v1/index.json, v1/index.sig, v1/blocklist.json, v1/blocklist.sig,
//   v1/plugins/<id>/meta.json, v1/plugins/<id>/<version>/{est.json, signature.json, bundle.est}.
// **A published version never changes**: a version already in the output with other bytes refuses the
// publish, and its first `publishedAt` is kept. The private key never enters the repository: it is
// read from a file or `EST_REGISTRY_SIGNING_KEY` and `keygen` refuses to write one inside it.
import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, sign as edSign } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { canonicalJson, catalogueOf, hasInvisible, REGISTRY_EXPIRES_DAYS, REGISTRY_TIERS, REGISTRY_VERSION, sanitiseBlocklist, signedBytes } from '../../../../shared/estRegistry.mjs';
import { checkPack, cleanPackPath, fileTypeOf, packBase, packFilePath, packIndexEntry, PACK_JSON_MAX_BYTES, sniffPackAudio } from '../../../../shared/storePack.mjs';

/**
 * 1.314 (EST-14): names only Cyber's own plugins may carry: the vendor "Cyber" (case-folded) and ids
 * under `org.cyber.`. `publishRegistry` refuses them unless the signing key is the owner's
 * (`ownerKeyIds`; with none given, as today with one key, the signing key is the owner's). The
 * publishing service's rule (a developer's upload) is DEV-C's.
 */
export function reservedName(id, vendor) {
  if (typeof id === 'string' && /^org\.cyber(\.|$)/i.test(id)) return `the id ${id} is Cyber's own (org.cyber.*)`;
  if (typeof vendor === 'string' && vendor.trim().toLowerCase() === 'cyber') return 'the vendor "Cyber" is Cyber\'s own';
  return null;
}

const sha256 = (b) => createHash('sha256').update(b).digest('hex');

/** A private key from PEM or base64 PKCS8 DER; throws unless it is Ed25519. */
export function signingKeyOf(raw) {
  const v = String(raw ?? '').trim();
  if (!v) throw new Error('no signing key: pass --key <file> or set EST_REGISTRY_SIGNING_KEY');
  const k = v.startsWith('-----') ? createPrivateKey({ key: v, format: 'pem' }) : createPrivateKey({ key: Buffer.from(v, 'base64'), format: 'der', type: 'pkcs8' });
  if (k.asymmetricKeyType !== 'ed25519') throw new Error('the signing key is not an Ed25519 key');
  return k;
}

/** The raw 32-byte public key of a private key, and its base64 (what the app pins: EST_REGISTRY_PUBLIC_KEY). */
export function publicKeyOf(privateKey) {
  const raw = createPublicKey(privateKey).export({ format: 'der', type: 'spki' }).subarray(12);
  return { raw: new Uint8Array(raw), base64: Buffer.from(raw).toString('base64') };
}
/** The key's id (16 hex) and fingerprint (64 hex in fours), as the hosts show them. */
export function keyFacts(privateKey) {
  const { raw, base64 } = publicKeyOf(privateKey);
  const h = sha256(raw);
  return { publicKey: base64, keyId: h.slice(0, 16), fingerprint: (h.match(/.{4}/g) ?? []).join(' ') };
}

/** A new Ed25519 key pair: the private key as PEM (PKCS8), and the public facts. */
export function generateRegistryKey() {
  const { privateKey } = generateKeyPairSync('ed25519');
  return { privateKeyPem: privateKey.export({ format: 'pem', type: 'pkcs8' }).toString(), ...keyFacts(privateKey) };
}

/** Whether `file` lies inside `dir`. */
const inside = (dir, file) => { const r = relative(resolve(dir), resolve(file)); return !!r && !r.startsWith('..') && !r.startsWith(sep) && !/^[a-z]:/i.test(r); };

/** `est keygen`: write a new private key to `file` (mode 600), never inside `repoDir`. */
export function writeRegistryKey(file, repoDir) {
  if (repoDir && (resolve(file) === resolve(repoDir) || inside(repoDir, file))) throw new Error('the signing key must live outside the repository (e.g. ~/.est/registry-signing-key.pem)');
  if (existsSync(file)) throw new Error(`${file} exists: keygen never overwrites a key`);
  const k = generateRegistryKey();
  mkdirSync(dirname(resolve(file)), { recursive: true });
  writeFileSync(file, k.privateKeyPem, { mode: 0o600 });
  try { chmodSync(file, 0o600); } catch { /* not on every file system */ }
  return k;
}

/** An Ed25519 signature of `kind`'s bytes of `obj`, base64. */
export function signRegistry(kind, obj, privateKey) {
  return edSign(null, Buffer.from(signedBytes(kind, obj)), privateKey).toString('base64');
}

/** A version's countersignature (`signature.json`, §3 step 5). */
export function versionSignature(payload, privateKey) {
  const { keyId } = keyFacts(privateKey);
  return { alg: 'ed25519', keyId, payload, sig: signRegistry('version', payload, privateKey) };
}

/** `est sign <file.est>`: the bundle's countersignature as the registry would give it. */
export function signBundle(bytes, manifest, privateKey, { tier = 'curated', publishedAt = new Date().toISOString() } = {}) {
  return versionSignature({ id: manifest.id, version: manifest.version, contentHash: sha256(bytes), tier, publishedAt }, privateKey);
}

const readJson = (file, fallback) => (existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : fallback);
const writeCanonical = (file, obj) => { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, `${canonicalJson(obj)}\n`); };

/**
 * Build and sign the registry. `distDir`: the bundles (reference.json and `<sha256>/`); `sourceDir`:
 * the registry's source folder (with `catalogue.json` since 1.344: bundles in `distDir` that are not reference ones); `outDir`: where `v1/` is written. `now`: the publish time (tests).
 * `blocklist`: extra entries (tests). Returns what was written.
 * 1.314: `expiresDays` (default 7, EST-11) sets the signed `expiresAt` of the index and the blocklist:
 * a registry must be republished within it or hosts show it as out of date; `ownerKeyIds` (EST-14)
 * names the owner key(s), the only ones that may publish Cyber's reserved names.
 * 1.322 (DEV-C, D-54): `community` `{ keys, developers }` (else `community.json` in the source folder,
 * when there is one): the community keys the owner trusts to sign Community records and each
 * developer's public keys (the app's GET /admin/est-developers/export), signed into the root so the
 * online key's authority is bounded.
 * 1.515 (EST Store Phase C, stream 1): the **sound packs** in `<sourceDir>/packs/<id>/pack.json` (`publishPacks`),
 * their files read from `packsRoot` (default: the repository, two folders above `sourceDir`), signed
 * into the index's `packs`. No pack folder: the index is as before (no `packs` member).
 * @param {{ distDir: string, sourceDir: string, outDir: string, privateKey: any, now?: Date, blocklist?: { id: string, version?: string, hash?: string, reason: string, at: string }[], expiresDays?: number, ownerKeyIds?: string[] | null, community?: { keys: any[], developers?: any[] }, packsRoot?: string }} o
 */
export function publishRegistry({ distDir, sourceDir, outDir, privateKey, now = new Date(), blocklist = [], expiresDays = REGISTRY_EXPIRES_DAYS, ownerKeyIds = null, community = undefined, packsRoot = resolve(sourceDir, '..', '..') }) {
  const key = typeof privateKey === 'string' ? signingKeyOf(privateKey) : privateKey;
  const { keyId } = keyFacts(key);
  const owner = !ownerKeyIds || ownerKeyIds.includes(keyId);
  const expiresAt = new Date(now.getTime() + Math.max(1, expiresDays) * 24 * 60 * 60 * 1000).toISOString();
  const v1 = join(outDir, 'v1');
  const source = readJson(join(sourceDir, 'registry.json'), {});
  // 1.344: the registry also signs the catalogue's bundles (`<sourceDir>/catalogue.json`, written by
  // scripts/est-catalogue-add.mjs): plugins built elsewhere, in dist/ by hash like the reference
  // ones but never built into the app.
  const reference = [...readJson(join(distDir, 'reference.json'), [])];
  for (const c of readJson(join(sourceDir, 'catalogue.json'), [])) if (!reference.some(r => r.hash === c.hash)) reference.push(c);
  const before = readJson(join(v1, 'index.json'), null);
  const at = now.toISOString();
  const publishedBefore = new Map();
  for (const e of before ? catalogueOf({ plugins: before.plugins ?? [], blocklist: [] }) : []) publishedBefore.set(`${e.id}@${e.version}`, e.hash);
  const prevAt = new Map();
  for (const p of before?.plugins ?? []) for (const v of p.versions ?? []) prevAt.set(`${p.id}@${v.version}`, v.publishedAt);

  const byId = new Map();
  for (const r of reference) {
    const dir = join(distDir, r.hash);
    const bytes = readFileSync(join(dir, 'bundle.est'));
    if (sha256(bytes) !== r.hash) throw new Error(`${r.id} ${r.version}: est-plugins/dist/${r.hash}/bundle.est is not its hash`);
    const manifest = JSON.parse(readFileSync(join(dir, 'est.json'), 'utf8'));
    if (manifest.id !== r.id || manifest.version !== r.version) throw new Error(`${r.hash}: its est.json names ${manifest.id} ${manifest.version}, not ${r.id} ${r.version}`);
    const was = publishedBefore.get(`${r.id}@${r.version}`);
    if (was && was !== r.hash) throw new Error(`${r.id} ${r.version} was published with other bytes (${was}): a published version never changes; give it a new version`);
    const meta = readJson(join(sourceDir, 'plugins', r.id, 'meta.json'), {});
    const tier = REGISTRY_TIERS.includes(meta.tier) ? meta.tier : 'curated';
    // 1.314 (EST-14): Cyber's names are the owner key's; no display text carries invisible or direction characters.
    const reserved = reservedName(r.id, manifest.vendor);
    if (reserved && !owner) throw new Error(`${r.id} ${r.version}: ${reserved}: only the owner key publishes it`);
    for (const [field, v] of [['name', manifest.name], ['vendor', manifest.vendor], ['description', manifest.description], ['summary', meta.summary]]) {
      if (typeof v === 'string' && hasInvisible(v)) throw new Error(`${r.id} ${r.version}: its ${field} has a zero-width or direction character`);
    }
    const publishedAt = prevAt.get(`${r.id}@${r.version}`) || at;
    const base = `plugins/${r.id}/${r.version}`;
    const version = {
      version: r.version, contentHash: r.hash, bundleUrl: `${base}/bundle.est`, manifestUrl: `${base}/est.json`, signatureUrl: `${base}/signature.json`,
      publishedAt, tier, estAbi: String(manifest.abi?.est ?? '1.0'), compat: String(manifest.compat?.host ?? ''), sizeBytes: bytes.length,
      cpuClass: String(meta.cpuClass ?? 'light'), ...(r.superseded ? { superseded: true } : {}),
    };
    const p = byId.get(r.id) ?? {
      id: r.id, name: manifest.name ?? r.name, vendor: manifest.vendor ?? '', kind: manifest.kind === 'instrument' ? 'instrument' : 'effect',
      features: Array.isArray(manifest.features) ? manifest.features : [], tier, tags: Array.isArray(meta.tags) ? meta.tags : [],
      summary: String(meta.summary ?? manifest.description ?? ''), icon: null, versions: [], meta,
    };
    p.versions.push(version);
    byId.set(r.id, p);
    // The version's files (immutable: written once, the same bytes every time).
    const vdir = join(v1, base);
    mkdirSync(vdir, { recursive: true });
    writeFileSync(join(vdir, 'bundle.est'), bytes);
    writeFileSync(join(vdir, 'est.json'), readFileSync(join(dir, 'est.json')));
    writeCanonical(join(vdir, 'signature.json'), versionSignature({ id: r.id, version: r.version, contentHash: r.hash, tier, publishedAt }, key));
  }

  const newest = (vs) => vs.filter(v => !v.superseded).map(v => v.version).sort((a, b) => cmp(b, a))[0] ?? vs[0].version;
  const plugins = [...byId.values()].map(({ meta, ...p }) => {
    writeCanonical(join(v1, 'plugins', p.id, 'meta.json'), {
      id: p.id, description: String(meta.description ?? p.summary), changelog: Array.isArray(meta.changelog) ? meta.changelog : [],
      links: meta.links ?? {}, license: String(meta.license ?? 'MIT'),
    });
    return { ...p, latest: newest(p.versions), versions: p.versions.map(({ superseded: _s, ...v }) => v).sort((a, b) => cmp(b.version, a.version)) };
  });
  const packs = publishPacks({ sourceDir, packsRoot, v1, before, at, key, owner });
  const communityRoot = community ?? readJson(join(sourceDir, 'community.json'), null);
  const block = sanitiseBlocklist([...readJson(join(sourceDir, 'blocklist.json'), []), ...blocklist]);
  const index = {
    est: REGISTRY_VERSION,
    registry: { name: String(source.name ?? 'Cyber EST registry'), url: String(source.url ?? ''), keyId, updatedAt: at, expiresAt },
    plugins, blocklist: block,
    ...(communityRoot ? { community: communityRoot } : {}),
    ...(packs.length ? { packs } : {}),
  };
  writeCanonical(join(v1, 'index.json'), index);
  writeCanonical(join(v1, 'index.sig'), { alg: 'ed25519', keyId, sig: signRegistry('index', index, key) });
  const bl = { est: REGISTRY_VERSION, registry: { keyId, updatedAt: at, expiresAt }, blocklist: block };
  writeCanonical(join(v1, 'blocklist.json'), bl);
  writeCanonical(join(v1, 'blocklist.sig'), { alg: 'ed25519', keyId, sig: signRegistry('blocklist', bl, key) });
  return { index, dir: v1, keyId, versions: plugins.reduce((n, p) => n + p.versions.length, 0) };
}

/**
 * 1.515: a pack version's countersignature (`signature.json`), as a plugin version's: the record's
 * hash under the registry key, in the `pack` kind's bytes.
 */
export function packSignature(payload, privateKey) {
  const { keyId } = keyFacts(privateKey);
  return { alg: 'ed25519', keyId, payload, sig: signRegistry('pack', payload, privateKey) };
}

/**
 * 1.515 (EST Store Phase C, stream 1): sign the sound packs into `v1/`. Each source folder
 * `<sourceDir>/packs/<id>/` holds a `pack.json`:
 *
 *   { id, version, kind, name, summary, tags, licence, preview?: <path>, files: [{ path, src }] }
 *
 * `path` is the file's name inside the pack (what the person sees in the Browser), `src` where its
 * bytes are, relative to `packsRoot` and never outside it. Every file is read, hashed and checked:
 * audio must sniff as audio (an upload's rule), a `program.json` must be a PAD program, a preset must be
 * JSON; anything else is refused, so a pack never holds code. The record (shared/storePack.mjs
 * `checkPack`) goes to `v1/packs/<id>/<version>/pack.json` in canonical JSON, its signature beside it,
 * and each file to `files/<sha256>.pack`. **A published pack version never changes**: one already in
 * the index with another record refuses the publish, and its first `publishedAt` is kept. Cyber's own
 * names (`org.cyber.*`, `reservedName`) are the owner key's alone. Returns the index's `packs` lines.
 */
/** @param {{ sourceDir: string, packsRoot: string, v1: string, before?: any, at: string, key: any, owner?: boolean }} o @returns {any[]} */
export function publishPacks({ sourceDir, packsRoot, v1, before = null, at, key, owner = true }) {
  const dir = join(sourceDir, 'packs');
  if (!existsSync(dir)) return [];
  const prev = new Map((Array.isArray(before?.packs) ? before.packs : []).map((p) => [`${p.id}@${p.version}`, p]));
  const out = [];
  for (const name of readdirSync(dir).sort()) {
    const file = join(dir, name, 'pack.json');
    if (!existsSync(file)) continue;
    const src = JSON.parse(readFileSync(file, 'utf8'));
    if (src.id !== name) throw new Error(`packs/${name}/pack.json names ${src.id}: the folder is its id`);
    const reserved = reservedName(src.id, '');
    if (reserved && !owner) throw new Error(`pack ${src.id}: ${reserved}: only the owner key publishes it`);
    if (!Array.isArray(src.files)) throw new Error(`pack ${src.id}: it lists no files`);
    const bytesOf = new Map();
    const files = src.files.map((f) => {
      const p = cleanPackPath(f?.path);
      if (!p) throw new Error(`pack ${src.id}: ${JSON.stringify(f?.path)} is not a plain relative path`);
      const type = fileTypeOf(p);
      if (!type) throw new Error(`pack ${src.id}: ${p} is not audio, a program.json or preset JSON`);
      const from = resolve(packsRoot, String(f.src ?? ''));
      if (!inside(packsRoot, from)) throw new Error(`pack ${src.id}: ${p}'s src is outside the packs' root`);
      const bytes = readFileSync(from);
      if (type === 'audio' && !sniffPackAudio(bytes)) throw new Error(`pack ${src.id}: ${p} is not audio Cyber reads`);
      if (type !== 'audio') {
        if (bytes.length > PACK_JSON_MAX_BYTES) throw new Error(`pack ${src.id}: ${p} is too large`);
        let doc;
        try { doc = JSON.parse(bytes.toString('utf8')); } catch { throw new Error(`pack ${src.id}: ${p} is not JSON`); }
        if (type === 'program' && !(doc?.app === 'cyber' && doc?.kind === 'padProgram')) throw new Error(`pack ${src.id}: ${p} is not a PAD program`);
      }
      const hash = sha256(bytes);
      bytesOf.set(hash, bytes);
      return { path: p, hash, bytes: bytes.length, type };
    });
    const preview = src.preview === undefined ? undefined : files.find((f) => f.path === src.preview)?.hash;
    if (src.preview !== undefined && !preview) throw new Error(`pack ${src.id}: its preview ${src.preview} is not one of its files`);
    for (const [field, v] of [['name', src.name], ['summary', src.summary], ['licence', src.licence]]) {
      if (typeof v === 'string' && hasInvisible(v)) throw new Error(`pack ${src.id}: its ${field} has a zero-width or direction character`);
    }
    const checked = checkPack({ id: src.id, version: src.version, kind: src.kind, name: src.name, summary: src.summary ?? '', tags: src.tags ?? [], licence: src.licence, files, ...(preview ? { previewHash: preview } : {}) });
    if (!checked.ok) throw new Error(`pack ${checked.error}`);
    const pack = checked.pack;
    const record = Buffer.from(`${canonicalJson(pack)}\n`);
    const recordHash = sha256(record);
    const was = prev.get(`${pack.id}@${pack.version}`);
    if (was && was.recordHash !== recordHash) throw new Error(`pack ${pack.id} ${pack.version} was published with another record: a published pack never changes; give it a new version`);
    const publishedAt = was?.publishedAt || at;
    const base = join(v1, packBase(pack.id, pack.version));
    mkdirSync(join(base, 'files'), { recursive: true });
    writeFileSync(join(base, 'pack.json'), record);
    writeCanonical(join(base, 'signature.json'), packSignature({ id: pack.id, version: pack.version, recordHash, publishedAt }, key));
    for (const f of pack.files) writeFileSync(join(v1, packFilePath(pack.id, pack.version, f.hash)), bytesOf.get(f.hash));
    out.push(packIndexEntry(pack, { recordHash, publishedAt }));
  }
  // Every version of a pack published before stays listed (as a plugin's versions do).
  for (const [k, p] of prev) if (!out.some((o) => `${o.id}@${o.version}` === k) && existsSync(join(v1, p.recordUrl))) out.push(p);
  return out.sort((a, b) => a.id.localeCompare(b.id) || cmp(a.version, b.version));
}

/** Semver order of the numbers (as the client's `compareEstVersions`, enough for the registry's own). */
function cmp(a, b) {
  const x = a.split(/[-+]/)[0].split('.').map(Number), y = b.split(/[-+]/)[0].split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) - (y[i] ?? 0);
  return 0;
}
