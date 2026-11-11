/*
 * A broken EST fixture (EST Phase 4, 4-A): EST Gain whose second parameter reports the first's id,
 * so one id is there twice (EST-C007).
 */
#define FIXTURE_ID "org.cyber.est.broken-params"
#define FIXTURE_NAME "Broken Params"
#include "est_rt.h"
static bool params_get_info(const clap_plugin_t *p, uint32_t index, clap_param_info_t *info);
#define params_get_info(p, index, info) params_get_info_inner(p, index, info)
#include "gain.c"
#undef params_get_info
static bool params_get_info(const clap_plugin_t *p, uint32_t index, clap_param_info_t *info) {
   bool ok = params_get_info_inner(p, index, info);
   if (ok && index == 1) info->id = 0;
   return ok;
}
