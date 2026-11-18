// The maths probe (1.805): each function of the freestanding <cmath> exported by name, as a C++
// port would call it (std::, float and double), plus est/runtime.hpp's own. sdk/tests/cppKit.test.ts
// compares each with JavaScript's Math over a sweep. Not a plugin: it has no clap_entry.
#define EST_RUNTIME_IMPL
#include <est/runtime.hpp>
#include <cmath>
#include <cstring>

#define D1(f) extern "C" EST_EXPORT(d_##f) double d_##f(double x) { return std::f(x); }
#define F1(f) extern "C" EST_EXPORT(f_##f) float f_##f(float x) { return std::f(x); }
#define D2(f) extern "C" EST_EXPORT(d_##f) double d_##f(double x, double y) { return std::f(x, y); }
#define F2(f) extern "C" EST_EXPORT(f_##f) float f_##f(float x, float y) { return std::f(x, y); }
#define ALL1(f) D1(f) F1(f)
#define ALL2(f) D2(f) F2(f)

ALL1(sin) ALL1(cos) ALL1(tan) ALL1(asin) ALL1(acos) ALL1(atan) ALL1(sinh) ALL1(cosh) ALL1(tanh)
ALL1(exp) ALL1(exp2) ALL1(log) ALL1(log2) ALL1(log10) ALL1(sqrt) ALL1(cbrt) ALL1(fabs) ALL1(floor)
ALL1(ceil) ALL1(trunc) ALL1(round) ALL1(abs)
ALL2(atan2) ALL2(pow) ALL2(fmod) ALL2(fmin) ALL2(fmax) ALL2(hypot) ALL2(copysign)

// The runtime's own: the old exp (its bits never change), the fast one, tanh and atan.
extern "C" EST_EXPORT(est_exp) double p_est_exp(double x) { return est::exp(x); }
extern "C" EST_EXPORT(est_fast_exp) double p_est_fast_exp(double x) { return est::fast_exp(x); }
extern "C" EST_EXPORT(est_tanh) double p_est_tanh(double x) { return est::tanh(x); }
extern "C" EST_EXPORT(est_atan) double p_est_atan(double x) { return est::atan(x); }

// Mixed and whole-number arguments choose the double function; isnan and friends; <cstring>.
extern "C" EST_EXPORT(mixed) double p_mixed(float a, int n) {
   char buf[8];
   std::memset(buf, 0, sizeof(buf));
   return std::pow(a, n) + std::sqrt(n) + std::pow(2, 0.5) + (std::isnan(a) ? 1000.0 : 0.0) + (std::isinf(a) ? 2000.0 : 0.0) + (std::isfinite(a) ? 0.0 : 4000.0) + buf[3];
}
