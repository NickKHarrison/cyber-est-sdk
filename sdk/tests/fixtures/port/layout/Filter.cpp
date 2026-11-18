// A fixture for est port's tests: original code, not a real plugin. The "host" names below are made
// up: the shapes are what matters (an id, a name, a range, a default).
#include "Filter.h"

static const char* kUnits = "Hz";

ParameterSet makeParameters() {
    ParameterSet set;
    set.add(makeFloat("cutoff", "Cutoff", Range(20.0f, 20000.0f, 0.1f, 0.3f), 1000.0f));
    set.add(makeFloat({ "res", 1 }, "Resonance",
                      Range { 0.1f, 10.0f },
                      0.707f));
    set.add(makeFloat("gain", "Output Gain", -24.0, 24.0, 0.0));
    set.add(makeChoice("mode", "Mode", 0, 3, 1));
    return set;
}

// A table of the same kind: { name, low, high, start, unit }.
struct Row { const char* name; double lo, hi, start; const char* unit; };
static const Row kRows[] = {
    { "Drive", 0.0, 30.0, 6.0, "dB" },
    { "Width", 0.0, 100.0, 100.0, "%" },
};
