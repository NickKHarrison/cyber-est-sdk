// The DSP: a smoothed gain. Plain C++ with no CLAP, no EST and no allocation in it, so the same file
// builds into your desktop plugin and into the EST module (sdk/docs/porting-cpp.md, porting-juce.md).
// This is what you replace with your own DSP; src/plugin.cpp is the CLAP side, which calls it.
//
// What keeps it portable: it takes its maths from `est/runtime.hpp` on wasm32 and from <cmath> on
// the desktop (the EST_MATH switch below), it allocates nothing, and it reads no clock and no
// random numbers, so the same input and events give the same output, bit for bit.
#pragma once

#include <stdint.h>

#if defined(__wasm__)
#include <est/runtime.hpp>
namespace gain_math { inline double exp(double x) { return est::exp(x); } }
#else
#include <cmath>
namespace gain_math { inline double exp(double x) { return std::exp(x); } }
#endif

namespace dsp {

class Gain {
public:
   static constexpr double kMinDb = -60.0;
   static constexpr double kMaxDb = 12.0;
   static constexpr double kDefaultDb = 0.0;
   /// The gain glides to a new value over about 5 ms (a one-pole), so automation never clicks.
   static constexpr double kSmoothingSeconds = 0.005;

   /// The sample rate is known: set the smoothing coefficient and jump to the target.
   void prepare(double sampleRate) {
      coef_ = 1.0 - gain_math::exp(-1.0 / (kSmoothingSeconds * sampleRate));
      current_ = target_;
   }

   /// Forget the glide (a transport jump, a reset).
   void reset() { current_ = target_; }

   void setGainDb(double db) {
      db_ = !(db >= kMinDb) ? kMinDb : db > kMaxDb ? kMaxDb : db; // NaN becomes the minimum
      target_ = db_ <= -144.0 ? 0.0 : gain_math::exp(db_ * (2.302585092994046 / 20.0));
   }
   double gainDb() const { return db_; }

   /// Frames [from, to) of `channels` channels. `in` and `out` may be the same buffers.
   void process(const float *const *in, float *const *out, uint32_t channels, uint32_t from, uint32_t to) {
      for (uint32_t n = from; n < to; n++) {
         current_ += (target_ - current_) * coef_;
         for (uint32_t c = 0; c < channels; c++) out[c][n] = (float)(in[c][n] * current_);
      }
   }

private:
   double db_ = kDefaultDb;
   double target_ = 1.0;
   double current_ = 1.0;
   double coef_ = 1.0;
};

} // namespace dsp
