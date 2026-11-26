/*
 * A planted fault for the add-time checks (1.914): EST Gain with FX_SILENT (addcheck-fx.c says what it breaks).
 */
#define FIXTURE_ID "org.cyber.est.addcheck-fx-silent"
#define FIXTURE_NAME "Add Check FX (silent)"
#define FX_SILENT
#include "addcheck-fx.c"
