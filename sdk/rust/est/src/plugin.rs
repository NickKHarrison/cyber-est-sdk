//! The two traits a plugin implements: [`Effect`] (audio in, audio out) and [`Instrument`] (notes
//! in, audio out). Both have the same shape:
//!
//! - `PARAMS`, declared once ([`Param`]); the glue stores the values and calls `param_changed`
//!   with each new one (clamped and stepped), at its own sample while processing;
//! - `activate(sample_rate, max_frames)`, the one place to allocate (a [`crate::dsp::DelayLine`]);
//! - `process(io, events)`: by default it splits the block at each event, calls
//!   `render(io, from, to)` for the frames between, and applies each event at its sample
//!   (parameters, the transport, and an instrument's notes). Override it to read the events
//!   yourself;
//! - `save_state`/`load_state`: the plugin's own bytes after the parameters (the glue saves and
//!   loads every parameter itself: magic, version, count, then (id, value) per parameter).

use crate::io::{Event, EventKind, Events, Expression, Io, Note};
use crate::param::Param;
use crate::state::{StateReader, StateWriter};

/// An EST effect.
pub trait Effect: Sized + 'static {
    const PARAMS: &'static [Param];
    /// Four bytes that mark this plugin's state (`u32::from_le_bytes(*b"GAIN")`): another plugin's is refused.
    const STATE_MAGIC: u32;
    /// Raise it when `save_state`'s bytes change; `load_state` gets the version that saved them.
    const STATE_VERSION: u32 = 1;
    fn new() -> Self;
    /// Before processing starts (the sample rate never changes while active). False refuses.
    fn activate(&mut self, _sample_rate: f64, _max_frames: u32) -> bool { true }
    fn deactivate(&mut self) {}
    /// Clear delay lines, filters and smoothers (a transport jump, the host's reset).
    fn reset(&mut self) {}
    /// A parameter's new value (also each default at creation, possibly before `activate`, and
    /// each value a state load brings).
    fn param_changed(&mut self, _id: u32, _value: f64) {}
    /// One block. The default splits it at the events (see the module's comment).
    fn process(&mut self, io: &mut Io, events: &Events) { split_effect(self, io, events) }
    /// Frames `from..to` of the block (the default `process` calls it between events).
    fn render(&mut self, io: &mut Io, from: usize, to: usize);
    /// Any event, after the glue has applied it (the default `process` calls it).
    fn event(&mut self, _io: &mut Io, _e: &Event) {}
    /// Latency in frames (EST hosts compensate nothing yet: report it honestly).
    fn latency(&self) -> u32 { 0 }
    /// Frames the output may go on sounding after the input stops (`u32::MAX`: forever).
    fn tail(&self) -> u32 { 0 }
    fn save_state(&self, _w: &mut StateWriter) {}
    fn load_state(&mut self, _r: &mut StateReader, _version: u32) -> bool { true }
    /// The host switched between real-time and offline rendering (`clap.render`).
    fn set_offline(&mut self, _offline: bool) {}
}

/// An EST instrument: an [`Effect`]'s shape plus notes, each at its own sample (`note.time`).
/// Every note it starts must end with `io.note_end` when it stops sounding ([`crate::dsp::Voices`]
/// does it); a choke stops at once; `tail()` covers the longest release.
pub trait Instrument: Sized + 'static {
    const PARAMS: &'static [Param];
    const STATE_MAGIC: u32;
    const STATE_VERSION: u32 = 1;
    fn new() -> Self;
    fn activate(&mut self, _sample_rate: f64, _max_frames: u32) -> bool { true }
    fn deactivate(&mut self) {}
    /// Silence every voice at once.
    fn reset(&mut self) {}
    fn param_changed(&mut self, _id: u32, _value: f64) {}
    fn process(&mut self, io: &mut Io, events: &Events) { split_instrument(self, io, events) }
    /// Add the voices' sound to frames `from..to` (the outputs start the block at zero).
    fn render(&mut self, io: &mut Io, from: usize, to: usize);
    fn note_on(&mut self, io: &mut Io, note: &Note);
    fn note_off(&mut self, io: &mut Io, note: &Note);
    /// Stop the matching voices at once (no release) and end their notes.
    fn choke(&mut self, io: &mut Io, note: &Note);
    fn note_expression(&mut self, _io: &mut Io, _e: &Expression) {}
    /// A MIDI 1.0 message (status, two data bytes) on note port `port`.
    fn midi(&mut self, _io: &mut Io, _port: u16, _data: [u8; 3]) {}
    fn event(&mut self, _io: &mut Io, _e: &Event) {}
    fn latency(&self) -> u32 { 0 }
    /// Frames the output may go on sounding after the last note is released (`u32::MAX`: forever).
    fn tail(&self) -> u32 { 0 }
    fn save_state(&self, _w: &mut StateWriter) {}
    fn load_state(&mut self, _r: &mut StateReader, _version: u32) -> bool { true }
    fn set_offline(&mut self, _offline: bool) {}
}

/// Apply the glue's part of an event: a parameter's value (stored, then `param_changed`) or the transport.
fn apply_common(io: &mut Io, e: &Event) -> Option<(u32, f64)> {
    match e.kind {
        EventKind::Param => io.set_param(e.id, e.value).map(|v| (e.id, v)),
        EventKind::Transport => { io.transport = e.transport; None }
        _ => None,
    }
}

/// The default `process` of an effect: `render` between events, each event at its sample.
pub fn split_effect<T: Effect>(p: &mut T, io: &mut Io, events: &Events) {
    let n = events.len();
    let mut at = 0usize;
    for k in 0..=n {
        let e = if k < n { Some(events.get(k)) } else { None };
        let until = match &e { Some(e) => e.time, None => io.frames };
        if until > at {
            p.render(io, at, until);
            at = until;
        }
        if let Some(e) = e {
            if let Some((id, v)) = apply_common(io, &e) { p.param_changed(id, v) }
            p.event(io, &e);
        }
    }
}

/// The default `process` of an instrument: as an effect's, plus the notes.
pub fn split_instrument<T: Instrument>(p: &mut T, io: &mut Io, events: &Events) {
    let n = events.len();
    let mut at = 0usize;
    for k in 0..=n {
        let e = if k < n { Some(events.get(k)) } else { None };
        let until = match &e { Some(e) => e.time, None => io.frames };
        if until > at {
            p.render(io, at, until);
            at = until;
        }
        if let Some(e) = e {
            if let Some((id, v)) = apply_common(io, &e) { p.param_changed(id, v) }
            match e.kind {
                EventKind::NoteOn => p.note_on(io, &e.note),
                EventKind::NoteOff => p.note_off(io, &e.note),
                EventKind::Choke => p.choke(io, &e.note),
                EventKind::Expression => p.note_expression(io, &Expression { id: e.id as i32, note: e.note, value: e.value }),
                EventKind::Midi => p.midi(io, e.port, e.midi),
                _ => {}
            }
            p.event(io, &e);
        }
    }
}
