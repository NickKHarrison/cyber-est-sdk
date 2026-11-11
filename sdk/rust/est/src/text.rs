//! Parameter values as text and back (CLAP's `value_to_text` and `text_to_value`, used by a host's
//! "Type a value…"), without `core::fmt` (it would triple the module).

use crate::param::{Format, Param};
use crate::math;
use core::ffi::c_char;

/// Copy `s` into the C buffer `out` of `cap` bytes, cut to fit, NUL-terminated.
pub fn copy(s: &[u8], out: *mut c_char, cap: u32) {
    if cap == 0 { return }
    let n = if s.len() < cap as usize - 1 { s.len() } else { cap as usize - 1 };
    unsafe {
        for (i, &b) in s[..n].iter().enumerate() { *out.add(i) = b as c_char }
        *out.add(n) = 0;
    }
}

/// A small text buffer on the stack.
pub struct Buf { b: [u8; 64], n: usize }
impl Buf {
    pub const fn new() -> Self { Buf { b: [0; 64], n: 0 } }
    pub fn push(&mut self, c: u8) { if self.n < self.b.len() { self.b[self.n] = c; self.n += 1 } }
    pub fn str(&mut self, s: &[u8]) { for &c in s { self.push(c) } }
    pub fn bytes(&self) -> &[u8] { &self.b[..self.n] }
    /// `v` with `decimals` decimals (rounded half away from zero).
    pub fn number(&mut self, v: f64, decimals: u8) {
        let mut scale = 1.0;
        for _ in 0..decimals { scale *= 10.0 }
        let r = math::round(v * scale);
        if r < 0.0 { self.push(b'-') }
        let r = if r < 0.0 { -r } else { r };
        if r > 9.0e15 { self.str(b"inf"); return }
        let mut whole = (r / scale) as u64;
        let mut frac = (r - whole as f64 * scale) as u64;
        let mut digits = [0u8; 20];
        let mut k = 0;
        loop { digits[k] = b'0' + (whole % 10) as u8; k += 1; whole /= 10; if whole == 0 { break } }
        while k > 0 { k -= 1; self.push(digits[k]) }
        if decimals > 0 {
            self.push(b'.');
            let mut f = [0u8; 20];
            for i in (0..decimals as usize).rev() { f[i] = b'0' + (frac % 10) as u8; frac /= 10 }
            for &c in &f[..decimals as usize] { self.push(c) }
        }
    }
}

/// The text of value `v` of `p` ("-6.0 dB", "1.20 kHz", a stepped parameter's label).
pub fn format(p: &Param, v: f64, b: &mut Buf) {
    if p.stepped() {
        let i = math::round(p.clamp(v) - p.min);
        let label = if i >= 0.0 && (i as usize) < p.labels.len() { p.labels[i as usize] } else { "" };
        b.str(label.as_bytes());
        return;
    }
    if p.format == Format::Hertz {
        let a = if v < 0.0 { -v } else { v };
        if a >= 1000.0 {
            b.number(v / 1000.0, if a >= 10000.0 { 1 } else { 2 });
            b.str(b" kHz");
        } else {
            b.number(v, if a < 100.0 { 1 } else { 0 });
            b.str(b" Hz");
        }
        return;
    }
    b.number(v, p.decimals);
    if !p.unit.is_empty() { b.push(b' '); b.str(p.unit.as_bytes()) }
}

pub fn value_to_text(p: &Param, v: f64, out: *mut c_char, cap: u32) {
    let mut b = Buf::new();
    format(p, v, &mut b);
    copy(b.bytes(), out, cap);
}

/// Text as a value: a stepped parameter's label (any case), or a decimal number; a unit after it
/// is ignored, except that a frequency's `k` multiplies by 1000.
pub fn parse(p: &Param, t: &[u8]) -> Option<f64> {
    let t = trim(t);
    for (i, l) in p.labels.iter().enumerate() {
        if eq_ignore_case(t, l.as_bytes()) { return Some(p.min + i as f64) }
    }
    let (v, rest) = parse_number(t)?;
    if p.format == Format::Hertz {
        let rest = trim(rest);
        if let Some(&c) = rest.first() { if c == b'k' || c == b'K' { return Some(v * 1000.0) } }
    }
    Some(v)
}

/// The C string `s` as a value (see [`parse`]).
pub unsafe fn text_to_value(p: &Param, s: *const c_char) -> Option<f64> {
    let mut len = 0usize;
    while len < 256 && *s.add(len) != 0 { len += 1 }
    parse(p, core::slice::from_raw_parts(s as *const u8, len))
}

fn trim(t: &[u8]) -> &[u8] {
    let mut a = 0;
    let mut b = t.len();
    while a < b && t[a] == b' ' { a += 1 }
    while b > a && t[b - 1] == b' ' { b -= 1 }
    &t[a..b]
}

fn eq_ignore_case(a: &[u8], b: &[u8]) -> bool {
    a.len() == b.len() && a.iter().zip(b).all(|(x, y)| x.to_ascii_lowercase() == y.to_ascii_lowercase())
}

/// A leading decimal number (sign, digits, an optional fraction) and the text after it.
pub fn parse_number(t: &[u8]) -> Option<(f64, &[u8])> {
    let mut i = 0;
    let neg = match t.first() { Some(b'-') => { i += 1; true } Some(b'+') => { i += 1; false } _ => false };
    let mut v = 0.0f64;
    let mut any = false;
    while i < t.len() && t[i].is_ascii_digit() { v = v * 10.0 + (t[i] - b'0') as f64; i += 1; any = true }
    if i < t.len() && (t[i] == b'.' || t[i] == b',') {
        i += 1;
        let mut scale = 0.1;
        while i < t.len() && t[i].is_ascii_digit() { v += (t[i] - b'0') as f64 * scale; scale /= 10.0; i += 1; any = true }
    }
    if !any { return None }
    Some((if neg { -v } else { v }, &t[i..]))
}

#[cfg(test)]
mod tests {
    use super::*;
    extern crate std;
    use std::string::String;

    fn text(p: &Param, v: f64) -> String { let mut b = Buf::new(); format(p, v, &mut b); String::from_utf8(b.bytes().into()).unwrap() }

    #[test]
    fn words_and_reads_values() {
        let db = Param::new(0, "Gain").range(-60.0, 12.0).unit("dB").decimals(1);
        assert_eq!(text(&db, -6.04), "-6.0 dB");
        assert_eq!(parse(&db, b" -6.5 dB"), Some(-6.5));
        let hz = Param::new(1, "Freq").range(20.0, 20000.0).hertz();
        assert_eq!(text(&hz, 440.0), "440 Hz");
        assert_eq!(text(&hz, 55.25), "55.3 Hz");
        assert_eq!(text(&hz, 1200.0), "1.20 kHz");
        assert_eq!(text(&hz, 12500.0), "12.5 kHz");
        assert_eq!(parse(&hz, b"1.2k"), Some(1200.0));
        assert_eq!(parse(&hz, b"1.2 kHz"), Some(1200.0));
        assert_eq!(parse(&hz, b"800 Hz"), Some(800.0));
        let mode = Param::new(2, "Mode").labels(&["Low", "Band"]);
        assert_eq!(text(&mode, 1.0), "Band");
        assert_eq!(parse(&mode, b"low"), Some(0.0));
        assert_eq!(parse(&mode, b"x"), None);
    }
}
