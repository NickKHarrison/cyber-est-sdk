/*
 * A broken EST fixture (EST Phase 4, 4-A): EST Gain that writes NaN on its 50th process() (EST-C014).
 */
#define FIXTURE_ID "org.cyber.est.broken-nan"
#define FIXTURE_NAME "Broken NaN"
#include "est_rt.h"
static clap_process_status plugin_process(const clap_plugin_t *p, const clap_process_t *proc);
#define plugin_process(p, proc) plugin_process_inner(p, proc)
#include "gain.c"
#undef plugin_process
static clap_process_status plugin_process(const clap_plugin_t *p, const clap_process_t *proc) {
   clap_process_status st = plugin_process_inner(p, proc);
   const gain_t *g = (const gain_t *)p->plugin_data;
   if (g->blocks == 50) proc->audio_outputs[0].data32[0][3] = __builtin_nanf("");
   return st;
}
