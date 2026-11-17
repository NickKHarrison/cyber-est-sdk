// The SDK library's steal rule on the toolkit's allocator (1.666). Import it from this file
// ("../../tools/dsp/oldest"); `index.ts` does not re-export it (see the class's note).

import { SLOT_HELD, SLOT_IDLE, SLOT_STEAL, VoiceAllocator } from "./voices";

/**
 * The allocator with the SDK library's `Voices` steal rule (1.666): an idle voice first, else the
 * oldest note whatever its state, held, pedal-held or released. For a plugin moved onto the toolkit
 * from that library, so a steal takes the voice it always took and the sound stays the same to the
 * sample. Everything else (NOTE_END, the release marks, the pedal, choke groups, a steal fade) is the
 * allocator's own; a voice fading for a waiting note is still taken last and a choke's fade first.
 * A subclass in a file of its own, never re-exported from `index.ts`: overriding `pick` makes it virtual
 * in any program that parses the subclass, so a plugin on `VoiceAllocator` alone compiles to the bytes it did.
 */
export class OldestVoiceAllocator extends VoiceAllocator {
  pick(protectPlayed: bool = false): i32 {
    const n = this.slots.length;
    for (let i = 0; i < n; i++) if (unchecked(this.slots[i]).state == SLOT_IDLE) return i;
    let best = -1, bestClass = 99;
    let bestAge: i64 = 0;
    for (let i = 0; i < n; i++) {
      const v = unchecked(this.slots[i]);
      let c: i32;
      if (v.state == SLOT_STEAL) c = v.waiting ? 1 : -1;
      else { if (protectPlayed && v.owned && v.state == SLOT_HELD) continue; c = 0; }
      if (best >= 0 && (c > bestClass || (c == bestClass && v.age >= bestAge))) continue;
      best = i; bestClass = c; bestAge = v.age;
    }
    return best;
  }
}
