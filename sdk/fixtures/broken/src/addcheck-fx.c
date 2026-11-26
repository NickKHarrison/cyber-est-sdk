/*
 * The add-time checks' effect faults (1.914, src/audio/est/review/addChecks.ts): Phase 1's EST Gain,
 * wrapped as rate-frames.c wraps it, with one fault (defined before including this file):
 *
 *   FX_NOTHING  the output is the input, whatever Gain says (EST-C031: it does nothing; EST-C038)
 *   FX_SILENT   the output is zeros (EST-C031: it makes no sound)
 *   FX_RING     a 100 ms echo that feeds back at 1: it never dies away (EST-C032)
 *
 * Each installs: no install rule sees these. rate-seconds is the same wrapper done right.
 */
#include "est_rt.h"
static bool plugin_activate(const clap_plugin_t *p, double sr, uint32_t min_frames, uint32_t max_frames);
static clap_process_status plugin_process(const clap_plugin_t *p, const clap_process_t *proc);
#define plugin_activate(p, sr, a, b) plugin_activate_inner(p, sr, a, b)
#define plugin_process(p, proc) plugin_process_inner(p, proc)
#include "gain.c"
#undef plugin_activate
#undef plugin_process

/* The longest ring buffer: 100 ms at 96 kHz. */
#define RING_MAX 9600
static float ring[2][RING_MAX];
static uint32_t ring_len, ring_pos;

static bool plugin_activate(const clap_plugin_t *p, double sr, uint32_t min_frames, uint32_t max_frames) {
   double frames = 0.1 * sr + 0.5;
   ring_len = frames > RING_MAX ? RING_MAX : (uint32_t)frames;
   ring_pos = 0;
   memset(ring, 0, sizeof(ring));
   return plugin_activate_inner(p, sr, min_frames, max_frames);
}

static clap_process_status plugin_process(const clap_plugin_t *p, const clap_process_t *proc) {
   clap_process_status st = plugin_process_inner(p, proc);
   const clap_audio_buffer_t *out = &proc->audio_outputs[0];
   uint32_t chans = out->channel_count < 2 ? out->channel_count : 2;
   (void)chans; (void)ring_len; (void)ring_pos;
#if defined(FX_NOTHING)
   const clap_audio_buffer_t *in = &proc->audio_inputs[0];
   for (uint32_t c = 0; c < chans; c++) {
      const float *src = in->data32[c < in->channel_count ? c : 0];
      if (src != out->data32[c]) for (uint32_t i = 0; i < proc->frames_count; i++) out->data32[c][i] = src[i];
   }
#elif defined(FX_SILENT)
   for (uint32_t c = 0; c < chans; c++) for (uint32_t i = 0; i < proc->frames_count; i++) out->data32[c][i] = 0.0f;
#elif defined(FX_RING)
   for (uint32_t i = 0; i < proc->frames_count; i++) {
      for (uint32_t c = 0; c < chans; c++) {
         float y = out->data32[c][i];
         float d = ring[c][ring_pos] + 0.02f * y; /* the fault: what is in the ring comes round at full level, for ever */
         ring[c][ring_pos] = d;
         out->data32[c][i] = y + d;
      }
      if (++ring_pos >= ring_len) ring_pos = 0;
   }
   return CLAP_PROCESS_CONTINUE;
#endif
   return st;
}
