/*
 * EST 1.1 fixtures (1.327, DEV-H, D-56): four small CLAP plugins from one file, chosen by a define,
 * each exercising one thing EST 1.1 adds. Deterministic (no randomness, no clock); no state beyond
 * their one parameter. Built by scripts/est-fixtures.sh.
 *
 *   FIX_DUCK  "EST Key Duck"    effect: stereo in, a stereo sidechain (input port 1), out = in · 1 /
 *             (1 + 8 · |key|), followed by a one-pole; a Gain (dB, -24…+12) that is modulatable
 *             (CLAP_PARAM_IS_MODULATABLE): `PARAM_MOD` adds its amount to the Gain while it holds.
 *   FIX_MULTI "EST Multi Drums" instrument: one 8-channel output port (four stereo pairs); a note's
 *             key mod 4 picks the pair it sounds on (a decaying 220·2^(pair/4) Hz sine), so a host's
 *             multi-out routing shows on separate strips.
 *   FIX_ECHO  "EST Note Echo"   instrument with a note output: silent itself; each note on, off and
 *             choke it gets is pushed out an octave up (key + 12) at the same sample.
 *   FIX_TONE  "EST Note Tone"   effect with a note input: its audio input passed through, plus a sine
 *             at each held note's key (one voice, -12 dBFS), so a note-out plugin before it is heard.
 */
#include "est_rt.h"

#if defined(FIX_DUCK)
#define FIX_ID "org.cyber.est.keyduck"
#define FIX_NAME "EST Key Duck"
#define FIX_INSTRUMENT 0
#elif defined(FIX_MULTI)
#define FIX_ID "org.cyber.est.multidrums"
#define FIX_NAME "EST Multi Drums"
#define FIX_INSTRUMENT 1
#elif defined(FIX_ECHO)
#define FIX_ID "org.cyber.est.noteecho"
#define FIX_NAME "EST Note Echo"
#define FIX_INSTRUMENT 1
#elif defined(FIX_TONE)
#define FIX_ID "org.cyber.est.notetone"
#define FIX_NAME "EST Note Tone"
#define FIX_INSTRUMENT 0
#else
#error "define one of FIX_DUCK, FIX_MULTI, FIX_ECHO, FIX_TONE"
#endif

#define GAIN_MIN -24.0
#define GAIN_MAX 12.0
#define STATE_MAGIC 0x31315345u /* "ES11" */
#define PAIRS 4

typedef struct {
   clap_plugin_t plugin;
   const clap_host_t *host;
   double sample_rate;
   double gain_db, mod_db;
   double env;
   /* FIX_MULTI: per pair, the phase, the step and the level; FIX_TONE: pair 0 is the one voice. */
   double phase[PAIRS], step[PAIRS], level[PAIRS], decay[PAIRS];
   int16_t key;
} fx_t;

#if FIX_INSTRUMENT
static const char *const features[] = { CLAP_PLUGIN_FEATURE_INSTRUMENT, 0 };
#else
static const char *const features[] = { CLAP_PLUGIN_FEATURE_AUDIO_EFFECT, CLAP_PLUGIN_FEATURE_STEREO, 0 };
#endif

static const clap_plugin_descriptor_t descriptor = {
   .clap_version = CLAP_VERSION_INIT,
   .id = FIX_ID,
   .name = FIX_NAME,
   .vendor = "Cyber",
   .url = "",
   .manual_url = "",
   .support_url = "",
   .version = "1.1.0",
   .description = "An EST 1.1 fixture.",
   .features = features,
};

/* 440 · 2^((key - 69) / 12), by est_exp. */
static double key_hz(double key) { return 440.0 * est_exp((key - 69.0) / 12.0 * EST_LN2); }

/* --- clap.params: one Gain (modulatable on the duck) --- */

static uint32_t params_count(const clap_plugin_t *p) { (void)p; return 1; }
static bool params_get_info(const clap_plugin_t *p, uint32_t index, clap_param_info_t *info) {
   (void)p;
   if (index != 0) return false;
   memset(info, 0, sizeof(*info));
   info->id = 0;
   info->flags = CLAP_PARAM_IS_AUTOMATABLE
#if defined(FIX_DUCK)
      | CLAP_PARAM_IS_MODULATABLE
#endif
      ;
   est_strcpy(info->name, "Gain", sizeof(info->name));
   info->min_value = GAIN_MIN;
   info->max_value = GAIN_MAX;
   info->default_value = 0.0;
   return true;
}
static bool params_get_value(const clap_plugin_t *p, clap_id id, double *out) {
   const fx_t *g = (const fx_t *)p->plugin_data;
   if (id != 0) return false;
   *out = g->gain_db;
   return true;
}
static bool params_value_to_text(const clap_plugin_t *p, clap_id id, double v, char *out, uint32_t cap) { (void)p; if (id != 0) return false; est_format(out, cap, v, "dB"); return true; }
static bool params_text_to_value(const clap_plugin_t *p, clap_id id, const char *text, double *out) { (void)p; return id == 0 && est_parse(text, out); }

static void set_gain(fx_t *g, double v) { g->gain_db = v < GAIN_MIN ? GAIN_MIN : v > GAIN_MAX ? GAIN_MAX : v; }

static void note_on(fx_t *g, int16_t key) {
#if defined(FIX_MULTI)
   int pair = key % PAIRS;
   g->phase[pair] = 0.0;
   g->step[pair] = 2.0 * EST_PI * 220.0 * est_exp(pair / 4.0 * EST_LN2) / g->sample_rate;
   g->level[pair] = 0.5;
   g->decay[pair] = 0.99993;
#elif defined(FIX_TONE)
   g->key = key;
   g->phase[0] = 0.0;
   g->step[0] = 2.0 * EST_PI * key_hz(key) / g->sample_rate;
   g->level[0] = 0.25;
#else
   (void)g; (void)key;
#endif
}

static void note_off(fx_t *g, int16_t key) {
#if defined(FIX_MULTI)
   /* A release: the pair (or every pair, for a wildcard) falls 60 dB in about 0.15 s. */
   for (int pair = 0; pair < PAIRS; pair++) if (key < 0 || key % PAIRS == pair) g->decay[pair] = 0.999;
#elif defined(FIX_TONE)
   if (key == g->key || key < 0) g->level[0] = 0.0;
#else
   (void)g; (void)key;
#endif
}

#if defined(FIX_ECHO)
/* An octave up, at the same sample, through out_events. */
static void echo(const clap_event_note_t *n, const clap_output_events_t *out) {
   clap_event_note_t e = *n;
   if (e.key >= 0) e.key = (int16_t)(e.key + 12 > 127 ? 127 : e.key + 12);
   e.note_id = -1;
   out->try_push(out, &e.header);
}
#endif

static void handle_event(fx_t *g, const clap_event_header_t *h, const clap_output_events_t *out) {
   (void)out;
   if (!h || h->space_id != CLAP_CORE_EVENT_SPACE_ID) return;
   if (h->type == CLAP_EVENT_PARAM_VALUE) {
      const clap_event_param_value_t *e = (const clap_event_param_value_t *)h;
      if (e->param_id == 0) set_gain(g, e->value);
   } else if (h->type == CLAP_EVENT_PARAM_MOD) {
      const clap_event_param_mod_t *e = (const clap_event_param_mod_t *)h;
      if (e->param_id == 0) g->mod_db = e->amount;
   } else if (h->type == CLAP_EVENT_NOTE_ON || h->type == CLAP_EVENT_NOTE_OFF || h->type == CLAP_EVENT_NOTE_CHOKE) {
      const clap_event_note_t *n = (const clap_event_note_t *)h;
#if defined(FIX_ECHO)
      echo(n, out);
#endif
      if (h->type == CLAP_EVENT_NOTE_ON) note_on(g, n->key);
      else note_off(g, n->key);
   }
}

static void params_flush(const clap_plugin_t *p, const clap_input_events_t *in, const clap_output_events_t *out) {
   fx_t *g = (fx_t *)p->plugin_data;
   uint32_t n = in->size(in);
   for (uint32_t i = 0; i < n; i++) handle_event(g, in->get(in, i), out);
}

static const clap_plugin_params_t ext_params = {
   .count = params_count, .get_info = params_get_info, .get_value = params_get_value,
   .value_to_text = params_value_to_text, .text_to_value = params_text_to_value, .flush = params_flush,
};

/* --- clap.state --- */

static bool state_save(const clap_plugin_t *p, const clap_ostream_t *s) {
   const fx_t *g = (const fx_t *)p->plugin_data;
   uint32_t head[2] = { STATE_MAGIC, 1 };
   return est_write_all(s, head, sizeof(head)) && est_write_all(s, &g->gain_db, sizeof(double));
}
static bool state_load(const clap_plugin_t *p, const clap_istream_t *s) {
   fx_t *g = (fx_t *)p->plugin_data;
   uint32_t head[2];
   double v;
   if (!est_read_all(s, head, sizeof(head)) || head[0] != STATE_MAGIC || head[1] != 1 || !est_read_all(s, &v, sizeof(v))) return false;
   set_gain(g, v);
   return true;
}
static const clap_plugin_state_t ext_state = { .save = state_save, .load = state_load };

/* --- clap.audio-ports --- */

static uint32_t audio_count(const clap_plugin_t *p, bool is_input) {
   (void)p;
#if defined(FIX_DUCK)
   return is_input ? 2 : 1;
#else
   return is_input ? (FIX_INSTRUMENT ? 0 : 1) : 1;
#endif
}
static bool audio_get(const clap_plugin_t *p, uint32_t index, bool is_input, clap_audio_port_info_t *info) {
   (void)p;
   if (index >= audio_count(p, is_input)) return false;
   memset(info, 0, sizeof(*info));
   info->id = index;
   est_strcpy(info->name, is_input ? (index ? "Key" : "In") : "Out", sizeof(info->name));
   info->flags = index ? 0 : CLAP_AUDIO_PORT_IS_MAIN;
#if defined(FIX_MULTI)
   info->channel_count = 2 * PAIRS;
   info->port_type = 0;
#else
   info->channel_count = 2;
   info->port_type = CLAP_PORT_STEREO;
#endif
   info->in_place_pair = CLAP_INVALID_ID;
   return true;
}
static const clap_plugin_audio_ports_t ext_audio = { .count = audio_count, .get = audio_get };

/* --- clap.tail (Multi Drums: its release) --- */

#if defined(FIX_MULTI)
static uint32_t tail_get(const clap_plugin_t *p) { const fx_t *g = (const fx_t *)p->plugin_data; return (uint32_t)(0.25 * g->sample_rate); }
static const clap_plugin_tail_t ext_tail = { .get = tail_get };
#endif

/* --- clap.note-ports --- */

static uint32_t notes_count(const clap_plugin_t *p, bool is_input) {
   (void)p;
#if defined(FIX_ECHO)
   (void)is_input;
   return 1;
#elif defined(FIX_DUCK)
   (void)is_input;
   return 0;
#else
   return is_input ? 1 : 0;
#endif
}
static bool notes_get(const clap_plugin_t *p, uint32_t index, bool is_input, clap_note_port_info_t *info) {
   if (index >= notes_count(p, is_input)) return false;
   memset(info, 0, sizeof(*info));
   info->id = 0;
   info->supported_dialects = CLAP_NOTE_DIALECT_CLAP;
   info->preferred_dialect = CLAP_NOTE_DIALECT_CLAP;
   est_strcpy(info->name, is_input ? "Notes" : "Notes out", sizeof(info->name));
   return true;
}
static const clap_plugin_note_ports_t ext_notes = { .count = notes_count, .get = notes_get };

/* --- The plugin --- */

static bool plugin_init(const clap_plugin_t *p) { fx_t *g = (fx_t *)p->plugin_data; g->gain_db = 0.0; return true; }
static void plugin_destroy(const clap_plugin_t *p) { free(p->plugin_data); }
static bool plugin_activate(const clap_plugin_t *p, double sr, uint32_t a, uint32_t b) {
   (void)a; (void)b;
   fx_t *g = (fx_t *)p->plugin_data;
   g->sample_rate = sr;
   g->env = 0.0;
   for (int k = 0; k < PAIRS; k++) g->level[k] = 0.0;
   return true;
}
static void plugin_deactivate(const clap_plugin_t *p) { (void)p; }
static bool plugin_start(const clap_plugin_t *p) { (void)p; return true; }
static void plugin_stop(const clap_plugin_t *p) { (void)p; }
static void plugin_reset(const clap_plugin_t *p) { (void)p; }

/* One frame of output into `out` at `i`. */
static void render_frame(fx_t *g, const clap_process_t *proc, uint32_t i) {
   const clap_audio_buffer_t *out = &proc->audio_outputs[0];
#if defined(FIX_DUCK)
   const clap_audio_buffer_t *in = &proc->audio_inputs[0];
   double key = 0.0;
   if (proc->audio_inputs_count > 1) {
      const clap_audio_buffer_t *sc = &proc->audio_inputs[1];
      for (uint32_t c = 0; c < sc->channel_count; c++) { double v = sc->data32[c][i]; key += v < 0 ? -v : v; }
   }
   g->env += (key - g->env) * 0.002;
   double k = est_db_to_lin(g->gain_db + g->mod_db) / (1.0 + 8.0 * g->env);
   for (uint32_t c = 0; c < out->channel_count; c++) out->data32[c][i] = (float)(in->data32[c < in->channel_count ? c : 0][i] * k);
#elif defined(FIX_MULTI)
   double gain = est_db_to_lin(g->gain_db);
   for (int pair = 0; pair < PAIRS; pair++) {
      float v = 0.0f;
      if (g->level[pair] > 1e-5) {
         v = (float)(est_sin(g->phase[pair]) * g->level[pair] * gain);
         g->phase[pair] += g->step[pair];
         if (g->phase[pair] > 2.0 * EST_PI) g->phase[pair] -= 2.0 * EST_PI;
         g->level[pair] *= g->decay[pair];
      }
      out->data32[2 * pair][i] = v;
      out->data32[2 * pair + 1][i] = v;
   }
#elif defined(FIX_ECHO)
   (void)g;
   for (uint32_t c = 0; c < out->channel_count; c++) out->data32[c][i] = 0.0f;
#else /* FIX_TONE */
   const clap_audio_buffer_t *in = &proc->audio_inputs[0];
   float t = 0.0f;
   if (g->level[0] > 0.0) {
      t = (float)(est_sin(g->phase[0]) * g->level[0] * est_db_to_lin(g->gain_db));
      g->phase[0] += g->step[0];
      if (g->phase[0] > 2.0 * EST_PI) g->phase[0] -= 2.0 * EST_PI;
   }
   for (uint32_t c = 0; c < out->channel_count; c++) out->data32[c][i] = in->data32[c < in->channel_count ? c : 0][i] + t;
#endif
}

static clap_process_status plugin_process(const clap_plugin_t *p, const clap_process_t *proc) {
   fx_t *g = (fx_t *)p->plugin_data;
   if (proc->audio_outputs_count < 1) return CLAP_PROCESS_ERROR;
   if (!FIX_INSTRUMENT && proc->audio_inputs_count < 1) return CLAP_PROCESS_ERROR;
   uint32_t n = proc->frames_count, at = 0;
   uint32_t count = proc->in_events->size(proc->in_events);
   for (uint32_t k = 0; k <= count; k++) {
      const clap_event_header_t *h = k < count ? proc->in_events->get(proc->in_events, k) : 0;
      uint32_t until = h ? (h->time < n ? h->time : n) : n;
      for (; at < until; at++) render_frame(g, proc, at);
      if (h) handle_event(g, h, proc->out_events);
   }
   return CLAP_PROCESS_CONTINUE;
}

static const void *plugin_get_extension(const clap_plugin_t *p, const char *id) {
   (void)p;
   if (est_streq(id, CLAP_EXT_PARAMS)) return &ext_params;
   if (est_streq(id, CLAP_EXT_STATE)) return &ext_state;
   if (est_streq(id, CLAP_EXT_AUDIO_PORTS)) return &ext_audio;
   if (est_streq(id, CLAP_EXT_NOTE_PORTS)) return &ext_notes;
#if defined(FIX_MULTI)
   if (est_streq(id, CLAP_EXT_TAIL)) return &ext_tail;
#endif
   return 0;
}
static void plugin_on_main_thread(const clap_plugin_t *p) { (void)p; }

/* --- The factory and the entry --- */

static uint32_t factory_count(const clap_plugin_factory_t *f) { (void)f; return 1; }
static const clap_plugin_descriptor_t *factory_descriptor(const clap_plugin_factory_t *f, uint32_t i) { (void)f; return i == 0 ? &descriptor : 0; }
static const clap_plugin_t *factory_create(const clap_plugin_factory_t *f, const clap_host_t *host, const char *id) {
   (void)f;
   if (!clap_version_is_compatible(host->clap_version) || !est_streq(id, descriptor.id)) return 0;
   fx_t *g = (fx_t *)malloc(sizeof(fx_t));
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
static const clap_plugin_factory_t factory = { .get_plugin_count = factory_count, .get_plugin_descriptor = factory_descriptor, .create_plugin = factory_create };

static bool entry_init(const char *path) { (void)path; return true; }
static void entry_deinit(void) {}
static const void *entry_get_factory(const char *id) { return est_streq(id, CLAP_PLUGIN_FACTORY_ID) ? &factory : 0; }

CLAP_EXPORT const clap_plugin_entry_t clap_entry = {
   .clap_version = CLAP_VERSION_INIT,
   .init = entry_init,
   .deinit = entry_deinit,
   .get_factory = entry_get_factory,
};
