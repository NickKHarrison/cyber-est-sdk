use crate::io::{Io, Note};

/// What [`Voices`] asks of a voice: to begin its release when its key is let go, and to fall
/// silent at once when its note ends (choked, stolen, or finished).
pub trait Voice {
    fn release(&mut self);
    fn stop(&mut self) {}
}

/// Polyphony for `N` voices of `T`: which voice plays which note (by note id, else by port,
/// channel and key, CLAP's matching), oldest-note stealing, and the host's `NOTE_END` for every
/// note that stops sounding, which an instrument owes the host:
///
/// - `note_on`: `let i = voices.start(io, note);` then set up `voices.voice_mut(i)` (a free voice,
///   else the oldest note's, whose note ends at this sample);
/// - `note_off`: `voices.release(note)` calls `release()` on each matching voice still held;
/// - `choke`: `voices.choke(io, note)` ends each matching voice at once;
/// - `render`: for each `i` with `voices.is_on(i)`, render the voice, and once it is silent call
///   `voices.end(i, io, n)` at the sample `n` it stopped.
///
/// Nothing here allocates: the voices are made once, in `new`.
pub struct Voices<T: Voice, const N: usize> {
    voices: [T; N],
    on: [bool; N],
    releasing: [bool; N],
    notes: [Note; N],
    ages: [u32; N],
    age: u32,
}

impl<T: Voice, const N: usize> Voices<T, N> {
    /// `N` voices, each made by `make`.
    pub fn new(make: impl Fn() -> T) -> Self {
        Voices { voices: core::array::from_fn(|_| make()), on: [false; N], releasing: [false; N], notes: [Note::NONE; N], ages: [0; N], age: 0 }
    }
    pub const fn len(&self) -> usize { N }
    /// Whether voice `i` is playing a note (held or releasing).
    pub fn is_on(&self, i: usize) -> bool { i < N && self.on[i] }
    /// Whether voice `i` has been released (its key let go).
    pub fn is_releasing(&self, i: usize) -> bool { i < N && self.on[i] && self.releasing[i] }
    /// The note voice `i` plays (its key, velocity and id).
    pub fn note(&self, i: usize) -> &Note { &self.notes[i] }
    pub fn voice(&self, i: usize) -> &T { &self.voices[i] }
    pub fn voice_mut(&mut self, i: usize) -> &mut T { &mut self.voices[i] }
    /// How many voices are on.
    pub fn count(&self) -> usize { self.on.iter().filter(|&&o| o).count() }
    /// Whether voice `i` is on and plays a note `note` names (an expression's or a note off's).
    pub fn matches(&self, i: usize, note: &Note) -> bool {
        let n = &self.notes[i];
        self.is_on(i) && note.matches(n.note_id, n.port, n.channel, n.key)
    }
    /// The voice `start` would take: the first free one, else the one with the oldest note.
    pub fn pick(&self) -> usize {
        let mut pick = 0;
        for i in 0..N {
            if !self.on[i] { return i }
            if self.ages[i] < self.ages[pick] { pick = i }
        }
        pick
    }
    /// Give `note` a voice (stealing the oldest when all are on: its note ends at `note.time`).
    pub fn start(&mut self, io: &mut Io, note: &Note) -> usize {
        let i = self.pick();
        if self.on[i] { self.end(i, io, note.time) }
        self.age = self.age.wrapping_add(1);
        self.on[i] = true;
        self.releasing[i] = false;
        self.notes[i] = *note;
        self.ages[i] = self.age;
        i
    }
    /// The key of `note` was let go: each matching held voice begins its release.
    pub fn release(&mut self, note: &Note) {
        for i in 0..N {
            if self.on[i] && !self.releasing[i] && self.matches(i, note) {
                self.releasing[i] = true;
                self.voices[i].release();
            }
        }
    }
    /// Stop each matching voice at once, ending its note at `note.time`.
    pub fn choke(&mut self, io: &mut Io, note: &Note) {
        for i in 0..N { if self.matches(i, note) { self.end(i, io, note.time) } }
    }
    /// Voice `i` stopped sounding at sample `n`: its note ends, the voice's `stop()` runs and it is free.
    pub fn end(&mut self, i: usize, io: &mut Io, n: usize) {
        if !self.is_on(i) { return }
        let note = self.notes[i];
        io.note_end(note.note_id, note.port, note.channel, note.key, n);
        self.voices[i].stop();
        self.on[i] = false;
        self.releasing[i] = false;
    }
    /// Every voice stopped and free at once, without NOTE_END (the host's reset forgets its notes).
    pub fn reset(&mut self) {
        for v in self.voices.iter_mut() { v.stop() }
        self.on = [false; N];
        self.releasing = [false; N];
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    struct V(u32);
    impl Voice for V { fn release(&mut self) { self.0 += 1 } }
    fn note(id: i32, key: i16) -> Note { Note { time: 0, note_id: id, port: 0, channel: 0, key, velocity: 1.0 } }

    #[test]
    fn steals_the_oldest_and_matches_by_id_or_key() {
        let mut io = Io::detached(128);
        let mut v: Voices<V, 2> = Voices::new(|| V(0));
        assert_eq!(v.start(&mut io, &note(1, 60)), 0);
        assert_eq!(v.start(&mut io, &note(2, 62)), 1);
        assert_eq!(v.start(&mut io, &note(3, 64)), 0); // note 1 was the oldest
        assert_eq!(v.note(0).note_id, 3);
        v.release(&Note { note_id: -1, key: 62, ..note(-1, 62) });
        assert!(v.is_releasing(1) && v.voice(1).0 == 1);
        assert_eq!(v.start(&mut io, &note(4, 65)), 1); // note 2 is now the oldest
        v.choke(&mut io, &note(3, -1));
        assert!(!v.is_on(0) && v.count() == 1);
        assert_eq!(v.pick(), 0);
    }
}
