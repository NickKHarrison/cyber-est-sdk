/*
 * EST Spin (EST Phase 1 fixture): EST Gain that never returns from its 100th process(). Nothing in
 * a browser can stop a worklet, so this stalls the whole AudioContext until the page reloads: the
 * availability problem the Phase 1 spikes (metering, the validation Worker) address. The EST lab
 * offers it only after a confirmation.
 */
#define FIXTURE_ID "org.cyber.est.spin"
#define FIXTURE_NAME "EST Spin"
#define FIXTURE_FAULT_SPIN 1
#include "gain.c"
