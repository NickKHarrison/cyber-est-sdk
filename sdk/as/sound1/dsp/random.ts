// Seeded randomness by position, never by a counter. A value is a hash of what it is for (the
// song step, the voice, the key, and a salt saying which choice), so a render from bar 9 matches live
// play from bar 9, a peer matches the host, and a note sounds the same however many notes came
// before it (review n572 D-06: a groove hit seeded by the hit count since reset; review 2 D2-10: a
// note's dice seeded by the count of notes since activate). `Dice` draws a short run of values from
// one such seed: its own little counter restarts with every `seed`, so it is still by position.

/** A 64-bit mix (splitmix64's finaliser): every input bit moves every output bit. */
// @ts-ignore: decorator
@inline export function mix64(x: u64): u64 {
  x ^= x >>> 30; x *= 0xbf58476d1ce4e5b9;
  x ^= x >>> 27; x *= 0x94d049bb133111eb;
  x ^= x >>> 31;
  return x;
}

/** A hash of (step, voice, key, salt). */
export function hashOf(step: i64, voice: i32, key: i32, salt: i32): u64 {
  let h = mix64(<u64>step + 0x9e3779b97f4a7c15);
  h = mix64(h ^ (<u64><u32>voice | (<u64><u32>key << 32)));
  return mix64(h ^ <u64><u32>salt);
}

/** A value in [0, 1) for (step, voice, key, salt): the same arguments give the same value, always. */
export function chance(step: i64, voice: i32, key: i32, salt: i32): f64 {
  return <f64>(hashOf(step, voice, key, salt) >>> 11) * 1.1102230246251565e-16; // 2^-53
}

/** A value in [-1, 1) for (step, voice, key, salt). */
export function bipolar(step: i64, voice: i32, key: i32, salt: i32): f64 { return chance(step, voice, key, salt) * 2.0 - 1.0; }

/** A few values from one seed, in order: `seed` restarts it, so the run is by position too. */
export class Dice {
  private base: u64 = 0;
  private n: u64 = 0;
  seed(step: i64, voice: i32, key: i32, salt: i32): void { this.base = hashOf(step, voice, key, salt); this.n = 0; }
  /** The next value in [0, 1). */
  next(): f64 { this.n++; return <f64>(mix64(this.base + this.n * 0x9e3779b97f4a7c15) >>> 11) * 1.1102230246251565e-16; }
  /** The next value in [-1, 1). */
  nextBipolar(): f64 { return this.next() * 2.0 - 1.0; }
  /** The next whole number in [0, n). */
  below(n: i32): i32 { const k = <i32>(this.next() * <f64>n); return k >= n ? n - 1 : k; }
}
