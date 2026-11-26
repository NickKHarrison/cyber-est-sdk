/*
 * The add-time checks' serious load case (1.914): addcheck.c with AC_HEAVY at 2850: sixteen held notes pass
 * the host's slow-stop bound (90 % of a block's fuel). The install's own conformance run reaches sixteen
 * voices too, so Cyber refuses this one at install (EST-C013, "slow"): it is not in addchecks.json. It is
 * here for the checks' own tests (the serious finding, the function named from the profiling build), which
 * stand for what the conformance run does not reach in a real plugin: its heaviest notes, its densest input.
 */
#define AC_HEAVY 2850
#include "addcheck.c"
