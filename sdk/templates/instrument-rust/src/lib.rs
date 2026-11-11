//! EST Instrument Template (org.example.est-instrument-template): an EST instrument in Rust, made
//! from the instrument-rust template, which starts as four voices of a band-limited saw into a
//! resonant low-pass, each shaped by an ADSR. Grow the voice, keep est.json's identity and
//! parameters in step with this file, then (see AGENTS.md):
//!
//!     est pack        # cargo build --release, then the bundle in dist/
//!     est validate    # the checks Cyber's install runs; read dist/validation.json
//!     est test        # the golden render in test/ plus the conformance run
//!
//! The rules an instrument keeps (the conformance run checks each): every note it starts ends with
//! a NOTE_END when its voice stops sounding (`Voices` sends it: call `voices.end` when a voice
//! falls silent); a choke stops at once; `tail()` covers the longest release; heap memory only in
//! `activate` (the voices are values inside the plugin, made in `new`); nothing allocates in
//! `render`, `process`, `param_changed` or the note handlers.
#![no_std]

use est::prelude::*;

const LEVEL: u32 = 0;
const CUTOFF: u32 = 1;
const RESONANCE: u32 = 2;
const ATTACK: u32 = 3;
const DECAY: u32 = 4;
const SUSTAIN: u32 = 5;
const RELEASE: u32 = 6;
const VOICES: usize = 4;

struct SynthVoice { osc: Oscillator, filter: Filter, env: Envelope, velocity: f64 }

impl Voice for SynthVoice {
    fn release(&mut self) { self.env.release() }
    fn stop(&mut self) { self.env.reset() }
}

pub struct Template {
    voices: Voices<SynthVoice, VOICES>,
    level: Smoother,
    sample_rate: f64,
}

impl Template {
    fn each(&mut self, f: impl Fn(&mut SynthVoice)) { for i in 0..VOICES { f(self.voices.voice_mut(i)) } }
}

impl Instrument for Template {
    const PARAMS: &'static [Param] = &[
        Param::new(LEVEL, "Level").range(-60.0, 0.0).default(-12.0).unit("dB").decimals(1),
        Param::new(CUTOFF, "Cutoff").range(20.0, 20000.0).default(2000.0).hertz().module("Filter"),
        Param::new(RESONANCE, "Resonance").range(0.0, 1.0).default(0.2).module("Filter"),
        Param::new(ATTACK, "Attack").range(1.0, 2000.0).default(5.0).unit("ms").decimals(0).module("Envelope"),
        Param::new(DECAY, "Decay").range(1.0, 2000.0).default(200.0).unit("ms").decimals(0).module("Envelope"),
        Param::new(SUSTAIN, "Sustain").range(0.0, 100.0).default(70.0).unit("%").decimals(0).module("Envelope"),
        Param::new(RELEASE, "Release").range(1.0, 4000.0).default(300.0).unit("ms").decimals(0).module("Envelope"),
    ];
    const STATE_MAGIC: u32 = u32::from_le_bytes(*b"TMPI");

    fn new() -> Self {
        let voice = || {
            let mut osc = Oscillator::new();
            osc.set_wave(Wave::Saw);
            SynthVoice { osc, filter: Filter::new(), env: Envelope::new(), velocity: 0.0 }
        };
        Template { voices: Voices::new(voice), level: Smoother::new(0.005), sample_rate: 48000.0 }
    }

    fn activate(&mut self, sample_rate: f64, _max_frames: u32) -> bool {
        self.sample_rate = sample_rate;
        self.level.set_sample_rate(sample_rate);
        self.level.reset();
        self.each(|v| { v.osc.set_sample_rate(sample_rate); v.filter.set_sample_rate(sample_rate); v.env.set_sample_rate(sample_rate) });
        true
    }

    fn reset(&mut self) { self.voices.reset() }

    fn param_changed(&mut self, id: u32, value: f64) {
        match id {
            LEVEL => self.level.set_target(db_to_gain(value)),
            CUTOFF => self.each(|v| v.filter.set_cutoff(value)),
            RESONANCE => self.each(|v| v.filter.set_resonance(value)),
            ATTACK => self.each(|v| v.env.set_attack(value / 1000.0)),
            DECAY => self.each(|v| v.env.set_decay(value / 1000.0)),
            SUSTAIN => self.each(|v| v.env.set_sustain(value / 100.0)),
            RELEASE => self.each(|v| v.env.set_release(value / 1000.0)),
            _ => {}
        }
    }

    fn note_on(&mut self, io: &mut Io, note: &Note) {
        let i = self.voices.start(io, note);
        let v = self.voices.voice_mut(i);
        v.osc.set_frequency(key_to_hz(note.key as f64));
        v.osc.reset(0.0);
        v.filter.reset();
        v.env.start();
        v.velocity = note.velocity;
    }

    fn note_off(&mut self, _io: &mut Io, note: &Note) { self.voices.release(note) }

    fn choke(&mut self, io: &mut Io, note: &Note) { self.voices.choke(io, note) }

    fn render(&mut self, io: &mut Io, from: usize, to: usize) {
        for n in from..to {
            let level = self.level.next();
            let mut sum = 0.0;
            for i in 0..VOICES {
                if !self.voices.is_on(i) { continue }
                let v = self.voices.voice_mut(i);
                let e = v.env.next();
                if !v.env.is_active() { self.voices.end(i, io, n); continue }
                sum += v.filter.process(v.osc.next()) * e * v.velocity;
            }
            let s = (sum * level) as f32;
            io.add(0, n, s);
            io.add(1, n, s);
        }
    }

    /// The longest a released voice sounds: its release.
    fn tail(&self) -> u32 { self.voices.voice(0).env.tail_frames() }
}

est::export_instrument!(Template, id: "org.example.est-instrument-template", name: "EST Instrument Template", vendor: "Example",
    version: "1.0.0", description: "Four voices of a saw through a resonant low-pass and an ADSR: the starting point for an EST instrument in Rust.",
    features: ["instrument", "synthesizer", "stereo"]);
