/**
 * 1.200 (Cyber_Music_Bench_And_Scale_Work_Order.md, T2): the factory Drum Rack kit **8-bit Kit**:
 * sixteen pads of the stock bank's 8-bit drums (`public/samples/stock/8bit/`, rendered by 8-BIT's
 * own processor in `scripts/stock-samples.mjs`), on the General MIDI layout the other factory kits
 * use (the kick on pad 1, the snare on pad 3, the hats choking each other in group 1, one tom tuned
 * down the pads). A pad's sample is the stock sound by hash, as an upload is: signed out it plays
 * from the site (`clipBuffers.ts`' loader, `stockFile`), signed in placing the kit copies each one
 * into the person's uploads first (`ensureInProject`, `copyStockToUploads`). The hashes are the
 * manifest's: `chipKit.test.ts` checks every one against it.
 */

export interface ChipKitPad {
  /** The pad (0–15). */
  pad: number;
  /** The pad's name. */
  label: string;
  /** The stock sound's id and name (`manifest.json`; the upload is named `<name>.wav`). */
  id: string;
  name: string;
  /** Its SHA-256. */
  hash: string;
  tune?: number;
  level?: number;
  choke?: number;
}

const KICK_LOW = 'e3ce82565ad124da47498d74244dcfc9c58e66cc670337e43eca6f083bfe80f1';
const BLIP = '157e6fd75a1f80654bd88f03241910fbdcdb7507266ebfa9372b30bdea7fc3cc';
const SNARE = '93cea0ee4ada3764882c7ee358d6afdaba62dc1c331b0189498c9d3f013b350f';
const CLAP = '8c741f7c76ec0c61652657cd3219ba5f297603224fc92531f963fa6161a79a50';
const NOISE_SNARE = 'ed2f1a09cfe51570eddc76fe69c6f20b8e0b484a6d5149ccdf726eaf20c307e0';
const TOM = '2dc8307b0c8531876b58f446a55dfa8b228a26851fd259c65ef8f2fe091bd98f';
const NOISE_HAT = '35a7f33e8289bf22bfa144d26297cc9e9b7bb1548d6ad9dc8c5be87fcbf0e0dc';
const METAL_HAT = 'd38dfc79f7193905116b2f2a071d4b4a97887a9765eaec12a571f46b2a116fae';
const HAT_OPEN = 'd33d5c8930b59ea9935af45e08e669dfc1ef823c75880042c5c79a1b021e4201';
const KICK_HIGH = '2be4ec20c01128de31feb90fae0a825ceba458ceae1917f9d34fee02caaa72c4';
const NOISE_KICK = '2d509e3c1cca4929a24b43f9ee9a73dd97f673429c16b82b7f58dad65377734b';
const CRASH = '450fd50b85e0059e257c75b8ca5736391efc7b2e253106e7b087e804b489e7fb';
const ZAP = '2aa6fad5bd78816e6ecb6f99b6bdca28a2b510519e1f4d461df781311d2b4b6c';

export const CHIP_KIT_PADS: readonly ChipKitPad[] = Object.freeze([
  { pad: 0, label: 'Kick', id: '8bit-kick-low', name: '8-bit Kick Low', hash: KICK_LOW },
  { pad: 1, label: 'Blip', id: '8bit-blip', name: '8-bit Blip', hash: BLIP, level: -3 },
  { pad: 2, label: 'Snare', id: '8bit-snare', name: '8-bit Snare', hash: SNARE },
  { pad: 3, label: 'Clap', id: '8bit-clap', name: '8-bit Clap', hash: CLAP },
  { pad: 4, label: 'Noise snare', id: '8bit-noise-snare', name: '8-bit Noise Snare', hash: NOISE_SNARE },
  { pad: 5, label: 'Low tom', id: '8bit-tom', name: '8-bit Tom', hash: TOM, tune: -5 },
  { pad: 6, label: 'Closed hat', id: '8bit-noise-hat', name: '8-bit Noise Hat', hash: NOISE_HAT, choke: 1 },
  { pad: 7, label: 'Floor tom', id: '8bit-tom', name: '8-bit Tom', hash: TOM, tune: -8 },
  { pad: 8, label: 'Metal hat', id: '8bit-metal-hat', name: '8-bit Metal Hat', hash: METAL_HAT, choke: 1 },
  { pad: 9, label: 'Mid tom', id: '8bit-tom', name: '8-bit Tom', hash: TOM, tune: -2 },
  { pad: 10, label: 'Open hat', id: '8bit-hat-open', name: '8-bit Hat Open', hash: HAT_OPEN, choke: 1 },
  { pad: 11, label: 'High kick', id: '8bit-kick-high', name: '8-bit Kick High', hash: KICK_HIGH },
  { pad: 12, label: 'Noise kick', id: '8bit-noise-kick', name: '8-bit Noise Kick', hash: NOISE_KICK },
  { pad: 13, label: 'Crash', id: '8bit-crash', name: '8-bit Crash', hash: CRASH, level: -3 },
  { pad: 14, label: 'High tom', id: '8bit-tom', name: '8-bit Tom', hash: TOM, tune: 3 },
  { pad: 15, label: 'Zap', id: '8bit-zap', name: '8-bit Zap', hash: ZAP, level: -3 },
]);
