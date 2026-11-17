import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { flagString, REPO_DIR, type EstCommand } from '../command';

/**
 * `est release` (1.686, stream 1 of Cyber_Store_Live_Updates_Work_Order.md): Cyber's **store
 * releases**, the registry owner's only. The STORE's content (bundles, the signed index, packs, the
 * store metadata, card art, demo clips) becomes a signed release pushed to the content store, which
 * the running servers pick up with no deploy: `build`, `verify`, `sign`, `push`, `status`, `revert`.
 *
 * The work is `scripts/est-release.mjs` in Cyber's repository, loaded here by its path at run time (so
 * neither it nor the server modules it uses are bundled into, or exported with, the kit). The command is
 * clone-only (`CLONE_ONLY` in `entry.mjs`): the published @cyber-est/cli leaves it out.
 */
const command: EstCommand = {
  name: 'release',
  summary: 'Cyber\'s store releases (the registry owner\'s: build, verify, sign, push, status, revert)',
  owner: 'build, verify, sign, push, status or revert a signed store release (the content store; live with no deploy)',
  ownerOnly: true,
  usage: [
    'est release build   [--out <dir>] [--serial <n>] [--to <dir>] [--json]',
    'est release verify  [--out <dir>] [--to <dir>] [--public-key <base64>] [--skip-tests] [--json]',
    'est release sign    --key <file> [--renew] [--out <dir>] [--public-key <base64>] [--json]',
    'est release push    [--dry-run] [--out <dir>] [--to <dir>] [--json]',
    'est release status  [--to <dir>] [--json]',
    'est release revert  <serial> [--out <dir>] [--to <dir>] [--json]',
    '',
    '  build    lay out a release from this clean commit (CI\'s verify passed on it) into --out (default .est-release/)',
    '  verify   signing day\'s checks, every file against the manifest, the index\'s key and expiry, the live release',
    '  sign     sign the manifest with the registry key (--key, outside the repository); --renew re-signs the index and blocklist first',
    '  push     blobs, then the manifest, then the pointer (resumable; --dry-run writes nothing)',
    '  status   the live release and the serials the content store holds',
    '  revert   a new release with that serial\'s contents under the next serial (then verify, sign, push)',
    '',
    'The content store is STORE_CONTENT_* in your environment (the write credential), or --to <dir> for a rehearsal.',
    'docs/est/EST_REGISTRY_RUNBOOK.md §9 has the steps.',
  ].join('\n'),
  valueFlags: ['out', 'to', 'serial', 'key', 'public-key'],
  async run(args, ctx) {
    const [sub, ...positional] = args.positional;
    const file = join(REPO_DIR, 'scripts', 'est-release.mjs');
    const mod = await import(/* @vite-ignore */ pathToFileURL(file).href) as {
      runRelease(sub: string, opts: Record<string, unknown>, io: { out(s: string): void, err(s: string): void, cwd: string }): Promise<number>;
      USAGE: string;
    };
    if (!sub) { ctx.err(mod.USAGE); return 2; }
    const opts = {
      positional,
      out: flagString(args, 'out'), to: flagString(args, 'to'), serial: flagString(args, 'serial'),
      key: flagString(args, 'key'), publicKey: flagString(args, 'public-key'),
      renew: !!args.flags.renew, dryRun: !!args.flags['dry-run'], json: !!args.flags.json, skipTests: !!args.flags['skip-tests'],
    };
    return mod.runRelease(sub, opts, { out: ctx.out, err: ctx.err, cwd: ctx.cwd });
  },
};
export default command;
