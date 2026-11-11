import { clamp, floor } from "../math";

/**
 * A delay line of f32 samples, sized once from its longest delay in `activate` (`allocate`, the one
 * block that allocates; a later, larger `allocate` replaces the buffer, a smaller one keeps it).
 * `read(d)` before `write(x)` in each sample gives a delay of `d` samples (1 at least), fractions
 * interpolated linearly. The Rust crate's `DelayLine`, sample for sample.
 */
export class DelayLine {
  private buf: StaticArray<f32> = new StaticArray<f32>(0);
  private len: i32 = 0;
  private pos: i32 = 0;

  /** Room for delays up to `maxFrames` (call from `activate`). */
  allocate(maxFrames: i32): bool {
    const need = maxFrames + 2;
    if (need > this.len) {
      this.buf = new StaticArray<f32>(need);
      this.len = need;
    }
    this.clear();
    return true;
  }
  /** The longest delay it holds, in frames. */
  capacity(): i32 { return this.len >= 2 ? this.len - 2 : 0; }
  /** Silence. */
  clear(): void {
    for (let i = 0; i < this.len; i++) unchecked(this.buf[i] = 0);
    this.pos = 0;
  }
  /** Push one sample. */
  @inline write(x: f64): void {
    if (this.len == 0) return;
    unchecked(this.buf[this.pos] = <f32>x);
    this.pos++;
    if (this.pos == this.len) this.pos = 0;
  }
  /** The sample written `delay` samples ago (1 to `capacity()`, a fraction interpolated). */
  @inline read(delay: f64): f64 {
    if (this.len == 0) return 0;
    const d = clamp(delay, 1.0, <f64>(this.len - 2));
    let r = <f64>this.pos - d;
    if (r < 0.0) r += <f64>this.len;
    const i0f = floor(r);
    const frac = r - i0f;
    const i0 = <i32>i0f;
    const i1 = i0 + 1 == this.len ? 0 : i0 + 1;
    const a = <f64>unchecked(this.buf[i0]);
    const b = <f64>unchecked(this.buf[i1]);
    return a + (b - a) * frac;
  }
}
