/*
 * A broken EST fixture (1.652): behave.c with FAULT_SUBNORMAL (EST-C027; behave.c says what it breaks).
 */
#define FAULT_SUBNORMAL
#include "behave.c"
