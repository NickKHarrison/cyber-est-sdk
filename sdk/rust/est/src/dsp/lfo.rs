use super::oscillator::{wrap1, Wave};
use crate::math;

/// A low-frequency oscillator, −1…1: free at a rate in Hz, or synced to the song's tempo with a
/// cycle of `beats` (feed it `io.transport.tempo`). The shapes are the plain ones (an LFO needs no
/// band-limiting): the sine and the triangle start at 0 rising, the saw at −1, the square at +1.
#[derive(Clone, Copy)]
pub struct Lfo { phase: f64, inc: f64, rate: f64, sync: f64, tempo: f64, sample_rate: f64, wave: Wave }

impl Lfo {
    pub fn new() -> Lfo {
        let mut l = Lfo { phase: 0.0, inc: 0.0, rate: 1.0, sync: 0.0, tempo: 120.0, sample_rate: super::DEFAULT_SAMPLE_RATE, wave: Wave::Sine };
        l.update();
        l
    }
    fn update(&mut self) {
        let hz = if self.sync > 0.0 { self.tempo / 60.0 / self.sync } else { self.rate };
        self.inc = math::clamp(hz / self.sample_rate, 0.0, 0.5);
    }
    pub fn set_sample_rate(&mut self, sample_rate: f64) { self.sample_rate = sample_rate; self.update() }
    /// The free rate in Hz (used while not synced).
    pub fn set_rate(&mut self, hz: f64) { self.rate = hz; self.update() }
    /// Synced: one cycle every `beats` beats (0: free, at the rate).
    pub fn set_sync(&mut self, beats: f64) { self.sync = if beats > 0.0 { beats } else { 0.0 }; self.update() }
    /// The song's tempo in BPM (a synced LFO follows it).
    pub fn set_tempo(&mut self, bpm: f64) { if bpm > 0.0 && bpm != self.tempo { self.tempo = bpm; self.update() } }
    pub fn set_wave(&mut self, wave: Wave) { self.wave = wave }
    /// Restart at `phase` (0…1 turns).
    pub fn reset(&mut self, phase: f64) { self.phase = math::clamp(phase - math::floor(phase), 0.0, 0.999_999_999) }
    pub fn phase(&self) -> f64 { self.phase }

    #[inline]
    pub fn next(&mut self) -> f64 {
        let t = self.phase;
        let y = match self.wave {
            Wave::Sine => math::sin_turns(t),
            Wave::Saw => 2.0 * t - 1.0,
            Wave::Square => if t < 0.5 { 1.0 } else { -1.0 },
            Wave::Triangle => {
                let u = wrap1(t + 0.25);
                1.0 - 4.0 * if u > 0.5 { u - 0.5 } else { 0.5 - u }
            }
        };
        self.phase = wrap1(t + self.inc);
        y
    }
}

impl Default for Lfo { fn default() -> Self { Lfo::new() } }

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn a_synced_cycle_lasts_its_beats_at_the_tempo() {
        let mut l = Lfo::new();
        l.set_sample_rate(1000.0);
        l.set_wave(Wave::Saw);
        l.set_sync(1.0);
        l.set_tempo(120.0); // a beat is 0.5 s: 500 samples
        let first = l.next();
        for _ in 0..499 { l.next(); }
        assert!((l.next() - first).abs() < 1e-9);
        l.set_sync(0.0);
        l.set_rate(10.0);
        l.reset(0.0);
        for _ in 0..100 { l.next(); }
        assert!(l.phase().abs() < 1e-9 || (l.phase() - 1.0).abs() < 1e-9);
    }
}
