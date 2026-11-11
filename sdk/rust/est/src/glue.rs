//! The CLAP side, generic over the plugin: the instance, the plugin's functions and the
//! extensions the export macros put in their tables. Not for plugins to call.
#![doc(hidden)]
// Off WebAssembly (the crate's own unit tests) nothing creates an instance.
#![cfg_attr(not(target_arch = "wasm32"), allow(dead_code, unused_imports))]

use crate::clap::*;
use crate::io::{Events, Io, Transport};
use crate::param::{Param, MAX_PARAMS};
use crate::plugin::{Effect, Instrument};
use crate::state::{StateReader, StateWriter};
use crate::text;
use core::ffi::{c_char, c_void};
use core::ptr::{null, null_mut};

/// What the glue needs of a plugin, effect or instrument alike.
pub trait Core: Sized + 'static {
    const PARAMS: &'static [Param];
    const STATE_MAGIC: u32;
    const STATE_VERSION: u32;
    const INSTRUMENT: bool;
    fn make() -> Self;
    fn activate(&mut self, sample_rate: f64, max_frames: u32) -> bool;
    fn deactivate(&mut self);
    fn reset(&mut self);
    fn param_changed(&mut self, id: u32, value: f64);
    fn process(&mut self, io: &mut Io, events: &Events);
    fn latency(&self) -> u32;
    fn tail(&self) -> u32;
    fn save_state(&self, w: &mut StateWriter);
    fn load_state(&mut self, r: &mut StateReader, version: u32) -> bool;
    fn set_offline(&mut self, offline: bool);
}

pub struct AsEffect<T: Effect>(pub T);
pub struct AsInstrument<T: Instrument>(pub T);

macro_rules! core_for {
    ($wrap:ident, $tr:ident, $inst:expr) => {
        impl<T: $tr> Core for $wrap<T> {
            const PARAMS: &'static [Param] = T::PARAMS;
            const STATE_MAGIC: u32 = T::STATE_MAGIC;
            const STATE_VERSION: u32 = T::STATE_VERSION;
            const INSTRUMENT: bool = $inst;
            fn make() -> Self { $wrap(T::new()) }
            fn activate(&mut self, sr: f64, max: u32) -> bool { self.0.activate(sr, max) }
            fn deactivate(&mut self) { self.0.deactivate() }
            fn reset(&mut self) { self.0.reset() }
            fn param_changed(&mut self, id: u32, v: f64) { self.0.param_changed(id, v) }
            fn process(&mut self, io: &mut Io, events: &Events) { self.0.process(io, events) }
            fn latency(&self) -> u32 { self.0.latency() }
            fn tail(&self) -> u32 { self.0.tail() }
            fn save_state(&self, w: &mut StateWriter) { self.0.save_state(w) }
            fn load_state(&mut self, r: &mut StateReader, version: u32) -> bool { self.0.load_state(r, version) }
            fn set_offline(&mut self, offline: bool) { self.0.set_offline(offline) }
        }
    };
}
core_for!(AsEffect, Effect, false);
core_for!(AsInstrument, Instrument, true);

/// One instance: CLAP's plugin struct first (its address is the instance's), then the values.
#[repr(C)]
pub struct Instance<C: Core> {
    pub plugin: ClapPlugin,
    pub host: *const ClapHost,
    pub values: [f64; MAX_PARAMS],
    pub core: C,
}

#[inline(always)]
unsafe fn instance<'a, C: Core>(p: *const ClapPlugin) -> &'a mut Instance<C> { &mut *((*p).plugin_data as *mut Instance<C>) }

fn index_of<C: Core>(id: u32) -> Option<usize> { C::PARAMS.iter().position(|p| p.id == id) }

/// Store a parameter's value (clamped) and tell the plugin.
fn set_value<C: Core>(inst: &mut Instance<C>, id: u32, v: f64) {
    if let Some(i) = index_of::<C>(id) {
        let v = C::PARAMS[i].clamp(v);
        inst.values[i] = v;
        inst.core.param_changed(id, v);
    }
}

/// The C strings are equal (`b` with its NUL).
pub unsafe fn cstr_eq(a: *const c_char, b: &[u8]) -> bool {
    if a.is_null() { return false }
    for (i, &c) in b.iter().enumerate() {
        if *a.add(i) as u8 != c { return false }
        if c == 0 { return true }
    }
    false
}

pub unsafe fn same_cstr(a: *const c_char, b: *const c_char) -> bool {
    if a.is_null() || b.is_null() { return false }
    let mut i = 0;
    loop {
        let (x, y) = (*a.add(i), *b.add(i));
        if x != y { return false }
        if x == 0 { return true }
        i += 1;
    }
}

#[cfg(target_arch = "wasm32")]
pub unsafe fn create<C: Core>(
    host: *const ClapHost,
    id: *const c_char,
    desc: &'static ClapPluginDescriptor,
    get_extension: extern "C" fn(*const ClapPlugin, *const c_char) -> *const c_void,
) -> *const ClapPlugin {
    if host.is_null() || (*host).clap_version.major < 1 || !same_cstr(id, desc.id) { return null() }
    let mem = crate::malloc(core::mem::size_of::<Instance<C>>()) as *mut Instance<C>;
    if mem.is_null() { return null() }
    core::ptr::write(mem, Instance {
        plugin: ClapPlugin {
            desc,
            plugin_data: mem as *mut c_void,
            init: plugin_init::<C>,
            destroy: plugin_destroy::<C>,
            activate: plugin_activate::<C>,
            deactivate: plugin_deactivate::<C>,
            start_processing: plugin_start,
            stop_processing: plugin_stop,
            reset: plugin_reset::<C>,
            process: plugin_process::<C>,
            get_extension,
            on_main_thread: plugin_on_main_thread,
        },
        host,
        values: [0.0; MAX_PARAMS],
        core: C::make(),
    });
    &(*mem).plugin
}

extern "C" fn plugin_init<C: Core>(p: *const ClapPlugin) -> bool {
    let inst = unsafe { instance::<C>(p) };
    for (i, prm) in C::PARAMS.iter().enumerate() {
        inst.values[i] = prm.default;
        inst.core.param_changed(prm.id, prm.default);
    }
    true
}
extern "C" fn plugin_destroy<C: Core>(p: *const ClapPlugin) {
    #[cfg(target_arch = "wasm32")]
    unsafe {
        let inst = (*p).plugin_data as *mut Instance<C>;
        core::ptr::drop_in_place(inst);
        crate::free(inst as *mut u8);
    }
    #[cfg(not(target_arch = "wasm32"))]
    let _ = p;
}
extern "C" fn plugin_activate<C: Core>(p: *const ClapPlugin, sr: f64, _min: u32, max: u32) -> bool {
    unsafe { instance::<C>(p) }.core.activate(sr, max)
}
extern "C" fn plugin_deactivate<C: Core>(p: *const ClapPlugin) { unsafe { instance::<C>(p) }.core.deactivate() }
extern "C" fn plugin_start(_p: *const ClapPlugin) -> bool { true }
extern "C" fn plugin_stop(_p: *const ClapPlugin) {}
extern "C" fn plugin_reset<C: Core>(p: *const ClapPlugin) { unsafe { instance::<C>(p) }.core.reset() }
extern "C" fn plugin_on_main_thread(_p: *const ClapPlugin) {}

unsafe fn param_event(h: *const ClapEventHeader) -> Option<(u32, f64)> {
    if h.is_null() || (*h).space_id != CLAP_CORE_EVENT_SPACE_ID || (*h).type_ != CLAP_EVENT_PARAM_VALUE { return None }
    if ((*h).size as usize) < core::mem::size_of::<ClapEventParamValue>() { return None }
    let e = &*(h as *const ClapEventParamValue);
    Some((e.param_id, e.value))
}

extern "C" fn plugin_process<C: Core>(p: *const ClapPlugin, proc_: *const ClapProcess) -> i32 {
    unsafe {
        let inst = instance::<C>(p);
        let pr = &*proc_;
        if pr.audio_outputs_count < 1 || pr.audio_outputs.is_null() { return CLAP_PROCESS_ERROR }
        let output = &*pr.audio_outputs;
        let frames = pr.frames_count as usize;
        let mut io = Io {
            ins: [null(); 2], outs: [null_mut(); 2], channels: 0, frames,
            transport: Transport::read(pr.transport), values: inst.values.as_mut_ptr(), params: C::PARAMS, out_events: pr.out_events,
        };
        let outs = output.channel_count as usize;
        if C::INSTRUMENT {
            for c in 0..outs { core::ptr::write_bytes(*output.data32.add(c), 0, frames) }
            io.channels = if outs > 2 { 2 } else { outs };
        } else {
            if pr.audio_inputs_count < 1 || pr.audio_inputs.is_null() { return CLAP_PROCESS_ERROR }
            let input = &*pr.audio_inputs;
            let ins = input.channel_count as usize;
            let n = if ins < outs { ins } else { outs };
            io.channels = if n > 2 { 2 } else { n };
            for c in 0..io.channels { io.ins[c] = *input.data32.add(c) }
            for c in io.channels..outs { core::ptr::write_bytes(*output.data32.add(c), 0, frames) }
        }
        for c in 0..io.channels { io.outs[c] = *output.data32.add(c) }
        let events = Events::new(pr.in_events, frames);
        inst.core.process(&mut io, &events);
        CLAP_PROCESS_CONTINUE
    }
}

// clap.params
pub extern "C" fn params_count<C: Core>(_p: *const ClapPlugin) -> u32 { C::PARAMS.len() as u32 }
pub extern "C" fn params_get_info<C: Core>(_p: *const ClapPlugin, index: u32, info: *mut ClapParamInfo) -> bool {
    let Some(prm) = C::PARAMS.get(index as usize) else { return false };
    if info.is_null() { return false }
    unsafe {
        core::ptr::write_bytes(info as *mut u8, 0, core::mem::size_of::<ClapParamInfo>());
        let i = &mut *info;
        i.id = prm.id;
        i.flags = CLAP_PARAM_IS_AUTOMATABLE | prm.flags | if prm.stepped() { CLAP_PARAM_IS_STEPPED } else { 0 };
        i.cookie = null_mut();
        text::copy(prm.name.as_bytes(), i.name.as_mut_ptr(), CLAP_NAME_SIZE as u32);
        text::copy(prm.module.as_bytes(), i.module.as_mut_ptr(), CLAP_PATH_SIZE as u32);
        i.min_value = prm.min;
        i.max_value = prm.max;
        i.default_value = prm.default;
    }
    true
}
pub extern "C" fn params_get_value<C: Core>(p: *const ClapPlugin, id: u32, out: *mut f64) -> bool {
    let Some(i) = index_of::<C>(id) else { return false };
    if out.is_null() { return false }
    unsafe { *out = instance::<C>(p).values[i] };
    true
}
pub extern "C" fn params_value_to_text<C: Core>(_p: *const ClapPlugin, id: u32, v: f64, out: *mut c_char, size: u32) -> bool {
    match index_of::<C>(id) { Some(i) if !out.is_null() && size > 0 => { text::value_to_text(&C::PARAMS[i], v, out, size); true } _ => false }
}
pub extern "C" fn params_text_to_value<C: Core>(_p: *const ClapPlugin, id: u32, s: *const c_char, out: *mut f64) -> bool {
    let Some(i) = index_of::<C>(id) else { return false };
    if s.is_null() || out.is_null() { return false }
    let prm = &C::PARAMS[i];
    match unsafe { text::text_to_value(prm, s) } { Some(v) => { unsafe { *out = prm.clamp(v) }; true } None => false }
}
pub extern "C" fn params_flush<C: Core>(p: *const ClapPlugin, input: *const ClapInputEvents, _out: *const ClapOutputEvents) {
    if input.is_null() { return }
    unsafe {
        let inst = instance::<C>(p);
        let n = ((*input).size)(input);
        for k in 0..n {
            if let Some((id, v)) = param_event(((*input).get)(input, k)) { set_value(inst, id, v) }
        }
    }
}

// clap.state
pub extern "C" fn state_save<C: Core>(p: *const ClapPlugin, s: *const ClapOstream) -> bool {
    let inst = unsafe { instance::<C>(p) };
    let mut w = StateWriter { stream: s, ok: !s.is_null() };
    w.u32(C::STATE_MAGIC);
    w.u32(C::STATE_VERSION);
    w.u32(C::PARAMS.len() as u32);
    for (i, prm) in C::PARAMS.iter().enumerate() { w.u32(prm.id); w.f64(inst.values[i]) }
    inst.core.save_state(&mut w);
    w.ok
}
pub extern "C" fn state_load<C: Core>(p: *const ClapPlugin, s: *const ClapIstream) -> bool {
    let inst = unsafe { instance::<C>(p) };
    let mut r = StateReader { stream: s, ok: !s.is_null() };
    if r.u32() != C::STATE_MAGIC || !r.ok { return false }
    let version = r.u32();
    if !r.ok || version == 0 || version > C::STATE_VERSION { return false }
    let n = r.u32();
    if !r.ok || n > 512 { return false }
    for _ in 0..n {
        let id = r.u32();
        let v = r.f64();
        if !r.ok { return false }
        set_value(inst, id, v);
    }
    inst.core.load_state(&mut r, version) && r.ok
}

// clap.audio-ports: an effect has one stereo main port each way; an instrument no input.
pub extern "C" fn ports_count<C: Core>(_p: *const ClapPlugin, is_input: bool) -> u32 { if is_input && C::INSTRUMENT { 0 } else { 1 } }
pub extern "C" fn ports_get<C: Core>(_p: *const ClapPlugin, index: u32, is_input: bool, info: *mut ClapAudioPortInfo) -> bool {
    if index != 0 || info.is_null() || (is_input && C::INSTRUMENT) { return false }
    unsafe {
        core::ptr::write_bytes(info as *mut u8, 0, core::mem::size_of::<ClapAudioPortInfo>());
        let i = &mut *info;
        i.id = 0;
        text::copy(if is_input { b"In" } else { b"Out" }, i.name.as_mut_ptr(), CLAP_NAME_SIZE as u32);
        i.flags = CLAP_AUDIO_PORT_IS_MAIN;
        i.channel_count = 2;
        i.port_type = b"stereo\0".as_ptr() as *const c_char;
        i.in_place_pair = CLAP_INVALID_ID;
    }
    true
}

// clap.note-ports: an instrument has one input; a note effect (DEV-F, 1.321) one input and one
// output. CLAP preferred, MIDI 1.0 accepted.
pub extern "C" fn notes_count<const OUTPUT: bool>(_p: *const ClapPlugin, is_input: bool) -> u32 { if is_input || OUTPUT { 1 } else { 0 } }
pub extern "C" fn notes_get<const OUTPUT: bool>(_p: *const ClapPlugin, index: u32, is_input: bool, info: *mut ClapNotePortInfo) -> bool {
    if index != 0 || !(is_input || OUTPUT) || info.is_null() { return false }
    unsafe {
        core::ptr::write_bytes(info as *mut u8, 0, core::mem::size_of::<ClapNotePortInfo>());
        let i = &mut *info;
        i.id = 0;
        i.supported_dialects = CLAP_NOTE_DIALECT_CLAP | CLAP_NOTE_DIALECT_MIDI;
        i.preferred_dialect = CLAP_NOTE_DIALECT_CLAP;
        text::copy(if is_input { b"Notes" } else { b"Notes out" }, i.name.as_mut_ptr(), CLAP_NAME_SIZE as u32);
    }
    true
}

pub extern "C" fn latency_get<C: Core>(p: *const ClapPlugin) -> u32 { unsafe { instance::<C>(p) }.core.latency() }
pub extern "C" fn tail_get<C: Core>(p: *const ClapPlugin) -> u32 { unsafe { instance::<C>(p) }.core.tail() }
pub extern "C" fn render_hard_rt(_p: *const ClapPlugin) -> bool { false }
pub extern "C" fn render_set<C: Core>(p: *const ClapPlugin, mode: i32) -> bool {
    unsafe { instance::<C>(p) }.core.set_offline(mode == CLAP_RENDER_OFFLINE);
    true
}
