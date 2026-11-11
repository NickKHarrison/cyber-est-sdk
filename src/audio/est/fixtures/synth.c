/*
 * EST Synth (EST Phase 1 fixture, docs/est/EST_Phase1_Work_Order.md §1.2): a tiny polyphonic sine
 * instrument, to prove note events. One CLAP note input port, one stereo audio output, 8 voices
 * (the oldest is stolen), note on/off/choke handled at their sample, a linear attack and release,
 * a tail of the release time, CLAP_EVENT_NOTE_END reported when a voice finishes. Parameters:
 * Level in dB (-60 to 0) and Release in ms (10 to 2000). synth-trap.c is it with a trap
 * (FIXTURE_FAULT_TRAP: on the FIXTURE_FAULT_AT-th block after its first note-on).
 */
#include "est_rt.h"

#ifndef FIXTURE_ID
#define FIXTURE_ID "org.cyber.est.synth"
#define FIXTURE_NAME "EST Synth"
#define FIXTURE_WHAT "Eight sine voices: the EST runtime's note-event fixture."
#endif
#ifndef FIXTURE_FAULT_AT
#define FIXTURE_FAULT_AT 100
#endif

#define VOICES 8
enum { PARAM_LEVEL = 0, PARAM_RELEASE = 1, PARAM_COUNT = 2 };
#define STATE_MAGIC 0x53545345u /* "ESTS" */

typedef struct {
   int active, releasing;
   int32_t note_id;
   int16_t port, channel, key;
   double phase, inc, env, attack_step, release_step, velocity;
   uint32_t age;
} voice_t;

typedef struct {
   clap_plugin_t plugin;
   const clap_host_t *host;
   double sample_rate;
   double level_db, release_ms, level;
   voice_t voices[VOICES];
   uint32_t clock;
#if defined(FIXTURE_FAULT_TRAP)
   int noted;            /* a note-on has arrived */
   uint32_t since_note;  /* blocks since the first note-on's */
#endif
} synth_t;

static const char *const features[] = { CLAP_PLUGIN_FEATURE_INSTRUMENT, CLAP_PLUGIN_FEATURE_SYNTHESIZER, CLAP_PLUGIN_FEATURE_STEREO, 0 };

static const clap_plugin_descriptor_t descriptor = {
   .clap_version = CLAP_VERSION_INIT,
   .id = FIXTURE_ID,
   .name = FIXTURE_NAME,
   .vendor = "Cyber",
   .url = "",
   .manual_url = "",
   .support_url = "",
   .version = "1.0.0",
   .description = FIXTURE_WHAT,
   .features = features,
};

static void set_param(synth_t *s, clap_id id, double v) {
   if (id == PARAM_LEVEL) {
      s->level_db = v < -60.0 ? -60.0 : v > 0.0 ? 0.0 : v;
      s->level = est_db_to_lin(s->level_db);
   } else if (id == PARAM_RELEASE) {
      s->release_ms = v < 10.0 ? 10.0 : v > 2000.0 ? 2000.0 : v;
   }
}

/* key → phase increment (radians per sample), 2^((key - 69) / 12) * 440 Hz. */
static double key_inc(double key, double sr) {
   double hz = 440.0 * est_exp((key - 69.0) / 12.0 * EST_LN2);
   return 2.0 * EST_PI * hz / sr;
}

static int voice_matches(const voice_t *v, const clap_event_note_t *e) {
   if (!v->active) return 0;
   if (e->note_id != -1) return v->note_id == e->note_id;
   return (e->key == -1 || v->key == e->key) && (e->channel == -1 || v->channel == e->channel) && (e->port_index == -1 || v->port == e->port_index);
}

static void note_end(synth_t *s, const voice_t *v, const clap_output_events_t *out, uint32_t time) {
   (void)s;
   clap_event_note_t e;
   memset(&e, 0, sizeof(e));
   e.header.size = sizeof(e);
   e.header.time = time;
   e.header.space_id = CLAP_CORE_EVENT_SPACE_ID;
   e.header.type = CLAP_EVENT_NOTE_END;
   e.note_id = v->note_id;
   e.port_index = v->port;
   e.channel = v->channel;
   e.key = v->key;
   out->try_push(out, &e.header);
}

static void handle_event(synth_t *s, const clap_event_header_t *h, const clap_output_events_t *out) {
   if (h->space_id != CLAP_CORE_EVENT_SPACE_ID) return;
   if (h->type == CLAP_EVENT_PARAM_VALUE) {
      const clap_event_param_value_t *e = (const clap_event_param_value_t *)h;
      set_param(s, e->param_id, e->value);
      return;
   }
   if (h->type != CLAP_EVENT_NOTE_ON && h->type != CLAP_EVENT_NOTE_OFF && h->type != CLAP_EVENT_NOTE_CHOKE) return;
   const clap_event_note_t *e = (const clap_event_note_t *)h;
   if (h->type == CLAP_EVENT_NOTE_ON) {
      voice_t *v = 0;
      for (int i = 0; i < VOICES && !v; i++) if (!s->voices[i].active) v = &s->voices[i];
      if (!v) { /* steal the oldest */
         v = &s->voices[0];
         for (int i = 1; i < VOICES; i++) if (s->voices[i].age < v->age) v = &s->voices[i];
         note_end(s, v, out, h->time);
      }
      v->active = 1;
      v->releasing = 0;
      v->note_id = e->note_id;
      v->port = e->port_index;
      v->channel = e->channel;
      v->key = e->key;
      v->phase = 0.0;
      v->inc = key_inc(e->key, s->sample_rate);
      v->env = 0.0;
      v->attack_step = 1.0 / (0.005 * s->sample_rate);
      v->velocity = e->velocity <= 0 ? 0.0 : e->velocity > 1 ? 1.0 : e->velocity;
      v->age = ++s->clock;
      return;
   }
   for (int i = 0; i < VOICES; i++) {
      voice_t *v = &s->voices[i];
      if (!voice_matches(v, e)) continue;
      if (h->type == CLAP_EVENT_NOTE_CHOKE) {
         v->active = 0;
      } else if (!v->releasing) {
         v->releasing = 1;
         v->release_step = (v->env > 0 ? v->env : 1.0) / (s->release_ms * 0.001 * s->sample_rate);
      }
   }
}

static void render(synth_t *s, float *l, float *r, uint32_t from, uint32_t to, const clap_output_events_t *out) {
   for (uint32_t i = from; i < to; i++) { l[i] = 0.0f; r[i] = 0.0f; }
   for (int k = 0; k < VOICES; k++) {
      voice_t *v = &s->voices[k];
      if (!v->active) continue;
      for (uint32_t i = from; i < to; i++) {
         if (v->releasing) {
            v->env -= v->release_step;
            if (v->env <= 0.0) {
               v->active = 0;
               note_end(s, v, out, i);
               break;
            }
         } else if (v->env < 1.0) {
            v->env += v->attack_step;
            if (v->env > 1.0) v->env = 1.0;
         }
         float y = (float)(est_sin(v->phase) * v->env * v->velocity * s->level * 0.25);
         v->phase += v->inc;
         if (v->phase > 2.0 * EST_PI) v->phase -= 2.0 * EST_PI;
         l[i] += y;
         r[i] += y;
      }
   }
}

/* --- clap.params --- */

static uint32_t params_count(const clap_plugin_t *p) { (void)p; return PARAM_COUNT; }

static bool params_get_info(const clap_plugin_t *p, uint32_t index, clap_param_info_t *info) {
   (void)p;
   memset(info, 0, sizeof(*info));
   info->flags = CLAP_PARAM_IS_AUTOMATABLE;
   if (index == PARAM_LEVEL) {
      info->id = PARAM_LEVEL;
      est_strcpy(info->name, "Level", sizeof(info->name));
      info->min_value = -60.0;
      info->max_value = 0.0;
      info->default_value = -12.0;
      return true;
   }
   if (index == PARAM_RELEASE) {
      info->id = PARAM_RELEASE;
      est_strcpy(info->name, "Release", sizeof(info->name));
      info->min_value = 10.0;
      info->max_value = 2000.0;
      info->default_value = 200.0;
      return true;
   }
   return false;
}

static bool params_get_value(const clap_plugin_t *p, clap_id id, double *out) {
   const synth_t *s = (const synth_t *)p->plugin_data;
   if (id == PARAM_LEVEL) { *out = s->level_db; return true; }
   if (id == PARAM_RELEASE) { *out = s->release_ms; return true; }
   return false;
}

static bool params_value_to_text(const clap_plugin_t *p, clap_id id, double v, char *out, uint32_t cap) {
   (void)p;
   if (id == PARAM_LEVEL) { est_format(out, cap, v, "dB"); return true; }
   if (id == PARAM_RELEASE) { est_format(out, cap, v, "ms"); return true; }
   return false;
}

static bool params_text_to_value(const clap_plugin_t *p, clap_id id, const char *text, double *out) {
   (void)p;
   return (id == PARAM_LEVEL || id == PARAM_RELEASE) && est_parse(text, out);
}

static void params_flush(const clap_plugin_t *p, const clap_input_events_t *in, const clap_output_events_t *out) {
   synth_t *s = (synth_t *)p->plugin_data;
   uint32_t n = in->size(in);
   for (uint32_t i = 0; i < n; i++) {
      const clap_event_header_t *h = in->get(in, i);
      if (h && h->type == CLAP_EVENT_PARAM_VALUE) handle_event(s, h, out);
   }
}

static const clap_plugin_params_t ext_params = {
   .count = params_count,
   .get_info = params_get_info,
   .get_value = params_get_value,
   .value_to_text = params_value_to_text,
   .text_to_value = params_text_to_value,
   .flush = params_flush,
};

/* --- clap.state, clap.latency, clap.tail, clap.audio-ports, clap.note-ports --- */

static bool state_save(const clap_plugin_t *p, const clap_ostream_t *st) {
   const synth_t *s = (const synth_t *)p->plugin_data;
   uint32_t head[2] = { STATE_MAGIC, 1 };
   double body[2] = { s->level_db, s->release_ms };
   return est_write_all(st, head, sizeof(head)) && est_write_all(st, body, sizeof(body));
}

static bool state_load(const clap_plugin_t *p, const clap_istream_t *st) {
   synth_t *s = (synth_t *)p->plugin_data;
   uint32_t head[2];
   double body[2];
   if (!est_read_all(st, head, sizeof(head)) || head[0] != STATE_MAGIC || head[1] != 1) return false;
   if (!est_read_all(st, body, sizeof(body))) return false;
   set_param(s, PARAM_LEVEL, body[0]);
   set_param(s, PARAM_RELEASE, body[1]);
   return true;
}

static const clap_plugin_state_t ext_state = { .save = state_save, .load = state_load };

static uint32_t latency_get(const clap_plugin_t *p) { (void)p; return 0; }
static const clap_plugin_latency_t ext_latency = { .get = latency_get };

static uint32_t tail_get(const clap_plugin_t *p) {
   const synth_t *s = (const synth_t *)p->plugin_data;
   return (uint32_t)(s->release_ms * 0.001 * s->sample_rate);
}
static const clap_plugin_tail_t ext_tail = { .get = tail_get };

static uint32_t audio_count(const clap_plugin_t *p, bool is_input) { (void)p; return is_input ? 0 : 1; }
static bool audio_get(const clap_plugin_t *p, uint32_t index, bool is_input, clap_audio_port_info_t *info) {
   (void)p;
   if (is_input || index != 0) return false;
   memset(info, 0, sizeof(*info));
   info->id = 0;
   est_strcpy(info->name, "Out", sizeof(info->name));
   info->flags = CLAP_AUDIO_PORT_IS_MAIN;
   info->channel_count = 2;
   info->port_type = CLAP_PORT_STEREO;
   info->in_place_pair = CLAP_INVALID_ID;
   return true;
}
static const clap_plugin_audio_ports_t ext_audio = { .count = audio_count, .get = audio_get };

static uint32_t notes_count(const clap_plugin_t *p, bool is_input) { (void)p; return is_input ? 1 : 0; }
static bool notes_get(const clap_plugin_t *p, uint32_t index, bool is_input, clap_note_port_info_t *info) {
   (void)p;
   if (!is_input || index != 0) return false;
   memset(info, 0, sizeof(*info));
   info->id = 0;
   info->supported_dialects = CLAP_NOTE_DIALECT_CLAP;
   info->preferred_dialect = CLAP_NOTE_DIALECT_CLAP;
   est_strcpy(info->name, "Notes", sizeof(info->name));
   return true;
}
static const clap_plugin_note_ports_t ext_notes = { .count = notes_count, .get = notes_get };

/* --- The plugin --- */

static bool plugin_init(const clap_plugin_t *p) {
   synth_t *s = (synth_t *)p->plugin_data;
   set_param(s, PARAM_LEVEL, -12.0);
   set_param(s, PARAM_RELEASE, 200.0);
   return true;
}

static void plugin_destroy(const clap_plugin_t *p) { free(p->plugin_data); }

static bool plugin_activate(const clap_plugin_t *p, double sr, uint32_t min_frames, uint32_t max_frames) {
   (void)min_frames; (void)max_frames;
   synth_t *s = (synth_t *)p->plugin_data;
   s->sample_rate = sr;
   memset(s->voices, 0, sizeof(s->voices));
   return true;
}

static void plugin_deactivate(const clap_plugin_t *p) { (void)p; }
static bool plugin_start(const clap_plugin_t *p) { (void)p; return true; }
static void plugin_stop(const clap_plugin_t *p) { (void)p; }
static void plugin_reset(const clap_plugin_t *p) { synth_t *s = (synth_t *)p->plugin_data; memset(s->voices, 0, sizeof(s->voices)); }

static clap_process_status plugin_process(const clap_plugin_t *p, const clap_process_t *proc) {
   synth_t *s = (synth_t *)p->plugin_data;
   if (proc->audio_outputs_count < 1 || proc->audio_outputs[0].channel_count < 1) return CLAP_PROCESS_ERROR;
   const clap_audio_buffer_t *out = &proc->audio_outputs[0];
   float *l = out->data32[0];
   float *r = out->channel_count > 1 ? out->data32[1] : out->data32[0];
   uint32_t n = proc->frames_count, at = 0;
#if defined(FIXTURE_FAULT_TRAP)
   if (s->noted && ++s->since_note == FIXTURE_FAULT_AT) __builtin_trap();
#endif
   uint32_t count = proc->in_events->size(proc->in_events);
   for (uint32_t i = 0; i < count; i++) {
      const clap_event_header_t *h = proc->in_events->get(proc->in_events, i);
      if (!h) continue;
#if defined(FIXTURE_FAULT_TRAP)
      if (h->space_id == CLAP_CORE_EVENT_SPACE_ID && h->type == CLAP_EVENT_NOTE_ON) s->noted = 1;
#endif
      uint32_t t = h->time < n ? h->time : n;
      if (t > at) { render(s, l, r, at, t, proc->out_events); at = t; }
      handle_event(s, h, proc->out_events);
   }
   if (at < n) render(s, l, r, at, n, proc->out_events);
   for (int k = 0; k < VOICES; k++) if (s->voices[k].active) return CLAP_PROCESS_CONTINUE;
   return CLAP_PROCESS_SLEEP;
}

static const void *plugin_get_extension(const clap_plugin_t *p, const char *id) {
   (void)p;
   if (est_streq(id, CLAP_EXT_PARAMS)) return &ext_params;
   if (est_streq(id, CLAP_EXT_STATE)) return &ext_state;
   if (est_streq(id, CLAP_EXT_LATENCY)) return &ext_latency;
   if (est_streq(id, CLAP_EXT_TAIL)) return &ext_tail;
   if (est_streq(id, CLAP_EXT_AUDIO_PORTS)) return &ext_audio;
   if (est_streq(id, CLAP_EXT_NOTE_PORTS)) return &ext_notes;
   return 0;
}

static void plugin_on_main_thread(const clap_plugin_t *p) { (void)p; }

/* --- The factory and the entry --- */

static uint32_t factory_count(const clap_plugin_factory_t *f) { (void)f; return 1; }
static const clap_plugin_descriptor_t *factory_descriptor(const clap_plugin_factory_t *f, uint32_t i) { (void)f; return i == 0 ? &descriptor : 0; }

static const clap_plugin_t *factory_create(const clap_plugin_factory_t *f, const clap_host_t *host, const char *id) {
   (void)f;
   if (!clap_version_is_compatible(host->clap_version) || !est_streq(id, descriptor.id)) return 0;
   synth_t *s = (synth_t *)malloc(sizeof(synth_t));
   if (!s) return 0;
   memset(s, 0, sizeof(*s));
   s->host = host;
   s->plugin.desc = &descriptor;
   s->plugin.plugin_data = s;
   s->plugin.init = plugin_init;
   s->plugin.destroy = plugin_destroy;
   s->plugin.activate = plugin_activate;
   s->plugin.deactivate = plugin_deactivate;
   s->plugin.start_processing = plugin_start;
   s->plugin.stop_processing = plugin_stop;
   s->plugin.reset = plugin_reset;
   s->plugin.process = plugin_process;
   s->plugin.get_extension = plugin_get_extension;
   s->plugin.on_main_thread = plugin_on_main_thread;
   return &s->plugin;
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
