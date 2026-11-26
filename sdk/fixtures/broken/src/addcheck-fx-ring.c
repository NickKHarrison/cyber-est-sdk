/*
 * A planted fault for the add-time checks (1.914): EST Gain with FX_RING (addcheck-fx.c says what it breaks).
 */
#define FIXTURE_ID "org.cyber.est.addcheck-fx-ring"
#define FIXTURE_NAME "Add Check FX (ring)"
#define FX_RING
#include "addcheck-fx.c"
