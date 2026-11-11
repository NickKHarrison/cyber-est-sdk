//! What `process` sees: the block's audio and parameter values ([`Io`]), the song's transport
//! ([`Transport`]), and the block's events ([`Events`], each an [`Event`] with its sample).

use crate::clap::*;
use crate::param::Param;
use core::ptr::{null, null_mut};

/// The host's transport, as of the sample being rendered (a transport event mid-block moves it).
#[derive(Clone, Copy)]
pub struct Transport {
    /// Beats per minute (120 when the host sends none).
    pub tempo: f64,
    pub playing: bool,
    /// The song position in beats (quarter notes), at the start of the block or the event.
    pub beat: f64,
    /// The beat the current bar starts on.
    pub bar_start: f64,
    /// The time signature (4/4 when the host sends none).
    pub num: u16,
    pub den: u16,
}

impl Transport {
    pub const DEFAULT: Transport = Transport { tempo: 120.0, playing: false, beat: 0.0, bar_start: 0.0, num: 4, den: 4 };

    /// Read a CLAP transport struct (absent fields keep their defaults).
    pub(crate) unsafe fn read(t: *const ClapEventTransport) -> Transport {
        let mut out = Transport::DEFAULT;
        if t.is_null() { return out }
        let t = &*t;
        if t.flags & CLAP_TRANSPORT_HAS_TEMPO != 0 && t.tempo > 0.0 { out.tempo = t.tempo }
        out.playing = t.flags & CLAP_TRANSPORT_IS_PLAYING != 0;
        if t.flags & CLAP_TRANSPORT_HAS_BEATS_TIMELINE != 0 {
            out.beat = t.song_pos_beats as f64 / CLAP_BEATTIME_FACTOR;
            out.bar_start = t.bar_start as f64 / CLAP_BEATTIME_FACTOR;
        }
        if t.flags & CLAP_TRANSPORT_HAS_TIME_SIGNATURE != 0 && t.tsig_num > 0 && t.tsig_denom > 0 {
            out.num = t.tsig_num;
            out.den = t.tsig_denom;
        }
        out
    }
}

/// One note, as CLAP sends it. `time` is the sample in the block; `note_id` -1 is none; `port`,
/// `channel` or `key` -1 is any (a note off or choke for every key).
#[derive(Clone, Copy)]
pub struct Note {
    pub time: usize,
    pub note_id: i32,
    pub port: i16,
    pub channel: i16,
    pub key: i16,
    /// 0 to 1 (a note off's release velocity).
    pub velocity: f64,
}

impl Note {
    pub const NONE: Note = Note { time: 0, note_id: -1, port: -1, channel: -1, key: -1, velocity: 0.0 };

    /// Whether a sounding note (`id`, `port`, `channel`, `key`) is the one this event names
    /// (CLAP's matching: by note id when the event has one, else by port, channel and key, -1 any).
    pub fn matches(&self, id: i32, port: i16, channel: i16, key: i16) -> bool {
        if self.note_id != -1 { return id == self.note_id }
        (self.port == -1 || self.port == port) && (self.channel == -1 || self.channel == channel) && (self.key == -1 || self.key == key)
    }
}

/// A note expression (`CLAP_NOTE_EXPRESSION_*` in `id`) on the notes `note` names.
#[derive(Clone, Copy)]
pub struct Expression {
    pub id: i32,
    pub note: Note,
    pub value: f64,
}

/// What an [`Event`] is.
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum EventKind { Param, NoteOn, NoteOff, Choke, Expression, Midi, Transport, Other }

/// One event of the block, decoded (a copy: reading it allocates nothing).
#[derive(Clone, Copy)]
pub struct Event {
    pub kind: EventKind,
    /// The sample in the block it applies from.
    pub time: usize,
    /// A parameter's id (`Param`) or an expression's (`Expression`).
    pub id: u32,
    /// A parameter's value (as sent: the glue clamps it before storing) or an expression's.
    pub value: f64,
    /// The note of `NoteOn`, `NoteOff`, `Choke` and `Expression`.
    pub note: Note,
    /// A MIDI 1.0 message (`Midi`) and its note port.
    pub midi: [u8; 3],
    pub port: u16,
    /// The transport from this sample on (`Transport`).
    pub transport: Transport,
}

impl Event {
    const EMPTY: Event = Event { kind: EventKind::Other, time: 0, id: 0, value: 0.0, note: Note::NONE, midi: [0; 3], port: 0, transport: Transport::DEFAULT };

    /// Whether this is a value for parameter `id`.
    pub fn is_param(&self, id: u32) -> bool { self.kind == EventKind::Param && self.id == id }

    unsafe fn decode(h: *const ClapEventHeader, frames: usize) -> Event {
        let mut e = Event::EMPTY;
        if h.is_null() { return e }
        let t = (*h).time as usize;
        e.time = if t < frames { t } else { frames };
        if (*h).space_id != CLAP_CORE_EVENT_SPACE_ID { return e }
        let size = (*h).size as usize;
        let time = e.time;
        let note = move |h: *const ClapEventHeader| {
            let n = &*(h as *const ClapEventNote);
            Note { time, note_id: n.note_id, port: n.port_index, channel: n.channel, key: n.key, velocity: n.velocity }
        };
        match (*h).type_ {
            CLAP_EVENT_PARAM_VALUE if size >= core::mem::size_of::<ClapEventParamValue>() => {
                let p = &*(h as *const ClapEventParamValue);
                e.kind = EventKind::Param;
                e.id = p.param_id;
                e.value = p.value;
            }
            CLAP_EVENT_NOTE_ON if size >= core::mem::size_of::<ClapEventNote>() => { e.kind = EventKind::NoteOn; e.note = note(h) }
            CLAP_EVENT_NOTE_OFF if size >= core::mem::size_of::<ClapEventNote>() => { e.kind = EventKind::NoteOff; e.note = note(h) }
            CLAP_EVENT_NOTE_CHOKE if size >= core::mem::size_of::<ClapEventNote>() => { e.kind = EventKind::Choke; e.note = note(h) }
            CLAP_EVENT_NOTE_EXPRESSION if size >= core::mem::size_of::<ClapEventNoteExpression>() => {
                let x = &*(h as *const ClapEventNoteExpression);
                e.kind = EventKind::Expression;
                e.id = x.expression_id as u32;
                e.value = x.value;
                e.note = Note { time: e.time, note_id: x.note_id, port: x.port_index, channel: x.channel, key: x.key, velocity: 0.0 };
            }
            CLAP_EVENT_MIDI if size >= core::mem::size_of::<ClapEventMidi>() => {
                let m = &*(h as *const ClapEventMidi);
                e.kind = EventKind::Midi;
                e.midi = m.data;
                e.port = m.port_index;
            }
            CLAP_EVENT_TRANSPORT if size >= core::mem::size_of::<ClapEventTransport>() => {
                e.kind = EventKind::Transport;
                e.transport = Transport::read(h as *const ClapEventTransport);
            }
            _ => {}
        }
        e
    }
}

/// The block's events, in time order (CLAP sorts them).
pub struct Events { list: *const ClapInputEvents, count: usize, frames: usize }

impl Events {
    pub(crate) unsafe fn new(list: *const ClapInputEvents, frames: usize) -> Events {
        let count = if list.is_null() { 0 } else { ((*list).size)(list) as usize };
        Events { list, count, frames }
    }
    /// No events (tests, and a plugin's own calls).
    pub const fn none() -> Events { Events { list: null(), count: 0, frames: 0 } }
    pub fn len(&self) -> usize { self.count }
    pub fn is_empty(&self) -> bool { self.count == 0 }
    /// Event `k` (0 ≤ k < len), decoded.
    pub fn get(&self, k: usize) -> Event {
        if k >= self.count { return Event::EMPTY }
        unsafe { Event::decode(((*self.list).get)(self.list, k as u32), self.frames) }
    }
}

/// The audio of one block, the parameters' values and the way back to the host (`note_end`).
/// For an effect, `input` reads the block's input; for an instrument there is none (it reads 0)
/// and the outputs start the block at zero.
pub struct Io {
    pub(crate) ins: [*const f32; 2],
    pub(crate) outs: [*mut f32; 2],
    /// Channels processed (1 or 2): an effect's inputs and outputs in common, an instrument's outputs.
    pub channels: usize,
    pub frames: usize,
    pub transport: Transport,
    pub(crate) values: *mut f64,
    pub(crate) params: &'static [Param],
    pub(crate) out_events: *const ClapOutputEvents,
}

impl Io {
    /// An Io with no audio and no host (a plugin's own tests, and probes): reads 0, writes nothing.
    pub const fn detached(frames: usize) -> Io {
        Io { ins: [null(); 2], outs: [null_mut(); 2], channels: 0, frames, transport: Transport::DEFAULT, values: null_mut(), params: &[], out_events: null() }
    }

    /// Input sample `n` of channel `c` (0 outside the block, and for an instrument).
    #[inline(always)]
    pub fn input(&self, c: usize, n: usize) -> f32 {
        if c < self.channels && n < self.frames && !self.ins[c].is_null() { unsafe { *self.ins[c].add(n) } } else { 0.0 }
    }
    /// Write output sample `n` of channel `c` (ignored outside the block).
    #[inline(always)]
    pub fn output(&mut self, c: usize, n: usize, v: f32) {
        if c < self.channels && n < self.frames && !self.outs[c].is_null() { unsafe { *self.outs[c].add(n) = v } }
    }
    /// Add `v` to output sample `n` of channel `c` (an instrument's voices mix this way).
    #[inline(always)]
    pub fn add(&mut self, c: usize, n: usize, v: f32) {
        if c < self.channels && n < self.frames && !self.outs[c].is_null() { unsafe { *self.outs[c].add(n) += v } }
    }

    fn index(&self, id: u32) -> Option<usize> { self.params.iter().position(|p| p.id == id) }

    /// The current value of parameter `id` (clamped; 0 for an unknown id).
    pub fn param(&self, id: u32) -> f64 {
        match self.index(id) { Some(i) if !self.values.is_null() => unsafe { *self.values.add(i) }, _ => 0.0 }
    }

    /// Store a value for parameter `id`, clamped: the value stored, or None for an unknown id.
    pub(crate) fn set_param(&mut self, id: u32, v: f64) -> Option<f64> {
        let i = self.index(id)?;
        let v = self.params[i].clamp(v);
        if !self.values.is_null() { unsafe { *self.values.add(i) = v } }
        Some(v)
    }

    /// Tell the host the note (`id`, `port`, `channel`, `key`) stopped sounding at sample `n`
    /// (an instrument must, for every note it started: CLAP's `NOTE_END`).
    pub fn note_end(&mut self, id: i32, port: i16, channel: i16, key: i16, n: usize) {
        self.push_note(CLAP_EVENT_NOTE_END, id, port, channel, key, 0.0, n);
    }

    /// A note effect's output (DEV-F, 1.321; `export_note_effect!`): start note `key` at sample `n`
    /// on the plugin's note output (port 0). A note it starts it must also end (`send_note_off`).
    pub fn send_note_on(&mut self, id: i32, channel: i16, key: i16, velocity: f64, n: usize) {
        self.push_note(CLAP_EVENT_NOTE_ON, id, 0, channel, key, velocity, n);
    }
    /// A note effect's output: release note `key` (or `id`) at sample `n`.
    pub fn send_note_off(&mut self, id: i32, channel: i16, key: i16, velocity: f64, n: usize) {
        self.push_note(CLAP_EVENT_NOTE_OFF, id, 0, channel, key, velocity, n);
    }

    fn push_note(&mut self, type_: u16, id: i32, port: i16, channel: i16, key: i16, velocity: f64, n: usize) {
        if self.out_events.is_null() { return }
        let e = ClapEventNote {
            header: ClapEventHeader {
                size: core::mem::size_of::<ClapEventNote>() as u32,
                time: if n < self.frames { n as u32 } else { self.frames.saturating_sub(1) as u32 },
                space_id: CLAP_CORE_EVENT_SPACE_ID,
                type_,
                flags: 0,
            },
            note_id: id, port_index: port, channel, key, velocity,
        };
        unsafe { ((*self.out_events).try_push)(self.out_events, &e.header) };
    }
}
