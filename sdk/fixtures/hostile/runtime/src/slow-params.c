/*
 * A hostile EST fixture (1.902, the sandbox review, R-1): EST Gain whose `get_value` burns most of a
 * lifecycle call's fuel each time. Every call of the parameter list had a whole CALL_FUEL of its own,
 * so 512 parameters froze the audio thread for seconds to minutes at boot; now the list's calls share
 * one budget (PARAM_FUEL), which two of these calls pass.
 */
#define FIXTURE_ID "org.cyber.est.hostile-slow-params"
#define FIXTURE_NAME "Hostile Slow Params"
#include "est_rt.h"
static bool params_get_value(const clap_plugin_t *p, clap_id id, double *out);
#define params_get_value(p, id, out) params_get_value_real(p, id, out)
#include "gain.c"
#undef params_get_value
static volatile unsigned burn_sink;
__attribute__((noinline)) static void burn(unsigned n) { for (unsigned i = 0; i < n; i++) burn_sink += i; }
static bool params_get_value(const clap_plugin_t *p, clap_id id, double *out) {
   burn(40000000u);
   return params_get_value_real(p, id, out);
}
