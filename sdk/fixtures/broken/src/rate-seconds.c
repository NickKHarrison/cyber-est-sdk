/*
 * rate-frames.c done right (1.342, R-K): the echo's delay is 0.1 s × the rate activate gives
 * (4410 frames at 44.1 kHz, 4800 at 48), so the parity suite passes it at a delay's tolerance.
 * It shows the suite refuses rate-frames for its rate fault, not for having an echo.
 */
#define FIXTURE_ID "org.cyber.est.rate-seconds"
#define FIXTURE_NAME "Rate (seconds)"
#define RATE_SECONDS 1
#include "rate-frames.c"
