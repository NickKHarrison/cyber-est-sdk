import { OWNER_ONLY, publishAsDeveloper, publishFiles } from '../developerKit';
import { UsageError, type EstCommand } from '../command';

/**
 * The published CLI's `est publish` (1.322, DEV-C follow-up): `est publish <file.est>`, your plugin to
 * Cyber with `est login`'s token. Without a file the command is the registry owner's build from
 * Cyber's repository, which only the clone runs.
 */
const command: EstCommand = {
  name: 'publish',
  summary: 'Publish your .est bundle to Cyber (est login first; est validate it first)',
  usage: [
    'est publish <file.est> [--screenshots a.png b.png …] [--changelog <file>] [--homepage <url>] [--source-url <url>] [--support <url>]',
    '            [--key <your developer key>] [--early-only] [--to <url>] [--json]',
    '',
    '  <file.est>    the bundle to publish (signed with <file>.developer.json if it is there, else with your key now)',
    '  --key         your developer key (default $EST_DEVELOPER_KEY_FILE or ~/.est/developer-key.pem)',
    '  --early-only  never make this version latest for others (only people with early updates see it)',
    '  --screenshots the files after it are the plugin page\'s screenshots (PNG or WebP, at most 6 of 2 MB)',
    '  --changelog   the changelog file (default CHANGELOG.md here): its top section is the version\'s changes',
    '  --homepage, --source-url, --support   https links for the plugin\'s page',
    '  --to          Cyber\'s address (default $EST_CYBER_URL or https://cyber-audio.fly.dev)',
  ].join('\n'),
  valueFlags: ['key', 'to', 'dist', 'source', 'out', 'expires-days', 'changelog', 'homepage', 'source-url', 'support'],
  async run(args, ctx) {
    const { bundleFile, shotFiles } = publishFiles(args);
    if (!bundleFile) throw new UsageError(`est publish without a file: ${OWNER_ONLY('Building the registry from a folder')}`);
    return publishAsDeveloper(args, ctx, bundleFile, shotFiles);
  },
};
export default command;
