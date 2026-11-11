//! # est: the EST SDK for Rust, with no dependencies
//!
//! An EST module is a `wasm32-unknown-unknown` CLAP 1.2 plugin with WCLAP's shape (the EST
//! specification draft §3): it exports `clap_entry` (a global holding the entry's address),
//! `malloc`, `free`, one growable function table and its memory, and imports nothing. This crate
//! writes all of that from one trait and one macro:
//!
//! - an effect implements [`Effect`] and calls [`export_effect!`]; an instrument implements
//!   [`Instrument`] and calls [`export_instrument!`];
//! - parameters are declared once ([`Param`]): the glue stores the values, clamps and steps what
//!   the host sends, words them as text, saves and loads them, and calls `param_changed`;
//! - `process(io, events)` splits each block at its events by default and calls `render` between
//!   them, so automation and notes land on their own sample; `io.transport` is the song's tempo,
//!   position and time signature;
//! - the state is the parameters plus the plugin's own bytes (`save_state`/`load_state`);
//! - [`dsp`] holds the blocks: [`dsp::Smoother`], [`dsp::Oscillator`], [`dsp::Filter`],
//!   [`dsp::Envelope`], [`dsp::Lfo`], [`dsp::Voices`], [`dsp::DelayLine`], [`dsp::Biquad`] and
//!   the decibel conversions, the same names and behaviour as the AssemblyScript library
//!   (`sdk/as/est`), each allocating nothing after `activate`;
//! - [`math`]: `exp`, `ln`, `sin`, `tan` and friends (`core` has no float maths), deterministic.
//!
//! The CLAP structs are in their wasm32 layout ([`clap`], checked against `est-abi-1.0.json` at
//! compile time). The host calls everything from one thread (the specification's §3.3), so
//! nothing here locks. Licence: MIT.
#![no_std]

#[cfg(test)]
extern crate std;

pub mod clap;
pub mod dsp;
#[doc(hidden)]
pub mod glue;
pub mod io;
pub mod math;
pub mod param;
pub mod plugin;
pub mod state;
pub mod text;

pub use io::{Event, EventKind, Events, Expression, Io, Note, Transport};
pub use param::{params_valid, Format, Param, MAX_PARAMS};
pub use plugin::{split_effect, split_instrument, Effect, Instrument};
pub use state::{StateReader, StateWriter};

/// Everything a plugin usually needs: `use est::prelude::*;`.
pub mod prelude {
    pub use crate::dsp::*;
    pub use crate::{Effect, Event, EventKind, Events, Expression, Instrument, Io, Note, Param, StateReader, StateWriter, Transport};
}

// --- The allocator ------------------------------------------------------------------------------

#[cfg(target_arch = "wasm32")]
mod heap {
    use core::arch::wasm32::{memory_grow, memory_size};
    use core::cell::UnsafeCell;
    use core::ptr::null_mut;

    extern "C" {
        static __heap_base: u8;
    }

    const PAGE: usize = 65536;
    /// Every block starts with its size (header included) and, while free, the next free block.
    const HEADER: usize = 8;

    struct Heap { top: usize, end: usize, free: usize }
    struct Cell(UnsafeCell<Heap>);
    unsafe impl Sync for Cell {}
    static HEAP: Cell = Cell(UnsafeCell::new(Heap { top: 0, end: 0, free: 0 }));

    unsafe fn word(at: usize) -> *mut usize { at as *mut usize }

    /// First fit from the free list, else from the top (growing the memory when it must).
    pub unsafe fn alloc(size: usize) -> *mut u8 {
        let h = &mut *HEAP.0.get();
        if h.top == 0 {
            h.top = (core::ptr::addr_of!(__heap_base) as usize + 7) & !7;
            h.end = memory_size(0) * PAGE;
        }
        let need = match size.checked_add(HEADER + 7) { Some(n) => n & !7, None => return null_mut() };
        let mut prev = 0usize;
        let mut at = h.free;
        while at != 0 {
            let len = *word(at);
            let next = *word(at + 4);
            if len >= need {
                if prev == 0 { h.free = next } else { *word(prev + 4) = next }
                return (at + HEADER) as *mut u8;
            }
            prev = at;
            at = next;
        }
        let start = h.top;
        let stop = match start.checked_add(need) { Some(s) => s, None => return null_mut() };
        if stop > h.end {
            let pages = (stop - h.end + PAGE - 1) / PAGE;
            if memory_grow(0, pages) == usize::MAX { return null_mut() }
            h.end += pages * PAGE;
        }
        h.top = stop;
        *word(start) = need;
        (start + HEADER) as *mut u8
    }

    pub unsafe fn free(p: *mut u8) {
        if p.is_null() { return }
        let h = &mut *HEAP.0.get();
        let at = p as usize - HEADER;
        *word(at + 4) = h.free;
        h.free = at;
    }
}

/// `malloc` with C semantics (the host's structs are allocated through it; the spec's §3.1 export).
#[cfg(target_arch = "wasm32")]
#[no_mangle]
pub extern "C" fn malloc(size: usize) -> *mut u8 { unsafe { heap::alloc(size) } }

/// `free` with C semantics.
#[cfg(target_arch = "wasm32")]
#[no_mangle]
pub extern "C" fn free(p: *mut u8) { unsafe { heap::free(p) } }

#[cfg(all(target_arch = "wasm32", not(test)))]
#[panic_handler]
fn panic(_: &core::panic::PanicInfo) -> ! { core::arch::wasm32::unreachable() }

/// A zeroed buffer of `n` floats from the plugin's heap, or None when the memory is full. Call it
/// from `activate` (never from `process`); [`dsp::DelayLine`] does.
pub fn alloc_floats(n: usize) -> Option<*mut f32> {
    #[cfg(target_arch = "wasm32")]
    {
        let p = malloc(n.checked_mul(4)?) as *mut f32;
        if p.is_null() { return None }
        unsafe { core::ptr::write_bytes(p, 0, n) };
        Some(p)
    }
    #[cfg(not(target_arch = "wasm32"))]
    {
        // Off WebAssembly (unit tests): a leaked buffer from the test's own allocator.
        #[cfg(test)]
        {
            extern crate std;
            let v: std::vec::Vec<f32> = std::vec![0.0; n];
            return Some(std::boxed::Box::leak(v.into_boxed_slice()).as_mut_ptr());
        }
        #[cfg(not(test))]
        { let _ = n; None }
    }
}

/// Give back a buffer from [`alloc_floats`].
pub fn free_floats(p: *mut f32) {
    #[cfg(target_arch = "wasm32")]
    free(p as *mut u8);
    #[cfg(not(target_arch = "wasm32"))]
    let _ = p;
}

// --- The export macros ------------------------------------------------------------------------

#[doc(hidden)]
#[macro_export]
macro_rules! __est_export {
    ($core:ty, $notes:expr, $note_out:expr, $id:literal, $name:literal, $vendor:literal, $ver:literal, $desc:literal, [$($f:literal),*]) => {
        const _: () = {
            use core::ffi::{c_char, c_void};
            use core::ptr::null;
            use $crate::clap::*;
            use $crate::glue::{self, Core};

            type C = $core;
            const _: () = assert!($crate::params_valid(<C as Core>::PARAMS), "PARAMS: more than 512, a repeated id, min above max, a default out of range, or a log parameter whose range does not stay above 0");
            const fn cs(s: &'static str) -> *const c_char { s.as_ptr() as *const c_char }
            const FEATURE_COUNT: usize = [$($f),*].len() + 1;
            static FEATURES: CStrList<FEATURE_COUNT> = CStrList([$(cs(concat!($f, "\0")),)* null()]);
            static DESCRIPTOR: ClapPluginDescriptor = ClapPluginDescriptor {
                clap_version: CLAP_VERSION,
                id: cs(concat!($id, "\0")),
                name: cs(concat!($name, "\0")),
                vendor: cs(concat!($vendor, "\0")),
                url: cs("\0"),
                manual_url: cs("\0"),
                support_url: cs("\0"),
                version: cs(concat!($ver, "\0")),
                description: cs(concat!($desc, "\0")),
                features: &FEATURES as *const CStrList<FEATURE_COUNT> as *const *const c_char,
            };
            static PARAMS: ClapPluginParams = ClapPluginParams {
                count: glue::params_count::<C>,
                get_info: glue::params_get_info::<C>,
                get_value: glue::params_get_value::<C>,
                value_to_text: glue::params_value_to_text::<C>,
                text_to_value: glue::params_text_to_value::<C>,
                flush: glue::params_flush::<C>,
            };
            static STATE: ClapPluginState = ClapPluginState { save: glue::state_save::<C>, load: glue::state_load::<C> };
            static PORTS: ClapPluginAudioPorts = ClapPluginAudioPorts { count: glue::ports_count::<C>, get: glue::ports_get::<C> };
            static NOTES: ClapPluginNotePorts = ClapPluginNotePorts { count: glue::notes_count::<$note_out>, get: glue::notes_get::<$note_out> };
            static LATENCY: ClapPluginLatency = ClapPluginLatency { get: glue::latency_get::<C> };
            static TAIL: ClapPluginTail = ClapPluginTail { get: glue::tail_get::<C> };
            static RENDER: ClapPluginRender = ClapPluginRender { has_hard_realtime_requirement: glue::render_hard_rt, set: glue::render_set::<C> };

            extern "C" fn get_extension(_p: *const ClapPlugin, id: *const c_char) -> *const c_void {
                unsafe {
                    if glue::cstr_eq(id, b"clap.params\0") { return &PARAMS as *const _ as *const c_void }
                    if glue::cstr_eq(id, b"clap.state\0") { return &STATE as *const _ as *const c_void }
                    if glue::cstr_eq(id, b"clap.audio-ports\0") { return &PORTS as *const _ as *const c_void }
                    if $notes && glue::cstr_eq(id, b"clap.note-ports\0") { return &NOTES as *const _ as *const c_void }
                    if glue::cstr_eq(id, b"clap.latency\0") { return &LATENCY as *const _ as *const c_void }
                    if glue::cstr_eq(id, b"clap.tail\0") { return &TAIL as *const _ as *const c_void }
                    if glue::cstr_eq(id, b"clap.render\0") { return &RENDER as *const _ as *const c_void }
                }
                null()
            }
            extern "C" fn factory_count(_f: *const ClapPluginFactory) -> u32 { 1 }
            extern "C" fn factory_descriptor(_f: *const ClapPluginFactory, i: u32) -> *const ClapPluginDescriptor {
                if i == 0 { &DESCRIPTOR } else { null() }
            }
            extern "C" fn factory_create(_f: *const ClapPluginFactory, host: *const ClapHost, id: *const c_char) -> *const ClapPlugin {
                unsafe { glue::create::<C>(host, id, &DESCRIPTOR, get_extension) }
            }
            static FACTORY: ClapPluginFactory = ClapPluginFactory {
                get_plugin_count: factory_count,
                get_plugin_descriptor: factory_descriptor,
                create_plugin: factory_create,
            };
            extern "C" fn entry_init(_path: *const c_char) -> bool { true }
            extern "C" fn entry_deinit() {}
            extern "C" fn entry_get_factory(id: *const c_char) -> *const c_void {
                if unsafe { glue::cstr_eq(id, b"clap.plugin-factory\0") } { &FACTORY as *const _ as *const c_void } else { null() }
            }
            #[no_mangle]
            pub static clap_entry: ClapPluginEntry = ClapPluginEntry {
                clap_version: CLAP_VERSION,
                init: entry_init,
                deinit: entry_deinit,
                get_factory: entry_get_factory,
            };
        };
    };
}

/// Exports an [`Effect`] as an EST module: the descriptor, the factory, the extensions and the
/// `clap_entry` global. Use it once, in the plugin's crate root:
///
/// ```text
/// est::export_effect!(MyEffect, id: "org.example.my-effect", name: "My Effect", vendor: "Me",
///     version: "1.0.0", description: "What it does.", features: ["audio-effect", "stereo"]);
/// ```
/// `id`, `name`, `version` and `features` must match the bundle's `est.json` (`est validate`
/// checks: EST-M rules).
#[macro_export]
macro_rules! export_effect {
    ($t:ty, id: $id:literal, name: $name:literal, vendor: $vendor:literal, version: $ver:literal, description: $desc:literal, features: [$($f:literal),* $(,)?]) => {
        $crate::__est_export!($crate::glue::AsEffect<$t>, false, false, $id, $name, $vendor, $ver, $desc, [$($f),*]);
    };
}

/// Exports an [`Instrument`] as an EST module, as [`export_effect!`] does an effect. Its features
/// start with `"instrument"`.
#[macro_export]
macro_rules! export_instrument {
    ($t:ty, id: $id:literal, name: $name:literal, vendor: $vendor:literal, version: $ver:literal, description: $desc:literal, features: [$($f:literal),* $(,)?]) => {
        $crate::__est_export!($crate::glue::AsInstrument<$t>, true, false, $id, $name, $vendor, $ver, $desc, [$($f),*]);
    };
}

/// Exports a note effect (DEV-F, 1.321): an [`Effect`] with a note input and a note output, so
/// its `event` sees the notes (`EventKind::NoteOn` …) and it plays notes on through
/// `io.send_note_on` / `io.send_note_off`. Its audio passes through `render` as any effect's; its
/// est.json says `"notes": { "inputs": 1, "outputs": 1 }` and its features start with
/// `"audio-effect"` and include `"note-effect"`. Cyber reports the notes it sends (the processor's
/// `notes` message, `est dev`'s `plugin-notes`) but does not yet route them to the next plugin on
/// a track (EST 1.1, DEV-H §3).
#[macro_export]
macro_rules! export_note_effect {
    ($t:ty, id: $id:literal, name: $name:literal, vendor: $vendor:literal, version: $ver:literal, description: $desc:literal, features: [$($f:literal),* $(,)?]) => {
        $crate::__est_export!($crate::glue::AsEffect<$t>, true, true, $id, $name, $vendor, $ver, $desc, [$($f),*]);
    };
}
