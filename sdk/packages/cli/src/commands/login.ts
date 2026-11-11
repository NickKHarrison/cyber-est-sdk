import { clearSession, cyberUrl, login, readSession, saveSession, SESSION_FILE } from '../../../tools/src/publishClient.mjs';
import { flagString, type EstCommand } from '../command';

/**
 * `est login` (DEV-C, 1.322; sdk/docs/publishing.md): a one-time code you approve in the browser
 * where you are signed in to Cyber, then a token that publishes as you for one hour, kept in
 * ~/.est/session.json (mode 600). Never a long-lived token; `--logout` deletes it.
 */
const command: EstCommand = {
  name: 'login',
  summary: 'Log in to Cyber to publish (a code you approve in the browser; the token lasts an hour)',
  usage: [
    'est login [--to <url>] [--logout] [--json]',
    '',
    '  --to      Cyber\'s address (default $EST_CYBER_URL or https://cyber-audio.fly.dev)',
    '  --logout  forget the kept token',
    '',
    'You must be a developer first: in Cyber, Settings → Plugins → Become a developer.',
  ].join('\n'),
  valueFlags: ['to'],
  async run(args, ctx) {
    if (args.flags.logout) { clearSession(); ctx.out(`forgot the token (${SESSION_FILE})`); return 0; }
    const url = cyberUrl(flagString(args, 'to') ?? '');
    const kept = readSession(url);
    if (kept && !args.flags.json) ctx.err(`(a token for ${url} is kept until ${kept.expiresAt}; logging in again)`);
    const s = await login({
      url,
      onCode: ({ verifyUrl, userCode }) => {
        ctx.err(`Open ${verifyUrl}\nin the browser where you are signed in to Cyber, check it shows ${userCode}, and approve it.\nWaiting…`);
      },
    });
    saveSession(s);
    if (args.flags.json) { ctx.out(JSON.stringify({ url: s.url, expiresAt: s.expiresAt, developer: s.developer })); return 0; }
    ctx.out(`logged in to ${s.url}${s.developer ? ` as ${s.developer.displayName}` : ''} until ${s.expiresAt}`);
    return 0;
  },
};
export default command;
