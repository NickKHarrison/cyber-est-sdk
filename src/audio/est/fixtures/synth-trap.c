/*
 * EST Synth Trap (EST Tidy, ET-B: the security checklist's §9.4 for instruments): EST Synth that
 * plays its notes and traps (`unreachable`) on the 100th block after its first note-on, so a note
 * is sounding when it traps: the runtime must silence the instance without a click or a stuck note,
 * and only its track.
 */
#define FIXTURE_ID "org.cyber.est.synth-trap"
#define FIXTURE_NAME "EST Synth Trap"
#define FIXTURE_WHAT "EST Synth that traps on the 100th block after its first note: it should silence only its track."
#define FIXTURE_FAULT_TRAP 1
#include "synth.c"
