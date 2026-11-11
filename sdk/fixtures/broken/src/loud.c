/*
 * A broken EST fixture (EST Phase 4, 4-A): EST Gain with 40 dB more gain than it says, so a
 * full-scale click passes +18 dBFS (EST-C015).
 */
#define FIXTURE_ID "org.cyber.est.broken-loud"
#define FIXTURE_NAME "Broken Loud"
#include "est_rt.h"
static clap_process_status plugin_process(const clap_plugin_t *p, const clap_process_t *proc);
#define plugin_process(p, proc) plugin_process_inner(p, proc)
#include "gain.c"
#undef plugin_process
static clap_process_status plugin_process(const clap_plugin_t *p, const clap_process_t *proc) {
   clap_process_status st = plugin_process_inner(p, proc);
   const clap_audio_buffer_t *out = &proc->audio_outputs[0];
   for (uint32_t c = 0; c < out->channel_count; c++)
      for (uint32_t n = 0; n < proc->frames_count; n++) out->data32[c][n] *= 100.0f;
   return st;
}
