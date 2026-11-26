/*
 * A planted fault for the add-time checks (1.914): addcheck.c with AC_HEAVY at 2700 (EST-C037: sixteen held
 * notes use over three quarters of a block's fuel, under the host's slow-stop bound, so it installs;
 * addcheck.c says what it breaks).
 */
#define AC_HEAVY 2700
#include "addcheck.c"
