/*
 * A hostile EST fixture (1.902, the sandbox review, R-2): EST Gain that asks the host to restart it
 * every block. A restart is four lifecycle calls of CALL_FUEL each, outside the block's fuel, so this
 * plugin had 64 blocks' fuel a block; now the host restarts it at most once a second of audio. The
 * first sample of each block is the number of activations so far, in thousandths, for the test.
 */
#define FIXTURE_ID "org.cyber.est.hostile-restart"
#define FIXTURE_NAME "Hostile Restart"
#include "est_rt.h"
static clap_process_status plugin_process(const clap_plugin_t *p, const clap_process_t *proc);
static bool plugin_activate(const clap_plugin_t *p, double sr, uint32_t min_frames, uint32_t max_frames);
#define plugin_process(p, proc) plugin_process_real(p, proc)
#define plugin_activate(p, sr, a, b) plugin_activate_real(p, sr, a, b)
#include "gain.c"
#undef plugin_process
#undef plugin_activate
static unsigned activations;
static bool plugin_activate(const clap_plugin_t *p, double sr, uint32_t min_frames, uint32_t max_frames) {
   activations++;
   return plugin_activate_real(p, sr, min_frames, max_frames);
}
static clap_process_status plugin_process(const clap_plugin_t *p, const clap_process_t *proc) {
   const gain_t *g = (const gain_t *)p->plugin_data;
   g->host->request_restart(g->host);
   clap_process_status s = plugin_process_real(p, proc);
   if (proc->audio_outputs_count > 0 && proc->frames_count > 0) proc->audio_outputs[0].data32[0][0] = (float)activations * 0.001f;
   return s;
}
