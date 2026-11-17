import { hash32 } from '../../sequencer/midiFx';

/**
 * 1.386's Randomize draw, shared since 1.673 by the Instrument Rack (`randomizeMacros`) and the Audio
 * Effect Rack (`randomizeFxMacros`): macro `k`'s value for the press seeded `seed`, 0…1 to 0.001. The
 * same seed draws the same values on both racks, for a test or a peer replaying the write.
 */
export const randomMacroValue = (seed: number, k: number): number => Math.round((hash32(0x7a2d, seed | 0, k) / 4294967296) * 1000) / 1000;
