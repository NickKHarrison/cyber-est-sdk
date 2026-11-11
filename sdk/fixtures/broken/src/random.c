/*
 * A broken EST fixture (EST Phase 4, 4-A): EST Gain that adds a little noise read from WASI's
 * `random_get` in process(), so two renders differ (EST-C018: installs, refused by the validator).
 */
#define FIXTURE_ID "org.cyber.est.broken-random"
#define FIXTURE_NAME "Broken Random"
#include "est_rt.h"
__attribute__((import_module("wasi_snapshot_preview1"), import_name("random_get"))) extern uint16_t wasi_random_get(uint8_t *buf, uint32_t len);
static clap_process_status plugin_process(const clap_plugin_t *p, const clap_process_t *proc);
#define plugin_process(p, proc) plugin_process_inner(p, proc)
#include "gain.c"
#undef plugin_process
static clap_process_status plugin_process(const clap_plugin_t *p, const clap_process_t *proc) {
   clap_process_status st = plugin_process_inner(p, proc);
   uint8_t r[4];
   wasi_random_get(r, 4);
   const clap_audio_buffer_t *out = &proc->audio_outputs[0];
   for (uint32_t c = 0; c < out->channel_count; c++) out->data32[c][0] += (float)(r[c & 3]) * 1e-6f;
   return st;
}
