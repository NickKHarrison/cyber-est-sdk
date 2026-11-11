/*
 * A broken EST fixture (EST Phase 4, 4-A): EST Gain whose init() fails, so it never starts (EST-C001).
 */
#define FIXTURE_ID "org.cyber.est.broken-init"
#define FIXTURE_NAME "Broken Init"
#include "est_rt.h"
static bool plugin_init(const clap_plugin_t *p);
#define plugin_init(p) plugin_init_unused(p)
#include "gain.c"
#undef plugin_init
static bool plugin_init(const clap_plugin_t *p) { (void)p; return false; }
