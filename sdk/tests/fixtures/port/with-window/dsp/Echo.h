// A fixture for est port's tests: original code, not a real plugin.
#pragma once
#include <atomic>
#include <vector>
#include "Loader.h"

// Knobs: time (10..2000 ms), feedback (0..0.95)
class Echo {
public:
    void prepare(double sampleRate, int maxFrames);
    void setTime(float ms) { timeMs.store(ms); }
    void setFeedback(float amount) { feedback.store(amount); }
    void render(const float* in, float* out, int frames);

private:
    std::atomic<float> timeMs { 250.0f };
    std::atomic<float> feedback { 0.4f };
    std::vector<float> line;
    int at = 0;
    double rate = 48000.0;
};
