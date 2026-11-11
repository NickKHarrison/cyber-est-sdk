/*
 * A broken EST fixture (EST Phase 4, 4-A): EST Gain that reports a latency of 4800 frames, more
 * than its est.json's limits.maxLatencyFrames (EST-C005).
 */
#define FIXTURE_ID "org.cyber.est.broken-latency"
#define FIXTURE_NAME "Broken Latency"
#include "est_rt.h"
static uint32_t latency_get(const clap_plugin_t *p);
#define latency_get(p) latency_get_unused(p)
#include "gain.c"
#undef latency_get
static uint32_t latency_get(const clap_plugin_t *p) { (void)p; return 4800; }
