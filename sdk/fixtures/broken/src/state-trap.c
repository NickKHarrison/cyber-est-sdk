/*
 * A broken EST fixture (EST Phase 4, 4-A): EST Gain that traps inside clap.state's save (EST-C011).
 */
#define FIXTURE_ID "org.cyber.est.broken-state-trap"
#define FIXTURE_NAME "Broken State Trap"
#include "est_rt.h"
static bool state_save(const clap_plugin_t *p, const clap_ostream_t *s);
#define state_save(p, s) state_save_unused(p, s)
#include "gain.c"
#undef state_save
static bool state_save(const clap_plugin_t *p, const clap_ostream_t *s) {
   (void)p; (void)s;
   __builtin_trap();
}
