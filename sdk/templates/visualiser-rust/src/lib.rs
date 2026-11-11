//! EST Visualiser Template (org.example.est-visualiser-template): a UI-first EST effect in Rust,
//! made from the visualiser-rust template. The DSP passes the audio through (with a smoothed
//! trim); the page in ui/ draws what the host measures after it, from protocol v2's meters
//! (`est:meter`, at most 30 a second: the strip's peaks, never samples), on a canvas. Keep
//! est.json's identity and parameters in step with this file, then (see AGENTS.md):
//!
//!     est pack        # cargo build --release, then the bundle in dist/ (ui/ and est-ui.js too)
//!     est validate    # the checks Cyber's install runs, the EST-U rules on the page included
//!     est test        # the golden render in test/ plus the conformance run
//!     est dev         # the page, live, beside the generated knobs
//!
//! History is the page's setting, kept as a parameter so it saves with the project: the DSP
//! reads it and does nothing with it. Nothing allocates.
#![no_std]

use est::prelude::*;

const TRIM: u32 = 0;
const HISTORY: u32 = 1;

pub struct Template { trim: Smoother }

impl Effect for Template {
    const PARAMS: &'static [Param] = &[
        Param::new(TRIM, "Trim").range(-24.0, 12.0).default(0.0).unit("dB").decimals(1),
        Param::new(HISTORY, "History").range(2.0, 20.0).default(6.0).unit("s").decimals(0).module("Display"),
    ];
    const STATE_MAGIC: u32 = u32::from_le_bytes(*b"TMPV");

    fn new() -> Self { Template { trim: Smoother::new(0.01) } }

    fn activate(&mut self, sample_rate: f64, _max_frames: u32) -> bool {
        self.trim.set_sample_rate(sample_rate);
        self.trim.reset();
        true
    }

    fn reset(&mut self) { self.trim.reset() }

    fn param_changed(&mut self, id: u32, value: f64) {
        if id == TRIM { self.trim.set_target(db_to_gain(value)) }
    }

    fn render(&mut self, io: &mut Io, from: usize, to: usize) {
        for n in from..to {
            let g = self.trim.next();
            for c in 0..io.channels { let x = io.input(c, n) as f64 * g; io.output(c, n, x as f32) }
        }
    }
}

est::export_effect!(Template, id: "org.example.est-visualiser-template", name: "EST Visualiser Template", vendor: "Example",
    version: "1.0.0", description: "Audio through, and a page that draws the level after it: the starting point for an EST plugin with a visual UI in Rust.",
    features: ["audio-effect", "analyzer", "stereo"]);
