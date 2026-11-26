/*
 * A planted fault for the add-time checks (1.914): addcheck.c with AC_LOWKEYS (EST-C031: keys below 60 make no sound;
 * addcheck.c says what it breaks).
 */
#define AC_LOWKEYS
#include "addcheck.c"
