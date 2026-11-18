// A fixture for est port's tests: original code, not a real plugin.
#pragma once
#include "host/ParameterSet.h"

class Filter {
public:
    void prepare(double sampleRate);
    float tick(float x);
private:
    float z1 = 0.0f, z2 = 0.0f;
};
