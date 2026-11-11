/*
 * A broken EST fixture (EST tidy, 1.286): EST Gain whose clap.state save returns false (EST-C020).
 * Until 1.286 the big-state fixture stood for EST-C020; a save past 4 MiB is now EST-C009.
 */
#define FIXTURE_ID "org.cyber.est.broken-state-refused"
#define FIXTURE_NAME "Broken State Refused"
#include "est_rt.h"
static bool state_save(const clap_plugin_t *p, const clap_ostream_t *s);
#define state_save(p, s) state_save_unused(p, s)
#include "gain.c"
#undef state_save
static bool state_save(const clap_plugin_t *p, const clap_ostream_t *s) {
   (void)p; (void)s;
   return false;
}
