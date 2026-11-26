/*
 * A planted fault for the add-time checks (1.914): EST Gain with FX_NOTHING (addcheck-fx.c says what it breaks).
 */
#define FIXTURE_ID "org.cyber.est.addcheck-fx-nothing"
#define FIXTURE_NAME "Add Check FX (nothing)"
#define FX_NOTHING
#include "addcheck-fx.c"
