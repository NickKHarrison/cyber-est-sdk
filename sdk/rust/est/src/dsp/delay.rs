use crate::{alloc_floats, free_floats, math};

/// A delay line of `f32` samples, sized once from its longest delay in `activate`
/// ([`DelayLine::allocate`], the one block that allocates; a later, larger `allocate` replaces the
/// buffer, a smaller one keeps it). `read(d)` before `write(x)` in each sample gives a delay of
/// `d` samples (1 at least), fractional delays interpolated linearly:
///
/// ```text
/// let y = self.line.read(delay_frames);
/// self.line.write(x + feedback * y);
/// ```
pub struct DelayLine { buf: *mut f32, len: usize, pos: usize }

impl DelayLine {
    pub const fn new() -> DelayLine { DelayLine { buf: core::ptr::null_mut(), len: 0, pos: 0 } }

    /// Room for delays up to `max_frames` (call from `activate`). False when the memory is full.
    pub fn allocate(&mut self, max_frames: usize) -> bool {
        let need = max_frames + 2;
        if need > self.len {
            if !self.buf.is_null() { free_floats(self.buf) }
            match alloc_floats(need) {
                Some(p) => { self.buf = p; self.len = need }
                None => { self.buf = core::ptr::null_mut(); self.len = 0; return false }
            }
        }
        self.clear();
        true
    }
    /// The longest delay it holds, in frames.
    pub fn capacity(&self) -> usize { if self.len >= 2 { self.len - 2 } else { 0 } }
    /// Silence.
    pub fn clear(&mut self) {
        if !self.buf.is_null() { unsafe { core::ptr::write_bytes(self.buf, 0, self.len) } }
        self.pos = 0;
    }
    /// Push one sample.
    #[inline]
    pub fn write(&mut self, x: f64) {
        if self.len == 0 { return }
        unsafe { *self.buf.add(self.pos) = x as f32 }
        self.pos += 1;
        if self.pos == self.len { self.pos = 0 }
    }
    /// The sample written `delay` samples ago (1 to `capacity()`, a fraction interpolated).
    #[inline]
    pub fn read(&self, delay: f64) -> f64 {
        if self.len == 0 { return 0.0 }
        let d = math::clamp(delay, 1.0, (self.len - 2) as f64);
        let mut r = self.pos as f64 - d;
        if r < 0.0 { r += self.len as f64 }
        let i0f = math::floor(r);
        let frac = r - i0f;
        let i0 = i0f as usize;
        let i1 = if i0 + 1 == self.len { 0 } else { i0 + 1 };
        let (a, b) = unsafe { (*self.buf.add(i0) as f64, *self.buf.add(i1) as f64) };
        a + (b - a) * frac
    }
}

impl Drop for DelayLine {
    fn drop(&mut self) { if !self.buf.is_null() { free_floats(self.buf) } }
}

impl Default for DelayLine { fn default() -> Self { DelayLine::new() } }

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn delays_by_whole_and_fractional_samples() {
        let mut d = DelayLine::new();
        assert!(d.allocate(8));
        assert_eq!(d.capacity(), 8);
        let mut out = [0.0; 12];
        for n in 0..12 {
            out[n] = d.read(3.0);
            d.write(if n == 0 { 1.0 } else { 0.0 });
        }
        assert_eq!(out[3], 1.0);
        assert_eq!(out.iter().sum::<f64>(), 1.0);
        d.clear();
        d.write(1.0);
        d.write(0.0);
        assert!((d.read(1.5) - 0.5).abs() < 1e-12);
    }
}
