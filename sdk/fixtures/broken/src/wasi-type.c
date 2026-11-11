/*
 * A broken EST fixture (1.314, LR-8b stream A, EST-02): EST Gain that imports
 * `wasi_snapshot_preview1.random_get`, a function EST allows, but with a type that is not
 * preview 1's: `(f64, f64) -> i32` instead of `(i32, i32) -> i32`. The name alone passed the
 * allowlist; the host's `random_get` then read a length of 10^15 (EST-W017: refused before
 * anything runs).
 */
#define FIXTURE_ID "org.cyber.est.broken-wasi-type"
#define FIXTURE_NAME "Broken WASI Type"
#include "est_rt.h"
__attribute__((import_module("wasi_snapshot_preview1"), import_name("random_get"))) extern int wasi_random_get(double buf, double len);
static clap_process_status plugin_process(const clap_plugin_t *p, const clap_process_t *proc);
#define plugin_process(p, proc) plugin_process_inner(p, proc)
#include "gain.c"
#undef plugin_process
static clap_process_status plugin_process(const clap_plugin_t *p, const clap_process_t *proc) {
   if (proc->frames_count == 0) wasi_random_get(0.0, 1e15);
   return plugin_process_inner(p, proc);
}
