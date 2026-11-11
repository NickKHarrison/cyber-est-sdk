use super::Smoother;
use crate::math;

/// A [`Filter`]'s response.
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum FilterMode { Low = 0, Band = 1, High = 2, Notch = 3 }

impl FilterMode {
    /// The mode of a stepped parameter's value (0 low, 1 band, 2 high, 3 notch).
    pub fn from_index(i: f64) -> FilterMode {
        let i = math::round(i);
        if i == 1.0 { FilterMode::Band } else if i == 2.0 { FilterMode::High } else if i == 3.0 { FilterMode::Notch } else { FilterMode::Low }
    }
}

/// A 12 dB/octave state-variable filter (Andrew Simper's trapezoidal form: stable under fast
/// modulation), low-, band-, high-pass or notch. The cutoff glides in octaves and the resonance
/// linearly, each over 5 ms by default (`set_smoothing`), so automation does not click; while
/// either moves, the coefficients are recomputed every sample, otherwise never.
///
/// Resonance runs 0 (Q 0.5, no peak) to 1 (Q 50, close to self-oscillation). The band-pass is
/// normalised to 0 dB at the cutoff, so resonance narrows it rather than raising it.
#[derive(Clone, Copy)]
pub struct Filter {
    mode: FilterMode,
    sample_rate: f64,
    /// log₂ of the cutoff in Hz.
    cutoff: Smoother,
    resonance: Smoother,
    k: f64,
    a1: f64,
    a2: f64,
    a3: f64,
    ic1: f64,
    ic2: f64,
}

impl Filter {
    pub fn new() -> Filter {
        let mut f = Filter {
            mode: FilterMode::Low, sample_rate: super::DEFAULT_SAMPLE_RATE, cutoff: Smoother::new(0.005), resonance: Smoother::new(0.005),
            k: 2.0, a1: 0.0, a2: 0.0, a3: 0.0, ic1: 0.0, ic2: 0.0,
        };
        f.cutoff.jump(math::log2(1000.0));
        f.update();
        f
    }
    pub fn set_sample_rate(&mut self, sample_rate: f64) {
        self.sample_rate = sample_rate;
        self.cutoff.set_sample_rate(sample_rate);
        self.resonance.set_sample_rate(sample_rate);
        self.update();
    }
    pub fn set_mode(&mut self, mode: FilterMode) { self.mode = mode }
    /// The cutoff in Hz (kept within 10 Hz and 0.49 of the sample rate).
    pub fn set_cutoff(&mut self, hz: f64) { self.cutoff.set_target(math::log2(math::clamp(hz, 10.0, 30000.0))) }
    /// The resonance, 0…1.
    pub fn set_resonance(&mut self, r: f64) { self.resonance.set_target(math::clamp(r, 0.0, 1.0)) }
    /// The glide time of the cutoff and the resonance (0: none).
    pub fn set_smoothing(&mut self, seconds: f64) { self.cutoff.set_time(seconds); self.resonance.set_time(seconds) }
    /// Clear the filter's memory and jump to the cutoff and resonance set.
    pub fn reset(&mut self) {
        self.ic1 = 0.0;
        self.ic2 = 0.0;
        self.cutoff.reset();
        self.resonance.reset();
        self.update();
    }
    /// The cutoff in Hz now (mid-glide, the glide's position).
    pub fn cutoff(&self) -> f64 { math::clamp(math::exp2(self.cutoff.value()), 10.0, 0.49 * self.sample_rate) }

    fn update(&mut self) {
        let g = math::tan_half_turns(self.cutoff() / self.sample_rate);
        self.k = 2.0 - 1.98 * self.resonance.value();
        self.a1 = 1.0 / (1.0 + g * (g + self.k));
        self.a2 = g * self.a1;
        self.a3 = g * self.a2;
    }

    /// One sample through the filter.
    #[inline]
    pub fn process(&mut self, x: f64) -> f64 {
        if !self.cutoff.settled() || !self.resonance.settled() {
            self.cutoff.next();
            self.resonance.next();
            self.update();
        }
        let v3 = x - self.ic2;
        let v1 = self.a1 * self.ic1 + self.a2 * v3;
        let v2 = self.ic2 + self.a2 * self.ic1 + self.a3 * v3;
        self.ic1 = 2.0 * v1 - self.ic1;
        self.ic2 = 2.0 * v2 - self.ic2;
        match self.mode {
            FilterMode::Low => v2,
            FilterMode::Band => self.k * v1,
            FilterMode::High => x - self.k * v1 - v2,
            FilterMode::Notch => x - self.k * v1,
        }
    }
}

impl Default for Filter { fn default() -> Self { Filter::new() } }

#[cfg(test)]
mod tests {
    use super::*;
    use crate::dsp::Oscillator;

    fn gain_at(mode: FilterMode, cutoff: f64, hz: f64) -> f64 {
        let mut f = Filter::new();
        f.set_sample_rate(48000.0);
        f.set_mode(mode);
        f.set_cutoff(cutoff);
        f.reset();
        let mut o = Oscillator::new();
        o.set_frequency(hz);
        let mut peak = 0.0f64;
        for n in 0..24000 { let y = f.process(o.next()); if n > 12000 { peak = peak.max(y.abs()) } }
        peak
    }

    #[test]
    fn passes_and_stops_where_its_mode_says() {
        assert!(gain_at(FilterMode::Low, 1000.0, 100.0) > 0.95);
        assert!(gain_at(FilterMode::Low, 1000.0, 10000.0) < 0.02);
        assert!(gain_at(FilterMode::High, 1000.0, 100.0) < 0.02);
        assert!(gain_at(FilterMode::High, 1000.0, 10000.0) > 0.95);
        assert!((gain_at(FilterMode::Band, 1000.0, 1000.0) - 1.0).abs() < 0.05);
        assert!(gain_at(FilterMode::Notch, 1000.0, 1000.0) < 0.05);
        // At the cutoff, a resonance-0 low-pass is 6 dB down (Q 0.5).
        assert!((gain_at(FilterMode::Low, 1000.0, 1000.0) - 0.5).abs() < 0.03);
    }
}
