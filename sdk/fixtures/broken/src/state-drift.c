/*
 * A broken EST fixture (EST Phase 4, 4-A): EST Gain (src/audio/est/fixtures/gain.c) whose state
 * does not round-trip: every save writes a counter that goes up, so a save, a load and a save give
 * different bytes (EST-C010).
 */
#define FIXTURE_ID "org.cyber.est.broken-state"
#define FIXTURE_NAME "Broken State"
#include "est_rt.h"
static bool state_save(const clap_plugin_t *p, const clap_ostream_t *s);
#define state_save(p, s) state_save_unused(p, s)
#include "gain.c"
#undef state_save
static uint32_t saves;
static bool state_save(const clap_plugin_t *p, const clap_ostream_t *s) {
   const gain_t *g = (const gain_t *)p->plugin_data;
   uint32_t head[2] = { STATE_MAGIC, 1 };
   double body[2] = { g->gain_db + (double)(++saves) * 0.001, g->bypass };
   return est_write_all(s, head, sizeof(head)) && est_write_all(s, body, sizeof(body));
}
