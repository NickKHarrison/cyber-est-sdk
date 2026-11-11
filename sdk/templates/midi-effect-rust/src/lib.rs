//! EST MIDI Effect Template (org.example.est-midi-effect-template): an EST note effect in Rust,
//! made from the midi-effect-rust template: notes in, notes out, the audio passed through. Two
//! modes: an arpeggiator whose rate follows the transport's tempo (and its beat grid while the
//! transport plays), and a chord memory that plays a learned chord from each key. Keep est.json's
//! identity and parameters in step with this file, then (see AGENTS.md):
//!
//!     est pack        # cargo build --release, then the bundle in dist/
//!     est validate    # the checks Cyber's install runs; read dist/validation.json
//!     est test        # the golden render (audio and the notes sent) plus the conformance run
//!
//! The rules a note effect keeps: every note it starts it ends (`io.send_note_off`), including
//! when the mode changes or the keys are let go; nothing allocates (fixed arrays only).
#![no_std]

use est::math::floor;
use est::prelude::*;

const MODE: u32 = 0;
const RATE: u32 = 1;
const PATTERN: u32 = 2;
const OCTAVES: u32 = 3;
const GATE: u32 = 4;
const LEARN: u32 = 5;

const MAX_HELD: usize = 16;
const MAX_CHORD: usize = 8;

pub struct Template {
    sample_rate: f64,
    mode: i32,
    rate: i32,
    pattern: i32,
    octaves: i32,
    gate: f64,
    learn: bool,
    // The arpeggiator: the keys held (in the order played), the step, the note sounding.
    held: [i32; MAX_HELD],
    held_vel: [f64; MAX_HELD],
    held_count: usize,
    sorted: [i32; MAX_HELD],
    step: i32,
    acc: f64,
    last_grid: f64,
    trigger: bool,
    out_key: i32,
    off_in: i32,
    /// Where the block's transport was last set (a transport event mid-block moves it).
    tr_at: usize,
    // The chord memory: the intervals learned, and what each held input key started.
    memory: [i32; MAX_CHORD],
    mem_count: usize,
    learn_keys: [i32; MAX_CHORD],
    learn_count: usize,
    active: [[i32; MAX_CHORD]; 128],
    active_count: [usize; 128],
}

impl Template {
    fn flush(&mut self, io: &mut Io, n: usize) {
        if self.out_key >= 0 { io.send_note_off(-1, 0, self.out_key as i16, 0.0, n); self.out_key = -1 }
        self.held_count = 0;
        for k in 0..128 { self.release_key(io, k, n) }
    }

    fn note_on(&mut self, io: &mut Io, note: &Note) {
        let key = note.key as i32;
        if !(0..=127).contains(&key) { return }
        if self.mode == 0 {
            if self.held_count >= MAX_HELD { return }
            if self.held_count == 0 { self.trigger = true }
            self.held[self.held_count] = key;
            self.held_vel[self.held_count] = note.velocity;
            self.held_count += 1;
            return;
        }
        self.release_key(io, key as usize, note.time); // the same key again: its chord starts afresh
        if self.learn {
            if self.learn_count == 0 { self.mem_count = 0 }
            if self.learn_count < MAX_CHORD { self.learn_keys[self.learn_count] = key; self.learn_count += 1 }
            self.learn_chord();
            self.start_key(io, key as usize, key, note.velocity, note.time); // played as it is while learning
            return;
        }
        for i in 0..self.mem_count { self.start_key(io, key as usize, key + self.memory[i], note.velocity, note.time) }
    }

    fn note_off(&mut self, io: &mut Io, note: &Note) {
        let key = note.key as i32;
        if self.mode == 0 {
            self.remove_held(key);
            if self.held_count == 0 && self.out_key >= 0 { io.send_note_off(-1, 0, self.out_key as i16, 0.0, note.time); self.out_key = -1 }
            return;
        }
        if (0..128).contains(&key) { self.release_key(io, key as usize, note.time) }
        for i in 0..self.learn_count {
            if self.learn_keys[i] != key { continue }
            for j in i + 1..self.learn_count { self.learn_keys[j - 1] = self.learn_keys[j] }
            self.learn_count -= 1;
            break;
        }
    }

    fn remove_held(&mut self, key: i32) {
        for i in 0..self.held_count {
            if self.held[i] != key { continue }
            for j in i + 1..self.held_count { self.held[j - 1] = self.held[j]; self.held_vel[j - 1] = self.held_vel[j] }
            self.held_count -= 1;
            return;
        }
    }

    /// The chord memory: the keys held while learning, from the lowest, as intervals.
    fn learn_chord(&mut self) {
        let mut lo = 127;
        for i in 0..self.learn_count { if self.learn_keys[i] < lo { lo = self.learn_keys[i] } }
        self.mem_count = 0;
        for i in 0..self.learn_count { self.memory[self.mem_count] = self.learn_keys[i] - lo; self.mem_count += 1 }
        sort(&mut self.memory[..self.mem_count]);
    }

    fn start_key(&mut self, io: &mut Io, input: usize, out: i32, velocity: f64, n: usize) {
        if !(0..=127).contains(&out) { return }
        let c = self.active_count[input];
        if c >= MAX_CHORD { return }
        self.active[input][c] = out;
        self.active_count[input] = c + 1;
        io.send_note_on(-1, 0, out as i16, velocity, n);
    }

    fn release_key(&mut self, io: &mut Io, input: usize, n: usize) {
        for i in 0..self.active_count[input] { io.send_note_off(-1, 0, self.active[input][i] as i16, 0.0, n) }
        self.active_count[input] = 0;
    }

    fn play_step(&mut self, io: &mut Io, n: usize, frames_per_step: f64) {
        let h = self.held_count;
        // The keys in pattern order: sorted for Up, Down and Up-Down, as played otherwise.
        self.sorted[..h].copy_from_slice(&self.held[..h]);
        if self.pattern != 3 { sort(&mut self.sorted[..h]) }
        let hi = h as i32;
        let len = hi * self.octaves;
        let i = match self.pattern {
            1 => len - 1 - self.step % len,
            2 => {
                let period = if len > 1 { 2 * len - 2 } else { 1 };
                let j = self.step % period;
                if j < len { j } else { period - j }
            }
            _ => self.step % len,
        };
        let base = self.sorted[(i % hi) as usize];
        let key = base + 12 * (i / hi);
        let mut velocity = 0.0;
        for k in 0..h { if self.held[k] == base { velocity = self.held_vel[k] } }
        self.step += 1;
        if self.out_key >= 0 { io.send_note_off(-1, 0, self.out_key as i16, 0.0, n) }
        self.out_key = -1;
        if key > 127 { return }
        io.send_note_on(-1, 0, key as i16, velocity, n);
        self.out_key = key;
        let gate_frames = floor(frames_per_step * self.gate / 100.0) as i32;
        self.off_in = if gate_frames < 1 { 1 } else { gate_frames };
    }
}

/// An insertion sort (a few entries, nothing allocated).
fn sort(v: &mut [i32]) {
    for i in 1..v.len() {
        let x = v[i];
        let mut j = i;
        while j > 0 && v[j - 1] > x { v[j] = v[j - 1]; j -= 1 }
        v[j] = x;
    }
}

impl Effect for Template {
    const PARAMS: &'static [Param] = &[
        Param::new(MODE, "Mode").labels(&["Arpeggiator", "Chord memory"]),
        Param::new(RATE, "Rate").labels(&["1/4", "1/8", "1/16", "1/32"]).default(2.0).module("Arpeggiator"),
        Param::new(PATTERN, "Pattern").labels(&["Up", "Down", "Up-Down", "As played"]).module("Arpeggiator"),
        Param::new(OCTAVES, "Octaves").labels(&["1", "2", "3", "4"]).module("Arpeggiator"),
        Param::new(GATE, "Gate").range(5.0, 100.0).default(50.0).unit("%").decimals(0).module("Arpeggiator"),
        Param::new(LEARN, "Learn").labels(&["Off", "On"]).module("Chord memory"),
    ];
    const STATE_MAGIC: u32 = u32::from_le_bytes(*b"TMPN");

    fn new() -> Self {
        let mut memory = [0; MAX_CHORD];
        memory[1] = 4; memory[2] = 7; // a major triad until one is learned
        Template {
            sample_rate: 48000.0, mode: 0, rate: 2, pattern: 0, octaves: 1, gate: 50.0, learn: false,
            held: [0; MAX_HELD], held_vel: [0.0; MAX_HELD], held_count: 0, sorted: [0; MAX_HELD],
            step: 0, acc: 0.0, last_grid: -1.0, trigger: false, out_key: -1, off_in: 0, tr_at: 0,
            memory, mem_count: 3, learn_keys: [0; MAX_CHORD], learn_count: 0,
            active: [[0; MAX_CHORD]; 128], active_count: [0; 128],
        }
    }

    fn activate(&mut self, sample_rate: f64, _max_frames: u32) -> bool {
        self.sample_rate = sample_rate;
        self.reset();
        true
    }

    /// Forget every note (the host's reset: it silences what follows this plugin itself).
    fn reset(&mut self) {
        self.held_count = 0; self.out_key = -1; self.off_in = 0; self.step = 0; self.acc = 0.0; self.last_grid = -1.0; self.trigger = false;
        self.learn_count = 0;
        self.active_count = [0; 128];
    }

    fn param_changed(&mut self, id: u32, value: f64) {
        match id {
            MODE => self.mode = value as i32,
            RATE => self.rate = value as i32,
            PATTERN => self.pattern = value as i32,
            OCTAVES => self.octaves = value as i32 + 1,
            GATE => self.gate = value,
            LEARN => { self.learn = value >= 0.5; self.learn_count = 0 }
            _ => {}
        }
    }

    fn process(&mut self, io: &mut Io, events: &Events) { self.tr_at = 0; est::split_effect(self, io, events) }

    /// Every event, after the glue has applied it: the notes, and a mode or Learn change (which
    /// ends every note sounding).
    fn event(&mut self, io: &mut Io, e: &Event) {
        match e.kind {
            EventKind::NoteOn => self.note_on(io, &e.note),
            EventKind::NoteOff => self.note_off(io, &e.note),
            EventKind::Choke => self.flush(io, e.time),
            EventKind::Transport => self.tr_at = e.time,
            _ => {}
        }
        if e.is_param(MODE) || e.is_param(LEARN) { self.flush(io, e.time) }
    }

    fn render(&mut self, io: &mut Io, from: usize, to: usize) {
        for n in from..to {
            for c in 0..io.channels { let x = io.input(c, n); io.output(c, n, x) } // the audio passes through
            if self.mode != 0 { continue }
            let step_beats = 1.0 / (1i32 << self.rate) as f64;
            let frames_per_step = self.sample_rate * 60.0 / io.transport.tempo * step_beats;
            if self.out_key >= 0 {
                self.off_in -= 1;
                if self.off_in <= 0 { io.send_note_off(-1, 0, self.out_key as i16, 0.0, n); self.out_key = -1 }
            }
            if self.held_count == 0 { continue }
            let mut due = false;
            if io.transport.playing {
                // On the song's grid: a step at every multiple of the rate.
                let beat = io.transport.beat + (n as i32 - self.tr_at as i32) as f64 * io.transport.tempo / (60.0 * self.sample_rate);
                let grid = floor(beat / step_beats);
                if grid != self.last_grid { due = self.last_grid >= 0.0; self.last_grid = grid }
            } else {
                // Free: a step every `frames_per_step` frames from the first key.
                self.last_grid = -1.0;
                self.acc += 1.0;
                if self.acc >= frames_per_step { self.acc -= frames_per_step; due = true }
            }
            if self.trigger { due = true; self.trigger = false; self.acc = 0.0; self.step = 0 }
            if due { self.play_step(io, n, frames_per_step) }
        }
    }

    // The state: the learned chord.
    fn save_state(&self, w: &mut StateWriter) {
        w.u32(self.mem_count as u32);
        for i in 0..self.mem_count { w.u32(self.memory[i] as u32) }
    }

    fn load_state(&mut self, r: &mut StateReader, _version: u32) -> bool {
        let n = r.u32() as usize;
        if !r.ok || n > MAX_CHORD { return false }
        for i in 0..n {
            let v = r.u32();
            if v > 127 { return false }
            self.memory[i] = v as i32;
        }
        self.mem_count = n;
        r.ok
    }
}

est::export_note_effect!(Template, id: "org.example.est-midi-effect-template", name: "EST MIDI Effect Template", vendor: "Example",
    version: "1.0.0", description: "An arpeggiator synced to the tempo and a chord memory: the starting point for an EST note effect in Rust.",
    features: ["audio-effect", "note-effect", "stereo"]);
