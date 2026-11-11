use crate::math;

/// A [`Biquad`]'s shape (Robert Bristow-Johnson's Audio EQ Cookbook).
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum BiquadKind { Peak = 0, LowShelf = 1, HighShelf = 2, LowPass = 3, HighPass = 4 }

impl BiquadKind {
    pub fn from_index(i: f64) -> BiquadKind {
        let i = math::round(i);
        if i == 1.0 { BiquadKind::LowShelf } else if i == 2.0 { BiquadKind::HighShelf } else if i == 3.0 { BiquadKind::LowPass } else if i == 4.0 { BiquadKind::HighPass } else { BiquadKind::Peak }
    }
}

/// A biquad's coefficients, normalised (a0 = 1).
#[derive(Clone, Copy, PartialEq)]
pub struct Coefficients { pub b0: f64, pub b1: f64, pub b2: f64, pub a1: f64, pub a2: f64 }

impl Coefficients {
    /// Passes everything unchanged.
    pub const IDENTITY: Coefficients = Coefficients { b0: 1.0, b1: 0.0, b2: 0.0, a1: 0.0, a2: 0.0 };
}

/// The cookbook's coefficients: `freq` in Hz (kept within 1 Hz and 0.499 of the sample rate),
/// `q` (at least 0.01; for the shelves it is the cookbook's Q form), `gain_db` for the peak and
/// the shelves (the passes ignore it).
pub fn coefficients(kind: BiquadKind, freq: f64, q: f64, gain_db: f64, sample_rate: f64) -> Coefficients {
    let f = math::clamp(freq, 1.0, 0.499 * sample_rate);
    let q = if q > 0.01 { q } else { 0.01 };
    let w = f / sample_rate;
    let cw = math::cos_turns(w);
    let sw = math::sin_turns(w);
    let alpha = sw / (2.0 * q);
    // A = 10^(gain/40) and √A = 10^(gain/80), through exp so they are the same bits everywhere.
    let a = math::exp(gain_db * core::f64::consts::LN_10 / 40.0);
    let sa = math::exp(gain_db * core::f64::consts::LN_10 / 80.0);
    let (b0, b1, b2, a0, a1, a2) = match kind {
        BiquadKind::Peak => (1.0 + alpha * a, -2.0 * cw, 1.0 - alpha * a, 1.0 + alpha / a, -2.0 * cw, 1.0 - alpha / a),
        BiquadKind::LowShelf => (
            a * ((a + 1.0) - (a - 1.0) * cw + 2.0 * sa * alpha),
            2.0 * a * ((a - 1.0) - (a + 1.0) * cw),
            a * ((a + 1.0) - (a - 1.0) * cw - 2.0 * sa * alpha),
            (a + 1.0) + (a - 1.0) * cw + 2.0 * sa * alpha,
            -2.0 * ((a - 1.0) + (a + 1.0) * cw),
            (a + 1.0) + (a - 1.0) * cw - 2.0 * sa * alpha,
        ),
        BiquadKind::HighShelf => (
            a * ((a + 1.0) + (a - 1.0) * cw + 2.0 * sa * alpha),
            -2.0 * a * ((a - 1.0) + (a + 1.0) * cw),
            a * ((a + 1.0) + (a - 1.0) * cw - 2.0 * sa * alpha),
            (a + 1.0) - (a - 1.0) * cw + 2.0 * sa * alpha,
            2.0 * ((a - 1.0) - (a + 1.0) * cw),
            (a + 1.0) - (a - 1.0) * cw - 2.0 * sa * alpha,
        ),
        BiquadKind::LowPass => ((1.0 - cw) / 2.0, 1.0 - cw, (1.0 - cw) / 2.0, 1.0 + alpha, -2.0 * cw, 1.0 - alpha),
        BiquadKind::HighPass => ((1.0 + cw) / 2.0, -(1.0 + cw), (1.0 + cw) / 2.0, 1.0 + alpha, -2.0 * cw, 1.0 - alpha),
    };
    Coefficients { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 }
}

/// The magnitude of `c`'s response at `freq` Hz, in dB.
pub fn response_db(c: &Coefficients, freq: f64, sample_rate: f64) -> f64 {
    let w = freq / sample_rate;
    let c1 = math::cos_turns(w);
    let c2 = math::cos_turns(2.0 * w);
    let num = c.b0 * c.b0 + c.b1 * c.b1 + c.b2 * c.b2 + 2.0 * (c.b0 * c.b1 + c.b1 * c.b2) * c1 + 2.0 * c.b0 * c.b2 * c2;
    let den = 1.0 + c.a1 * c.a1 + c.a2 * c.a2 + 2.0 * (c.a1 + c.a1 * c.a2) * c1 + 2.0 * c.a2 * c2;
    10.0 * math::ln(num / den) / core::f64::consts::LN_10
}

/// One biquad section (transposed direct form II, `f64` state). Coefficients change at once:
/// smooth the parameters that drive `set`, as [`super::Smoother`] does, to keep it click-free.
#[derive(Clone, Copy)]
pub struct Biquad { c: Coefficients, z1: f64, z2: f64 }

impl Biquad {
    pub const fn new() -> Biquad { Biquad { c: Coefficients::IDENTITY, z1: 0.0, z2: 0.0 } }
    pub fn set(&mut self, kind: BiquadKind, freq: f64, q: f64, gain_db: f64, sample_rate: f64) {
        self.c = coefficients(kind, freq, q, gain_db, sample_rate);
    }
    pub fn set_coefficients(&mut self, c: Coefficients) { self.c = c }
    pub fn coefficients(&self) -> Coefficients { self.c }
    /// Clear the memory.
    pub fn reset(&mut self) { self.z1 = 0.0; self.z2 = 0.0 }
    #[inline]
    pub fn process(&mut self, x: f64) -> f64 {
        let y = self.c.b0 * x + self.z1;
        self.z1 = self.c.b1 * x - self.c.a1 * y + self.z2;
        self.z2 = self.c.b2 * x - self.c.a2 * y;
        y
    }
    /// The response at `freq` Hz, in dB.
    pub fn response_db(&self, freq: f64, sample_rate: f64) -> f64 { response_db(&self.c, freq, sample_rate) }
}

impl Default for Biquad { fn default() -> Self { Biquad::new() } }

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn meets_the_cookbook_at_its_frequency() {
        let sr = 48000.0;
        let p = coefficients(BiquadKind::Peak, 1000.0, 1.0, 6.0, sr);
        assert!((response_db(&p, 1000.0, sr) - 6.0).abs() < 1e-6);
        let ls = coefficients(BiquadKind::LowShelf, 200.0, 0.707, -9.0, sr);
        assert!((response_db(&ls, 10.0, sr) + 9.0).abs() < 0.1);
        assert!((response_db(&ls, 200.0, sr) + 4.5).abs() < 0.05);
        let hp = coefficients(BiquadKind::HighPass, 100.0, core::f64::consts::FRAC_1_SQRT_2, 0.0, sr);
        assert!((response_db(&hp, 100.0, sr) + 3.0103).abs() < 0.01);
        // A rendered sine at the peak's centre has the gain the formula says.
        let mut b = Biquad::new();
        b.set_coefficients(p);
        let mut peak = 0.0f64;
        for n in 0..48000 { let y = b.process(math::sin_turns(n as f64 * 1000.0 / sr)); if n > 24000 { peak = peak.max(y.abs()) } }
        assert!((20.0 * math::ln(peak) / core::f64::consts::LN_10 - 6.0).abs() < 0.01);
    }
}
