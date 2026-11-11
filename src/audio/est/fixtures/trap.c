/*
 * EST Trap (EST Phase 1 fixture): EST Gain that traps (`unreachable`) on its 100th process(), to
 * prove the runtime contains a trap: the instance is silenced and reports, the graph plays on.
 */
#define FIXTURE_ID "org.cyber.est.trap"
#define FIXTURE_NAME "EST Trap"
#define FIXTURE_FAULT_TRAP 1
#include "gain.c"
