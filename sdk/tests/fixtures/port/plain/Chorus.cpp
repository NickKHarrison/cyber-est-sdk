// SPDX-License-Identifier: MIT
// A fixture for est port's tests: original code, not a real plugin.
#include "Chorus.h"

Chorus::Chorus() { reset(); }

void Chorus::setSampleRate(double sr) { sampleRate = sr; reset(); }

void Chorus::reset() {
    for (int i = 0; i < kMaxDelay; ++i) lineL[i] = lineR[i] = 0.0f;
    writeAt = 0;
    phase = 0.0f;
}

void Chorus::setRate(float hz) { rate = hz; }
void Chorus::setDepth(float ms) { depth = ms; }
void Chorus::setMix(float amount) { mix = amount; }
void Chorus::setBlockSize(int) {}

void Chorus::processBlock(float* left, float* right, int frames) {
    const float twoPi = 6.2831853f;
    for (int i = 0; i < frames; ++i) {
        phase += twoPi * rate / (float)sampleRate;
        if (phase > twoPi) phase -= twoPi;
        const float delay = (1.0f + std::sin(phase)) * 0.5f * depth * 0.001f * (float)sampleRate + 1.0f;
        int readAt = writeAt - (int)delay;
        if (readAt < 0) readAt += kMaxDelay;
        lineL[writeAt] = left[i];
        lineR[writeAt] = right[i];
        left[i] = left[i] * (1.0f - mix) + lineL[readAt] * mix;
        right[i] = right[i] * (1.0f - mix) + lineR[readAt] * mix;
        writeAt = (writeAt + 1) % kMaxDelay;
    }
}
