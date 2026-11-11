/// Where an [`Envelope`] is.
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Stage { Idle = 0, Attack = 1, Decay = 2, Sustain = 3, Release = 4 }

/// A linear ADSR, 0…1. `start` attacks from the level it is at (so a stolen or retriggered voice
/// does not click), `release` falls from wherever it is to 0 in exactly the release time, and
/// [`Envelope::tail_frames`] is that time in frames: what an instrument's `tail()` reports.
/// Times are in seconds; a change applies from the next stage (the sustain level at once).
#[derive(Clone, Copy)]
pub struct Envelope {
    stage: Stage,
    level: f64,
    step: f64,
    sample_rate: f64,
    attack: f64,
    decay: f64,
    sustain: f64,
    release: f64,
}

impl Envelope {
    pub fn new() -> Envelope {
        Envelope { stage: Stage::Idle, level: 0.0, step: 0.0, sample_rate: super::DEFAULT_SAMPLE_RATE, attack: 0.005, decay: 0.1, sustain: 0.7, release: 0.3 }
    }
    pub fn set_sample_rate(&mut self, sample_rate: f64) { self.sample_rate = sample_rate }
    pub fn set_attack(&mut self, seconds: f64) { self.attack = if seconds > 0.0 { seconds } else { 0.0 } }
    pub fn set_decay(&mut self, seconds: f64) { self.decay = if seconds > 0.0 { seconds } else { 0.0 } }
    /// The sustain level, 0…1.
    pub fn set_sustain(&mut self, level: f64) { self.sustain = if level > 1.0 { 1.0 } else if level > 0.0 { level } else { 0.0 } }
    pub fn set_release(&mut self, seconds: f64) { self.release = if seconds > 0.0 { seconds } else { 0.0 } }
    /// All four at once.
    pub fn set_adsr(&mut self, attack: f64, decay: f64, sustain: f64, release: f64) {
        self.set_attack(attack);
        self.set_decay(decay);
        self.set_sustain(sustain);
        self.set_release(release);
    }

    fn frames(&self, seconds: f64) -> f64 { let f = seconds * self.sample_rate; if f > 1.0 { f } else { 1.0 } }

    /// The note started: attack from the current level.
    pub fn start(&mut self) {
        self.stage = Stage::Attack;
        self.step = 1.0 / self.frames(self.attack);
    }
    /// The note was released: fall to 0 over the release time.
    pub fn release(&mut self) {
        if self.stage == Stage::Idle { return }
        self.stage = Stage::Release;
        self.step = self.level / self.frames(self.release);
    }
    /// Silent at once.
    pub fn reset(&mut self) { self.stage = Stage::Idle; self.level = 0.0; self.step = 0.0 }

    /// The next sample's level.
    #[inline]
    pub fn next(&mut self) -> f64 {
        match self.stage {
            Stage::Attack => {
                self.level += self.step;
                if self.level >= 1.0 {
                    self.level = 1.0;
                    self.stage = Stage::Decay;
                    self.step = (1.0 - self.sustain) / self.frames(self.decay);
                }
            }
            Stage::Decay => {
                self.level -= self.step;
                if self.level <= self.sustain { self.level = self.sustain; self.stage = Stage::Sustain }
            }
            Stage::Sustain => self.level = self.sustain,
            Stage::Release => {
                self.level -= self.step;
                if self.level <= 0.0 { self.level = 0.0; self.stage = Stage::Idle }
            }
            Stage::Idle => {}
        }
        self.level
    }
    pub fn level(&self) -> f64 { self.level }
    pub fn stage(&self) -> Stage { self.stage }
    /// Whether it still sounds (any stage but Idle).
    pub fn is_active(&self) -> bool { self.stage != Stage::Idle }
    /// The release in frames, plus one: the most a released note goes on sounding.
    pub fn tail_frames(&self) -> u32 { self.frames(self.release) as u32 + 1 }
}

impl Default for Envelope { fn default() -> Self { Envelope::new() } }

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn attacks_decays_sustains_and_releases_within_its_tail() {
        let mut e = Envelope::new();
        e.set_sample_rate(1000.0);
        e.set_adsr(0.01, 0.02, 0.5, 0.1);
        e.start();
        let mut v = 0.0;
        for _ in 0..11 { v = e.next() }
        assert_eq!(v, 1.0);
        for _ in 0..21 { v = e.next() }
        assert!((v - 0.5).abs() < 1e-9 && e.stage() == Stage::Sustain);
        e.release();
        let mut n = 0;
        while e.is_active() { e.next(); n += 1 }
        assert!(n <= e.tail_frames() as usize && n >= 99, "{n}");
    }
}
