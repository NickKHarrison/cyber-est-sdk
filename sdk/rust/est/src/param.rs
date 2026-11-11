//! Parameters, declared once in `PARAMS` with a `const` builder. The glue keeps every value (so a
//! plugin writes no getter, and the state saves them all), clamps and steps what the host sends,
//! words values as text and reads text back, and tells the plugin through `param_changed`.
//!
//! ```text
//! const PARAMS: &'static [Param] = &[
//!     Param::new(GAIN, "Gain").range(-60.0, 12.0).default(0.0).unit("dB").decimals(1),
//!     Param::new(CUTOFF, "Cutoff").range(20.0, 20000.0).default(1000.0).hertz().log().module("Filter"),
//!     Param::new(MODE, "Mode").labels(&["Low", "Band", "High", "Notch"]).module("Filter"),
//! ];
//! ```

use crate::clap::{CLAP_PARAM_IS_BYPASS, CLAP_PARAM_IS_HIDDEN, CLAP_PARAM_IS_READONLY};
use crate::math;

/// How a value is worded.
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Format {
    /// `decimals` decimals, then the unit ("-6.0 dB").
    Number,
    /// A frequency: "440 Hz", "1.20 kHz" (text back takes "1.2k" and "1200").
    Hertz,
}

/// One parameter, in plain values (what automation, the generated UI and the project store).
#[derive(Clone, Copy)]
pub struct Param {
    /// The CLAP id: stable for the plugin's life (projects and automation name it).
    pub id: u32,
    pub name: &'static str,
    /// The group it is shown in ("Filter", "Low shelf"); empty for none (CLAP's `module`).
    pub module: &'static str,
    /// Shown after the value ("dB", "ms", "%"); empty for none.
    pub unit: &'static str,
    pub min: f64,
    pub max: f64,
    pub default: f64,
    /// Decimals shown in the value's text.
    pub decimals: u8,
    /// Names of a stepped parameter's values, from `min` up (empty: a continuous parameter).
    pub labels: &'static [&'static str],
    pub format: Format,
    /// Extra CLAP flags: bypass, hidden, read-only (automatable and stepped are the glue's).
    pub flags: u32,
    /// Moves geometrically over its range (`.log()`): mark it `"scale": "log"` in est.json too,
    /// which is what hosts read (CLAP has no scale). The range must stay above 0.
    pub log: bool,
}

impl Param {
    /// A continuous parameter from 0 to 1, default 0, two decimals: then the builder's calls.
    pub const fn new(id: u32, name: &'static str) -> Param {
        Param { id, name, module: "", unit: "", min: 0.0, max: 1.0, default: 0.0, decimals: 2, labels: &[], format: Format::Number, flags: 0, log: false }
    }
    pub const fn range(self, min: f64, max: f64) -> Param { Param { min, max, ..self } }
    pub const fn default(self, default: f64) -> Param { Param { default, ..self } }
    pub const fn unit(self, unit: &'static str) -> Param { Param { unit, ..self } }
    pub const fn decimals(self, decimals: u8) -> Param { Param { decimals, ..self } }
    pub const fn module(self, module: &'static str) -> Param { Param { module, ..self } }
    /// A stepped parameter: one value per label, 0 to `labels.len() - 1`.
    pub const fn labels(self, labels: &'static [&'static str]) -> Param {
        let max = if labels.is_empty() { 0.0 } else { (labels.len() - 1) as f64 };
        Param { labels, min: 0.0, max, decimals: 0, ..self }
    }
    /// A frequency in Hz, worded "440 Hz" or "1.20 kHz".
    pub const fn hertz(self) -> Param { Param { format: Format::Hertz, unit: "Hz", ..self } }
    /// The plugin's bypass switch (Off, On), which hosts may show as their own.
    pub const fn bypass(self) -> Param {
        Param { labels: &["Off", "On"], min: 0.0, max: 1.0, decimals: 0, flags: self.flags | CLAP_PARAM_IS_BYPASS, ..self }
    }
    /// A logarithmic parameter (a frequency, a time, a Q): knobs, sliders and automation move
    /// geometrically over its range, so the middle of a lane is the geometric middle. Needs a
    /// range above 0 and no labels (checked at compile time), and `"scale": "log"` on the
    /// parameter in est.json (the conformance run checks the range, EST-C021).
    pub const fn log(self) -> Param { Param { log: true, ..self } }
    pub const fn hidden(self) -> Param { Param { flags: self.flags | CLAP_PARAM_IS_HIDDEN, ..self } }
    pub const fn read_only(self) -> Param { Param { flags: self.flags | CLAP_PARAM_IS_READONLY, ..self } }

    pub const fn stepped(&self) -> bool { !self.labels.is_empty() }

    /// A value made valid: within the range, whole steps for a stepped parameter (NaN: the default).
    pub fn clamp(&self, v: f64) -> f64 {
        let v = if v.is_nan() { self.default } else { v };
        let v = if v < self.min { self.min } else if v > self.max { self.max } else { v };
        if self.stepped() { math::round(v) } else { v }
    }
}

/// The most parameters a plugin may declare (the glue keeps their values in a fixed table).
pub const MAX_PARAMS: usize = 512;

/// Whether a parameter list is sound: at most [`MAX_PARAMS`], unique ids, `min < max` (or a
/// one-step switch), the default in range. The export macros check it at compile time.
pub const fn params_valid(ps: &[Param]) -> bool {
    if ps.len() > MAX_PARAMS { return false }
    let mut i = 0;
    while i < ps.len() {
        let p = &ps[i];
        if !(p.min <= p.max) || !(p.default >= p.min && p.default <= p.max) { return false }
        if p.log && !(p.min > 0.0 && p.max > p.min && p.labels.is_empty()) { return false }
        let mut j = i + 1;
        while j < ps.len() {
            if ps[j].id == p.id { return false }
            j += 1;
        }
        i += 1;
    }
    true
}
