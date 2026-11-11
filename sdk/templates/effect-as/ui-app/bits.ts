// The app's own data (a pattern, a chain, keyframes) lives in hidden parameters: whole numbers
// below 2^53 holding several small fields (sdk/docs/ui.md, "Every piece of state is a parameter").
// Arithmetic, never JavaScript's bitwise operators, which cut a number to 32 bits.

/** The most bits one parameter holds: a double is exact for whole numbers below 2^53. */
export const MAX_BITS = 53;

/** `fields` (each a whole number below 2^width, the first in the lowest bits) packed into one value. */
export function packFields(fields: readonly number[], width: number): number {
  if (!Number.isInteger(width) || width < 1 || fields.length * width > MAX_BITS) throw new RangeError(`${fields.length} fields of ${width} bits do not fit in ${MAX_BITS}`);
  const size = 2 ** width;
  let v = 0;
  for (let i = fields.length - 1; i >= 0; i--) {
    const f = fields[i]!;
    if (!Number.isInteger(f) || f < 0 || f >= size) throw new RangeError(`field ${i} (${f}) is not a whole number below 2^${width}`);
    v = v * size + f;
  }
  return v;
}

/** `count` fields of `width` bits out of one value (the first from the lowest bits). */
export function unpackFields(value: number, width: number, count: number): number[] {
  if (!Number.isInteger(width) || width < 1 || count * width > MAX_BITS) throw new RangeError(`${count} fields of ${width} bits do not fit in ${MAX_BITS}`);
  const size = 2 ** width;
  let v = Math.max(0, Math.floor(value));
  const out: number[] = [];
  for (let i = 0; i < count; i++) { out.push(v % size); v = Math.floor(v / size); }
  return out;
}
