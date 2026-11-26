/*
 * A planted fault for the add-time checks (1.914): addcheck.c with AC_EXTREME (EST-C039: Tone and Release at their maximum divide the output by 0;
 * addcheck.c says what it breaks).
 */
#define AC_EXTREME
#include "addcheck.c"
