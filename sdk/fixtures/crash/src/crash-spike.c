/*
 * EST Crash Spike (1.669, the crash replayer's planted fault): EST Gain that traps in
 * `spike_guard` on an input sample past 0.9 in magnitude while its Gain is over +6 dB.
 */
#define FIXTURE_ID "org.cyber.est.crashspike"
#define FIXTURE_NAME "EST Crash Spike"
#define FIXTURE_FAULT_SPIKE 1
#include "gain.c"
