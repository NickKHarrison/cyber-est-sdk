// The adapter: the one class src/plugin.cpp (the CLAP side) calls, and the only new sound-side code
// of this port. It holds the original class, untouched (src/original/Overdrive.h), and hands it the
// sample rate, the knobs and the audio. The original says std::pow, std::exp and std::tanh from
// <cmath>; the kit's own <cmath> answers on wasm32.
#pragma once

#include <stdint.h>
#include "original/Overdrive.h"

namespace port {

class Adapter {
public:
   /// The sample rate is known. The original allocates nothing, so there is nothing to size.
   void prepare(double sampleRate) {
      overdrive_.prepare(sampleRate);
      quietLimit_ = (uint32_t)(0.25 * sampleRate);
      quiet_ = 0;
   }

   /// Forget what is ringing: the original clears its two filter states.
   void reset() {
      overdrive_.reset();
      quiet_ = 0;
   }

   /// A parameter moved. `v` is in the parameter's own unit, inside its range, never NaN
   /// (plugin.cpp's setParam clamps it). The original's setters take the same units.
   void setParam(uint32_t id, double v) {
      switch (id) {
         case 0: overdrive_.setDrive((float)v); break; // dB
         case 1: overdrive_.setTone((float)v); break;  // Hz
         case 2: overdrive_.setLevel((float)v); break; // dB
         case 3: overdrive_.setMix((float)v); break;   // 0 to 1
         default: break;
      }
   }

   /// Frames [from, to). The original processes two channels of n frames from the start of the
   /// buffers it is given, so it gets pointers moved on by `from`.
   void process(const float *const *in, float *const *out, uint32_t channels, uint32_t from, uint32_t to) {
      if (channels < 2) { // never with est.json's stereo ports; pass a lone channel through
         for (uint32_t c = 0; c < channels; c++)
            for (uint32_t n = from; n < to; n++) out[c][n] = in[c][n];
         return;
      }
      // Read before the original writes: `in` and `out` may be the same buffers.
      bool silent = true;
      for (uint32_t n = from; n < to && silent; n++) silent = in[0][n] == 0.0f && in[1][n] == 0.0f;

      const float *const i2[2] = { in[0] + from, in[1] + from };
      float *const o2[2] = { out[0] + from, out[1] + from };
      overdrive_.process(i2, o2, (int)(to - from));

      // The one thing a desktop build never needed. WebAssembly has no flush-to-zero, and the
      // original's low-pass state, decaying in silence, stops just above zero at low Tone and stays
      // there (the validator's EST-C027). After a quarter second of digital silence the state is
      // below e^(-2 pi * 200 Hz * 0.25 s) = e^-314 of where it was (200 Hz is the lowest Tone), far
      // under anything a float can hear, so clearing it then changes no sample anyone could tell.
      if (!silent) quiet_ = 0;
      else if (quiet_ < quietLimit_) {
         quiet_ += to - from;
         if (quiet_ >= quietLimit_) overdrive_.reset();
      }
   }

private:
   Overdrive overdrive_;
   uint32_t quiet_ = 0;           // frames of digital silence in a row
   uint32_t quietLimit_ = 12000;  // a quarter second, set in prepare
};

} // namespace port
