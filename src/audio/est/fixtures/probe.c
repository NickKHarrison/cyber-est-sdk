/*
 * EST Probe (EST Phase 3 fixture, docs/est/EST_Phase3_Work_Order.md §1): an instrument that records
 * what the host sends it, to prove the host's events as a plugin sees them. One CLAP note input
 * port, one stereo audio output (silent). Every input event (notes with their ids, chokes, note
 * expressions, MIDI, parameter values and transport events with their sample offsets) and the
 * block's own transport are kept in a log of at most 2048 records; `clap.state`'s save writes the
 * log (and the notes still sounding), its load clears it. A note is "sounding" from its NOTE_ON to
 * its NOTE_OFF or NOTE_CHOKE (by id, or by key, channel and port with -1 as a wildcard), so a test
 * reads which notes the host left hanging. One parameter, Gain (0 to 1), so lanes have a target.
 * Its tail is a fixed 0.25 s (`clap.tail`), so the host's tail handling is seen.
 */

#include "est_rt.h"

#define LOG_MAX 2048
#define SOUNDING_MAX 256
#define STATE_MAGIC 0x424f5250u /* "PROB" */

enum { REC_BLOCK = 100 };

typedef struct { double f[8]; } rec_t;

typedef struct {
   int32_t id;
   int16_t port, channel, key;
} sounding_t;

typedef struct {
   clap_plugin_t plugin;
   const clap_host_t *host;
   double sample_rate;
   double gain;
   uint32_t log_len;
   rec_t log[LOG_MAX];
   uint32_t sounding_len;
   sounding_t sounding[SOUNDING_MAX];
} probe_t;

static const char *const features[] = { CLAP_PLUGIN_FEATURE_INSTRUMENT, CLAP_PLUGIN_FEATURE_SYNTHESIZER, CLAP_PLUGIN_FEATURE_STEREO, 0 };

static const clap_plugin_descriptor_t descriptor = {
   .clap_version = CLAP_VERSION_INIT,
   .id = "org.cyber.est.probe",
   .name = "EST Probe",
   .vendor = "Cyber",
   .url = "",
   .manual_url = "",
   .support_url = "",
   .version = "1.0.0",
   .description = "Records the events the host sends: the EST runtime's event fixture.",
   .features = features,
};

static void put(probe_t *s, double a, double b, double c, double d, double e, double f, double g, double h) {
   if (s->log_len >= LOG_MAX) return;
   rec_t *r = &s->log[s->log_len++];
   r->f[0] = a; r->f[1] = b; r->f[2] = c; r->f[3] = d; r->f[4] = e; r->f[5] = f; r->f[6] = g; r->f[7] = h;
}

static double fixed(int64_t v) { return (double)v / (double)CLAP_BEATTIME_FACTOR; }

static void log_transport(probe_t *s, double kind, uint32_t time, const clap_event_transport_t *t) {
   put(s, kind, time, (double)t->flags, t->tempo, t->tempo_inc, fixed(t->song_pos_beats), (double)t->song_pos_seconds / (double)CLAP_SECTIME_FACTOR, (double)t->bar_number);
}

static int matches(const sounding_t *v, const clap_event_note_t *e) {
   if (e->note_id != -1) return v->id == e->note_id;
   return (e->key == -1 || v->key == e->key) && (e->channel == -1 || v->channel == e->channel) && (e->port_index == -1 || v->port == e->port_index);
}

static void handle(probe_t *s, const clap_event_header_t *h) {
   if (h->space_id != CLAP_CORE_EVENT_SPACE_ID) return;
   switch (h->type) {
   case CLAP_EVENT_NOTE_ON: case CLAP_EVENT_NOTE_OFF: case CLAP_EVENT_NOTE_CHOKE: {
      const clap_event_note_t *e = (const clap_event_note_t *)h;
      put(s, h->type, h->time, e->note_id, e->port_index, e->channel, e->key, e->velocity, 0);
      if (h->type == CLAP_EVENT_NOTE_ON) {
         if (s->sounding_len < SOUNDING_MAX) {
            sounding_t *v = &s->sounding[s->sounding_len++];
            v->id = e->note_id; v->port = e->port_index; v->channel = e->channel; v->key = e->key;
         }
      } else {
         uint32_t w = 0;
         for (uint32_t i = 0; i < s->sounding_len; i++) if (!matches(&s->sounding[i], e)) s->sounding[w++] = s->sounding[i];
         s->sounding_len = w;
      }
      break;
   }
   case CLAP_EVENT_NOTE_EXPRESSION: {
      const clap_event_note_expression_t *e = (const clap_event_note_expression_t *)h;
      put(s, h->type, h->time, e->expression_id, e->note_id, e->channel, e->key, e->value, e->port_index);
      break;
   }
   case CLAP_EVENT_MIDI: {
      const clap_event_midi_t *e = (const clap_event_midi_t *)h;
      put(s, h->type, h->time, e->port_index, e->data[0], e->data[1], e->data[2], 0, 0);
      break;
   }
   case CLAP_EVENT_PARAM_VALUE: {
      const clap_event_param_value_t *e = (const clap_event_param_value_t *)h;
      if (e->param_id == 0) s->gain = e->value < 0 ? 0 : e->value > 1 ? 1 : e->value;
      put(s, h->type, h->time, e->param_id, e->value, 0, 0, 0, 0);
      break;
   }
   case CLAP_EVENT_TRANSPORT:
      log_transport(s, h->type, h->time, (const clap_event_transport_t *)h);
      break;
   default:
      put(s, h->type, h->time, 0, 0, 0, 0, 0, 0);
   }
}

/* --- clap.params: Gain --- */

static uint32_t params_count(const clap_plugin_t *p) { (void)p; return 1; }
static bool params_get_info(const clap_plugin_t *p, uint32_t index, clap_param_info_t *info) {
   (void)p;
   if (index != 0) return false;
   memset(info, 0, sizeof(*info));
   info->id = 0;
   info->flags = CLAP_PARAM_IS_AUTOMATABLE;
   est_strcpy(info->name, "Gain", sizeof(info->name));
   info->min_value = 0.0;
   info->max_value = 1.0;
   info->default_value = 1.0;
   return true;
}
static bool params_get_value(const clap_plugin_t *p, clap_id id, double *out) {
   const probe_t *s = (const probe_t *)p->plugin_data;
   if (id != 0) return false;
   *out = s->gain;
   return true;
}
static bool params_value_to_text(const clap_plugin_t *p, clap_id id, double v, char *out, uint32_t cap) {
   (void)p;
   if (id != 0) return false;
   est_format(out, cap, v, "");
   return true;
}
static bool params_text_to_value(const clap_plugin_t *p, clap_id id, const char *text, double *out) { (void)p; return id == 0 && est_parse(text, out); }
static void params_flush(const clap_plugin_t *p, const clap_input_events_t *in, const clap_output_events_t *out) {
   (void)out;
   probe_t *s = (probe_t *)p->plugin_data;
   uint32_t n = in->size(in);
   for (uint32_t i = 0; i < n; i++) { const clap_event_header_t *h = in->get(in, i); if (h) handle(s, h); }
}
static const clap_plugin_params_t ext_params = {
   .count = params_count, .get_info = params_get_info, .get_value = params_get_value,
   .value_to_text = params_value_to_text, .text_to_value = params_text_to_value, .flush = params_flush,
};

/* --- clap.state: the log out, a load clears it --- */

static bool state_save(const clap_plugin_t *p, const clap_ostream_t *st) {
   const probe_t *s = (const probe_t *)p->plugin_data;
   uint32_t head[4] = { STATE_MAGIC, 1, s->log_len, s->sounding_len };
   if (!est_write_all(st, head, sizeof(head))) return false;
   if (s->log_len && !est_write_all(st, s->log, sizeof(rec_t) * s->log_len)) return false;
   for (uint32_t i = 0; i < s->sounding_len; i++) {
      double v[4] = { s->sounding[i].id, s->sounding[i].port, s->sounding[i].channel, s->sounding[i].key };
      if (!est_write_all(st, v, sizeof(v))) return false;
   }
   return true;
}
static bool state_load(const clap_plugin_t *p, const clap_istream_t *st) {
   probe_t *s = (probe_t *)p->plugin_data;
   uint32_t head[2];
   if (!est_read_all(st, head, sizeof(head)) || head[0] != STATE_MAGIC) return false;
   s->log_len = 0;
   return true;
}
static const clap_plugin_state_t ext_state = { .save = state_save, .load = state_load };

static uint32_t latency_get(const clap_plugin_t *p) { (void)p; return 0; }
static const clap_plugin_latency_t ext_latency = { .get = latency_get };
static uint32_t tail_get(const clap_plugin_t *p) { const probe_t *s = (const probe_t *)p->plugin_data; return (uint32_t)(0.25 * s->sample_rate); }
static const clap_plugin_tail_t ext_tail = { .get = tail_get };

static uint32_t audio_count(const clap_plugin_t *p, bool is_input) { (void)p; return is_input ? 0 : 1; }
static bool audio_get(const clap_plugin_t *p, uint32_t index, bool is_input, clap_audio_port_info_t *info) {
   (void)p;
   if (is_input || index != 0) return false;
   memset(info, 0, sizeof(*info));
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
   info->supported_dialects = CLAP_NOTE_DIALECT_CLAP | CLAP_NOTE_DIALECT_MIDI;
   info->preferred_dialect = CLAP_NOTE_DIALECT_CLAP;
   est_strcpy(info->name, "Notes", sizeof(info->name));
   return true;
}
static const clap_plugin_note_ports_t ext_notes = { .count = notes_count, .get = notes_get };

/* --- The plugin --- */

static bool plugin_init(const clap_plugin_t *p) { probe_t *s = (probe_t *)p->plugin_data; s->gain = 1.0; return true; }
static void plugin_destroy(const clap_plugin_t *p) { free(p->plugin_data); }
static bool plugin_activate(const clap_plugin_t *p, double sr, uint32_t min, uint32_t max) {
   (void)min; (void)max;
   probe_t *s = (probe_t *)p->plugin_data;
   s->sample_rate = sr;
   return true;
}
static void plugin_deactivate(const clap_plugin_t *p) { (void)p; }
static bool plugin_start(const clap_plugin_t *p) { (void)p; return true; }
static void plugin_stop(const clap_plugin_t *p) { (void)p; }
static void plugin_reset(const clap_plugin_t *p) { probe_t *s = (probe_t *)p->plugin_data; s->sounding_len = 0; }

static clap_process_status plugin_process(const clap_plugin_t *p, const clap_process_t *proc) {
   probe_t *s = (probe_t *)p->plugin_data;
   if (proc->audio_outputs_count < 1 || proc->audio_outputs[0].channel_count < 1) return CLAP_PROCESS_ERROR;
   const clap_audio_buffer_t *out = &proc->audio_outputs[0];
   for (uint32_t c = 0; c < out->channel_count; c++) for (uint32_t i = 0; i < proc->frames_count; i++) out->data32[c][i] = 0.0f;
   if (proc->transport) log_transport(s, REC_BLOCK, 0, proc->transport);
   uint32_t count = proc->in_events->size(proc->in_events);
   for (uint32_t i = 0; i < count; i++) {
      const clap_event_header_t *h = proc->in_events->get(proc->in_events, i);
      if (h) handle(s, h);
   }
   return CLAP_PROCESS_CONTINUE;
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
   probe_t *s = (probe_t *)malloc(sizeof(probe_t));
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
