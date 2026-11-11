// The CLAP side, the twin of the Rust crate's glue.rs: the entry, the factory, the descriptor, the
// plugin's functions and the extensions, for an effect or an instrument. Not for plugins to call
// beyond the export block (`setup`, `isReady`, `alloc`, `free`, `clap_entry`).
//
// Two things differ from Rust because of how AssemblyScript compiles (the Phase 3 lessons, EST
// decision log):
// 1. **No start function.** The host meters every module (D-30) and gives fuel only before each
//    call it makes, so a WebAssembly start function (where AssemblyScript runs top-level code)
//    would trap at instantiation; and a function's table index is not a constant AssemblyScript
//    can put in a data segment. So `clap_entry` is the constant address of empty memory, and the
//    structs behind it are written by `setup`, which the plugin's exported `malloc` calls first:
//    the host must allocate before it can call anything. Keep top-level code to constants.
// 2. **The runtime is `stub`'s** (./runtime.ts: a bump allocator that never frees but the last
//    block): `malloc` and `free` are its `heap.alloc`/`heap.free`, so the host's structs and the
//    plugin's objects share one heap; allocate in `setup`, the constructor and `activate`, never
//    while processing. One instance per module (the host makes a module instance per plugin).

import * as C from "./clap";
import { Descriptor, Events, Io, MAX_PARAMS, Param, Plugin, StateReader, StateWriter } from "./plugin";
import { put, textToValue, valueToText } from "./text";

let ready = false;
let desc: Descriptor | null = null;
let params: Param[] | null = null;
let instance: Plugin | null = null;
let maker: (() => Plugin) | null = null;
let io: Io | null = null;
let events: Events | null = null;
let values: StaticArray<f64> | null = null;
let instrument = false;
/** A note effect's note ports (DEV-F, 1.321: `Descriptor.noteEffect()`): one in, one out. */
let noteIo = false;
let scratch: usize = 0;
let writer: StateWriter | null = null;
let reader: StateReader | null = null;
let descPtr: usize = 0;
let factoryPtr: usize = 0;
let pluginPtr: usize = 0;
let paramsExt: usize = 0;
let stateExt: usize = 0;
let portsExt: usize = 0;
let notesExt: usize = 0;
let latencyExt: usize = 0;
let tailExt: usize = 0;
let renderExt: usize = 0;
let stereo: usize = 0;

/** The entry's address: constant, so it is there before anything runs; `setup` writes the entry. */
export const clap_entry: usize = memory.data(<i32>C.ENTRY_SIZE, 8);

/** The C string of `s` (UTF-8, NUL-terminated), kept for the module's life. */
function cstr(s: string): usize { return changetype<usize>(String.UTF8.encode(s, true)); }

function zalloc(n: usize): usize {
  const p = heap.alloc(n);
  memory.fill(p, 0, n);
  return p;
}

function inst(): Plugin { return changetype<Plugin>(load<usize>(pluginPtr, C.PLUGIN_PLUGIN_DATA)); }
function plist(): Param[] { return changetype<Param[]>(params); }
function vals(): StaticArray<f64> { return changetype<StaticArray<f64>>(values); }
function indexOf(id: u32): i32 {
  const ps = plist();
  for (let i = 0; i < ps.length; i++) if (ps[i].id == id) return i;
  return -1;
}
/** Store a parameter's value (clamped) and tell the plugin. */
function setValue(id: u32, v: f64): void {
  const i = indexOf(id);
  if (i < 0) return;
  const x = plist()[i].clamp(v);
  vals()[i] = x;
  inst().paramChanged(id, x);
}

/** Whether `setup` has run. */
export function isReady(): bool { return ready; }

/**
 * Write the entry, the factory, the descriptor and the extensions for this plugin. Called by the
 * plugin's `malloc` before its first allocation (see the file's comment); does nothing after.
 */
export function setup(d: Descriptor, ps: Param[], make: () => Plugin): void {
  if (ready) return;
  ready = true;
  if (ps.length > MAX_PARAMS) unreachable();
  desc = d;
  params = ps;
  maker = make;
  instrument = d.instrument();
  noteIo = d.notePorts;
  const o = new Io();
  o.ev = zalloc(C.NOTE_SIZE);
  o.params = ps;
  const vs = new StaticArray<f64>(ps.length);
  o.values = vs;
  values = vs;
  io = o;
  events = new Events();
  scratch = zalloc(16);
  writer = new StateWriter(0, scratch);
  reader = new StateReader(0, scratch);
  stereo = cstr("stereo");
  for (let i = 0; i < ps.length; i++) { ps[i].cname = cstr(ps[i].name); ps[i].cmodule = cstr(ps[i].modulePath); }
  // The entry.
  const e = clap_entry;
  store<u32>(e, C.CLAP_VERSION_MAJOR, 0);
  store<u32>(e, C.CLAP_VERSION_MINOR, 4);
  store<u32>(e, C.CLAP_VERSION_REVISION, 8);
  store<u32>(e, entry_init.index, C.ENTRY_INIT);
  store<u32>(e, entry_deinit.index, C.ENTRY_DEINIT);
  store<u32>(e, entry_get_factory.index, C.ENTRY_GET_FACTORY);
  // The descriptor and the factory.
  descPtr = zalloc(C.DESCRIPTOR_SIZE);
  store<u32>(descPtr, C.CLAP_VERSION_MAJOR, 0);
  store<u32>(descPtr, C.CLAP_VERSION_MINOR, 4);
  store<u32>(descPtr, C.CLAP_VERSION_REVISION, 8);
  const empty = cstr("");
  store<usize>(descPtr, cstr(d.id), C.DESCRIPTOR_ID);
  store<usize>(descPtr, cstr(d.name), C.DESCRIPTOR_NAME);
  store<usize>(descPtr, cstr(d.vendor), C.DESCRIPTOR_VENDOR);
  store<usize>(descPtr, empty, C.DESCRIPTOR_URL);
  store<usize>(descPtr, empty, C.DESCRIPTOR_MANUAL_URL);
  store<usize>(descPtr, empty, C.DESCRIPTOR_SUPPORT_URL);
  store<usize>(descPtr, cstr(d.version), C.DESCRIPTOR_VERSION);
  store<usize>(descPtr, cstr(d.description), C.DESCRIPTOR_DESCRIPTION);
  const features = zalloc(<usize>(d.features.length + 1) << 2);
  for (let i = 0; i < d.features.length; i++) store<usize>(features + (<usize>i << 2), cstr(d.features[i]));
  store<usize>(descPtr, features, C.DESCRIPTOR_FEATURES);
  factoryPtr = zalloc(C.FACTORY_SIZE);
  store<u32>(factoryPtr, factory_count.index, C.FACTORY_GET_PLUGIN_COUNT);
  store<u32>(factoryPtr, factory_descriptor.index, C.FACTORY_GET_PLUGIN_DESCRIPTOR);
  store<u32>(factoryPtr, factory_create.index, C.FACTORY_CREATE_PLUGIN);
  // The extensions.
  paramsExt = zalloc(C.PARAMS_SIZE);
  store<u32>(paramsExt, params_count.index, C.PARAMS_COUNT);
  store<u32>(paramsExt, params_get_info.index, C.PARAMS_GET_INFO);
  store<u32>(paramsExt, params_get_value.index, C.PARAMS_GET_VALUE);
  store<u32>(paramsExt, params_value_to_text.index, C.PARAMS_VALUE_TO_TEXT);
  store<u32>(paramsExt, params_text_to_value.index, C.PARAMS_TEXT_TO_VALUE);
  store<u32>(paramsExt, params_flush.index, C.PARAMS_FLUSH);
  stateExt = zalloc(C.STATE_SIZE);
  store<u32>(stateExt, state_save.index, C.STATE_SAVE);
  store<u32>(stateExt, state_load.index, C.STATE_LOAD);
  portsExt = zalloc(C.AUDIO_PORTS_SIZE);
  store<u32>(portsExt, ports_count.index, C.AUDIO_PORTS_COUNT);
  store<u32>(portsExt, ports_get.index, C.AUDIO_PORTS_GET);
  notesExt = zalloc(C.NOTE_PORTS_SIZE);
  store<u32>(notesExt, notes_count.index, C.NOTE_PORTS_COUNT);
  store<u32>(notesExt, notes_get.index, C.NOTE_PORTS_GET);
  latencyExt = zalloc(4);
  store<u32>(latencyExt, latency_get.index, C.LATENCY_GET);
  tailExt = zalloc(4);
  store<u32>(tailExt, tail_get.index, C.TAIL_GET);
  renderExt = zalloc(C.RENDER_SIZE);
  store<u32>(renderExt, render_hard_rt.index, C.RENDER_HAS_HARD_REALTIME_REQUIREMENT);
  store<u32>(renderExt, render_set.index, C.RENDER_SET);
}

/** `malloc` with C semantics on the runtime's heap (what the plugin's exported `malloc` returns after `setup`). */
export function alloc(size: usize): usize { return heap.alloc(size); }

/** `free` with C semantics (the stub runtime frees only the last block; the host frees almost nothing). */
export function free(p: usize): void { if (p != 0) heap.free(p); }

function cstrEq(p: usize, s: string): bool {
  if (p == 0) return false;
  for (let i = 0; i < s.length; i++) if (load<u8>(p + i) != <u8>s.charCodeAt(i)) return false;
  return load<u8>(p + s.length) == 0;
}

// --- The entry and the factory -------------------------------------------------------------------

function entry_init(path: usize): bool { return true; }
function entry_deinit(): void {}
function entry_get_factory(id: usize): usize { return cstrEq(id, "clap.plugin-factory") ? factoryPtr : 0; }
function factory_count(f: usize): u32 { return 1; }
function factory_descriptor(f: usize, i: u32): usize { return i == 0 ? descPtr : 0; }

function factory_create(f: usize, host: usize, id: usize): usize {
  if (host == 0 || load<u32>(host, C.HOST_CLAP_VERSION) < 1 || pluginPtr != 0) return 0;
  if (!cstrEq(id, changetype<Descriptor>(desc).id)) return 0;
  const make = changetype<() => Plugin>(maker);
  const it = make();
  instance = it;
  const p = zalloc(C.PLUGIN_SIZE);
  store<usize>(p, descPtr, C.PLUGIN_DESC);
  store<usize>(p, changetype<usize>(it), C.PLUGIN_PLUGIN_DATA);
  store<u32>(p, plugin_init.index, C.PLUGIN_INIT);
  store<u32>(p, plugin_destroy.index, C.PLUGIN_DESTROY);
  store<u32>(p, plugin_activate.index, C.PLUGIN_ACTIVATE);
  store<u32>(p, plugin_deactivate.index, C.PLUGIN_DEACTIVATE);
  store<u32>(p, plugin_start.index, C.PLUGIN_START_PROCESSING);
  store<u32>(p, plugin_stop.index, C.PLUGIN_STOP_PROCESSING);
  store<u32>(p, plugin_reset.index, C.PLUGIN_RESET);
  store<u32>(p, plugin_process.index, C.PLUGIN_PROCESS);
  store<u32>(p, plugin_get_extension.index, C.PLUGIN_GET_EXTENSION);
  store<u32>(p, plugin_on_main_thread.index, C.PLUGIN_ON_MAIN_THREAD);
  pluginPtr = p;
  return p;
}

// --- The plugin -----------------------------------------------------------------------------------

function plugin_init(p: usize): bool {
  const ps = plist();
  const vs = vals();
  for (let i = 0; i < ps.length; i++) {
    vs[i] = ps[i].defaultValue;
    inst().paramChanged(ps[i].id, ps[i].defaultValue);
  }
  return true;
}
function plugin_destroy(p: usize): void { pluginPtr = 0; instance = null; }
function plugin_activate(p: usize, sr: f64, min: u32, max: u32): bool { return inst().activate(sr, max); }
function plugin_deactivate(p: usize): void { inst().deactivate(); }
function plugin_start(p: usize): bool { return true; }
function plugin_stop(p: usize): void {}
function plugin_reset(p: usize): void { inst().reset(); }
function plugin_on_main_thread(p: usize): void {}

function plugin_get_extension(p: usize, id: usize): usize {
  if (cstrEq(id, "clap.params")) return paramsExt;
  if (cstrEq(id, "clap.state")) return stateExt;
  if (cstrEq(id, "clap.audio-ports")) return portsExt;
  if ((instrument || noteIo) && cstrEq(id, "clap.note-ports")) return notesExt;
  if (cstrEq(id, "clap.latency")) return latencyExt;
  if (cstrEq(id, "clap.tail")) return tailExt;
  if (cstrEq(id, "clap.render")) return renderExt;
  return 0;
}

function plugin_process(p: usize, pr: usize): i32 {
  const it = inst();
  const outs = load<usize>(pr, C.PROCESS_AUDIO_OUTPUTS);
  if (load<u32>(pr, C.PROCESS_AUDIO_OUTPUTS_COUNT) < 1 || outs == 0) return C.CLAP_PROCESS_ERROR;
  const frames = <i32>load<u32>(pr, C.PROCESS_FRAMES_COUNT);
  const outCount = <i32>load<u32>(outs, C.AUDIO_BUFFER_CHANNEL_COUNT);
  const outData = load<usize>(outs, C.AUDIO_BUFFER_DATA32);
  const o = changetype<Io>(io);
  o.frames = frames;
  o.inL = 0;
  o.inR = 0;
  let channels = outCount;
  if (instrument) {
    for (let c = 0; c < outCount; c++) memory.fill(load<usize>(outData + (<usize>c << 2)), 0, <usize>frames << 2);
  } else {
    const ins = load<usize>(pr, C.PROCESS_AUDIO_INPUTS);
    if (load<u32>(pr, C.PROCESS_AUDIO_INPUTS_COUNT) < 1 || ins == 0) return C.CLAP_PROCESS_ERROR;
    const inCount = <i32>load<u32>(ins, C.AUDIO_BUFFER_CHANNEL_COUNT);
    const inData = load<usize>(ins, C.AUDIO_BUFFER_DATA32);
    if (inCount < channels) channels = inCount;
    if (channels > 2) channels = 2;
    if (channels > 0) o.inL = load<usize>(inData);
    if (channels > 1) o.inR = load<usize>(inData + 4);
    for (let c = channels; c < outCount; c++) memory.fill(load<usize>(outData + (<usize>c << 2)), 0, <usize>frames << 2);
  }
  if (channels > 2) channels = 2;
  o.channels = channels;
  o.outL = channels > 0 ? load<usize>(outData) : 0;
  o.outR = channels > 1 ? load<usize>(outData + 4) : 0;
  o.outEvents = load<usize>(pr, C.PROCESS_OUT_EVENTS);
  o.transport.read(load<usize>(pr, C.PROCESS_TRANSPORT));
  const ev = changetype<Events>(events);
  ev.reset(load<usize>(pr, C.PROCESS_IN_EVENTS), frames);
  it.process(o, ev);
  return C.CLAP_PROCESS_CONTINUE;
}

// --- clap.params ----------------------------------------------------------------------------------

function params_count(p: usize): u32 { return <u32>plist().length; }

function copyC(src: usize, dst: usize, cap: usize): void {
  let k: usize = 0;
  while (k < cap - 1 && load<u8>(src + k) != 0) { store<u8>(dst + k, load<u8>(src + k)); k++; }
  store<u8>(dst + k, 0);
}

function params_get_info(p: usize, index: u32, info: usize): bool {
  const ps = plist();
  if (index >= <u32>ps.length || info == 0) return false;
  const prm = ps[index];
  memory.fill(info, 0, C.PARAM_INFO_SIZE);
  store<u32>(info, prm.id, C.PARAM_INFO_ID);
  store<u32>(info, C.CLAP_PARAM_IS_AUTOMATABLE | prm.flags | (prm.stepped() ? C.CLAP_PARAM_IS_STEPPED : 0), C.PARAM_INFO_FLAGS);
  copyC(prm.cname, info + C.PARAM_INFO_NAME, C.CLAP_NAME_SIZE);
  copyC(prm.cmodule, info + C.PARAM_INFO_MODULE, C.CLAP_PATH_SIZE);
  store<f64>(info, prm.min, C.PARAM_INFO_MIN_VALUE);
  store<f64>(info, prm.max, C.PARAM_INFO_MAX_VALUE);
  store<f64>(info, prm.defaultValue, C.PARAM_INFO_DEFAULT_VALUE);
  return true;
}

function params_get_value(p: usize, id: u32, value: usize): bool {
  const i = indexOf(id);
  if (i < 0 || value == 0) return false;
  store<f64>(value, vals()[i]);
  return true;
}

function params_value_to_text(p: usize, id: u32, v: f64, text: usize, size: u32): bool {
  const i = indexOf(id);
  if (i < 0 || text == 0 || size == 0) return false;
  valueToText(plist()[i], v, text, <i32>(size > 256 ? 256 : size));
  return true;
}

function params_text_to_value(p: usize, id: u32, text: usize, value: usize): bool {
  const i = indexOf(id);
  if (i < 0 || text == 0 || value == 0) return false;
  const prm = plist()[i];
  const v = textToValue(prm, text);
  if (isNaN(v)) return false;
  store<f64>(value, prm.clamp(v));
  return true;
}

function params_flush(p: usize, input: usize, output: usize): void {
  if (input == 0) return;
  const n = call_indirect<u32>(load<u32>(input, C.INPUT_EVENTS_SIZE), input);
  for (let k: u32 = 0; k < n; k++) {
    const h = call_indirect<usize>(load<u32>(input, C.INPUT_EVENTS_GET), input, k);
    if (h != 0 && load<u16>(h, C.HEADER_SPACE_ID) == C.CLAP_CORE_EVENT_SPACE_ID && load<u16>(h, C.HEADER_TYPE) == C.CLAP_EVENT_PARAM_VALUE
      && load<u32>(h, C.HEADER_SIZE) >= <u32>C.PARAM_VALUE_SIZE) {
      setValue(load<u32>(h, C.PARAM_VALUE_PARAM_ID), load<f64>(h, C.PARAM_VALUE_VALUE));
    }
  }
}

// --- clap.state: magic, version, count, (id u32, value f64) per parameter, the plugin's bytes ------

function magic(): u32 {
  const m = changetype<Descriptor>(desc).stateMagic;
  return <u32>m.charCodeAt(0) | (<u32>m.charCodeAt(1) << 8) | (<u32>m.charCodeAt(2) << 16) | (<u32>m.charCodeAt(3) << 24);
}

function state_save(p: usize, s: usize): bool {
  if (s == 0) return false;
  const ps = plist();
  const vs = vals();
  const w = changetype<StateWriter>(writer);
  w.stream = s;
  w.ok = true;
  w.u32(magic());
  w.u32(changetype<Descriptor>(desc).stateVersion);
  w.u32(<u32>ps.length);
  for (let i = 0; i < ps.length; i++) { w.u32(ps[i].id); w.f64(vs[i]); }
  inst().saveState(w);
  return w.ok;
}

function state_load(p: usize, s: usize): bool {
  if (s == 0) return false;
  const r = changetype<StateReader>(reader);
  r.stream = s;
  r.ok = true;
  if (r.u32() != magic() || !r.ok) return false;
  const version = r.u32();
  if (!r.ok || version == 0 || version > changetype<Descriptor>(desc).stateVersion) return false;
  const n = r.u32();
  if (!r.ok || n > 512) return false;
  for (let i: u32 = 0; i < n; i++) {
    const id = r.u32();
    const v = r.f64();
    if (!r.ok) return false;
    setValue(id, v);
  }
  return inst().loadState(r, version) && r.ok;
}

// --- clap.audio-ports, clap.note-ports, clap.latency, clap.tail, clap.render ----------------------

function ports_count(p: usize, isInput: bool): u32 { return isInput && instrument ? 0 : 1; }

function ports_get(p: usize, index: u32, isInput: bool, info: usize): bool {
  if (index != 0 || info == 0 || (isInput && instrument)) return false;
  memory.fill(info, 0, C.AUDIO_PORT_INFO_SIZE);
  store<u32>(info, 0, C.AUDIO_PORT_INFO_ID);
  put(info + C.AUDIO_PORT_INFO_NAME, 256, 0, isInput ? "In" : "Out");
  store<u32>(info, C.CLAP_AUDIO_PORT_IS_MAIN, C.AUDIO_PORT_INFO_FLAGS);
  store<u32>(info, 2, C.AUDIO_PORT_INFO_CHANNEL_COUNT);
  store<usize>(info, stereo, C.AUDIO_PORT_INFO_PORT_TYPE);
  store<u32>(info, C.CLAP_INVALID_ID, C.AUDIO_PORT_INFO_IN_PLACE_PAIR);
  return true;
}

function notes_count(p: usize, isInput: bool): u32 { return isInput || noteIo ? 1 : 0; }

function notes_get(p: usize, index: u32, isInput: bool, info: usize): bool {
  if (index != 0 || !(isInput || noteIo) || info == 0) return false;
  memory.fill(info, 0, C.NOTE_PORT_INFO_SIZE);
  store<u32>(info, C.CLAP_NOTE_DIALECT_CLAP | C.CLAP_NOTE_DIALECT_MIDI, C.NOTE_PORT_INFO_SUPPORTED_DIALECTS);
  store<u32>(info, C.CLAP_NOTE_DIALECT_CLAP, C.NOTE_PORT_INFO_PREFERRED_DIALECT);
  put(info + C.NOTE_PORT_INFO_NAME, 256, 0, isInput ? "Notes" : "Notes out");
  return true;
}

function latency_get(p: usize): u32 { return inst().latency(); }
function tail_get(p: usize): u32 { return inst().tail(); }
function render_hard_rt(p: usize): bool { return false; }
function render_set(p: usize, mode: i32): bool { inst().setOffline(mode == C.CLAP_RENDER_OFFLINE); return true; }
