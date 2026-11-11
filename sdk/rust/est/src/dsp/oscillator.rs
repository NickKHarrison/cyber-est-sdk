use crate::math;

/// An oscillator's (or an [`super::Lfo`]'s) waveform.
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Wave { Sine = 0, Saw = 1, Square = 2, Triangle = 3 }

impl Wave {
    /// The wave of a stepped parameter's value (0 sine, 1 saw, 2 square, 3 triangle).
    pub fn from_index(i: f64) -> Wave {
        let i = math::round(i);
        if i == 1.0 { Wave::Saw } else if i == 2.0 { Wave::Square } else if i == 3.0 { Wave::Triangle } else { Wave::Sine }
    }
}

/// `x` in 0…2 brought into 0…1.
#[inline(always)]
pub(crate) fn wrap1(x: f64) -> f64 { if x >= 1.0 { x - 1.0 } else { x } }

/// The polyBLEP residual of a rising step of 2 at phase 0 (`t` the phase, `dt` the step per sample).
#[inline(always)]
fn blep(t: f64, dt: f64) -> f64 {
    if t < dt {
        let x = t / dt;
        x + x - x * x - 1.0
    } else if t > 1.0 - dt {
        let x = (t - 1.0) / dt;
        x * x + x + x + 1.0
    } else {
        0.0
    }
}

/// The polyBLAMP residual of a unit change of slope at phase 0 (per unit of `dt`).
#[inline(always)]
fn blamp(t: f64, dt: f64) -> f64 {
    if t < dt {
        let x = 1.0 - t / dt;
        x * x * x / 6.0
    } else if t > 1.0 - dt {
        let x = 1.0 - (1.0 - t) / dt;
        x * x * x / 6.0
    } else {
        0.0
    }
}

/// An audio oscillator: a sine, or a saw, square or triangle band-limited by polyBLEP (polyBLAMP
/// for the triangle's corners), so it aliases far less than the naive shapes. Every wave starts at
/// phase 0 and runs −1…1; the sine and the triangle start at 0 rising, the square at +1, the saw
/// at −1.
#[derive(Clone, Copy)]
pub struct Oscillator { phase: f64, inc: f64, freq: f64, sample_rate: f64, wave: Wave }

impl Oscillator {
    pub fn new() -> Oscillator {
        let sr = super::DEFAULT_SAMPLE_RATE;
        Oscillator { phase: 0.0, inc: 440.0 / sr, freq: 440.0, sample_rate: sr, wave: Wave::Sine }
    }
    pub fn set_sample_rate(&mut self, sample_rate: f64) { self.sample_rate = sample_rate; self.set_frequency(self.freq) }
    /// The frequency in Hz (0 to just under half the sample rate).
    pub fn set_frequency(&mut self, hz: f64) {
        self.freq = hz;
        self.inc = math::clamp(hz / self.sample_rate, 0.0, 0.49);
    }
    pub fn set_wave(&mut self, wave: Wave) { self.wave = wave }
    /// Restart at `phase` (0…1 turns).
    pub fn reset(&mut self, phase: f64) { self.phase = math::clamp(phase - math::floor(phase), 0.0, 0.999_999_999) }
    pub fn phase(&self) -> f64 { self.phase }
    pub fn frequency(&self) -> f64 { self.freq }

    /// The next sample.
    #[inline]
    pub fn next(&mut self) -> f64 {
        let t = self.phase;
        let dt = self.inc;
        let y = match self.wave {
            Wave::Sine => math::sin_turns(t),
            Wave::Saw => 2.0 * t - 1.0 - blep(t, dt),
            Wave::Square => (if t < 0.5 { 1.0 } else { -1.0 }) + blep(t, dt) - blep(wrap1(t + 0.5), dt),
            Wave::Triangle => {
                let u = wrap1(t + 0.25);
                let naive = 1.0 - 4.0 * if u > 0.5 { u - 0.5 } else { 0.5 - u };
                naive + 8.0 * dt * (blamp(u, dt) - blamp(wrap1(t + 0.75), dt))
            }
        };
        self.phase = wrap1(t + dt);
        y
    }
}

impl Default for Oscillator { fn default() -> Self { Oscillator::new() } }

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn each_wave_runs_minus_one_to_one_at_its_frequency() {
        for w in [Wave::Sine, Wave::Saw, Wave::Square, Wave::Triangle] {
            let mut o = Oscillator::new();
            o.set_sample_rate(48000.0);
            o.set_frequency(1000.0);
            o.set_wave(w);
            let (mut lo, mut hi, mut crossings, mut last) = (0.0f64, 0.0f64, 0, 0.0);
            for n in 0..48000 {
                let y = o.next();
                lo = lo.min(y);
                hi = hi.max(y);
                if n > 0 && last < 0.0 && y >= 0.0 { crossings += 1 }
                last = y;
            }
            assert!(hi < 1.1 && hi > 0.9 && lo > -1.1 && lo < -0.9, "{hi} {lo}");
            assert!((crossings as i32 - 1000).abs() <= 1, "{crossings}");
        }
    }
}
