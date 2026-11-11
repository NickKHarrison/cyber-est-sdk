/*
 * A broken EST fixture (EST Phase 4, 4-A): EST Gain whose state is 5 MiB (its settings, then 80
 * blocks of 64 KiB of padding), over the 4 MiB a state may be (EST-C009).
 */
#define FIXTURE_ID "org.cyber.est.broken-big-state"
#define FIXTURE_NAME "Broken Big State"
#include "est_rt.h"
static bool state_save(const clap_plugin_t *p, const clap_ostream_t *s);
#define state_save(p, s) state_save_unused(p, s)
#include "gain.c"
#undef state_save
static uint8_t pad[65536];
static bool state_save(const clap_plugin_t *p, const clap_ostream_t *s) {
   if (!state_save_unused(p, s)) return false;
   for (int i = 0; i < 80; i++) if (!est_write_all(s, pad, sizeof(pad))) return false;
   return true;
}
