use crate::math;

/// A one-pole glide to a target: reaches 63 % of a step in `seconds`, then snaps to the target once
/// within 1e-9 of it (so `settled` is exact and a settled smoother costs a compare).
#[derive(Clone, Copy)]
pub struct Smoother { value: f64, target: f64, coef: f64, seconds: f64, sample_rate: f64 }

impl Smoother {
    pub fn new(seconds: f64) -> Smoother {
        let sr = super::DEFAULT_SAMPLE_RATE;
        Smoother { value: 0.0, target: 0.0, coef: math::one_pole(seconds, sr), seconds, sample_rate: sr }
    }
    pub fn set_sample_rate(&mut self, sample_rate: f64) {
        self.sample_rate = sample_rate;
        self.coef = math::one_pole(self.seconds, sample_rate);
    }
    /// The glide's time constant (0: none, the value jumps).
    pub fn set_time(&mut self, seconds: f64) {
        self.seconds = seconds;
        self.coef = math::one_pole(seconds, self.sample_rate);
    }
    pub fn set_target(&mut self, target: f64) { self.target = target }
    /// Jump to `value` at once (no glide).
    pub fn jump(&mut self, value: f64) { self.value = value; self.target = value }
    /// Jump to the target at once.
    pub fn reset(&mut self) { self.value = self.target }
    /// One sample's step; the new value.
    #[inline]
    pub fn next(&mut self) -> f64 {
        if self.value != self.target {
            self.value += (self.target - self.value) * self.coef;
            let d = self.target - self.value;
            if d < 1e-9 && d > -1e-9 { self.value = self.target }
        }
        self.value
    }
    pub fn value(&self) -> f64 { self.value }
    pub fn target(&self) -> f64 { self.target }
    pub fn settled(&self) -> bool { self.value == self.target }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn glides_63_percent_in_its_time_then_settles() {
        let mut s = Smoother::new(0.01);
        s.set_sample_rate(1000.0);
        s.set_target(1.0);
        let mut v = 0.0;
        for _ in 0..10 { v = s.next() }
        assert!((v - 0.6321).abs() < 0.02, "{v}");
        for _ in 0..1000 { s.next(); }
        assert!(s.settled());
        assert_eq!(s.value(), 1.0);
        s.jump(0.25);
        assert_eq!(s.next(), 0.25);
    }
}
