/*
 * A broken EST fixture (EST tidy, 1.286, D-43): EST Gain that exports `_initialize()` (the WASI
 * reactor convention) and never returns from it. The host calls `_initialize` once with a block's
 * fuel before `clap_entry`; the loop runs out of fuel there, so the plugin never starts (EST-W016).
 */
#define FIXTURE_ID "org.cyber.est.broken-init-trap"
#define FIXTURE_NAME "Broken Initialize"
#include "est_rt.h"
#include "gain.c"
static volatile uint32_t spins;
__attribute__((export_name("_initialize"))) void est_initialize(void) {
   for (;;) spins++;
}
