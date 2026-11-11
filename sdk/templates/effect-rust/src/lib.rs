//! EST Effect Template (org.example.est-effect-template): an EST effect in Rust, made from the
//! effect-rust template, which starts as a smoothed gain into a state-variable filter. Write your
//! DSP in `render`, keep est.json's identity and parameters in step with this file, then (see
//! AGENTS.md):
//!
//!     est pack        # cargo build --release, then the bundle in dist/
//!     est validate    # the checks Cyber's install runs; read dist/validation.json
//!     est test        # the golden render in test/ plus the conformance run
//!
//! The rules: declare every parameter once in PARAMS (and list it in est.json); heap memory
//! (`DelayLine::allocate`) only in `activate`; nothing allocates in `render`, `process` or
//! `param_changed`.
#![no_std]

use est::prelude::*;

const GAIN: u32 = 0;
const CUTOFF: u32 = 1;
const RESONANCE: u32 = 2;
const MODE: u32 = 3;

pub struct Template {
    gain: Smoother,
    filters: [Filter; 2],
    sample_rate: f64,
}

impl Effect for Template {
    const PARAMS: &'static [Param] = &[
        Param::new(GAIN, "Gain").range(-60.0, 12.0).default(0.0).unit("dB").decimals(1),
        Param::new(CUTOFF, "Cutoff").range(20.0, 20000.0).default(20000.0).hertz().module("Filter"),
        Param::new(RESONANCE, "Resonance").range(0.0, 1.0).default(0.0).module("Filter"),
        Param::new(MODE, "Mode").labels(&["Low-pass", "Band-pass", "High-pass", "Notch"]).module("Filter"),
    ];
    const STATE_MAGIC: u32 = u32::from_le_bytes(*b"TMPE");

    fn new() -> Self { Template { gain: Smoother::new(0.005), filters: [Filter::new(); 2], sample_rate: 48000.0 } }

    fn activate(&mut self, sample_rate: f64, _max_frames: u32) -> bool {
        self.sample_rate = sample_rate;
        self.gain.set_sample_rate(sample_rate);
        for f in self.filters.iter_mut() { f.set_sample_rate(sample_rate) }
        self.reset();
        true
    }

    fn reset(&mut self) {
        self.gain.reset();
        for f in self.filters.iter_mut() { f.reset() }
    }

    fn param_changed(&mut self, id: u32, value: f64) {
        match id {
            GAIN => self.gain.set_target(db_to_gain(value)),
            CUTOFF => for f in self.filters.iter_mut() { f.set_cutoff(value) },
            RESONANCE => for f in self.filters.iter_mut() { f.set_resonance(value) },
            MODE => for f in self.filters.iter_mut() { f.set_mode(FilterMode::from_index(value)) },
            _ => {}
        }
    }

    fn render(&mut self, io: &mut Io, from: usize, to: usize) {
        for n in from..to {
            let g = self.gain.next();
            for c in 0..io.channels {
                let y = self.filters[c].process(io.input(c, n) as f64) * g;
                io.output(c, n, y as f32);
            }
        }
    }

    /// A resonant filter rings on after its input stops: a second covers it.
    fn tail(&self) -> u32 { self.sample_rate as u32 }
}

est::export_effect!(Template, id: "org.example.est-effect-template", name: "EST Effect Template", vendor: "Example",
    version: "1.0.0", description: "A smoothed gain into a resonant filter: the starting point for an EST effect in Rust.",
    features: ["audio-effect", "filter", "stereo"]);
