// SPDX-License-Identifier: MIT
// A fixture for est port's tests: original code, not a real plugin.
#pragma once
#include <cmath>
#include <cstdint>

enum ChorusParam { kParamRate = 0, kParamDepth, kParamMix, kParamCount };

class Chorus {
public:
    Chorus();
    void setSampleRate(double sampleRate);
    void reset();
    void setRate(float hz);      // 0.05 .. 8 Hz
    void setDepth(float ms);     // 0 to 12 ms
    void setMix(float amount);
    void setBlockSize(int frames);
    void processBlock(float* left, float* right, int frames);

private:
    static const int kMaxDelay = 4096;
    double sampleRate = 44100.0;
    float rate = 0.8f, depth = 3.0f, mix = 0.5f;
    float phase = 0.0f;
    float lineL[kMaxDelay], lineR[kMaxDelay];
    int writeAt = 0;
};
