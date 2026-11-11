import { cyberUrl, readSession, yankVersion } from '../../../tools/src/publishClient.mjs';
import { flagString, UsageError, type EstCommand } from '../command';

/**
 * `est yank <id>@<version>` (DEV-C §5, 1.322): hide one of your published versions. It stays
 * installable by its exact pin (projects that use it keep working, with a warning); a version
 * number is never reused. `--undo` unhides it.
 */
const command: EstCommand = {
  name: 'yank',
  summary: 'Hide one of your published versions (still installable by exact pin); --undo unhides it',
  usage: 'est yank <id>@<version> [--undo] [--to <url>] [--json]',
  valueFlags: ['to'],
  async run(args, ctx) {
    const m = /^([a-z0-9][a-z0-9.-]+[a-z0-9])@(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)$/.exec(args.positional[0] ?? '');
    if (!m) throw new UsageError('name the version as <id>@<version>');
    const url = cyberUrl(flagString(args, 'to') ?? '');
    const s = readSession(url);
    if (!s) throw new Error('not logged in (or the hour is up): run est login first');
    const r = await yankVersion({ url, token: s.token, id: m[1]!, version: m[2]!, undo: args.flags.undo === true });
    if (args.flags.json) ctx.out(JSON.stringify(r));
    else ctx.out(`${r.id} ${r.version} is ${r.yanked ? 'yanked (hidden; still installable by its exact pin)' : 'listed again'}`);
    return 0;
  },
};
export default command;
