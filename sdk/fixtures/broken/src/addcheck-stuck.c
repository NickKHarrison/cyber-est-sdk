/*
 * A planted fault for the add-time checks (1.914): addcheck.c with AC_STUCK (EST-C032: a released note never stops;
 * addcheck.c says what it breaks).
 */
#define AC_STUCK
#include "addcheck.c"
