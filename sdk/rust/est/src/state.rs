//! The state stream (CLAP's `clap.state`), little-endian. The glue writes the header and every
//! parameter; a plugin's `save_state` adds its own bytes after them and `load_state` reads them back.
//!
//! The format: the plugin's magic (u32), its state version (u32), the parameter count (u32), then
//! (id u32, value f64) per parameter, then the plugin's bytes. A state from another plugin, or from
//! a later version, is refused; an unknown parameter id is skipped, a missing one keeps its value.

use crate::clap::{ClapIstream, ClapOstream};
use core::ffi::c_void;

/// Writes the state stream, remembering whether every write landed.
pub struct StateWriter { pub(crate) stream: *const ClapOstream, pub ok: bool }
impl StateWriter {
    pub fn bytes(&mut self, b: &[u8]) {
        let mut done = 0usize;
        while self.ok && done < b.len() {
            let s = unsafe { &*self.stream };
            let n = (s.write)(self.stream, unsafe { b.as_ptr().add(done) } as *const c_void, (b.len() - done) as u64);
            if n <= 0 { self.ok = false } else { done += n as usize }
        }
    }
    pub fn u32(&mut self, v: u32) { self.bytes(&v.to_le_bytes()) }
    pub fn f32(&mut self, v: f32) { self.bytes(&v.to_le_bytes()) }
    pub fn f64(&mut self, v: f64) { self.bytes(&v.to_le_bytes()) }
}

/// Reads the state stream; `ok` turns false at the first short read.
pub struct StateReader { pub(crate) stream: *const ClapIstream, pub ok: bool }
impl StateReader {
    pub fn bytes(&mut self, b: &mut [u8]) {
        let mut done = 0usize;
        while self.ok && done < b.len() {
            let s = unsafe { &*self.stream };
            let n = (s.read)(self.stream, unsafe { b.as_mut_ptr().add(done) } as *mut c_void, (b.len() - done) as u64);
            if n <= 0 { self.ok = false } else { done += n as usize }
        }
    }
    pub fn u32(&mut self) -> u32 { let mut b = [0u8; 4]; self.bytes(&mut b); u32::from_le_bytes(b) }
    pub fn f32(&mut self) -> f32 { let mut b = [0u8; 4]; self.bytes(&mut b); f32::from_le_bytes(b) }
    pub fn f64(&mut self) -> f64 { let mut b = [0u8; 8]; self.bytes(&mut b); f64::from_le_bytes(b) }
}
