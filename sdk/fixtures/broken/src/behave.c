/*
 * A behaviour fixture (1.652, EST-C024 to EST-C030): a small pattern instrument that does each of the
 * seven things the behaviour checks look for the right way, so behave.wasm passes them all
 * (passing.json's `behave-ok`), and each of the seven broken fixtures (behave-*.c) is it with one
 * fault, defined before including this file:
 *
 *   FAULT_NOTE_END   a stolen note's NOTE_END is never sent (EST-C024)
 *   FAULT_TOGGLE     a note let go during its steal's fade toggles its "released" mark (EST-C025)
 *   FAULT_SWING      a step fires whenever the swung step index changes, so raising Swing replays (EST-C026)
 *   FAULT_SUBNORMAL  the output's DC blocker is never flushed: it sticks subnormal in silence (EST-C027)
 *   FAULT_TAIL       the tail is the echo's at 120 BPM, whatever the tempo (EST-C028)
 *   FAULT_SEED       a step's pitch is seeded by the count of hits, not the step (EST-C029)
 *   FAULT_JUMP       a forward transport jump fires every skipped step (EST-C030)
 *
 * Four sine voices (the oldest is stolen with a 3 ms fade, the new note waiting), and, while the
 * transport plays, a pattern of sixteenth blips on sixteen blip voices (Pattern on by default) with
 * Swing, then a tempo-synced dotted-eighth echo (feedback 0.4) over everything, then a DC blocker.
 * Parameters: Level (dB), Release (ms), Pattern (off/on), Swing (%).
 */
#include "est_rt.h"

#ifndef FIXTURE_ID
#define FIXTURE_ID "org.cyber.est.behave"
#endif

#define VOICES 4
#define BLIPS 16
#define ECHO_MAX_FRAMES 196608 /* 2.048 s at 96 kHz: the echo at 30 BPM and up */
enum { PARAM_LEVEL = 0, PARAM_RELEASE = 1, PARAM_PATTERN = 2, PARAM_SWING = 3, PARAM_COUNT = 4 };
#define STATE_MAGIC 0x56484542u /* "BEHV" */
#define FLUSH(x) do { if ((x) < 1e-20 && (x) > -1e-20) (x) = 0; } while (0)

typedef struct {
   int active, releasing, fade;           /* fade: frames left of a steal's fade (the waiting note starts after) */
   int32_t note_id; int16_t port, channel, key;
   double phase, inc, env, release_step, velocity, fade_step;
   uint32_t age;
   int pending; int32_t p_id; int16_t p_port, p_channel, p_key; double p_velocity; int p_released;
} voice_t;

typedef struct { double phase, inc, env; } blip_t;

typedef struct {
   clap_plugin_t plugin;
   const clap_host_t *host;
   double sample_rate;
   double level_db, level, release_ms, pattern, swing;
   voice_t voices[VOICES];
   blip_t blips[BLIPS];
   int next_blip;
   uint32_t clock;
   /* The transport. */
   int playing; double beat, tempo; int have_transport;
   double next_step; double last_idx; uint32_t hits;
   /* The echo and the DC blocker. */
   float *echo; uint32_t echo_w;
   double dc;
} behave_t;

static const char *const features[] = { CLAP_PLUGIN_FEATURE_INSTRUMENT, CLAP_PLUGIN_FEATURE_SYNTHESIZER, CLAP_PLUGIN_FEATURE_STEREO, 0 };
static const clap_plugin_descriptor_t descriptor = {
   .clap_version = CLAP_VERSION_INIT, .id = FIXTURE_ID, .name = "Behave", .vendor = "Cyber", .url = "", .manual_url = "",
   .support_url = "", .version = "1.0.0", .description = "The behaviour checks' fixture.", .features = features,
};

static void set_param(behave_t *s, clap_id id, double v) {
   if (id == PARAM_LEVEL) { s->level_db = v < -60.0 ? -60.0 : v > 0.0 ? 0.0 : v; s->level = est_db_to_lin(s->level_db); }
   else if (id == PARAM_RELEASE) s->release_ms = v < 10.0 ? 10.0 : v > 2000.0 ? 2000.0 : v;
   else if (id == PARAM_PATTERN) s->pattern = v >= 0.5 ? 1.0 : 0.0;
   else if (id == PARAM_SWING) s->swing = v < 0.0 ? 0.0 : v > 100.0 ? 100.0 : v;
}

static double key_inc(double key, double sr) { return 2.0 * EST_PI * 440.0 * est_exp((key - 69.0) / 12.0 * EST_LN2) / sr; }

static void note_end_of(const clap_output_events_t *out, uint32_t time, int32_t id, int16_t port, int16_t channel, int16_t key) {
   clap_event_note_t e;
   memset(&e, 0, sizeof(e));
   e.header.size = sizeof(e); e.header.time = time; e.header.space_id = CLAP_CORE_EVENT_SPACE_ID; e.header.type = CLAP_EVENT_NOTE_END;
   e.note_id = id; e.port_index = port; e.channel = channel; e.key = key;
   out->try_push(out, &e.header);
}

static void start_voice(behave_t *s, voice_t *v, int32_t id, int16_t port, int16_t channel, int16_t key, double vel) {
   v->active = 1; v->releasing = 0; v->fade = 0; v->pending = 0;
   v->note_id = id; v->port = port; v->channel = channel; v->key = key;
   v->phase = 0.0; v->inc = key_inc(key, s->sample_rate); v->env = 0.0; v->velocity = vel;
}

static void release_voice(behave_t *s, voice_t *v) {
   if (v->releasing) return;
   v->releasing = 1;
   v->release_step = (v->env > 0 ? v->env : 1.0) / (s->release_ms * 0.001 * s->sample_rate);
}

static void handle_note(behave_t *s, const clap_event_header_t *h, const clap_output_events_t *out) {
   const clap_event_note_t *e = (const clap_event_note_t *)h;
   if (h->type == CLAP_EVENT_NOTE_ON) {
      double vel = e->velocity <= 0 ? 0.0 : e->velocity > 1 ? 1.0 : e->velocity;
      voice_t *v = 0;
      for (int i = 0; i < VOICES && !v; i++) if (!s->voices[i].active) v = &s->voices[i];
      if (v) { start_voice(s, v, e->note_id, e->port_index, e->channel, e->key, vel); v->age = ++s->clock; return; }
      /* Steal the oldest: its note ends now, and the new one waits for the fade. */
      v = &s->voices[0];
      for (int i = 1; i < VOICES; i++) if (s->voices[i].age < v->age) v = &s->voices[i];
      if (v->pending) note_end_of(out, h->time, v->p_id, v->p_port, v->p_channel, v->p_key);
#if !defined(FAULT_NOTE_END)
      else note_end_of(out, h->time, v->note_id, v->port, v->channel, v->key);
#endif
      if (!v->fade) { v->fade = (int)(0.003 * s->sample_rate); v->fade_step = v->env / v->fade; }
      v->pending = 1; v->p_id = e->note_id; v->p_port = e->port_index; v->p_channel = e->channel; v->p_key = e->key; v->p_velocity = vel; v->p_released = 0;
      v->age = ++s->clock;
      return;
   }
   for (int i = 0; i < VOICES; i++) {
      voice_t *v = &s->voices[i];
      if (!v->active) continue;
      if (v->pending && (e->note_id == -1 ? v->p_key == e->key : v->p_id == e->note_id)) {
         if (h->type == CLAP_EVENT_NOTE_CHOKE) { note_end_of(out, h->time, v->p_id, v->p_port, v->p_channel, v->p_key); v->pending = 0; }
#if defined(FAULT_TOGGLE)
         else v->p_released = !v->p_released;
#else
         else v->p_released = 1;
#endif
         continue;
      }
      if (v->fade) continue;
      if (e->note_id == -1 ? v->key != e->key : v->note_id != e->note_id) continue;
      if (h->type == CLAP_EVENT_NOTE_CHOKE) { v->active = 0; note_end_of(out, h->time, v->note_id, v->port, v->channel, v->key); }
      else release_voice(s, v);
   }
}

/* --- The pattern: sixteenths, the odd ones swung by up to a twelfth of a beat. --- */

static double step_beat(behave_t *s, double step) {
   double odd = step - 2.0 * (double)(int64_t)(step / 2.0);
   return step / 4.0 + (odd > 0.5 ? s->swing / 100.0 / 12.0 : 0.0);
}
/* The first step at or after `beat`. */
static double step_at(behave_t *s, double beat) {
   double k = (double)(int64_t)(beat * 4.0) - 1.0;
   if (k < 0) k = 0;
   while (step_beat(s, k) < beat - 1e-9) k += 1.0;
   return k;
}
static uint32_t hash32(uint32_t x) { x ^= x >> 16; x *= 0x7feb352d; x ^= x >> 15; x *= 0x846ca68b; x ^= x >> 16; return x; }

static void fire(behave_t *s, double step) {
   s->hits++;
#if defined(FAULT_SEED)
   (void)step;
   uint32_t h = hash32(s->hits);
#else
   uint32_t h = hash32((uint32_t)(int64_t)step + 1u);
#endif
   blip_t *b = &s->blips[s->next_blip];
   s->next_blip = (s->next_blip + 1) % BLIPS;
   b->phase = 0.0;
   b->inc = 2.0 * EST_PI * (400.0 + 100.0 * (double)(h % 8u)) / s->sample_rate;
   b->env = 0.25;
}

/* One sample of the pattern at the current beat, then the beat moves on. */
static void pattern_tick(behave_t *s) {
   if (!s->playing) return;
   if (s->pattern > 0.5) {
#if defined(FAULT_SWING)
      double idx = step_at(s, s->beat + 1e-9);
      if (step_beat(s, idx) > s->beat + 1e-12) idx -= 1.0;
      if (idx >= 0 && idx != s->last_idx) { s->last_idx = idx; fire(s, idx); }
#else
      int guard = 0;
      while (step_beat(s, s->next_step) <= s->beat + 1e-12 && guard++ < 4096) { fire(s, s->next_step); s->next_step += 1.0; }
#endif
   }
   s->beat += s->tempo / 60.0 / s->sample_rate;
}

static void take_transport(behave_t *s, const clap_event_transport_t *t) {
   int playing = (t->flags & CLAP_TRANSPORT_IS_PLAYING) != 0;
   double beat = (double)t->song_pos_beats / (double)CLAP_BEATTIME_FACTOR;
   if (t->flags & CLAP_TRANSPORT_HAS_TEMPO) s->tempo = t->tempo < 30.0 ? 30.0 : t->tempo > 300.0 ? 300.0 : t->tempo;
   if (playing) {
      double drift = beat - s->beat;
      int started = !s->playing;
#if defined(FAULT_JUMP)
      int jumped = drift < -1e-4;
#else
      int jumped = drift < -1e-4 || drift > 1e-4;
#endif
      if (started || jumped) { s->next_step = step_at(s, beat); s->last_idx = -1.0; }
      s->beat = beat;
   }
   s->playing = playing;
   s->have_transport = 1;
}

/* --- Rendering --- */

static double echo_frames(behave_t *s) {
   double f = 0.75 * 60.0 / s->tempo * s->sample_rate;
   return f > ECHO_MAX_FRAMES - 2 ? ECHO_MAX_FRAMES - 2 : f;
}

static void render(behave_t *s, float *l, float *r, uint32_t from, uint32_t to, const clap_output_events_t *out) {
   const double blip_dec = est_exp(-6.907755278982137 / (0.05 * s->sample_rate));
   for (uint32_t i = from; i < to; i++) {
      double x = 0.0;
      for (int k = 0; k < VOICES; k++) {
         voice_t *v = &s->voices[k];
         if (!v->active) continue;
         if (v->fade) {
            v->env -= v->fade_step;
            if (v->env < 0) v->env = 0;
            if (--v->fade == 0) {
               int released = v->p_released;
               start_voice(s, v, v->p_id, v->p_port, v->p_channel, v->p_key, v->p_velocity);
               if (released) release_voice(s, v);
               continue;
            }
         } else if (v->releasing) {
            v->env -= v->release_step;
            if (v->env <= 0.0) { v->active = 0; note_end_of(out, i, v->note_id, v->port, v->channel, v->key); continue; }
         } else if (v->env < 1.0) {
            v->env += 1.0 / (0.005 * s->sample_rate);
            if (v->env > 1.0) v->env = 1.0;
         }
         x += est_sin(v->phase) * v->env * v->velocity * 0.2;
         v->phase += v->inc;
         if (v->phase > 2.0 * EST_PI) v->phase -= 2.0 * EST_PI;
      }
      pattern_tick(s);
      for (int k = 0; k < BLIPS; k++) {
         blip_t *b = &s->blips[k];
         if (b->env == 0.0) continue;
         x += est_sin(b->phase) * b->env;
         b->phase += b->inc;
         if (b->phase > 2.0 * EST_PI) b->phase -= 2.0 * EST_PI;
         b->env *= blip_dec;
         if (b->env < 1e-6) b->env = 0.0;
      }
      x *= s->level;
      /* The echo: a dotted eighth at the tempo, feedback 0.4. */
      double d = echo_frames(s);
      uint32_t di = (uint32_t)d;
      uint32_t rd = (s->echo_w + ECHO_MAX_FRAMES - di) % ECHO_MAX_FRAMES;
      double e = s->echo[rd];
      float w = (float)(x + 0.4 * e);
      if (w < 1e-6f && w > -1e-6f) w = 0.0f; /* -120 dB */
      s->echo[s->echo_w] = w;
      s->echo_w = (s->echo_w + 1) % ECHO_MAX_FRAMES;
      double y = x + 0.5 * e;
      /* The DC blocker. */
      s->dc += 0.05 * (y - s->dc);
#if !defined(FAULT_SUBNORMAL)
      FLUSH(s->dc);
#endif
      y -= s->dc;
      l[i] = (float)y;
      r[i] = (float)y;
   }
}

/* --- clap.params --- */

static uint32_t params_count(const clap_plugin_t *p) { (void)p; return PARAM_COUNT; }
static bool params_get_info(const clap_plugin_t *p, uint32_t index, clap_param_info_t *info) {
   (void)p;
   memset(info, 0, sizeof(*info));
   info->flags = CLAP_PARAM_IS_AUTOMATABLE;
   info->id = index;
   if (index == PARAM_LEVEL) { est_strcpy(info->name, "Level", sizeof(info->name)); info->min_value = -60; info->max_value = 0; info->default_value = -6; return true; }
   if (index == PARAM_RELEASE) { est_strcpy(info->name, "Release", sizeof(info->name)); info->min_value = 10; info->max_value = 2000; info->default_value = 200; return true; }
   if (index == PARAM_PATTERN) { est_strcpy(info->name, "Pattern", sizeof(info->name)); info->flags |= CLAP_PARAM_IS_STEPPED; info->min_value = 0; info->max_value = 1; info->default_value = 1; return true; }
   if (index == PARAM_SWING) { est_strcpy(info->name, "Swing", sizeof(info->name)); info->min_value = 0; info->max_value = 100; info->default_value = 0; return true; }
   return false;
}
static bool params_get_value(const clap_plugin_t *p, clap_id id, double *out) {
   const behave_t *s = (const behave_t *)p->plugin_data;
   if (id == PARAM_LEVEL) *out = s->level_db;
   else if (id == PARAM_RELEASE) *out = s->release_ms;
   else if (id == PARAM_PATTERN) *out = s->pattern;
   else if (id == PARAM_SWING) *out = s->swing;
   else return false;
   return true;
}
static bool params_value_to_text(const clap_plugin_t *p, clap_id id, double v, char *out, uint32_t cap) {
   (void)p;
   if (id >= PARAM_COUNT) return false;
   est_format(out, cap, v, id == PARAM_LEVEL ? "dB" : id == PARAM_RELEASE ? "ms" : id == PARAM_SWING ? "%" : "");
   return true;
}
static bool params_text_to_value(const clap_plugin_t *p, clap_id id, const char *text, double *out) { (void)p; return id < PARAM_COUNT && est_parse(text, out); }
static void params_flush(const clap_plugin_t *p, const clap_input_events_t *in, const clap_output_events_t *out) {
   (void)out;
   behave_t *s = (behave_t *)p->plugin_data;
   uint32_t n = in->size(in);
   for (uint32_t i = 0; i < n; i++) {
      const clap_event_header_t *h = in->get(in, i);
      if (h && h->space_id == CLAP_CORE_EVENT_SPACE_ID && h->type == CLAP_EVENT_PARAM_VALUE) {
         const clap_event_param_value_t *e = (const clap_event_param_value_t *)h;
         set_param(s, e->param_id, e->value);
      }
   }
}
static const clap_plugin_params_t ext_params = {
   .count = params_count, .get_info = params_get_info, .get_value = params_get_value,
   .value_to_text = params_value_to_text, .text_to_value = params_text_to_value, .flush = params_flush,
};

/* --- clap.state, latency, tail, ports --- */

static bool state_save(const clap_plugin_t *p, const clap_ostream_t *st) {
   const behave_t *s = (const behave_t *)p->plugin_data;
   uint32_t head[2] = { STATE_MAGIC, 1 };
   double body[4] = { s->level_db, s->release_ms, s->pattern, s->swing };
   return est_write_all(st, head, sizeof(head)) && est_write_all(st, body, sizeof(body));
}
static bool state_load(const clap_plugin_t *p, const clap_istream_t *st) {
   behave_t *s = (behave_t *)p->plugin_data;
   uint32_t head[2]; double body[4];
   if (!est_read_all(st, head, sizeof(head)) || head[0] != STATE_MAGIC || head[1] != 1) return false;
   if (!est_read_all(st, body, sizeof(body))) return false;
   for (int k = 0; k < 4; k++) set_param(s, (clap_id)k, body[k]);
   return true;
}
static const clap_plugin_state_t ext_state = { .save = state_save, .load = state_load };
static uint32_t latency_get(const clap_plugin_t *p) { (void)p; return 0; }
static const clap_plugin_latency_t ext_latency = { .get = latency_get };

static uint32_t tail_get(const clap_plugin_t *p) {
   const behave_t *s = (const behave_t *)p->plugin_data;
#if defined(FAULT_TAIL)
   double echo = 0.75 * 60.0 / 120.0 * s->sample_rate;
#else
   double echo = echo_frames((behave_t *)s);
#endif
   /* The release and a blip's 50 ms, then the echo's repeats to 60 dB down (0.4^8 ≈ 6.6e-4), and 10 ms. */
   return (uint32_t)((s->release_ms + 60.0) * 0.001 * s->sample_rate + 9.0 * echo);
}
static const clap_plugin_tail_t ext_tail = { .get = tail_get };

static uint32_t audio_count(const clap_plugin_t *p, bool is_input) { (void)p; return is_input ? 0 : 1; }
static bool audio_get(const clap_plugin_t *p, uint32_t index, bool is_input, clap_audio_port_info_t *info) {
   (void)p;
   if (is_input || index != 0) return false;
   memset(info, 0, sizeof(*info));
   est_strcpy(info->name, "Out", sizeof(info->name));
   info->flags = CLAP_AUDIO_PORT_IS_MAIN; info->channel_count = 2; info->port_type = CLAP_PORT_STEREO; info->in_place_pair = CLAP_INVALID_ID;
   return true;
}
static const clap_plugin_audio_ports_t ext_audio = { .count = audio_count, .get = audio_get };
static uint32_t notes_count(const clap_plugin_t *p, bool is_input) { (void)p; return is_input ? 1 : 0; }
static bool notes_get(const clap_plugin_t *p, uint32_t index, bool is_input, clap_note_port_info_t *info) {
   (void)p;
   if (!is_input || index != 0) return false;
   memset(info, 0, sizeof(*info));
   info->supported_dialects = CLAP_NOTE_DIALECT_CLAP; info->preferred_dialect = CLAP_NOTE_DIALECT_CLAP;
   est_strcpy(info->name, "Notes", sizeof(info->name));
   return true;
}
static const clap_plugin_note_ports_t ext_notes = { .count = notes_count, .get = notes_get };

/* --- The plugin --- */

static bool plugin_init(const clap_plugin_t *p) {
   behave_t *s = (behave_t *)p->plugin_data;
   set_param(s, PARAM_LEVEL, -6.0); set_param(s, PARAM_RELEASE, 200.0); set_param(s, PARAM_PATTERN, 1.0); set_param(s, PARAM_SWING, 0.0);
   s->echo = (float *)malloc(sizeof(float) * ECHO_MAX_FRAMES);
   return s->echo != 0;
}
static void plugin_destroy(const clap_plugin_t *p) { behave_t *s = (behave_t *)p->plugin_data; free(s->echo); free(s); }
static void clear(behave_t *s) {
   memset(s->voices, 0, sizeof(s->voices)); memset(s->blips, 0, sizeof(s->blips));
   memset(s->echo, 0, sizeof(float) * ECHO_MAX_FRAMES);
   s->echo_w = 0; s->dc = 0; s->playing = 0; s->beat = 0; s->tempo = 120; s->next_step = 0; s->last_idx = -1; s->hits = 0; s->next_blip = 0;
}
static bool plugin_activate(const clap_plugin_t *p, double sr, uint32_t min_frames, uint32_t max_frames) {
   (void)min_frames; (void)max_frames;
   behave_t *s = (behave_t *)p->plugin_data;
   s->sample_rate = sr;
   clear(s);
   return true;
}
static void plugin_deactivate(const clap_plugin_t *p) { (void)p; }
static bool plugin_start(const clap_plugin_t *p) { (void)p; return true; }
static void plugin_stop(const clap_plugin_t *p) { (void)p; }
static void plugin_reset(const clap_plugin_t *p) { clear((behave_t *)p->plugin_data); }

static clap_process_status plugin_process(const clap_plugin_t *p, const clap_process_t *proc) {
   behave_t *s = (behave_t *)p->plugin_data;
   if (proc->audio_outputs_count < 1 || proc->audio_outputs[0].channel_count < 1) return CLAP_PROCESS_ERROR;
   const clap_audio_buffer_t *ob = &proc->audio_outputs[0];
   float *l = ob->data32[0];
   float *r = ob->channel_count > 1 ? ob->data32[1] : ob->data32[0];
   uint32_t n = proc->frames_count, at = 0;
   if (proc->transport) take_transport(s, proc->transport);
   uint32_t count = proc->in_events->size(proc->in_events);
   for (uint32_t i = 0; i < count; i++) {
      const clap_event_header_t *h = proc->in_events->get(proc->in_events, i);
      if (!h || h->space_id != CLAP_CORE_EVENT_SPACE_ID) continue;
      uint32_t t = h->time < n ? h->time : n;
      if (t > at) { render(s, l, r, at, t, proc->out_events); at = t; }
      if (h->type == CLAP_EVENT_PARAM_VALUE) { const clap_event_param_value_t *e = (const clap_event_param_value_t *)h; set_param(s, e->param_id, e->value); }
      else if (h->type == CLAP_EVENT_TRANSPORT) take_transport(s, (const clap_event_transport_t *)h);
      else if (h->type == CLAP_EVENT_NOTE_ON || h->type == CLAP_EVENT_NOTE_OFF || h->type == CLAP_EVENT_NOTE_CHOKE) handle_note(s, h, proc->out_events);
   }
   if (at < n) render(s, l, r, at, n, proc->out_events);
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

static uint32_t factory_count(const clap_plugin_factory_t *f) { (void)f; return 1; }
static const clap_plugin_descriptor_t *factory_descriptor(const clap_plugin_factory_t *f, uint32_t i) { (void)f; return i == 0 ? &descriptor : 0; }
static const clap_plugin_t *factory_create(const clap_plugin_factory_t *f, const clap_host_t *host, const char *id) {
   (void)f;
   if (!clap_version_is_compatible(host->clap_version) || !est_streq(id, descriptor.id)) return 0;
   behave_t *s = (behave_t *)malloc(sizeof(behave_t));
   if (!s) return 0;
   memset(s, 0, sizeof(*s));
   s->host = host;
   s->plugin.desc = &descriptor; s->plugin.plugin_data = s;
   s->plugin.init = plugin_init; s->plugin.destroy = plugin_destroy; s->plugin.activate = plugin_activate; s->plugin.deactivate = plugin_deactivate;
   s->plugin.start_processing = plugin_start; s->plugin.stop_processing = plugin_stop; s->plugin.reset = plugin_reset; s->plugin.process = plugin_process;
   s->plugin.get_extension = plugin_get_extension; s->plugin.on_main_thread = plugin_on_main_thread;
   return &s->plugin;
}
static const clap_plugin_factory_t factory = { .get_plugin_count = factory_count, .get_plugin_descriptor = factory_descriptor, .create_plugin = factory_create };
static bool entry_init(const char *path) { (void)path; return true; }
static void entry_deinit(void) {}
static const void *entry_get_factory(const char *id) { return est_streq(id, CLAP_PLUGIN_FACTORY_ID) ? &factory : 0; }
CLAP_EXPORT const clap_plugin_entry_t clap_entry = { .clap_version = CLAP_VERSION_INIT, .init = entry_init, .deinit = entry_deinit, .get_factory = entry_get_factory };
