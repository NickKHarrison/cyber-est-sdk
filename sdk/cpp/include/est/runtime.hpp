/*
 * The EST C and C++ runtime (EST-DEV-3, DEV-G: the porting kit, sdk/docs/porting-cpp.md). An EST
 * module is built with no libc: `-nostdlib -ffreestanding`, so nothing is imported (spec §3.1).
 * This header is the little a CLAP plugin needs instead:
 *
 * - the C library functions the compiler calls on its own (`memset`, `memcpy`, `memmove`,
 *   `memcmp`), an allocator exported as `malloc` and `free` (the host allocates its structures in
 *   the plugin's memory through them), and `_initialize`, which runs your static constructors
 *   (the host calls it once, with fuel, before it reads `clap_entry`);
 * - C++'s `new` and `delete` (on `malloc`), placement `new`, and the two ABI functions a
 *   freestanding build may still name (`__cxa_pure_virtual`, `__cxa_atexit`);
 * - `est::` maths without libm (`exp`, `log`, `sin`, `cos`, `tan`, `pow`, `db_to_gain`,
 *   `gain_to_db`; `sqrt`, `floor`, `fabs` are single WebAssembly instructions), the same results
 *   on every engine, so a render is deterministic. Since 1.805 also `est::fast_exp` (no division:
 *   the one to call per sample), `est::tanh` and `est::atan`;
 * - (1.805) `<cmath>` and `<math.h>` themselves, for a port: `sdk/cpp/freestanding/` holds small
 *   versions built on the functions here, found only where your clang brings no C++ library of
 *   its own. What they have: `sin cos tan asin acos atan atan2 sinh cosh tanh exp exp2 log log2
 *   log10 pow sqrt cbrt hypot fabs abs floor ceil trunc round fmod fmin fmax copysign isnan isinf
 *   isfinite`, each for `float` and `double` (`sinf` …), and `M_PI` and friends. What they have
 *   not: `long double`, `erf`, `tgamma`, `lgamma`, `frexp`, `ldexp`, `modf`, `remainder`,
 *   `nextafter`, `fma`, `lround`, `lrint`, `fenv`. Costs: `exp`, `exp2`, `tanh`, `sinh`, `cosh`
 *   are about 15 multiplications; `sin`, `cos`, `atan` about 20 operations; `log`, `log2`,
 *   `log10` and so `pow` cost about 20 divisions: call those when a knob moves, not per sample;
 * - `est::write_all` / `est::read_all` for `clap.state`'s streams, `est::streq`, `est::strcpy`.
 *
 * Include it everywhere you need it; in exactly one source file define `EST_RUNTIME_IMPL` first
 * (the definitions of the exported functions live there):
 *
 *     #define EST_RUNTIME_IMPL
 *     #include <est/runtime.hpp>
 *
 * Works as C11 too (without the C++ parts and with `est_` names: `est_exp`, `est_db_to_gain` …).
 * MIT, as the rest of the SDK.
 */
#pragma once

#include <stddef.h>
#include <stdint.h>
#include <clap/clap.h>

#ifdef __cplusplus
#define EST_EXTERN_C extern "C"
#else
#define EST_EXTERN_C
#endif

/* An export by name: `EST_EXPORT(my_name) int f(void)`. The plugin's own exports are only these. */
#define EST_EXPORT(name) __attribute__((export_name(#name), visibility("default")))

EST_EXTERN_C void *memset(void *dst, int c, size_t n);
EST_EXTERN_C void *memcpy(void *dst, const void *src, size_t n);
EST_EXTERN_C void *memmove(void *dst, const void *src, size_t n);
EST_EXTERN_C int memcmp(const void *a, const void *b, size_t n);
EST_EXTERN_C void *malloc(size_t n);
EST_EXTERN_C void free(void *p);

/* ---------------------------------------------------------------------------------------------
 * Maths. No libm: `exp` from a Taylor series after range reduction, `log` from atanh's series,
 * `sin` and `cos` reduced to [-pi/4, pi/4]. Accurate to about 1e-15 relative over the audio range.
 * Each is pure arithmetic, so a render is the same bits in every browser.
 * ------------------------------------------------------------------------------------------- */

#define EST_LN2 0.6931471805599453
#define EST_LN10 2.302585092994046
#define EST_PI 3.141592653589793

static inline double est_fabs(double x) { return __builtin_fabs(x); }
static inline double est_sqrt(double x) { return __builtin_sqrt(x); }
static inline double est_floor(double x) { return __builtin_floor(x); }
static inline double est_clamp(double x, double lo, double hi) { return x < lo ? lo : x > hi ? hi : x; }

static inline double est_exp(double x) {
   if (x != x) return x;
   if (x < -745.0) return 0.0;
   if (x > 709.0) x = 709.0;
   double kf = est_floor(x / EST_LN2 + 0.5);
   int k = (int)kf;
   double r = x - kf * EST_LN2, term = 1.0, sum = 1.0;
   for (int i = 1; i < 18; i++) { term *= r / i; sum += term; }
   /* 2^k in two steps, so k below -1022 still scales correctly. */
   int k1 = k / 2, k2 = k - k1;
   union { double d; uint64_t u; } a, b;
   a.u = (uint64_t)(k1 + 1023) << 52;
   b.u = (uint64_t)(k2 + 1023) << 52;
   return sum * a.d * b.d;
}

static inline double est_log(double x) {
   if (!(x > 0.0)) return x == 0.0 ? -1.0 / 0.0 : 0.0 / 0.0;
   union { double d; uint64_t u; } v;
   v.d = x;
   int e = (int)((v.u >> 52) & 0x7ff) - 1023;
   if (e == -1023) { v.d = x * 4503599627370496.0; e = (int)((v.u >> 52) & 0x7ff) - 1023 - 52; } /* subnormal */
   v.u = (v.u & 0x000fffffffffffffull) | 0x3ff0000000000000ull; /* the mantissa, in [1, 2) */
   double m = v.d;
   if (m > 1.4142135623730951) { m *= 0.5; e++; }
   double s = (m - 1.0) / (m + 1.0), s2 = s * s, term = s, sum = 0.0;
   for (int i = 1; i < 40; i += 2) { sum += term / i; term *= s2; }
   return 2.0 * sum + e * EST_LN2;
}

/* exp without a division (1.805): the argument reduced to |r| <= ln(2)/2 with ln 2 in two parts,
 * then a degree-13 polynomial (the next term is below 2e-16 of the sum). Within 3e-16 relative of
 * the true value from -700 to 700 (`est_exp` drifts to 8e-14 at the far ends; it is left exactly
 * as it was, for the renders that already depend on its bits).
 * `est_expm1_small_` is exp(r) - 1 for |r| <= 0.35, exact to the last bits near 0. */
#define EST_LN2_HI 6.93147180369123816490e-01
#define EST_LN2_LO 1.90821492927058770002e-10
static inline double est_expm1_small_(double r) {
   double p = 1.6059043836821613e-10;      /* 1/13! */
   p = p * r + 2.08767569878681e-09;        /* 1/12! */
   p = p * r + 2.505210838544172e-08;       /* 1/11! */
   p = p * r + 2.755731922398589e-07;       /* 1/10! */
   p = p * r + 2.7557319223985893e-06;      /* 1/9! */
   p = p * r + 2.48015873015873e-05;        /* 1/8! */
   p = p * r + 1.984126984126984e-04;       /* 1/7! */
   p = p * r + 1.388888888888889e-03;       /* 1/6! */
   p = p * r + 8.333333333333333e-03;       /* 1/5! */
   p = p * r + 4.1666666666666664e-02;      /* 1/4! */
   p = p * r + 1.6666666666666666e-01;      /* 1/3! */
   p = p * r + 0.5;
   p = p * r + 1.0;
   return p * r;
}
/* v * 2^k for k in [-2046, 2046], in two steps so a result below 2^-1022 still scales correctly. */
static inline double est_scale2_(double v, int k) {
   int k1 = k / 2, k2 = k - k1;
   union { double d; uint64_t u; } a, b;
   a.u = (uint64_t)(k1 + 1023) << 52;
   b.u = (uint64_t)(k2 + 1023) << 52;
   return v * a.d * b.d;
}
static inline double est_fast_exp(double x) {
   if (x != x) return x;
   if (x < -745.0) return 0.0;
   if (x > 709.0) x = 709.0;
   double kf = est_floor(x * 1.4426950408889634 + 0.5); /* x / ln 2, rounded */
   int k = (int)kf;
   double r = (x - kf * EST_LN2_HI) - kf * EST_LN2_LO;
   return est_scale2_(1.0 + est_expm1_small_(r), k);
}

/* tanh (1.805): one division. Small arguments go through exp(2x) - 1 computed directly, so
 * tanh(x) is x to the last bits near 0 (a quiet signal stays itself); past 19 it is 1. */
static inline double est_tanh(double x) {
   if (x != x) return x;
   double a = est_fabs(x), t;
   if (a > 19.0) t = 1.0;
   else if (a < 0.17) { double m = est_expm1_small_(2.0 * a); t = m / (m + 2.0); }
   else { double e = est_fast_exp(2.0 * a); t = (e - 1.0) / (e + 1.0); }
   return x < 0.0 ? -t : t;
}

/* atan (1.805): |x| > 1 folded to 1/x, then past tan(pi/12) rotated by pi/6, then the series to
 * x^31 (|x| <= 0.268, so the next term is below 1e-19). */
static inline double est_atan(double x) {
   if (x != x) return x;
   double a = est_fabs(x), add = 0.0, sgn = 1.0;
   if (a > 1.0) { a = 1.0 / a; add = 1.5707963267948966; sgn = -1.0; }
   double off = 0.0;
   if (a > 0.2679491924311227) { a = (1.7320508075688772 * a - 1.0) / (1.7320508075688772 + a); off = 0.5235987755982989; }
   double a2 = a * a, sum = 0.0;
   for (int i = 31; i >= 1; i -= 2) sum = sum * a2 + ((i & 2) ? -1.0 : 1.0) / i;
   double r = add + sgn * (off + sum * a);
   return x < 0.0 ? -r : r;
}

static inline double est_pow(double base, double ex) { return base <= 0.0 ? (ex == 0.0 ? 1.0 : 0.0) : est_exp(ex * est_log(base)); }

static inline double est_sin_core(double x) { /* |x| <= pi/4 */
   double x2 = x * x, term = x, sum = x;
   for (int i = 1; i <= 9; i++) { term *= -x2 / ((2 * i) * (2 * i + 1)); sum += term; }
   return sum;
}
static inline double est_cos_core(double x) {
   double x2 = x * x, term = 1.0, sum = 1.0;
   for (int i = 1; i <= 9; i++) { term *= -x2 / ((2 * i - 1) * (2 * i)); sum += term; }
   return sum;
}
static inline double est_sin(double x) {
   double q = est_floor(x / (EST_PI / 2) + 0.5);
   double r = x - q * (EST_PI / 2);
   int n = (int)((int64_t)q & 3);
   return n == 0 ? est_sin_core(r) : n == 1 ? est_cos_core(r) : n == 2 ? -est_sin_core(r) : -est_cos_core(r);
}
static inline double est_cos(double x) { return est_sin(x + EST_PI / 2); }
static inline double est_tan(double x) { return est_sin(x) / est_cos(x); }

/* A level in dB as a gain; -144 dB or below is silence. */
static inline double est_db_to_gain(double db) { return db <= -144.0 ? 0.0 : est_exp(db * (EST_LN10 / 20.0)); }
static inline double est_gain_to_db(double g) { return g <= 0.0 ? -144.0 : 20.0 * est_log(g) / EST_LN10; }

/* ---------------------------------------------------------------------------------------------
 * Strings and CLAP's streams.
 * ------------------------------------------------------------------------------------------- */

static inline int est_streq(const char *a, const char *b) {
   if (!a || !b) return 0;
   while (*a && *a == *b) { a++; b++; }
   return *a == *b;
}

/* At most `cap - 1` characters and a terminator (CLAP's fixed-size name fields). */
static inline void est_strcpy(char *dst, const char *src, size_t cap) {
   if (!cap) return;
   size_t i = 0;
   for (; src && src[i] && i + 1 < cap; i++) dst[i] = src[i];
   dst[i] = 0;
}

/* Write all `n` bytes to a CLAP ostream (it may take them in parts). */
static inline int est_write_all(const clap_ostream_t *s, const void *data, uint64_t n) {
   const unsigned char *p = (const unsigned char *)data;
   while (n) {
      int64_t w = s->write(s, p, n);
      if (w <= 0) return 0;
      p += w;
      n -= (uint64_t)w;
   }
   return 1;
}

/* Read exactly `n` bytes from a CLAP istream; 0 when it ends first. */
static inline int est_read_all(const clap_istream_t *s, void *data, uint64_t n) {
   unsigned char *p = (unsigned char *)data;
   while (n) {
      int64_t r = s->read(s, p, n);
      if (r <= 0) return 0;
      p += r;
      n -= (uint64_t)r;
   }
   return 1;
}

#ifdef __cplusplus
/* The same, as `est::` for C++. */
namespace est {
inline double fabs(double x) { return est_fabs(x); }
inline double sqrt(double x) { return est_sqrt(x); }
inline double floor(double x) { return est_floor(x); }
inline double clamp(double x, double lo, double hi) { return est_clamp(x, lo, hi); }
inline double exp(double x) { return est_exp(x); }
inline double fast_exp(double x) { return est_fast_exp(x); }
inline double tanh(double x) { return est_tanh(x); }
inline double atan(double x) { return est_atan(x); }
inline double log(double x) { return est_log(x); }
inline double pow(double b, double e) { return est_pow(b, e); }
inline double sin(double x) { return est_sin(x); }
inline double cos(double x) { return est_cos(x); }
inline double tan(double x) { return est_tan(x); }
inline double db_to_gain(double db) { return est_db_to_gain(db); }
inline double gain_to_db(double g) { return est_gain_to_db(g); }
inline bool streq(const char *a, const char *b) { return est_streq(a, b) != 0; }
inline void strcpy(char *dst, const char *src, size_t cap) { est_strcpy(dst, src, cap); }
inline bool write_all(const clap_ostream_t *s, const void *d, uint64_t n) { return est_write_all(s, d, n) != 0; }
inline bool read_all(const clap_istream_t *s, void *d, uint64_t n) { return est_read_all(s, d, n) != 0; }
} // namespace est

/* Placement new: construct an object in memory you already have. */
inline void *operator new(size_t, void *p) noexcept { return p; }
inline void *operator new[](size_t, void *p) noexcept { return p; }
#endif

/* ---------------------------------------------------------------------------------------------
 * The definitions: in exactly one source file, after `#define EST_RUNTIME_IMPL`.
 * ------------------------------------------------------------------------------------------- */
#ifdef EST_RUNTIME_IMPL

/* `no_builtin`: clang must not turn these loops back into calls to themselves. */
EST_EXTERN_C __attribute__((no_builtin("memset"))) void *memset(void *dst, int c, size_t n) {
   unsigned char *d = (unsigned char *)dst;
   while (n--) *d++ = (unsigned char)c;
   return dst;
}

EST_EXTERN_C __attribute__((no_builtin("memcpy"))) void *memcpy(void *dst, const void *src, size_t n) {
   unsigned char *d = (unsigned char *)dst;
   const unsigned char *s = (const unsigned char *)src;
   while (n--) *d++ = *s++;
   return dst;
}

EST_EXTERN_C __attribute__((no_builtin("memmove"))) void *memmove(void *dst, const void *src, size_t n) {
   unsigned char *d = (unsigned char *)dst;
   const unsigned char *s = (const unsigned char *)src;
   if (d < s) while (n--) *d++ = *s++;
   else { d += n; s += n; while (n--) *--d = *--s; }
   return dst;
}

EST_EXTERN_C __attribute__((no_builtin("memcmp"))) int memcmp(const void *a, const void *b, size_t n) {
   const unsigned char *x = (const unsigned char *)a, *y = (const unsigned char *)b;
   for (; n; n--, x++, y++) if (*x != *y) return *x < *y ? -1 : 1;
   return 0;
}

/* A first-fit allocator: 16-byte headers, a free list, the heap grown a page at a time up to the
 * module's memory maximum (a `memory.grow` past it fails: `malloc` answers null). Allocate in
 * `activate`, never in `process`. */
extern unsigned char __heap_base;

typedef struct est_block_ {
   size_t size;
   struct est_block_ *next;
} est_block_;

static unsigned char *est_heap_top_;
static est_block_ *est_free_list_;

EST_EXTERN_C EST_EXPORT(malloc) void *malloc(size_t n) {
   /* Never wrap: a size this close to the address space's end has no room (and the host may
    * ask for any size). */
   if (n > (size_t)-1 - 32) return 0;
   if (!n) n = 1;
   n = (n + 15) & ~(size_t)15;
   est_block_ **pp = &est_free_list_;
   for (est_block_ *b = est_free_list_; b; pp = &b->next, b = b->next) {
      if (b->size >= n) {
         *pp = b->next;
         return (unsigned char *)b + 16;
      }
   }
   if (!est_heap_top_) est_heap_top_ = (unsigned char *)((((size_t)&__heap_base) + 15) & ~(size_t)15);
   if (n > (size_t)-1 - 16 - (size_t)est_heap_top_) return 0;
   size_t need = (size_t)est_heap_top_ + 16 + n;
   size_t have = __builtin_wasm_memory_size(0) * 65536;
   if (need > have) {
      size_t pages = (need - have + 65535) / 65536;
      if (__builtin_wasm_memory_grow(0, pages) == (size_t)-1) return 0;
   }
   est_block_ *b = (est_block_ *)est_heap_top_;
   b->size = n;
   est_heap_top_ += 16 + n;
   return (unsigned char *)b + 16;
}

EST_EXTERN_C EST_EXPORT(free) void free(void *p) {
   if (!p) return;
   est_block_ *b = (est_block_ *)((unsigned char *)p - 16);
   b->next = est_free_list_;
   est_free_list_ = b;
}

/* wasm-ld writes this: every static constructor, in order. */
EST_EXTERN_C void __wasm_call_ctors(void);

/* The host calls `_initialize` once, with fuel, before it reads `clap_entry` (EST tidy, 1.286). */
EST_EXTERN_C EST_EXPORT(_initialize) void est_initialize_(void) { __wasm_call_ctors(); }

#ifdef __cplusplus
void *operator new(size_t n) { return malloc(n); }
void *operator new[](size_t n) { return malloc(n); }
void operator delete(void *p) noexcept { free(p); }
void operator delete[](void *p) noexcept { free(p); }
void operator delete(void *p, size_t) noexcept { free(p); }
void operator delete[](void *p, size_t) noexcept { free(p); }
/* A pure virtual called during construction or destruction: a bug, so a trap. */
extern "C" void __cxa_pure_virtual() { __builtin_trap(); }
/* Static destructors never run (a plugin module is never unloaded, only dropped). */
extern "C" int __cxa_atexit(void (*)(void *), void *, void *) { return 0; }
#endif

#endif /* EST_RUNTIME_IMPL */
