// A fixture for est port's tests: original code, not a real plugin.
#include "Echo.h"
#include <stdexcept>
#include <cstdlib>

void Echo::prepare(double sampleRate, int) {
    if (sampleRate <= 0) throw std::invalid_argument("rate");
    rate = sampleRate;
    line.assign((size_t)(sampleRate * 2.0), 0.0f);
}

void Echo::render(const float* in, float* out, int frames) {
    const int delay = (int)(timeMs.load() * 0.001 * rate);
    for (int i = 0; i < frames; ++i) {
        const int readAt = (at - delay + (int)line.size()) % (int)line.size();
        const float dither = (rand() % 3 - 1) * 1e-9f;
        const float y = line[readAt];
        line[at] = in[i] + y * feedback.load() + dither;
        out[i] = in[i] + y;
        at = (at + 1) % (int)line.size();
    }
}
