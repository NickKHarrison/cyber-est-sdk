//! The DSP library: the blocks a plugin is built from. The AssemblyScript library (`sdk/as/est`)
//! has the same blocks with the same behaviour, sample for sample (Cyber's suite renders both
//! builds of every block and compares them to within 1e-5): its names are these in camelCase.
//!
//! The rules every block keeps:
//! - it allocates nothing after `activate` (only [`DelayLine::allocate`] allocates, and only there);
//! - it is deterministic: its maths is [`crate::math`]'s, the same bits on every host;
//! - it works in `f64` and takes the sample rate from `set_sample_rate` (call it in `activate`;
//!   until then a block assumes 48 kHz).
//!
//! | Block | What |
//! |---|---|
//! | [`Smoother`] | a one-pole glide to a target (parameter smoothing) |
//! | [`Oscillator`] | sine, and band-limited (polyBLEP) saw, square and triangle |
//! | [`Filter`] | a state-variable filter, low, band, high or notch, cutoff and resonance smoothed |
//! | [`Envelope`] | a linear ADSR that reports its tail |
//! | [`Lfo`] | a low-frequency oscillator, free in Hz or synced to the tempo in beats |
//! | [`Voices`] | polyphony: note ids, oldest-note stealing, NOTE_END for every note |
//! | [`DelayLine`] | a delay sized from its maximum in `activate`, fractional reads |
//! | [`Biquad`] | the RBJ cookbook's peak, shelves and passes, and its response |
//! | [`db_to_gain`], [`gain_to_db`] | decibels |

mod biquad;
mod delay;
mod envelope;
mod filter;
mod lfo;
mod oscillator;
mod smoother;
mod voices;

pub use biquad::{coefficients, response_db, Biquad, BiquadKind, Coefficients};
pub use delay::DelayLine;
pub use envelope::{Envelope, Stage};
pub use filter::{Filter, FilterMode};
pub use lfo::Lfo;
pub use oscillator::{Oscillator, Wave};
pub use smoother::Smoother;
pub use voices::{Voice, Voices};

pub use crate::math::{db_to_gain, gain_to_db, key_to_hz};

/// The sample rate a block assumes until `set_sample_rate`.
pub const DEFAULT_SAMPLE_RATE: f64 = 48000.0;
