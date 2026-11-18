// SPDX-License-Identifier: MIT
// Written for the EST kit as the worked example of a port (sdk/examples/port-overdrive): original code,
// taken from no product. This file is the "before": it knows nothing of EST, CLAP or WebAssembly.
//
// A small stereo overdrive. Plain C++, no framework. Parameters: drive (0..36 dB), tone (200..12000 Hz
// one-pole low-pass after the clipper), level (-24..+6 dB), mix (0..1).
#pragma once
#include <cmath>

class Overdrive {
public:
    void prepare(double sampleRate) { sr = sampleRate; reset(); updateTone(); }
    void reset() { z[0] = z[1] = 0.0f; }
    void setDrive(float dB) { drive = std::pow(10.0f, dB / 20.0f); }
    void setTone(float hz) { toneHz = hz; updateTone(); }
    void setLevel(float dB) { level = std::pow(10.0f, dB / 20.0f); }
    void setMix(float m) { mix = m < 0 ? 0 : (m > 1 ? 1 : m); }

    // in/out: two channels of n frames each (may alias).
    void process(const float* const* in, float* const* out, int n) {
        for (int c = 0; c < 2; ++c) {
            float s = z[c];
            for (int i = 0; i < n; ++i) {
                const float x = in[c][i];
                float y = shape(x * drive);
                s += a * (y - s);            // one-pole low-pass
                out[c][i] = (x * (1.0f - mix) + s * mix) * level;
            }
            z[c] = s;
        }
    }

private:
    static float shape(float x) {            // asymmetric soft clip
        return x >= 0 ? std::tanh(x) : 0.8f * std::tanh(1.25f * x);
    }
    void updateTone() { a = 1.0f - std::exp(-2.0f * 3.14159265f * toneHz / (float)sr); }
    double sr = 48000.0;
    float drive = 1, toneHz = 6000, level = 1, mix = 1, a = 0.5f, z[2] = {0, 0};
};
