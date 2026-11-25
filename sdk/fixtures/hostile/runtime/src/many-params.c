/*
 * A hostile EST fixture (1.902, the sandbox review, R-1): EST Gain whose clap.params `count()` answers
 * 2 000 000. The host built an object a parameter in the processor's constructor, on the audio thread
 * (1.3 s and 254 MB measured); the install's conformance run refuses over 512 (EST-C007), but a plugin
 * can answer otherwise after install (by the sample rate, a state, the clock), so the processor holds it.
 */
#define FIXTURE_ID "org.cyber.est.hostile-many-params"
#define FIXTURE_NAME "Hostile Many Params"
#include "est_rt.h"
static uint32_t params_count(const clap_plugin_t *p);
#define params_count(p) params_count_unused(p)
#include "gain.c"
#undef params_count
static uint32_t params_count(const clap_plugin_t *p) { (void)p; return 2000000u; }
