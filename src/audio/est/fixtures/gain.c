/*
 * EST Gain (EST Phase 1 fixture, docs/est/EST_Phase1_Work_Order.md §1.2): a CLAP plugin with one
 * stereo in and one stereo out port, a smoothed Gain parameter in dB (-60 to +12) and a Bypass flag,
 * clap.state save/load and clap.latency 0. trap.c and spin.c are this file with a fault on the
 * 100th process() (FIXTURE_FAULT_TRAP, FIXTURE_FAULT_SPIN); gainsimd.c is it with its samples
 * multiplied four at a time in fixed-width SIMD (FIXTURE_SIMD, built with -msimd128).
 */
#include "est_rt.h"
#if defined(FIXTURE_SIMD)
#include <wasm_simd128.h>
#endif

#ifndef FIXTURE_ID
#define FIXTURE_ID "org.cyber.est.gain"
#define FIXTURE_NAME "EST Gain"
#endif
#ifndef FIXTURE_FAULT_AT
#define FIXTURE_FAULT_AT 100
#endif

enum { PARAM_GAIN = 0, PARAM_BYPASS = 1, PARAM_COUNT = 2 };
#define GAIN_MIN -60.0
#define GAIN_MAX 12.0
#define STATE_MAGIC 0x47545345u /* "ESTG" */

typedef struct {
   clap_plugin_t plugin;
   const clap_host_t *host;
   double sample_rate;
   double gain_db, bypass;
   double target, current, coef;
   uint32_t blocks;
} gain_t;

static const char *const features[] = { CLAP_PLUGIN_FEATURE_AUDIO_EFFECT, CLAP_PLUGIN_FEATURE_UTILITY, CLAP_PLUGIN_FEATURE_STEREO, 0 };

static const clap_plugin_descriptor_t descriptor = {
   .clap_version = CLAP_VERSION_INIT,
   .id = FIXTURE_ID,
   .name = FIXTURE_NAME,
   .vendor = "Cyber",
   .url = "",
   .manual_url = "",
   .support_url = "",
   .version = "1.0.0",
   .description = "A gain and a bypass: the EST runtime's reference effect.",
   .features = features,
};

static double target_of(const gain_t *g) { return g->bypass >= 0.5 ? 1.0 : est_db_to_lin(g->gain_db); }

static void set_param(gain_t *g, clap_id id, double v) {
   if (id == PARAM_GAIN) g->gain_db = v < GAIN_MIN ? GAIN_MIN : v > GAIN_MAX ? GAIN_MAX : v;
   else if (id == PARAM_BYPASS) g->bypass = v >= 0.5 ? 1.0 : 0.0;
   g->target = target_of(g);
}

/* --- clap.params --- */

static uint32_t params_count(const clap_plugin_t *p) { (void)p; return PARAM_COUNT; }

static bool params_get_info(const clap_plugin_t *p, uint32_t index, clap_param_info_t *info) {
   (void)p;
   memset(info, 0, sizeof(*info));
   if (index == PARAM_GAIN) {
      info->id = PARAM_GAIN;
      info->flags = CLAP_PARAM_IS_AUTOMATABLE;
      est_strcpy(info->name, "Gain", sizeof(info->name));
      info->min_value = GAIN_MIN;
      info->max_value = GAIN_MAX;
      info->default_value = 0.0;
      return true;
   }
   if (index == PARAM_BYPASS) {
      info->id = PARAM_BYPASS;
      info->flags = CLAP_PARAM_IS_AUTOMATABLE | CLAP_PARAM_IS_STEPPED | CLAP_PARAM_IS_BYPASS;
      est_strcpy(info->name, "Bypass", sizeof(info->name));
      info->min_value = 0.0;
      info->max_value = 1.0;
      info->default_value = 0.0;
      return true;
   }
   return false;
}

static bool params_get_value(const clap_plugin_t *p, clap_id id, double *out) {
   const gain_t *g = (const gain_t *)p->plugin_data;
   if (id == PARAM_GAIN) { *out = g->gain_db; return true; }
   if (id == PARAM_BYPASS) { *out = g->bypass; return true; }
   return false;
}

static bool params_value_to_text(const clap_plugin_t *p, clap_id id, double v, char *out, uint32_t cap) {
   (void)p;
   if (id == PARAM_GAIN) { est_format(out, cap, v, "dB"); return true; }
   if (id == PARAM_BYPASS) { est_strcpy(out, v >= 0.5 ? "On" : "Off", cap); return true; }
   return false;
}

static bool params_text_to_value(const clap_plugin_t *p, clap_id id, const char *text, double *out) {
   (void)p;
   if (id == PARAM_BYPASS) { *out = est_streq(text, "On") ? 1.0 : 0.0; return true; }
   return id == PARAM_GAIN && est_parse(text, out);
}

static void handle_event(gain_t *g, const clap_event_header_t *h) {
   if (h && h->space_id == CLAP_CORE_EVENT_SPACE_ID && h->type == CLAP_EVENT_PARAM_VALUE) {
      const clap_event_param_value_t *e = (const clap_event_param_value_t *)h;
      set_param(g, e->param_id, e->value);
   }
}

static void handle_events(gain_t *g, const clap_input_events_t *in) {
   uint32_t n = in->size(in);
   for (uint32_t i = 0; i < n; i++) handle_event(g, in->get(in, i));
}

static void params_flush(const clap_plugin_t *p, const clap_input_events_t *in, const clap_output_events_t *out) {
   (void)out;
   handle_events((gain_t *)p->plugin_data, in);
}

static const clap_plugin_params_t ext_params = {
   .count = params_count,
   .get_info = params_get_info,
   .get_value = params_get_value,
   .value_to_text = params_value_to_text,
   .text_to_value = params_text_to_value,
   .flush = params_flush,
};

/* --- clap.state --- */

static bool state_save(const clap_plugin_t *p, const clap_ostream_t *s) {
   const gain_t *g = (const gain_t *)p->plugin_data;
   uint32_t head[2] = { STATE_MAGIC, 1 };
   double body[2] = { g->gain_db, g->bypass };
   return est_write_all(s, head, sizeof(head)) && est_write_all(s, body, sizeof(body));
}

static bool state_load(const clap_plugin_t *p, const clap_istream_t *s) {
   gain_t *g = (gain_t *)p->plugin_data;
   uint32_t head[2];
   double body[2];
   if (!est_read_all(s, head, sizeof(head)) || head[0] != STATE_MAGIC || head[1] != 1) return false;
   if (!est_read_all(s, body, sizeof(body))) return false;
   set_param(g, PARAM_GAIN, body[0]);
   set_param(g, PARAM_BYPASS, body[1]);
   return true;
}

static const clap_plugin_state_t ext_state = { .save = state_save, .load = state_load };

/* --- clap.latency, clap.audio-ports --- */

static uint32_t latency_get(const clap_plugin_t *p) { (void)p; return 0; }
static const clap_plugin_latency_t ext_latency = { .get = latency_get };

static uint32_t ports_count(const clap_plugin_t *p, bool is_input) { (void)p; (void)is_input; return 1; }
static bool ports_get(const clap_plugin_t *p, uint32_t index, bool is_input, clap_audio_port_info_t *info) {
   (void)p;
   if (index != 0) return false;
   memset(info, 0, sizeof(*info));
   info->id = 0;
   est_strcpy(info->name, is_input ? "In" : "Out", sizeof(info->name));
   info->flags = CLAP_AUDIO_PORT_IS_MAIN;
   info->channel_count = 2;
   info->port_type = CLAP_PORT_STEREO;
   info->in_place_pair = CLAP_INVALID_ID;
   return true;
}
static const clap_plugin_audio_ports_t ext_ports = { .count = ports_count, .get = ports_get };

/* --- The plugin --- */

static bool plugin_init(const clap_plugin_t *p) {
   gain_t *g = (gain_t *)p->plugin_data;
   g->gain_db = 0.0;
   g->bypass = 0.0;
   g->target = g->current = 1.0;
   return true;
}

static void plugin_destroy(const clap_plugin_t *p) { free(p->plugin_data); }

static bool plugin_activate(const clap_plugin_t *p, double sr, uint32_t min_frames, uint32_t max_frames) {
   (void)min_frames; (void)max_frames;
   gain_t *g = (gain_t *)p->plugin_data;
   g->sample_rate = sr;
   g->coef = 1.0 - est_exp(-1.0 / (0.005 * sr)); /* a 5 ms one-pole */
   g->current = g->target = target_of(g);
   g->blocks = 0;
   return true;
}

static void plugin_deactivate(const clap_plugin_t *p) { (void)p; }
static bool plugin_start(const clap_plugin_t *p) { (void)p; return true; }
static void plugin_stop(const clap_plugin_t *p) { (void)p; }
static void plugin_reset(const clap_plugin_t *p) { gain_t *g = (gain_t *)p->plugin_data; g->current = g->target; }

static clap_process_status plugin_process(const clap_plugin_t *p, const clap_process_t *proc) {
   gain_t *g = (gain_t *)p->plugin_data;
   g->blocks++;
#if defined(FIXTURE_FAULT_TRAP)
   if (g->blocks == FIXTURE_FAULT_AT) __builtin_trap();
#elif defined(FIXTURE_FAULT_SPIN)
   if (g->blocks == FIXTURE_FAULT_AT) {
      volatile uint32_t spin = 0;
      for (;;) spin++;
   }
#endif
   if (proc->audio_inputs_count < 1 || proc->audio_outputs_count < 1) return CLAP_PROCESS_ERROR;
   const clap_audio_buffer_t *in = &proc->audio_inputs[0];
   const clap_audio_buffer_t *out = &proc->audio_outputs[0];
   uint32_t chans = in->channel_count < out->channel_count ? in->channel_count : out->channel_count;
   uint32_t n = proc->frames_count, at = 0;
   /* Sample-accurate: each event applies from its own sample. */
   uint32_t count = proc->in_events->size(proc->in_events);
   for (uint32_t k = 0; k <= count; k++) {
      const clap_event_header_t *h = k < count ? proc->in_events->get(proc->in_events, k) : 0;
      uint32_t until = h ? (h->time < n ? h->time : n) : n;
#if defined(FIXTURE_SIMD)
      /* Four frames at a time: the four gains in scalar (the smoothing is a recurrence), the
       * samples as f32x4 (unaligned loads and stores: the host's buffers are 4-aligned only). */
      for (; at + 4 <= until; at += 4) {
         float k[4];
         for (int j = 0; j < 4; j++) {
            g->current += (g->target - g->current) * g->coef;
            k[j] = (float)g->current;
         }
         v128_t kv = wasm_v128_load(k);
         for (uint32_t c = 0; c < chans; c++) {
            wasm_v128_store(&out->data32[c][at], wasm_f32x4_mul(wasm_v128_load(&in->data32[c][at]), kv));
         }
      }
#endif
      for (; at < until; at++) {
         g->current += (g->target - g->current) * g->coef;
         for (uint32_t c = 0; c < chans; c++) out->data32[c][at] = (float)(in->data32[c][at] * g->current);
      }
      if (h) handle_event(g, h);
   }
   for (uint32_t c = chans; c < out->channel_count; c++) memset(out->data32[c], 0, n * sizeof(float));
   return CLAP_PROCESS_CONTINUE;
}

static const void *plugin_get_extension(const clap_plugin_t *p, const char *id) {
   (void)p;
   if (est_streq(id, CLAP_EXT_PARAMS)) return &ext_params;
   if (est_streq(id, CLAP_EXT_STATE)) return &ext_state;
   if (est_streq(id, CLAP_EXT_LATENCY)) return &ext_latency;
   if (est_streq(id, CLAP_EXT_AUDIO_PORTS)) return &ext_ports;
   return 0;
}

static void plugin_on_main_thread(const clap_plugin_t *p) { (void)p; }

/* --- The factory and the entry --- */

static uint32_t factory_count(const clap_plugin_factory_t *f) { (void)f; return 1; }
static const clap_plugin_descriptor_t *factory_descriptor(const clap_plugin_factory_t *f, uint32_t i) { (void)f; return i == 0 ? &descriptor : 0; }

static const clap_plugin_t *factory_create(const clap_plugin_factory_t *f, const clap_host_t *host, const char *id) {
   (void)f;
   if (!clap_version_is_compatible(host->clap_version) || !est_streq(id, descriptor.id)) return 0;
   gain_t *g = (gain_t *)malloc(sizeof(gain_t));
   if (!g) return 0;
   memset(g, 0, sizeof(*g));
   g->host = host;
   g->plugin.desc = &descriptor;
   g->plugin.plugin_data = g;
   g->plugin.init = plugin_init;
   g->plugin.destroy = plugin_destroy;
   g->plugin.activate = plugin_activate;
   g->plugin.deactivate = plugin_deactivate;
   g->plugin.start_processing = plugin_start;
   g->plugin.stop_processing = plugin_stop;
   g->plugin.reset = plugin_reset;
   g->plugin.process = plugin_process;
   g->plugin.get_extension = plugin_get_extension;
   g->plugin.on_main_thread = plugin_on_main_thread;
   return &g->plugin;
}

static const clap_plugin_factory_t factory = {
   .get_plugin_count = factory_count,
   .get_plugin_descriptor = factory_descriptor,
   .create_plugin = factory_create,
};

static bool entry_init(const char *path) { (void)path; return true; }
static void entry_deinit(void) {}
static const void *entry_get_factory(const char *id) { return est_streq(id, CLAP_PLUGIN_FACTORY_ID) ? &factory : 0; }

CLAP_EXPORT const clap_plugin_entry_t clap_entry = {
   .clap_version = CLAP_VERSION_INIT,
   .init = entry_init,
   .deinit = entry_deinit,
   .get_factory = entry_get_factory,
};
