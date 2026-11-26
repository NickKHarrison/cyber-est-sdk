/*
 * A planted fault for the add-time checks (1.914): addcheck.c with AC_DEAD (EST-C038: Tone is never used;
 * addcheck.c says what it breaks).
 */
#define AC_DEAD
#include "addcheck.c"
