//! EST Sampler Template (org.example.est-sampler-template): an EST instrument in Rust, made from
//! the sampler-rust template: WAVs from assets/, mapped to keys and velocity layers in
//! samples.json, played from notes with pitch, a one-shot or loop mode and an ADSR. The samples
//! are in the module (src/samples.rs, written by tools/embed-samples.mjs): an EST module reads no
//! file and fetches nothing at run time. Then (see AGENTS.md):
//!
//!     node tools/embed-samples.mjs   # after changing samples.json or a WAV
//!     est pack        # cargo build --release, then the bundle in dist/
//!     est validate    # the checks Cyber's install runs; read dist/validation.json
//!     est test        # the golden render in test/ plus the conformance run
//!
//! The rules an instrument keeps: every note it starts ends with a NOTE_END when its voice stops
//! (`voices.end`); a choke stops at once; `tail()` covers the longest release; nothing allocates.
#![no_std]

mod samples;

use est::math::{exp2, floor};
use est::prelude::*;
use samples::{COUNT, DATA, INFO, INFO_STRIDE};

const LEVEL: u32 = 0;
const MODE: u32 = 1;
const TUNE: u32 = 2;
const ATTACK: u32 = 3;
const DECAY: u32 = 4;
const SUSTAIN: u32 = 5;
const RELEASE: u32 = 6;
const VOICES: usize = 8;

/// Value `k` of sample `s`'s row in the table.
#[inline(always)]
fn info(s: usize, k: usize) -> i32 { INFO[s * INFO_STRIDE + k] }
/// Frame `i` of the table's data, as -1…1.
#[inline(always)]
fn frame(i: i32) -> f64 { DATA[i as usize] as f64 / 32768.0 }

struct SampleVoice { env: Envelope, sample: usize, pos: f64, step: f64, gain: f64 }

impl Voice for SampleVoice {
    fn release(&mut self) { self.env.release() }
    fn stop(&mut self) { self.env.reset() }
}

pub struct Template {
    voices: Voices<SampleVoice, VOICES>,
    level: Smoother,
    sample_rate: f64,
    looped: bool,
    tune: f64,
}

impl Template {
    fn each(&mut self, f: impl Fn(&mut SampleVoice)) { for i in 0..VOICES { f(self.voices.voice_mut(i)) } }

    /// The first sample whose keys and velocities hold the note.
    fn pick(key: i32, velocity: f64) -> Option<usize> {
        (0..COUNT).find(|&s| {
            key >= info(s, 4) && key <= info(s, 5) && velocity >= info(s, 6) as f64 / 1000.0 && velocity <= info(s, 7) as f64 / 1000.0
        })
    }
}

impl Instrument for Template {
    const PARAMS: &'static [Param] = &[
        Param::new(LEVEL, "Level").range(-60.0, 0.0).default(-6.0).unit("dB").decimals(1),
        Param::new(MODE, "Mode").labels(&["One-shot", "Loop"]),
        Param::new(TUNE, "Tune").range(-24.0, 24.0).default(0.0).unit("st").decimals(0),
        Param::new(ATTACK, "Attack").range(0.0, 2000.0).default(1.0).unit("ms").decimals(0).module("Envelope"),
        Param::new(DECAY, "Decay").range(1.0, 4000.0).default(400.0).unit("ms").decimals(0).module("Envelope"),
        Param::new(SUSTAIN, "Sustain").range(0.0, 100.0).default(80.0).unit("%").decimals(0).module("Envelope"),
        Param::new(RELEASE, "Release").range(1.0, 4000.0).default(200.0).unit("ms").decimals(0).module("Envelope"),
    ];
    const STATE_MAGIC: u32 = u32::from_le_bytes(*b"TMPS");

    fn new() -> Self {
        let voice = || SampleVoice { env: Envelope::new(), sample: 0, pos: 0.0, step: 1.0, gain: 0.0 };
        Template { voices: Voices::new(voice), level: Smoother::new(0.005), sample_rate: 48000.0, looped: false, tune: 0.0 }
    }

    fn activate(&mut self, sample_rate: f64, _max_frames: u32) -> bool {
        self.sample_rate = sample_rate;
        self.level.set_sample_rate(sample_rate);
        self.level.reset();
        self.each(|v| v.env.set_sample_rate(sample_rate));
        true
    }

    fn reset(&mut self) { self.voices.reset() }

    fn param_changed(&mut self, id: u32, value: f64) {
        match id {
            LEVEL => self.level.set_target(db_to_gain(value)),
            MODE => self.looped = value >= 0.5,
            TUNE => self.tune = value,
            ATTACK => self.each(|v| v.env.set_attack(value / 1000.0)),
            DECAY => self.each(|v| v.env.set_decay(value / 1000.0)),
            SUSTAIN => self.each(|v| v.env.set_sustain(value / 100.0)),
            RELEASE => self.each(|v| v.env.set_release(value / 1000.0)),
            _ => {}
        }
    }

    fn note_on(&mut self, io: &mut Io, note: &Note) {
        let Some(s) = Self::pick(note.key as i32, note.velocity) else {
            io.note_end(note.note_id, note.port, note.channel, note.key, note.time); // no sample: it ends at once
            return;
        };
        let (tune, rate) = (self.tune, self.sample_rate);
        let i = self.voices.start(io, note);
        let v = self.voices.voice_mut(i);
        v.sample = s;
        v.pos = 0.0;
        v.step = exp2((note.key as f64 + tune - info(s, 3) as f64) / 12.0) * info(s, 2) as f64 / rate;
        v.gain = note.velocity;
        v.env.start();
    }

    fn note_off(&mut self, _io: &mut Io, note: &Note) { self.voices.release(note) }

    fn choke(&mut self, io: &mut Io, note: &Note) { self.voices.choke(io, note) }

    fn render(&mut self, io: &mut Io, from: usize, to: usize) {
        let looped = self.looped;
        for n in from..to {
            let level = self.level.next();
            let mut sum = 0.0;
            for i in 0..VOICES {
                if !self.voices.is_on(i) { continue }
                let v = self.voices.voice_mut(i);
                let s = v.sample;
                let (at, len, ls, le) = (info(s, 0), info(s, 1), info(s, 8), info(s, 9));
                let e = v.env.next();
                if !v.env.is_active() || (!looped && v.pos >= (len - 1) as f64) { self.voices.end(i, io, n); continue }
                // Linear interpolation between two frames (the loop's end wraps to its start).
                let k = floor(v.pos) as i32;
                let frac = v.pos - k as f64;
                let mut k1 = k + 1;
                if looped && k1 >= le { k1 = ls }
                let (x0, x1) = (frame(at + k), frame(at + if k1 < len { k1 } else { len - 1 }));
                sum += (x0 + (x1 - x0) * frac) * e * v.gain;
                v.pos += v.step;
                if looped && v.pos >= le as f64 { v.pos -= (le - ls) as f64 }
            }
            let out = (sum * level) as f32;
            io.add(0, n, out);
            io.add(1, n, out);
        }
    }

    /// The longest a released voice sounds: its release.
    fn tail(&self) -> u32 { self.voices.voice(0).env.tail_frames() }
}

est::export_instrument!(Template, id: "org.example.est-sampler-template", name: "EST Sampler Template", vendor: "Example",
    version: "1.0.0", description: "Samples mapped to keys and velocity layers, one-shot or looped, with an ADSR: the starting point for an EST sampler in Rust.",
    features: ["instrument", "sampler", "stereo"]);
