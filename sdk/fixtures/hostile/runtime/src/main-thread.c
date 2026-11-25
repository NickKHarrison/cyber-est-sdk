/*
 * A hostile EST fixture (1.902, the sandbox review, R-2): EST Gain that asks the host for
 * `on_main_thread` every block and does its work there. The callback had a fresh CALL_FUEL (16 blocks'
 * fuel) after the block was judged, so the block's fuel and the slow-block rule never saw the work.
 * Now it runs on what the block left.
 */
#define FIXTURE_ID "org.cyber.est.hostile-main-thread"
#define FIXTURE_NAME "Hostile Main Thread"
#include "est_rt.h"
static clap_process_status plugin_process(const clap_plugin_t *p, const clap_process_t *proc);
static void plugin_on_main_thread(const clap_plugin_t *p);
#define plugin_process(p, proc) plugin_process_real(p, proc)
#define plugin_on_main_thread(p) plugin_on_main_thread_unused(p)
#include "gain.c"
#undef plugin_process
#undef plugin_on_main_thread
static volatile unsigned burn_sink;
__attribute__((noinline)) static void burn(unsigned n) { for (unsigned i = 0; i < n; i++) burn_sink += i; }
static clap_process_status plugin_process(const clap_plugin_t *p, const clap_process_t *proc) {
   const gain_t *g = (const gain_t *)p->plugin_data;
   g->host->request_callback(g->host);
   return plugin_process_real(p, proc);
}
static void plugin_on_main_thread(const clap_plugin_t *p) { (void)p; burn(30000000u); }
