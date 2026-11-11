// Parameter values as text and back (CLAP's value_to_text and text_to_value), into and out of C
// buffers without allocating: the twin of the Rust crate's text.rs, worded the same way.

import { Format, Param } from "./plugin";
import { round } from "./math";

/** Copy `s` (ASCII) into the C buffer `out` of `cap` bytes at `at`, returning where it ended. */
export function put(out: usize, cap: i32, at: i32, s: string): i32 {
  for (let i = 0; i < s.length && at < cap - 1; i++) store<u8>(out + at++, <u8>s.charCodeAt(i));
  return at;
}

function putByte(out: usize, cap: i32, at: i32, c: u8): i32 {
  if (at < cap - 1) store<u8>(out + at++, c);
  return at;
}

/** `v` with `decimals` decimals, rounded half away from zero, into `out` at `at`. */
function putNumber(out: usize, cap: i32, at: i32, v: f64, decimals: i32): i32 {
  const digits = memory.data(24);
  let scale = 1.0;
  for (let i = 0; i < decimals; i++) scale *= 10;
  let r = round(v * scale);
  if (r < 0) { at = putByte(out, cap, at, 45); r = -r; }
  if (r > 9.0e15) return put(out, cap, at, "inf");
  let whole = <u64>(r / scale);
  let frac = <u64>(r - <f64>whole * scale);
  let k = 0;
  do { store<u8>(digits + k++, <u8>(48 + whole % 10)); whole /= 10; } while (whole != 0);
  while (k > 0) at = putByte(out, cap, at, load<u8>(digits + --k));
  if (decimals > 0) {
    at = putByte(out, cap, at, 46);
    for (let i = decimals - 1; i >= 0; i--) { store<u8>(digits + i, <u8>(48 + frac % 10)); frac /= 10; }
    for (let i = 0; i < decimals; i++) at = putByte(out, cap, at, load<u8>(digits + i));
  }
  return at;
}

/** The text of value `v` of `p` into the C buffer `out` of `cap` bytes, NUL-terminated. */
export function valueToText(p: Param, v: f64, out: usize, cap: i32): void {
  let at = 0;
  if (p.stepped()) {
    const i = <i32>round(p.clamp(v) - p.min);
    if (i >= 0 && i < p.labelList.length) at = put(out, cap, at, p.labelList[i]);
  } else if (p.format == Format.Hertz) {
    const a = Math.abs(v);
    if (a >= 1000) {
      at = putNumber(out, cap, at, v / 1000, a >= 10000 ? 1 : 2);
      at = put(out, cap, at, " kHz");
    } else {
      at = putNumber(out, cap, at, v, a < 100 ? 1 : 0);
      at = put(out, cap, at, " Hz");
    }
  } else {
    at = putNumber(out, cap, at, v, p.decimalCount);
    if (p.unitText.length > 0) { at = putByte(out, cap, at, 32); at = put(out, cap, at, p.unitText); }
  }
  store<u8>(out + at, 0);
}

function lower(c: u32): u32 { return c >= 65 && c <= 90 ? c + 32 : c; }

/** A C string as a value: a stepped parameter's label (any case), or a decimal number (a frequency's `k` × 1000). NaN: none. */
export function textToValue(p: Param, s: usize): f64 {
  let len = 0;
  while (len < 256 && load<u8>(s + len) != 0) len++;
  let a = 0, b = len;
  while (a < b && load<u8>(s + a) == 32) a++;
  while (b > a && load<u8>(s + b - 1) == 32) b--;
  for (let i = 0; i < p.labelList.length; i++) {
    const l = p.labelList[i];
    if (l.length != b - a) continue;
    let same = true;
    for (let k = 0; k < l.length && same; k++) same = lower(load<u8>(s + a + k)) == lower(l.charCodeAt(k));
    if (same) return p.min + <f64>i;
  }
  let i = a;
  let neg = false;
  if (i < b && (load<u8>(s + i) == 45 || load<u8>(s + i) == 43)) { neg = load<u8>(s + i) == 45; i++; }
  let v = 0.0;
  let any = false;
  while (i < b && load<u8>(s + i) >= 48 && load<u8>(s + i) <= 57) { v = v * 10 + <f64>(load<u8>(s + i) - 48); i++; any = true; }
  if (i < b && (load<u8>(s + i) == 46 || load<u8>(s + i) == 44)) {
    i++;
    let scale = 0.1;
    while (i < b && load<u8>(s + i) >= 48 && load<u8>(s + i) <= 57) { v += <f64>(load<u8>(s + i) - 48) * scale; scale /= 10; i++; any = true; }
  }
  if (!any) return NaN;
  if (neg) v = -v;
  if (p.format == Format.Hertz) {
    while (i < b && load<u8>(s + i) == 32) i++;
    if (i < b && (load<u8>(s + i) == 107 || load<u8>(s + i) == 75)) v *= 1000;
  }
  return v;
}
