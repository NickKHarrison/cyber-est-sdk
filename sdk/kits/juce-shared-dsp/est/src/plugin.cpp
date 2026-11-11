// The EST wrapper of the JUCE kit (sdk/docs/porting-juce.md): `est new cpp-clap`'s src/plugin.cpp
// with its DSP taken from ../dsp/SharedGain.h, the file the JUCE desktop build compiles too
// (est-build.json adds ../dsp to the include path). Only the two lines marked SHARED differ from
// the template: the CLAP side is the same for any plugin that keeps the template's shape.
//
//     est pack        # from this folder, or `cmake --build build --target est` from the kit's root
//     est validate    # the checks Cyber's install runs
//     est compare dist/<id>-<version>.est ../build/reference.wav --input ../build/input.wav
#define EST_RUNTIME_IMPL
#include <est/runtime.hpp>
#include "est_plugin.h"
#include "SharedGain.h"   // SHARED: the desktop build's DSP
namespace dsp { using Gain = shared::Gain; }   // SHARED: under the name the template uses

namespace {

// ---- The parameters: ids are stable for the plugin's life; never reuse or renumber one. ----

enum : clap_id { kParamGain = 0 };

struct ParamSpec {
   clap_id id;
   const char *name;
   const char *module;
   double min, max, def;
   uint32_t flags;
   const char *unit;
};

constexpr ParamSpec kParams[] = {
   { kParamGain, "Gain", "", dsp::Gain::kMinDb, dsp::Gain::kMaxDb, dsp::Gain::kDefaultDb, CLAP_PARAM_IS_AUTOMATABLE, "dB" },
};
constexpr uint32_t kParamCount = sizeof(kParams) / sizeof(kParams[0]);

// Every saved state starts with these four bytes; choose yours before you ship and never change
// them (raise kStateVersion instead when the bytes after them change).
constexpr uint32_t kStateMagic = 0x4e47534au; // "JSGN"
constexpr uint32_t kStateVersion = 1;

// ---- The plugin ----

struct Plugin {
   clap_plugin_t clap;
   const clap_host_t *host;
   dsp::Gain gain;
   double values[kParamCount];

   void setParam(clap_id id, double v) {
      if (id >= kParamCount) return;
      const ParamSpec &p = kParams[id];
      // Written so NaN fails the first test and becomes the minimum: no NaN reaches the DSP.
      if (!(v >= p.min)) v = p.min;
      if (v > p.max) v = p.max;
      values[id] = v;
      if (id == kParamGain) gain.setGainDb(v);
   }

   void handleEvent(const clap_event_header_t *h) {
      if (h->space_id != CLAP_CORE_EVENT_SPACE_ID) return;
      if (h->type == CLAP_EVENT_PARAM_VALUE) {
         auto *e = reinterpret_cast<const clap_event_param_value_t *>(h);
         setParam(e->param_id, e->value);
      }
   }

   // Sample accurate: the audio between two events, then the event, at its own frame.
   clap_process_status process(const clap_process_t *proc) {
      if (proc->audio_inputs_count < 1 || proc->audio_outputs_count < 1) return CLAP_PROCESS_ERROR;
      const clap_audio_buffer_t &in = proc->audio_inputs[0];
      const clap_audio_buffer_t &out = proc->audio_outputs[0];
      const uint32_t channels = in.channel_count < out.channel_count ? in.channel_count : out.channel_count;
      const uint32_t frames = proc->frames_count;
      const uint32_t count = proc->in_events->size(proc->in_events);
      uint32_t at = 0;
      for (uint32_t k = 0; k <= count; k++) {
         const clap_event_header_t *h = k < count ? proc->in_events->get(proc->in_events, k) : nullptr;
         const uint32_t until = h ? (h->time < frames ? h->time : frames) : frames;
         if (until > at) gain.process(in.data32, out.data32, channels, at, until);
         if (until > at) at = until;
         if (h) handleEvent(h);
      }
      for (uint32_t c = channels; c < out.channel_count; c++) memset(out.data32[c], 0, frames * sizeof(float));
      return CLAP_PROCESS_CONTINUE;
   }
};

Plugin *self(const clap_plugin_t *p) { return static_cast<Plugin *>(p->plugin_data); }

// ---- clap.params ----

uint32_t paramsCount(const clap_plugin_t *) { return kParamCount; }

bool paramsInfo(const clap_plugin_t *, uint32_t index, clap_param_info_t *info) {
   if (index >= kParamCount) return false;
   const ParamSpec &p = kParams[index];
   memset(info, 0, sizeof(*info));
   info->id = p.id;
   info->flags = p.flags;
   est::strcpy(info->name, p.name, sizeof(info->name));
   est::strcpy(info->module, p.module, sizeof(info->module));
   info->min_value = p.min;
   info->max_value = p.max;
   info->default_value = p.def;
   return true;
}

bool paramsValue(const clap_plugin_t *plugin, clap_id id, double *out) {
   if (id >= kParamCount) return false;
   *out = self(plugin)->values[id];
   return true;
}

// "-6.0 dB": one decimal and the unit.
void formatValue(char *out, uint32_t cap, double v, const char *unit) {
   char buf[64];
   int i = 0;
   if (v < 0) { buf[i++] = '-'; v = -v; }
   long long tenths = (long long)(v * 10.0 + 0.5), whole = tenths / 10;
   char digits[24];
   int d = 0;
   do { digits[d++] = (char)('0' + whole % 10); whole /= 10; } while (whole && d < 20);
   while (d) buf[i++] = digits[--d];
   buf[i++] = '.';
   buf[i++] = (char)('0' + tenths % 10);
   if (unit && *unit) { buf[i++] = ' '; while (*unit && i < 62) buf[i++] = *unit++; }
   buf[i] = 0;
   est::strcpy(out, buf, cap);
}

bool paramsToText(const clap_plugin_t *, clap_id id, double v, char *out, uint32_t cap) {
   if (id >= kParamCount) return false;
   formatValue(out, cap, v, kParams[id].unit);
   return true;
}

bool paramsFromText(const clap_plugin_t *, clap_id id, const char *s, double *out) {
   if (id >= kParamCount || !s) return false;
   while (*s == ' ') s++;
   double sign = 1.0, v = 0.0, scale = 0.0;
   bool any = false;
   if (*s == '-') { sign = -1.0; s++; } else if (*s == '+') s++;
   for (; *s; s++) {
      if (*s >= '0' && *s <= '9') {
         any = true;
         if (scale > 0) { v += (*s - '0') * scale; scale /= 10.0; } else v = v * 10.0 + (*s - '0');
      } else if (*s == '.' && scale == 0) scale = 0.1;
      else break;
   }
   if (any) *out = sign * v;
   return any;
}

// Parameter changes while the plugin is not processing.
void paramsFlush(const clap_plugin_t *plugin, const clap_input_events_t *in, const clap_output_events_t *) {
   const uint32_t n = in->size(in);
   for (uint32_t i = 0; i < n; i++) self(plugin)->handleEvent(in->get(in, i));
}

const clap_plugin_params_t kExtParams = { paramsCount, paramsInfo, paramsValue, paramsToText, paramsFromText, paramsFlush };

// ---- clap.state: the magic, the version, then every parameter ----

bool stateSave(const clap_plugin_t *plugin, const clap_ostream_t *s) {
   const uint32_t head[3] = { kStateMagic, kStateVersion, kParamCount };
   return est::write_all(s, head, sizeof(head)) && est::write_all(s, self(plugin)->values, sizeof(self(plugin)->values));
}

bool stateLoad(const clap_plugin_t *plugin, const clap_istream_t *s) {
   uint32_t head[3];
   if (!est::read_all(s, head, sizeof(head)) || head[0] != kStateMagic || head[1] != kStateVersion || head[2] != kParamCount) return false;
   double v[kParamCount];
   if (!est::read_all(s, v, sizeof(v))) return false;
   for (uint32_t i = 0; i < kParamCount; i++) self(plugin)->setParam(kParams[i].id, v[i]);
   return true;
}

const clap_plugin_state_t kExtState = { stateSave, stateLoad };

// ---- clap.audio-ports and clap.latency ----

uint32_t portsCount(const clap_plugin_t *, bool) { return 1; }

bool portsGet(const clap_plugin_t *, uint32_t index, bool isInput, clap_audio_port_info_t *info) {
   if (index != 0) return false;
   memset(info, 0, sizeof(*info));
   info->id = 0;
   est::strcpy(info->name, isInput ? "In" : "Out", sizeof(info->name));
   info->flags = CLAP_AUDIO_PORT_IS_MAIN;
   info->channel_count = 2;
   info->port_type = CLAP_PORT_STEREO;
   info->in_place_pair = CLAP_INVALID_ID;
   return true;
}

const clap_plugin_audio_ports_t kExtPorts = { portsCount, portsGet };

uint32_t latencyGet(const clap_plugin_t *) { return 0; }
const clap_plugin_latency_t kExtLatency = { latencyGet };

// ---- The plugin's functions ----

bool pluginInit(const clap_plugin_t *plugin) {
   Plugin *p = self(plugin);
   for (uint32_t i = 0; i < kParamCount; i++) p->setParam(kParams[i].id, kParams[i].def);
   return true;
}

void pluginDestroy(const clap_plugin_t *plugin) {
   Plugin *p = self(plugin);
   p->~Plugin();
   free(p);
}

bool pluginActivate(const clap_plugin_t *plugin, double sampleRate, uint32_t, uint32_t) {
   self(plugin)->gain.prepare(sampleRate); // the place to allocate (delay lines, tables): never in process
   return true;
}

void pluginDeactivate(const clap_plugin_t *) {}
bool pluginStart(const clap_plugin_t *) { return true; }
void pluginStop(const clap_plugin_t *) {}
void pluginReset(const clap_plugin_t *plugin) { self(plugin)->gain.reset(); }
clap_process_status pluginProcess(const clap_plugin_t *plugin, const clap_process_t *proc) { return self(plugin)->process(proc); }

const void *pluginExtension(const clap_plugin_t *, const char *id) {
   if (est::streq(id, CLAP_EXT_PARAMS)) return &kExtParams;
   if (est::streq(id, CLAP_EXT_STATE)) return &kExtState;
   if (est::streq(id, CLAP_EXT_AUDIO_PORTS)) return &kExtPorts;
   if (est::streq(id, CLAP_EXT_LATENCY)) return &kExtLatency;
   return nullptr;
}

void pluginOnMainThread(const clap_plugin_t *) {}

// ---- The descriptor, the factory and the entry ----

const char *const kFeatures[] = { EST_PLUGIN_FEATURES nullptr };

const clap_plugin_descriptor_t kDescriptor = {
   CLAP_VERSION_INIT, EST_PLUGIN_ID, EST_PLUGIN_NAME, EST_PLUGIN_VENDOR, EST_PLUGIN_URL, "", "",
   EST_PLUGIN_VERSION, EST_PLUGIN_DESCRIPTION, kFeatures,
};

uint32_t factoryCount(const clap_plugin_factory_t *) { return 1; }
const clap_plugin_descriptor_t *factoryDescriptor(const clap_plugin_factory_t *, uint32_t i) { return i == 0 ? &kDescriptor : nullptr; }

const clap_plugin_t *factoryCreate(const clap_plugin_factory_t *, const clap_host_t *host, const char *id) {
   if (!clap_version_is_compatible(host->clap_version) || !est::streq(id, kDescriptor.id)) return nullptr;
   void *mem = malloc(sizeof(Plugin));
   if (!mem) return nullptr;
   memset(mem, 0, sizeof(Plugin));
   Plugin *p = new (mem) Plugin();
   p->host = host;
   p->clap = { &kDescriptor, p, pluginInit, pluginDestroy, pluginActivate, pluginDeactivate, pluginStart, pluginStop,
               pluginReset, pluginProcess, pluginExtension, pluginOnMainThread };
   return &p->clap;
}

const clap_plugin_factory_t kFactory = { factoryCount, factoryDescriptor, factoryCreate };

bool entryInit(const char *) { return true; }
void entryDeinit() {}
const void *entryFactory(const char *id) { return est::streq(id, CLAP_PLUGIN_FACTORY_ID) ? &kFactory : nullptr; }

} // namespace

// The one symbol a CLAP module exports (WCLAP's shape: a global holding the entry's address).
extern "C" CLAP_EXPORT const clap_plugin_entry_t clap_entry = { CLAP_VERSION_INIT, entryInit, entryDeinit, entryFactory };

// What EST changes from a desktop CLAP plugin (sdk/docs/porting-cpp.md has the list):
// - one thread: every main-thread call runs on the audio thread between blocks (no clap.thread-pool);
// - no clap.gui: a UI is a web page in a sandboxed frame (ui/, @est/ui), or Cyber's generated knobs;
// - no files, no sockets, no clock, no random numbers in process: state, presets and bundle assets;
// - no libc or libm: est/runtime.hpp (memset, memcpy, malloc, free, new, delete, the maths);
// - no exceptions and no RTTI (-fno-exceptions -fno-rtti), memory with est.json's maximum.
