/*
 * EST NaN Out (1.314, LR-8b stream A, LCH-21 a): EST Gain that on its 10th process() writes NaN,
 * +∞, +100 and −100 into the left channel's samples 3 to 6, and keeps doing so on every block after.
 * The host's output check turns them into 0, 0, 4 and −4 and counts four faults a block
 * (`estProcessor.test.ts`).
 */
#define FIXTURE_ID "org.cyber.est.nanout"
#define FIXTURE_NAME "EST NaN Out"
#include "est_rt.h"
static clap_process_status plugin_process(const clap_plugin_t *p, const clap_process_t *proc);
#define plugin_process(p, proc) plugin_process_inner(p, proc)
#include "gain.c"
#undef plugin_process
static clap_process_status plugin_process(const clap_plugin_t *p, const clap_process_t *proc) {
   clap_process_status st = plugin_process_inner(p, proc);
   const gain_t *g = (const gain_t *)p->plugin_data;
   if (g->blocks >= 10) {
      float *out = proc->audio_outputs[0].data32[0];
      out[3] = __builtin_nanf("");
      out[4] = __builtin_inff();
      out[5] = 100.0f;
      out[6] = -100.0f;
   }
   return st;
}
