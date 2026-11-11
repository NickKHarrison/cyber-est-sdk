import { OWNER_ONLY, signAsDeveloper } from '../developerKit';
import { UsageError, type EstCommand } from '../command';

/**
 * The published CLI's `est sign` (1.322, DEV-C follow-up): `--developer` only, your signature written
 * beside the bundle as `<file>.developer.json` for `est publish`. The registry owner's countersignature
 * (without `--developer`) is the clone's.
 */
const command: EstCommand = {
  name: 'sign',
  summary: 'Sign a .est bundle as its developer (writes <file>.developer.json for est publish)',
  usage: [
    'est sign <file.est> --developer [--key <file>] [--json]',
    '',
    '  --key  your developer key (default $EST_DEVELOPER_KEY_FILE or ~/.est/developer-key.pem)',
  ].join('\n'),
  valueFlags: ['key', 'tier'],
  async run(args, ctx) {
    const file = args.positional[0];
    if (!file) throw new UsageError('name a .est file');
    if (!args.flags.developer) throw new UsageError(`est sign without --developer: ${OWNER_ONLY('The registry countersignature')}`);
    return signAsDeveloper(args, ctx, file);
  },
};
export default command;
