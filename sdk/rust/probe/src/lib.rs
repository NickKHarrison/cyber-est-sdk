//! The DSP probe (Rust): each block of `est::dsp` behind a plain export, so Cyber's suite can
//! render the same scenario through this build and the AssemblyScript one (sdk/as/probe) and
//! compare them sample for sample (sdk/tests/dsp.test.ts). Not a plugin. Every scenario here is
//! written the same way, line for line, in sdk/as/probe/index.ts: change both or neither.
//!
//! The caller writes an input into `input_ptr()` (f32) where a scenario reads one, calls the
//! scenario, and reads `output_ptr()` (f64).
#![no_std]

use core::ptr::{addr_of, addr_of_mut};
use est::dsp::*;
use est::text::{self, Buf};
use est::{math, Io, Note, Param};

const MAX: usize = 16384;
static mut IN: [f32; MAX] = [0.0; MAX];
static mut OUT: [f64; MAX * 2] = [0.0; MAX * 2];

fn inp(i: usize) -> f64 { unsafe { (*addr_of!(IN))[i] as f64 } }
fn out(i: usize, v: f64) { unsafe { (*addr_of_mut!(OUT))[i] = v } }
fn lim(n: u32) -> usize { if (n as usize) < MAX { n as usize } else { MAX } }

#[no_mangle]
pub extern "C" fn input_ptr() -> *mut f32 { addr_of_mut!(IN) as *mut f32 }
#[no_mangle]
pub extern "C" fn output_ptr() -> *mut f64 { addr_of_mut!(OUT) as *mut f64 }

#[no_mangle]
pub extern "C" fn smoother(n: u32, seconds: f64, sr: f64, t1: f64, t2: f64, at: u32) {
    let mut s = Smoother::new(seconds);
    s.set_sample_rate(sr);
    s.set_target(t1);
    for i in 0..lim(n) {
        if i == at as usize { s.set_target(t2) }
        out(i, s.next());
    }
}

#[no_mangle]
pub extern "C" fn oscillator(n: u32, wave: u32, hz: f64, sr: f64, hz2: f64, at: u32) {
    let mut o = Oscillator::new();
    o.set_sample_rate(sr);
    o.set_wave(Wave::from_index(wave as f64));
    o.set_frequency(hz);
    for i in 0..lim(n) {
        if i == at as usize { o.set_frequency(hz2) }
        out(i, o.next());
    }
}

#[no_mangle]
pub extern "C" fn filter(n: u32, mode: u32, cutoff: f64, res: f64, sr: f64, cutoff2: f64, res2: f64, at: u32) {
    let mut f = Filter::new();
    f.set_sample_rate(sr);
    f.set_mode(FilterMode::from_index(mode as f64));
    f.set_cutoff(cutoff);
    f.set_resonance(res);
    f.reset();
    for i in 0..lim(n) {
        if i == at as usize { f.set_cutoff(cutoff2); f.set_resonance(res2) }
        out(i, f.process(inp(i)));
    }
}

#[no_mangle]
pub extern "C" fn envelope(n: u32, a: f64, d: f64, s: f64, r: f64, sr: f64, off_at: u32, on_at: u32) -> u32 {
    let mut e = Envelope::new();
    e.set_sample_rate(sr);
    e.set_adsr(a, d, s, r);
    e.start();
    for i in 0..lim(n) {
        if i == off_at as usize { e.release() }
        if i == on_at as usize { e.start() }
        out(i, e.next());
    }
    e.tail_frames()
}

#[no_mangle]
pub extern "C" fn lfo(n: u32, wave: u32, rate: f64, sync: f64, tempo: f64, sr: f64, tempo2: f64, at: u32) {
    let mut l = Lfo::new();
    l.set_sample_rate(sr);
    l.set_wave(Wave::from_index(wave as f64));
    l.set_rate(rate);
    l.set_sync(sync);
    l.set_tempo(tempo);
    for i in 0..lim(n) {
        if i == at as usize { l.set_tempo(tempo2) }
        out(i, l.next());
    }
}

#[no_mangle]
pub extern "C" fn delay(n: u32, max: u32, d1: f64, d2: f64, feedback: f64, at: u32) -> u32 {
    let mut line = DelayLine::new();
    if !line.allocate(max as usize) { return 0 }
    let mut d = d1;
    for i in 0..lim(n) {
        if i == at as usize { d = d2 }
        let y = line.read(d);
        line.write(inp(i) + feedback * y);
        out(i, y);
    }
    line.capacity() as u32
}

#[no_mangle]
pub extern "C" fn biquad(n: u32, kind: u32, freq: f64, q: f64, gain_db: f64, sr: f64) {
    let mut b = Biquad::new();
    b.set(BiquadKind::from_index(kind as f64), freq, q, gain_db, sr);
    for i in 0..lim(n) { out(i, b.process(inp(i))) }
}

#[no_mangle]
pub extern "C" fn biquad_response(kind: u32, freq: f64, q: f64, gain_db: f64, sr: f64, at_hz: f64) -> f64 {
    let c = coefficients(BiquadKind::from_index(kind as f64), freq, q, gain_db, sr);
    response_db(&c, at_hz, sr)
}

struct Counted { releases: u32, stops: u32 }
impl Voice for Counted {
    fn release(&mut self) { self.releases += 1 }
    fn stop(&mut self) { self.stops += 1 }
}

/// `ops` operations from the input, three floats each: (0 start, 1 release, 2 choke, 3 end voice
/// `key`), the note id (-1 none) and the key (-1 any). Per operation, the output gets: the voice
/// `start` took (else -1), the voices on as bits, the voices releasing as bits, the sum of the
/// voices' releases and stops.
#[no_mangle]
pub extern "C" fn voices(ops: u32) {
    let mut io = Io::detached(128);
    let mut v: Voices<Counted, 4> = Voices::new(|| Counted { releases: 0, stops: 0 });
    let k_max = lim(ops * 3) / 3;
    for k in 0..k_max {
        let op = inp(k * 3) as i32;
        let id = inp(k * 3 + 1) as i32;
        let key = inp(k * 3 + 2) as i32;
        let note = Note { time: 0, note_id: id, port: if id == -1 && key == -1 { -1 } else { 0 }, channel: if id == -1 && key == -1 { -1 } else { 0 }, key: key as i16, velocity: 1.0 };
        let mut took = -1.0;
        if op == 0 { took = v.start(&mut io, &note) as f64 }
        else if op == 1 { v.release(&note) }
        else if op == 2 { v.choke(&mut io, &note) }
        else if op == 3 { v.end(key as usize, &mut io, 0) }
        let (mut on, mut rel, mut counts) = (0.0, 0.0, 0.0);
        for i in 0..4 {
            if v.is_on(i) { on += math::exp2(i as f64) }
            if v.is_releasing(i) { rel += math::exp2(i as f64) }
            counts += (v.voice(i).releases + v.voice(i).stops) as f64;
        }
        out(k * 4, took);
        out(k * 4 + 1, on);
        out(k * 4 + 2, rel);
        out(k * 4 + 3, counts);
    }
}

#[no_mangle]
pub extern "C" fn decibels(n: u32, from: f64, step: f64) {
    for i in 0..lim(n) {
        let db = from + i as f64 * step;
        let g = db_to_gain(db);
        out(i * 2, g);
        out(i * 2 + 1, gain_to_db(g));
    }
}

/// The maths the blocks share, over `n` points from `from` by `step`: exp, ln, sin, cos, tan, exp2,
/// log2 and the MIDI key's frequency, eight outputs per point.
#[no_mangle]
pub extern "C" fn maths(n: u32, from: f64, step: f64) {
    let m = lim(n) / 4;
    for i in 0..m {
        let x = from + i as f64 * step;
        let a = if x < 0.0 { -x } else { x };
        out(i * 8, math::exp(x));
        out(i * 8 + 1, math::ln(a + 0.001));
        out(i * 8 + 2, math::sin_turns(x));
        out(i * 8 + 3, math::cos_turns(x));
        out(i * 8 + 4, math::tan_half_turns((a - math::floor(a)) * 0.49));
        out(i * 8 + 5, math::exp2(x));
        out(i * 8 + 6, math::log2(a + 0.001));
        out(i * 8 + 7, math::key_to_hz(x * 10.0 + 60.0));
    }
}

const TEXT_PARAMS: [Param; 3] = [
    Param::new(0, "Gain").range(-60.0, 12.0).unit("dB").decimals(1),
    Param::new(1, "Freq").range(20.0, 20000.0).hertz(),
    Param::new(2, "Mode").labels(&["Low", "Band"]),
];
static mut TEXT: [u8; 256] = [0; 256];

#[no_mangle]
pub extern "C" fn text_ptr() -> *mut u8 { addr_of_mut!(TEXT) as *mut u8 }

/// Parameter `which`'s text for `v` into `text_ptr()` (NUL-terminated); its length.
#[no_mangle]
pub extern "C" fn value_text(which: u32, v: f64) -> u32 {
    let mut b = Buf::new();
    text::format(&TEXT_PARAMS[which as usize % 3], v, &mut b);
    let t = unsafe { &mut *addr_of_mut!(TEXT) };
    let n = b.bytes().len();
    t[..n].copy_from_slice(b.bytes());
    t[n] = 0;
    n as u32
}

/// The NUL-terminated text at `text_ptr()` as a value of parameter `which` (NaN: none).
#[no_mangle]
pub extern "C" fn text_value(which: u32) -> f64 {
    let t = unsafe { &*addr_of!(TEXT) };
    let n = t.iter().position(|&c| c == 0).unwrap_or(t.len());
    text::parse(&TEXT_PARAMS[which as usize % 3], &t[..n]).unwrap_or(f64::NAN)
}
