import type { EstCommand } from '../command';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SDK_DIR } from '../command';

const PLACEHOLDER = 'What I want it to do: <one sentence>';
/** The prompt, read from the kit's own page (its ````text block): never bundled, so its example code is not read as imports. */
function onePrompt(sentence: string): string {
  const page = readFileSync(join(SDK_DIR, 'docs', 'ONE_PROMPT.md'), 'utf8');
  const m = /````text\n([\s\S]*?)\n````/.exec(page);
  if (!m?.[1]) throw new Error('sdk/docs/ONE_PROMPT.md has no prompt block');
  const line = sentence.replace(/\s+/g, ' ').trim();
  return line ? m[1].replace(PLACEHOLDER, () => `What I want it to do: ${line}`) : m[1];
}

/**
 * 1.800: `est prompt ["<one sentence>"]`: the one prompt for a chat assistant that has no folder and
 * no tools. Pasted into the chat, it makes the assistant answer with two whole files
 * (`assembly/index.ts` and `est.json`) to paste over the same two in a folder `est new` made (or into
 * Cyber's plugin playground). The text is generated (`sdk/agents/generate.mjs`, from
 * sdk/docs/for-agents.md and the effect-as and instrument-as templates): the same words as
 * sdk/docs/ONE_PROMPT.md and the app's copy.
 */
const command: EstCommand = {
  name: 'prompt',
  summary: 'Print the one prompt for a chat assistant with no folder: it answers with the plugin\'s two files',
  usage: [
    'est prompt ["<one sentence>"]',
    '',
    '  one sentence  what the plugin should do; without it the prompt keeps the line',
    '                "What I want it to do: <one sentence>" for you to fill in',
    '',
    'Paste what it prints into any chat assistant. It answers with assembly/index.ts and est.json, each whole:',
    'paste them over the same two files in a folder made by est new (est new --kind effect --name "My Echo"),',
    'then npx est validate there.',
  ].join('\n'),
  async run(args, ctx) {
    const sentence = args.positional.join(' ');
    ctx.out(onePrompt(sentence).trimEnd());
    return 0;
  },
};
export default command;
