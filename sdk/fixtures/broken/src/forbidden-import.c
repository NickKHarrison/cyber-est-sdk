/*
 * A broken EST fixture (EST Phase 4, 4-A): EST Gain that imports a host function EST does not
 * provide, `env.host_fetch`, and calls it in process() (EST-W004: refused before anything runs).
 */
#define FIXTURE_ID "org.cyber.est.broken-import"
#define FIXTURE_NAME "Broken Import"
#include "est_rt.h"
__attribute__((import_module("env"), import_name("host_fetch"))) extern int host_fetch(int what);
static clap_process_status plugin_process(const clap_plugin_t *p, const clap_process_t *proc);
#define plugin_process(p, proc) plugin_process_inner(p, proc)
#include "gain.c"
#undef plugin_process
static clap_process_status plugin_process(const clap_plugin_t *p, const clap_process_t *proc) {
   if (proc->frames_count == 0) host_fetch(1);
   return plugin_process_inner(p, proc);
}
