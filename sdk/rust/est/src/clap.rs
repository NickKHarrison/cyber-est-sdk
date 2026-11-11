//! The CLAP 1.2 structs an EST effect or instrument touches, in their wasm32 (ILP32) layout. Every size and
//! offset is checked at compile time against `src/audio/est/abi/est-abi-1.0.json` (the asserts at
//! the end), so a change here that breaks the ABI does not build.
#![allow(non_camel_case_types)]

use core::ffi::c_char;
use core::ffi::c_void;

pub const CLAP_VERSION: ClapVersion = ClapVersion { major: 1, minor: 2, revision: 2 };
pub const CLAP_NAME_SIZE: usize = 256;
pub const CLAP_PATH_SIZE: usize = 1024;
pub const CLAP_INVALID_ID: u32 = u32::MAX;
pub const CLAP_CORE_EVENT_SPACE_ID: u16 = 0;
pub const CLAP_EVENT_PARAM_VALUE: u16 = 5;
pub const CLAP_EVENT_TRANSPORT: u16 = 9;
pub const CLAP_PROCESS_ERROR: i32 = 0;
pub const CLAP_PROCESS_CONTINUE: i32 = 1;
pub const CLAP_TRANSPORT_HAS_TEMPO: u32 = 1;
pub const CLAP_TRANSPORT_IS_PLAYING: u32 = 16;
pub const CLAP_PARAM_IS_STEPPED: u32 = 1;
pub const CLAP_PARAM_IS_AUTOMATABLE: u32 = 32;
pub const CLAP_PARAM_IS_HIDDEN: u32 = 4;
pub const CLAP_PARAM_IS_READONLY: u32 = 8;
pub const CLAP_PARAM_IS_BYPASS: u32 = 16;
pub const CLAP_TRANSPORT_HAS_BEATS_TIMELINE: u32 = 2;
pub const CLAP_TRANSPORT_HAS_TIME_SIGNATURE: u32 = 8;
/// `clap_beattime` is fixed point: beats × 2³¹.
pub const CLAP_BEATTIME_FACTOR: f64 = 2147483648.0;
pub const CLAP_RENDER_OFFLINE: i32 = 1;
pub const CLAP_AUDIO_PORT_IS_MAIN: u32 = 1;
// Instruments (EST Phase 3): note events, MIDI, note ports and note expressions.
pub const CLAP_EVENT_NOTE_ON: u16 = 0;
pub const CLAP_EVENT_NOTE_OFF: u16 = 1;
pub const CLAP_EVENT_NOTE_CHOKE: u16 = 2;
pub const CLAP_EVENT_NOTE_END: u16 = 3;
pub const CLAP_EVENT_NOTE_EXPRESSION: u16 = 4;
pub const CLAP_EVENT_MIDI: u16 = 10;
pub const CLAP_NOTE_DIALECT_CLAP: u32 = 1;
pub const CLAP_NOTE_DIALECT_MIDI: u32 = 2;
pub const CLAP_NOTE_EXPRESSION_VOLUME: i32 = 0;
pub const CLAP_NOTE_EXPRESSION_PAN: i32 = 1;
pub const CLAP_NOTE_EXPRESSION_TUNING: i32 = 2;
pub const CLAP_NOTE_EXPRESSION_VIBRATO: i32 = 3;
pub const CLAP_NOTE_EXPRESSION_EXPRESSION: i32 = 4;
pub const CLAP_NOTE_EXPRESSION_BRIGHTNESS: i32 = 5;
pub const CLAP_NOTE_EXPRESSION_PRESSURE: i32 = 6;

#[repr(C)]
#[derive(Clone, Copy)]
pub struct ClapVersion { pub major: u32, pub minor: u32, pub revision: u32 }

#[repr(C)]
pub struct ClapPluginEntry {
    pub clap_version: ClapVersion,
    pub init: extern "C" fn(plugin_path: *const c_char) -> bool,
    pub deinit: extern "C" fn(),
    pub get_factory: extern "C" fn(factory_id: *const c_char) -> *const c_void,
}

#[repr(C)]
pub struct ClapPluginFactory {
    pub get_plugin_count: extern "C" fn(factory: *const ClapPluginFactory) -> u32,
    pub get_plugin_descriptor: extern "C" fn(factory: *const ClapPluginFactory, index: u32) -> *const ClapPluginDescriptor,
    pub create_plugin: extern "C" fn(factory: *const ClapPluginFactory, host: *const ClapHost, plugin_id: *const c_char) -> *const ClapPlugin,
}

#[repr(C)]
pub struct ClapPluginDescriptor {
    pub clap_version: ClapVersion,
    pub id: *const c_char,
    pub name: *const c_char,
    pub vendor: *const c_char,
    pub url: *const c_char,
    pub manual_url: *const c_char,
    pub support_url: *const c_char,
    pub version: *const c_char,
    pub description: *const c_char,
    pub features: *const *const c_char,
}

#[repr(C)]
pub struct ClapPlugin {
    pub desc: *const ClapPluginDescriptor,
    pub plugin_data: *mut c_void,
    pub init: extern "C" fn(plugin: *const ClapPlugin) -> bool,
    pub destroy: extern "C" fn(plugin: *const ClapPlugin),
    pub activate: extern "C" fn(plugin: *const ClapPlugin, sample_rate: f64, min_frames: u32, max_frames: u32) -> bool,
    pub deactivate: extern "C" fn(plugin: *const ClapPlugin),
    pub start_processing: extern "C" fn(plugin: *const ClapPlugin) -> bool,
    pub stop_processing: extern "C" fn(plugin: *const ClapPlugin),
    pub reset: extern "C" fn(plugin: *const ClapPlugin),
    pub process: extern "C" fn(plugin: *const ClapPlugin, process: *const ClapProcess) -> i32,
    pub get_extension: extern "C" fn(plugin: *const ClapPlugin, id: *const c_char) -> *const c_void,
    pub on_main_thread: extern "C" fn(plugin: *const ClapPlugin),
}

#[repr(C)]
pub struct ClapHost {
    pub clap_version: ClapVersion,
    pub host_data: *mut c_void,
    pub name: *const c_char,
    pub vendor: *const c_char,
    pub url: *const c_char,
    pub version: *const c_char,
    pub get_extension: extern "C" fn(host: *const ClapHost, id: *const c_char) -> *const c_void,
    pub request_restart: extern "C" fn(host: *const ClapHost),
    pub request_process: extern "C" fn(host: *const ClapHost),
    pub request_callback: extern "C" fn(host: *const ClapHost),
}

#[repr(C)]
pub struct ClapProcess {
    pub steady_time: i64,
    pub frames_count: u32,
    pub transport: *const ClapEventTransport,
    pub audio_inputs: *const ClapAudioBuffer,
    pub audio_outputs: *mut ClapAudioBuffer,
    pub audio_inputs_count: u32,
    pub audio_outputs_count: u32,
    pub in_events: *const ClapInputEvents,
    pub out_events: *const ClapOutputEvents,
}

#[repr(C)]
pub struct ClapAudioBuffer {
    pub data32: *mut *mut f32,
    pub data64: *mut *mut f64,
    pub channel_count: u32,
    pub latency: u32,
    pub constant_mask: u64,
}

#[repr(C)]
pub struct ClapEventHeader { pub size: u32, pub time: u32, pub space_id: u16, pub type_: u16, pub flags: u32 }

#[repr(C)]
pub struct ClapEventParamValue {
    pub header: ClapEventHeader,
    pub param_id: u32,
    pub cookie: *mut c_void,
    pub note_id: i32,
    pub port_index: i16,
    pub channel: i16,
    pub key: i16,
    pub value: f64,
}

#[repr(C)]
pub struct ClapEventNote {
    pub header: ClapEventHeader,
    pub note_id: i32,
    pub port_index: i16,
    pub channel: i16,
    pub key: i16,
    pub velocity: f64,
}

#[repr(C)]
pub struct ClapEventNoteExpression {
    pub header: ClapEventHeader,
    pub expression_id: i32,
    pub note_id: i32,
    pub port_index: i16,
    pub channel: i16,
    pub key: i16,
    pub value: f64,
}

#[repr(C)]
pub struct ClapEventMidi {
    pub header: ClapEventHeader,
    pub port_index: u16,
    pub data: [u8; 3],
}

#[repr(C)]
pub struct ClapEventTransport {
    pub header: ClapEventHeader,
    pub flags: u32,
    pub song_pos_beats: i64,
    pub song_pos_seconds: i64,
    pub tempo: f64,
    pub tempo_inc: f64,
    pub loop_start_beats: i64,
    pub loop_end_beats: i64,
    pub loop_start_seconds: i64,
    pub loop_end_seconds: i64,
    pub bar_start: i64,
    pub bar_number: i32,
    pub tsig_num: u16,
    pub tsig_denom: u16,
}

#[repr(C)]
pub struct ClapInputEvents {
    pub ctx: *mut c_void,
    pub size: extern "C" fn(list: *const ClapInputEvents) -> u32,
    pub get: extern "C" fn(list: *const ClapInputEvents, index: u32) -> *const ClapEventHeader,
}

#[repr(C)]
pub struct ClapOutputEvents {
    pub ctx: *mut c_void,
    pub try_push: extern "C" fn(list: *const ClapOutputEvents, event: *const ClapEventHeader) -> bool,
}

#[repr(C)]
pub struct ClapPluginParams {
    pub count: extern "C" fn(plugin: *const ClapPlugin) -> u32,
    pub get_info: extern "C" fn(plugin: *const ClapPlugin, index: u32, info: *mut ClapParamInfo) -> bool,
    pub get_value: extern "C" fn(plugin: *const ClapPlugin, id: u32, out: *mut f64) -> bool,
    pub value_to_text: extern "C" fn(plugin: *const ClapPlugin, id: u32, value: f64, out: *mut c_char, size: u32) -> bool,
    pub text_to_value: extern "C" fn(plugin: *const ClapPlugin, id: u32, text: *const c_char, out: *mut f64) -> bool,
    pub flush: extern "C" fn(plugin: *const ClapPlugin, input: *const ClapInputEvents, output: *const ClapOutputEvents),
}

#[repr(C)]
pub struct ClapParamInfo {
    pub id: u32,
    pub flags: u32,
    pub cookie: *mut c_void,
    pub name: [c_char; CLAP_NAME_SIZE],
    pub module: [c_char; CLAP_PATH_SIZE],
    pub min_value: f64,
    pub max_value: f64,
    pub default_value: f64,
}

#[repr(C)]
pub struct ClapPluginState {
    pub save: extern "C" fn(plugin: *const ClapPlugin, stream: *const ClapOstream) -> bool,
    pub load: extern "C" fn(plugin: *const ClapPlugin, stream: *const ClapIstream) -> bool,
}

#[repr(C)]
pub struct ClapIstream {
    pub ctx: *mut c_void,
    pub read: extern "C" fn(stream: *const ClapIstream, buffer: *mut c_void, size: u64) -> i64,
}

#[repr(C)]
pub struct ClapOstream {
    pub ctx: *mut c_void,
    pub write: extern "C" fn(stream: *const ClapOstream, buffer: *const c_void, size: u64) -> i64,
}

#[repr(C)]
pub struct ClapPluginAudioPorts {
    pub count: extern "C" fn(plugin: *const ClapPlugin, is_input: bool) -> u32,
    pub get: extern "C" fn(plugin: *const ClapPlugin, index: u32, is_input: bool, info: *mut ClapAudioPortInfo) -> bool,
}

#[repr(C)]
pub struct ClapAudioPortInfo {
    pub id: u32,
    pub name: [c_char; CLAP_NAME_SIZE],
    pub flags: u32,
    pub channel_count: u32,
    pub port_type: *const c_char,
    pub in_place_pair: u32,
}

#[repr(C)]
pub struct ClapPluginNotePorts {
    pub count: extern "C" fn(plugin: *const ClapPlugin, is_input: bool) -> u32,
    pub get: extern "C" fn(plugin: *const ClapPlugin, index: u32, is_input: bool, info: *mut ClapNotePortInfo) -> bool,
}

#[repr(C)]
pub struct ClapNotePortInfo {
    pub id: u32,
    pub supported_dialects: u32,
    pub preferred_dialect: u32,
    pub name: [c_char; CLAP_NAME_SIZE],
}

#[repr(C)]
pub struct ClapPluginLatency { pub get: extern "C" fn(plugin: *const ClapPlugin) -> u32 }

#[repr(C)]
pub struct ClapPluginTail { pub get: extern "C" fn(plugin: *const ClapPlugin) -> u32 }

#[repr(C)]
pub struct ClapPluginRender {
    pub has_hard_realtime_requirement: extern "C" fn(plugin: *const ClapPlugin) -> bool,
    pub set: extern "C" fn(plugin: *const ClapPlugin, mode: i32) -> bool,
}

// Statics that hold pointers (descriptors, vtables) are read-only and the module is single
// threaded (EST's single-thread model, spec §3.3), so sharing them is sound.
unsafe impl Sync for ClapPluginEntry {}
unsafe impl Sync for ClapPluginFactory {}
unsafe impl Sync for ClapPluginDescriptor {}
unsafe impl Sync for ClapPluginParams {}
unsafe impl Sync for ClapPluginState {}
unsafe impl Sync for ClapPluginAudioPorts {}
unsafe impl Sync for ClapPluginNotePorts {}
unsafe impl Sync for ClapPluginLatency {}
unsafe impl Sync for ClapPluginTail {}
unsafe impl Sync for ClapPluginRender {}

/// A NULL-terminated list of C strings in a static (the descriptor's features).
#[repr(transparent)]
pub struct CStrList<const N: usize>(pub [*const c_char; N]);
unsafe impl<const N: usize> Sync for CStrList<N> {}

// --- The layout, checked against est-abi-1.0.json (wasm32 only: elsewhere pointers differ) ---
#[cfg(target_arch = "wasm32")]
mod layout {
    use super::*;
    use core::mem::{offset_of, size_of};
    macro_rules! check { ($t:ty, $size:expr $(, $f:ident = $o:expr)*) => {
        const _: () = assert!(size_of::<$t>() == $size);
        $(const _: () = assert!(offset_of!($t, $f) == $o);)*
    } }
    check!(ClapVersion, 12, major = 0, minor = 4, revision = 8);
    check!(ClapPluginEntry, 24, clap_version = 0, init = 12, deinit = 16, get_factory = 20);
    check!(ClapPluginFactory, 12, get_plugin_count = 0, get_plugin_descriptor = 4, create_plugin = 8);
    check!(ClapPluginDescriptor, 48, clap_version = 0, id = 12, name = 16, vendor = 20, url = 24, manual_url = 28, support_url = 32, version = 36, description = 40, features = 44);
    check!(ClapPlugin, 48, desc = 0, plugin_data = 4, init = 8, destroy = 12, activate = 16, deactivate = 20, start_processing = 24, stop_processing = 28, reset = 32, process = 36, get_extension = 40, on_main_thread = 44);
    check!(ClapHost, 48, clap_version = 0, host_data = 12, name = 16, vendor = 20, url = 24, version = 28, get_extension = 32, request_restart = 36, request_process = 40, request_callback = 44);
    check!(ClapProcess, 40, steady_time = 0, frames_count = 8, transport = 12, audio_inputs = 16, audio_outputs = 20, audio_inputs_count = 24, audio_outputs_count = 28, in_events = 32, out_events = 36);
    check!(ClapAudioBuffer, 24, data32 = 0, data64 = 4, channel_count = 8, latency = 12, constant_mask = 16);
    check!(ClapEventHeader, 16, size = 0, time = 4, space_id = 8, type_ = 10, flags = 12);
    check!(ClapEventParamValue, 48, header = 0, param_id = 16, cookie = 20, note_id = 24, port_index = 28, channel = 30, key = 32, value = 40);
    check!(ClapEventNote, 40, header = 0, note_id = 16, port_index = 20, channel = 22, key = 24, velocity = 32);
    check!(ClapEventNoteExpression, 40, header = 0, expression_id = 16, note_id = 20, port_index = 24, channel = 26, key = 28, value = 32);
    check!(ClapEventMidi, 24, header = 0, port_index = 16, data = 18);
    check!(ClapEventTransport, 104, header = 0, flags = 16, song_pos_beats = 24, song_pos_seconds = 32, tempo = 40, tempo_inc = 48, loop_start_beats = 56, loop_end_beats = 64, loop_start_seconds = 72, loop_end_seconds = 80, bar_start = 88, bar_number = 96, tsig_num = 100, tsig_denom = 102);
    check!(ClapInputEvents, 12, ctx = 0, size = 4, get = 8);
    check!(ClapOutputEvents, 8, ctx = 0, try_push = 4);
    check!(ClapPluginParams, 24, count = 0, get_info = 4, get_value = 8, value_to_text = 12, text_to_value = 16, flush = 20);
    check!(ClapParamInfo, 1320, id = 0, flags = 4, cookie = 8, name = 12, module = 268, min_value = 1296, max_value = 1304, default_value = 1312);
    check!(ClapPluginState, 8, save = 0, load = 4);
    check!(ClapIstream, 8, ctx = 0, read = 4);
    check!(ClapOstream, 8, ctx = 0, write = 4);
    check!(ClapPluginAudioPorts, 8, count = 0, get = 4);
    check!(ClapAudioPortInfo, 276, id = 0, name = 4, flags = 260, channel_count = 264, port_type = 268, in_place_pair = 272);
    check!(ClapPluginNotePorts, 8, count = 0, get = 4);
    check!(ClapNotePortInfo, 268, id = 0, supported_dialects = 4, preferred_dialect = 8, name = 12);
    check!(ClapPluginLatency, 4, get = 0);
    check!(ClapPluginTail, 4, get = 0);
    check!(ClapPluginRender, 8, has_hard_realtime_requirement = 0, set = 4);
}
