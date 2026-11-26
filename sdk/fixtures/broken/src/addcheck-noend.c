/*
 * A planted fault for the add-time checks (1.914): addcheck.c with AC_NOEND (EST-C024's cheap form: the
 * sound ends and the host is never told; addcheck.c says what it breaks).
 */
#define AC_NOEND
#include "addcheck.c"
