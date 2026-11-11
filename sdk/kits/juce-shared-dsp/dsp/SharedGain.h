// The shared DSP (sdk/docs/porting-juce.md): one header, no JUCE, no CLAP and no EST in it, built
// into both the desktop plugin (juce/PluginProcessor.cpp) and the EST module (est/src/plugin.cpp).
// Your own DSP goes here (or in a static library both targets link); keep it this shape:
//
// - prepare(sampleRate) where JUCE calls prepareToPlay and CLAP calls activate: size buffers there;
// - process(...) on raw channel pointers, frames [from, to): JUCE's processBlock passes the whole
//   AudioBuffer, EST's wrapper passes the frames between two events, so automation is sample
//   accurate in EST with no change here;
// - setters for each parameter, in plain units (dB, Hz), never JUCE's 0-1 normalised values;
// - nothing that allocates, locks, reads a clock or calls rand() while processing.
//
// Its maths comes from <cmath> on the desktop and from est/runtime.hpp in the module (wasm32 has
// no libm): SHARED_EXP below. Both give the same samples to within a float's last bit.
#pragma once

#include <stdint.h>

#if defined(__wasm__)
#include <est/runtime.hpp>
#define SHARED_EXP(x) est::exp(x)
#else
#include <cmath>
#define SHARED_EXP(x) std::exp(x)
#endif

namespace shared {

class Gain {
public:
   static constexpr double kMinDb = -60.0;
   static constexpr double kMaxDb = 12.0;
   static constexpr double kDefaultDb = 0.0;

   void prepare(double sampleRate) {
      coef_ = 1.0 - SHARED_EXP(-1.0 / (0.005 * sampleRate)); // a 5 ms glide
      current_ = target_;
   }
   void reset() { current_ = target_; }

   void setGainDb(double db) {
      db_ = !(db >= kMinDb) ? kMinDb : db > kMaxDb ? kMaxDb : db; // NaN becomes the minimum
      target_ = SHARED_EXP(db_ * (2.302585092994046 / 20.0));
   }
   double gainDb() const { return db_; }

   void process(const float *const *in, float *const *out, uint32_t channels, uint32_t from, uint32_t to) {
      for (uint32_t n = from; n < to; n++) {
         current_ += (target_ - current_) * coef_;
         for (uint32_t c = 0; c < channels; c++) out[c][n] = (float)(in[c][n] * current_);
      }
   }

private:
   double db_ = kDefaultDb, target_ = 1.0, current_ = 1.0, coef_ = 1.0;
};

} // namespace shared
