/*
 * A passing EST fixture (EST tidy, 1.286, D-43): EST Gain that exports `_initialize()` (the WASI
 * reactor convention), which sets a global its process() reads: until `_initialize` has run, every
 * block starts with a NaN (EST-C014), so a host that skips it refuses this plugin, and one that calls
 * it as the spec says (once, with fuel, before `clap_entry`) installs it.
 */
#define FIXTURE_ID "org.cyber.est.init-ok"
#define FIXTURE_NAME "Initialize OK"
#include "est_rt.h"
static clap_process_status plugin_process(const clap_plugin_t *p, const clap_process_t *proc);
#define plugin_process(p, proc) plugin_process_inner(p, proc)
#include "gain.c"
#undef plugin_process
static volatile uint32_t initialised;
__attribute__((export_name("_initialize"))) void est_initialize(void) { initialised = 0x45535421u; }
static clap_process_status plugin_process(const clap_plugin_t *p, const clap_process_t *proc) {
   clap_process_status st = plugin_process_inner(p, proc);
   if (initialised != 0x45535421u) proc->audio_outputs[0].data32[0][0] = __builtin_nanf("");
   return st;
}
