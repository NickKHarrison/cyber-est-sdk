// The CLAP 1.2 structs an EST plugin touches, in their wasm32 (ILP32) layout, as offsets:
// AssemblyScript has no C structs, so the glue reads and writes them with load<T>/store<T> at these
// offsets. Every value is checked against src/audio/est/abi/est-abi-1.0.json by Cyber's unit test
// src/audio/est/install/synthAs.test.ts (the AssemblyScript twin of the Rust crate's compile-time asserts), so
// the two languages share one layout: the ABI file's.

export const CLAP_VERSION_MAJOR: u32 = 1;
export const CLAP_VERSION_MINOR: u32 = 2;
export const CLAP_VERSION_REVISION: u32 = 2;
export const CLAP_NAME_SIZE: u32 = 256;
export const CLAP_PATH_SIZE: u32 = 1024;
export const CLAP_INVALID_ID: u32 = 0xffffffff;
export const CLAP_CORE_EVENT_SPACE_ID: u16 = 0;
export const CLAP_EVENT_NOTE_ON: u16 = 0;
export const CLAP_EVENT_NOTE_OFF: u16 = 1;
export const CLAP_EVENT_NOTE_CHOKE: u16 = 2;
export const CLAP_EVENT_NOTE_END: u16 = 3;
export const CLAP_EVENT_NOTE_EXPRESSION: u16 = 4;
export const CLAP_EVENT_PARAM_VALUE: u16 = 5;
export const CLAP_EVENT_TRANSPORT: u16 = 9;
export const CLAP_EVENT_MIDI: u16 = 10;
export const CLAP_PROCESS_ERROR: i32 = 0;
export const CLAP_PROCESS_CONTINUE: i32 = 1;
export const CLAP_TRANSPORT_HAS_TEMPO: u32 = 1;
export const CLAP_TRANSPORT_HAS_BEATS_TIMELINE: u32 = 2;
export const CLAP_TRANSPORT_HAS_TIME_SIGNATURE: u32 = 8;
export const CLAP_TRANSPORT_IS_PLAYING: u32 = 16;
export const CLAP_PARAM_IS_STEPPED: u32 = 1;
export const CLAP_PARAM_IS_HIDDEN: u32 = 4;
export const CLAP_PARAM_IS_READONLY: u32 = 8;
export const CLAP_PARAM_IS_BYPASS: u32 = 16;
export const CLAP_PARAM_IS_AUTOMATABLE: u32 = 32;
export const CLAP_AUDIO_PORT_IS_MAIN: u32 = 1;
export const CLAP_NOTE_DIALECT_CLAP: u32 = 1;
export const CLAP_NOTE_DIALECT_MIDI: u32 = 2;
export const CLAP_NOTE_EXPRESSION_VOLUME: i32 = 0;
export const CLAP_NOTE_EXPRESSION_PAN: i32 = 1;
export const CLAP_NOTE_EXPRESSION_TUNING: i32 = 2;
export const CLAP_NOTE_EXPRESSION_BRIGHTNESS: i32 = 5;
export const CLAP_RENDER_OFFLINE: i32 = 1;

// clap_version
export const VERSION_SIZE: usize = 12;
// clap_plugin_entry
export const ENTRY_SIZE: usize = 24;
export const ENTRY_INIT: usize = 12;
export const ENTRY_DEINIT: usize = 16;
export const ENTRY_GET_FACTORY: usize = 20;
// clap_plugin_factory
export const FACTORY_SIZE: usize = 12;
export const FACTORY_GET_PLUGIN_COUNT: usize = 0;
export const FACTORY_GET_PLUGIN_DESCRIPTOR: usize = 4;
export const FACTORY_CREATE_PLUGIN: usize = 8;
// clap_plugin_descriptor
export const DESCRIPTOR_SIZE: usize = 48;
export const DESCRIPTOR_ID: usize = 12;
export const DESCRIPTOR_NAME: usize = 16;
export const DESCRIPTOR_VENDOR: usize = 20;
export const DESCRIPTOR_URL: usize = 24;
export const DESCRIPTOR_MANUAL_URL: usize = 28;
export const DESCRIPTOR_SUPPORT_URL: usize = 32;
export const DESCRIPTOR_VERSION: usize = 36;
export const DESCRIPTOR_DESCRIPTION: usize = 40;
export const DESCRIPTOR_FEATURES: usize = 44;
// clap_plugin
export const PLUGIN_SIZE: usize = 48;
export const PLUGIN_DESC: usize = 0;
export const PLUGIN_PLUGIN_DATA: usize = 4;
export const PLUGIN_INIT: usize = 8;
export const PLUGIN_DESTROY: usize = 12;
export const PLUGIN_ACTIVATE: usize = 16;
export const PLUGIN_DEACTIVATE: usize = 20;
export const PLUGIN_START_PROCESSING: usize = 24;
export const PLUGIN_STOP_PROCESSING: usize = 28;
export const PLUGIN_RESET: usize = 32;
export const PLUGIN_PROCESS: usize = 36;
export const PLUGIN_GET_EXTENSION: usize = 40;
export const PLUGIN_ON_MAIN_THREAD: usize = 44;
// clap_host
export const HOST_CLAP_VERSION: usize = 0;
// clap_process
export const PROCESS_FRAMES_COUNT: usize = 8;
export const PROCESS_TRANSPORT: usize = 12;
export const PROCESS_AUDIO_INPUTS: usize = 16;
export const PROCESS_AUDIO_OUTPUTS: usize = 20;
export const PROCESS_AUDIO_INPUTS_COUNT: usize = 24;
export const PROCESS_AUDIO_OUTPUTS_COUNT: usize = 28;
export const PROCESS_IN_EVENTS: usize = 32;
export const PROCESS_OUT_EVENTS: usize = 36;
// clap_audio_buffer
export const AUDIO_BUFFER_DATA32: usize = 0;
export const AUDIO_BUFFER_CHANNEL_COUNT: usize = 8;
// clap_event_header
export const HEADER_SIZE: usize = 0;
export const HEADER_TIME: usize = 4;
export const HEADER_SPACE_ID: usize = 8;
export const HEADER_TYPE: usize = 10;
export const HEADER_FLAGS: usize = 12;
// clap_event_param_value
export const PARAM_VALUE_SIZE: usize = 48;
export const PARAM_VALUE_PARAM_ID: usize = 16;
export const PARAM_VALUE_VALUE: usize = 40;
// clap_event_note
export const NOTE_SIZE: usize = 40;
export const NOTE_NOTE_ID: usize = 16;
export const NOTE_PORT_INDEX: usize = 20;
export const NOTE_CHANNEL: usize = 22;
export const NOTE_KEY: usize = 24;
export const NOTE_VELOCITY: usize = 32;
// clap_event_note_expression
export const EXPRESSION_SIZE: usize = 40;
export const EXPRESSION_EXPRESSION_ID: usize = 16;
export const EXPRESSION_NOTE_ID: usize = 20;
export const EXPRESSION_PORT_INDEX: usize = 24;
export const EXPRESSION_CHANNEL: usize = 26;
export const EXPRESSION_KEY: usize = 28;
export const EXPRESSION_VALUE: usize = 32;
// clap_event_midi
export const MIDI_SIZE: usize = 24;
export const MIDI_PORT_INDEX: usize = 16;
export const MIDI_DATA: usize = 18;
// clap_event_transport
export const TRANSPORT_SIZE: usize = 104;
export const TRANSPORT_FLAGS: usize = 16;
export const TRANSPORT_SONG_POS_BEATS: usize = 24;
export const TRANSPORT_TEMPO: usize = 40;
export const TRANSPORT_BAR_START: usize = 88;
export const TRANSPORT_TSIG_NUM: usize = 100;
export const TRANSPORT_TSIG_DENOM: usize = 102;
// clap_input_events, clap_output_events
export const INPUT_EVENTS_SIZE: usize = 4;
export const INPUT_EVENTS_GET: usize = 8;
export const OUTPUT_EVENTS_TRY_PUSH: usize = 4;
// clap_plugin_params
export const PARAMS_SIZE: usize = 24;
export const PARAMS_COUNT: usize = 0;
export const PARAMS_GET_INFO: usize = 4;
export const PARAMS_GET_VALUE: usize = 8;
export const PARAMS_VALUE_TO_TEXT: usize = 12;
export const PARAMS_TEXT_TO_VALUE: usize = 16;
export const PARAMS_FLUSH: usize = 20;
// clap_param_info
export const PARAM_INFO_SIZE: usize = 1320;
export const PARAM_INFO_ID: usize = 0;
export const PARAM_INFO_FLAGS: usize = 4;
export const PARAM_INFO_NAME: usize = 12;
export const PARAM_INFO_MODULE: usize = 268;
export const PARAM_INFO_MIN_VALUE: usize = 1296;
export const PARAM_INFO_MAX_VALUE: usize = 1304;
export const PARAM_INFO_DEFAULT_VALUE: usize = 1312;
// clap_plugin_state, clap_istream, clap_ostream
export const STATE_SIZE: usize = 8;
export const STATE_SAVE: usize = 0;
export const STATE_LOAD: usize = 4;
export const ISTREAM_READ: usize = 4;
export const OSTREAM_WRITE: usize = 4;
// clap_plugin_audio_ports, clap_audio_port_info
export const AUDIO_PORTS_SIZE: usize = 8;
export const AUDIO_PORTS_COUNT: usize = 0;
export const AUDIO_PORTS_GET: usize = 4;
export const AUDIO_PORT_INFO_SIZE: usize = 276;
export const AUDIO_PORT_INFO_ID: usize = 0;
export const AUDIO_PORT_INFO_NAME: usize = 4;
export const AUDIO_PORT_INFO_FLAGS: usize = 260;
export const AUDIO_PORT_INFO_CHANNEL_COUNT: usize = 264;
export const AUDIO_PORT_INFO_PORT_TYPE: usize = 268;
export const AUDIO_PORT_INFO_IN_PLACE_PAIR: usize = 272;
// clap_plugin_note_ports, clap_note_port_info
export const NOTE_PORTS_SIZE: usize = 8;
export const NOTE_PORTS_COUNT: usize = 0;
export const NOTE_PORTS_GET: usize = 4;
export const NOTE_PORT_INFO_SIZE: usize = 268;
export const NOTE_PORT_INFO_ID: usize = 0;
export const NOTE_PORT_INFO_SUPPORTED_DIALECTS: usize = 4;
export const NOTE_PORT_INFO_PREFERRED_DIALECT: usize = 8;
export const NOTE_PORT_INFO_NAME: usize = 12;
// clap_plugin_latency, clap_plugin_tail, clap_plugin_render
export const LATENCY_GET: usize = 0;
export const TAIL_GET: usize = 0;
export const RENDER_SIZE: usize = 8;
export const RENDER_HAS_HARD_REALTIME_REQUIREMENT: usize = 0;
export const RENDER_SET: usize = 4;
