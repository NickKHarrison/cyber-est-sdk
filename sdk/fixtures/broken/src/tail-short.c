/*
 * A broken EST fixture (EST Phase 4, 4-A): EST Synth (src/audio/est/fixtures/synth.c) that reports
 * a tail of one frame while its release lasts 200 ms, so it sounds past the tail it reports
 * (EST-C017).
 */
#include "est_rt.h"
static uint32_t tail_get(const clap_plugin_t *p);
#define tail_get(p) tail_get_unused(p)
#include "synth.c"
#undef tail_get
static uint32_t tail_get(const clap_plugin_t *p) { (void)p; return 1; }
