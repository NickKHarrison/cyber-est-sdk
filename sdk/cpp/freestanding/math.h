/*
 * EST's freestanding <math.h> (1.805, "Bring your plugin"): the maths a C or C++ port names, built
 * on est/runtime.hpp, so a source that says `tanhf(x)` or `std::pow(a, b)` compiles as it is. An
 * EST module links no libm; these are `static inline`, pure arithmetic, the same bits in every
 * browser. Found last (`-idirafter`), so a C library your own clang brings wins.
 *
 * Has: sin cos tan asin acos atan atan2 sinh cosh tanh exp exp2 log log2 log10 pow sqrt cbrt hypot
 * fabs floor ceil trunc round fmod fmin fmax copysign, each with its `f` twin for float, the
 * M_ constants, INFINITY, NAN, and in C isnan, isinf, isfinite (in C++ <cmath> has them as
 * std::isnan …, with std::abs).
 * Has not: long double, erf, tgamma, lgamma, frexp, ldexp, modf, remainder, nextafter, fma,
 * lround, lrint, fenv. Write the one you need from the ones here.
 * Costs: exp, exp2, tanh, sinh, cosh are about 15 multiplications; log, log2, log10 and pow about
 * 20 divisions (call them when a knob moves, not per sample). Results are within a few 1e-16
 * relative of a desktop libm, not bit-identical to it: `est compare` measures the difference.
 * `fmod` is x - trunc(x / y) * y: right while |x / y| is below 2^53.
 */
#ifndef EST_FREESTANDING_MATH_H
#define EST_FREESTANDING_MATH_H

#include <est/runtime.hpp>

#define M_E 2.718281828459045
#define M_LOG2E 1.4426950408889634
#define M_LOG10E 0.4342944819032518
#define M_LN2 0.6931471805599453
#define M_LN10 2.302585092994046
#define M_PI 3.141592653589793
#define M_PI_2 1.5707963267948966
#define M_PI_4 0.7853981633974483
#define M_1_PI 0.3183098861837907
#define M_2_PI 0.6366197723675814
#define M_SQRT2 1.4142135623730951
#define M_SQRT1_2 0.7071067811865476
#define INFINITY (__builtin_inff())
#define NAN (__builtin_nanf(""))
#define HUGE_VAL (__builtin_inf())
#define HUGE_VALF (__builtin_inff())

/* Single WebAssembly instructions. */
static inline double fabs(double x) { return __builtin_fabs(x); }
static inline float fabsf(float x) { return __builtin_fabsf(x); }
static inline double sqrt(double x) { return __builtin_sqrt(x); }
static inline float sqrtf(float x) { return __builtin_sqrtf(x); }
static inline double floor(double x) { return __builtin_floor(x); }
static inline float floorf(float x) { return __builtin_floorf(x); }
static inline double ceil(double x) { return __builtin_ceil(x); }
static inline float ceilf(float x) { return __builtin_ceilf(x); }
static inline double trunc(double x) { return __builtin_trunc(x); }
static inline float truncf(float x) { return __builtin_truncf(x); }
static inline double copysign(double x, double y) { return __builtin_copysign(x, y); }
static inline float copysignf(float x, float y) { return __builtin_copysignf(x, y); }

static inline double sin(double x) { return est_sin(x); }
static inline double cos(double x) { return est_cos(x); }
static inline double tan(double x) { return est_tan(x); }
static inline double atan(double x) { return est_atan(x); }
static inline double exp(double x) { return est_fast_exp(x); }
static inline double exp2(double x) {
   if (x != x) return x;
   if (x < -1080.0) return 0.0;
   if (x > 1023.0) x = 1023.0;
   double kf = __builtin_floor(x + 0.5);
   return est_scale2_(1.0 + est_expm1_small_((x - kf) * M_LN2), (int)kf);
}
static inline double log(double x) { return est_log(x); }
static inline double log2(double x) { return est_log(x) * M_LOG2E; }
static inline double log10(double x) { return est_log(x) * M_LOG10E; }
static inline double tanh(double x) { return est_tanh(x); }

static inline double sinh(double x) {
   double a = __builtin_fabs(x), r;
   if (a < 0.3) { double m = est_expm1_small_(a); r = 0.5 * (m + m / (m + 1.0)); }
   else { double e = est_fast_exp(a); r = 0.5 * (e - 1.0 / e); }
   return x < 0.0 ? -r : r;
}
static inline double cosh(double x) { double e = est_fast_exp(__builtin_fabs(x)); return 0.5 * (e + 1.0 / e); }

static inline double atan2(double y, double x) {
   if (x != x || y != y) return x + y;
   if (x == 0.0) return y == 0.0 ? 0.0 : y > 0.0 ? M_PI_2 : -M_PI_2;
   double a = est_atan(y / x);
   return x > 0.0 ? a : (y < 0.0 ? a - M_PI : a + M_PI);
}
static inline double asin(double x) { return x > 1.0 || x < -1.0 ? 0.0 / 0.0 : atan2(x, __builtin_sqrt((1.0 - x) * (1.0 + x))); }
static inline double acos(double x) { return x > 1.0 || x < -1.0 ? 0.0 / 0.0 : atan2(__builtin_sqrt((1.0 - x) * (1.0 + x)), x); }

/* Half away from zero, as C's round. */
static inline double round(double x) {
   double t = __builtin_trunc(x), f = x - t;
   return f >= 0.5 ? t + 1.0 : f <= -0.5 ? t - 1.0 : t;
}
static inline double fmod(double x, double y) { return y == 0.0 || x != x || y != y ? 0.0 / 0.0 : x - __builtin_trunc(x / y) * y; }
static inline double fmin(double a, double b) { return a != a ? b : b != b ? a : a < b ? a : b; }
static inline double fmax(double a, double b) { return a != a ? b : b != b ? a : a > b ? a : b; }
static inline double hypot(double x, double y) { return __builtin_sqrt(x * x + y * y); }

/* 0 to a positive power is 0, to a negative one infinity; a negative base takes whole powers only. */
static inline double pow(double b, double e) {
   if (e == 0.0) return 1.0;
   if (b != b || e != e) return b + e;
   if (b == 0.0) return e > 0.0 ? 0.0 : 1.0 / 0.0;
   if (b > 0.0) return est_fast_exp(e * est_log(b));
   double w = __builtin_trunc(e);
   if (w != e) return 0.0 / 0.0;
   double r = est_fast_exp(e * est_log(-b));
   return w - 2.0 * __builtin_trunc(w * 0.5) != 0.0 ? -r : r;
}
static inline double cbrt(double x) { return x == 0.0 || x != x ? x : x < 0.0 ? -pow(-x, 1.0 / 3.0) : pow(x, 1.0 / 3.0); }

#define EST_MATH_F1_(fn) static inline float fn##f(float x) { return (float)fn((double)x); }
#define EST_MATH_F2_(fn) static inline float fn##f(float x, float y) { return (float)fn((double)x, (double)y); }
EST_MATH_F1_(sin) EST_MATH_F1_(cos) EST_MATH_F1_(tan) EST_MATH_F1_(asin) EST_MATH_F1_(acos) EST_MATH_F1_(atan)
EST_MATH_F1_(sinh) EST_MATH_F1_(cosh) EST_MATH_F1_(tanh) EST_MATH_F1_(exp) EST_MATH_F1_(exp2)
EST_MATH_F1_(log) EST_MATH_F1_(log2) EST_MATH_F1_(log10) EST_MATH_F1_(round) EST_MATH_F1_(cbrt)
EST_MATH_F2_(atan2) EST_MATH_F2_(pow) EST_MATH_F2_(fmod) EST_MATH_F2_(fmin) EST_MATH_F2_(fmax) EST_MATH_F2_(hypot)
#undef EST_MATH_F1_
#undef EST_MATH_F2_

#ifndef __cplusplus
#define isnan(x) ((x) != (x))
#define isinf(x) (__builtin_isinf(x))
#define isfinite(x) (__builtin_isfinite(x))
#endif

#endif
