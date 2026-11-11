/*
 * The fixtures' freestanding runtime (EST Phase 1, docs/est/EST_Phase1_Work_Order.md §1.2): the
 * C library functions clang may call (memset, memcpy), a first-fit allocator exported as `malloc`
 * and `free` (spec §3.1: the host allocates its structures in the plugin's memory through them),
 * and the little maths the fixtures need. Built with -nostdlib: nothing is imported.
 */
#pragma once

#include <clap/clap.h>

#define EST_EXPORT(name) __attribute__((export_name(#name), visibility("default")))
#define EST_INTERNAL __attribute__((visibility("hidden")))

EST_INTERNAL void *memset(void *dst, int c, size_t n) {
   unsigned char *d = (unsigned char *)dst;
   while (n--) *d++ = (unsigned char)c;
   return dst;
}

EST_INTERNAL void *memcpy(void *dst, const void *src, size_t n) {
   unsigned char *d = (unsigned char *)dst;
   const unsigned char *s = (const unsigned char *)src;
   while (n--) *d++ = *s++;
   return dst;
}

static int est_streq(const char *a, const char *b) {
   if (!a || !b) return 0;
   while (*a && *a == *b) { a++; b++; }
   return *a == *b;
}

static void est_strcpy(char *dst, const char *src, size_t cap) {
   size_t i = 0;
   for (; src[i] && i + 1 < cap; i++) dst[i] = src[i];
   dst[i] = 0;
}

/* --- The allocator: 16-byte headers, a free list, the heap grown a page at a time. --- */

extern unsigned char __heap_base;

typedef struct est_block {
   size_t size;
   struct est_block *next;
} est_block;

static unsigned char *est_heap_top;
static est_block *est_free_list;

EST_EXPORT(malloc) void *malloc(size_t n) {
   if (!n) n = 1;
   n = (n + 15) & ~(size_t)15;
   est_block **pp = &est_free_list;
   for (est_block *b = est_free_list; b; pp = &b->next, b = b->next) {
      if (b->size >= n) {
         *pp = b->next;
         return (unsigned char *)b + 16;
      }
   }
   if (!est_heap_top) est_heap_top = (unsigned char *)((((size_t)&__heap_base) + 15) & ~(size_t)15);
   size_t need = (size_t)est_heap_top + 16 + n;
   size_t have = __builtin_wasm_memory_size(0) * 65536;
   if (need > have) {
      size_t pages = (need - have + 65535) / 65536;
      if (__builtin_wasm_memory_grow(0, pages) == (size_t)-1) return 0;
   }
   est_block *b = (est_block *)est_heap_top;
   b->size = n;
   est_heap_top += 16 + n;
   return (unsigned char *)b + 16;
}

EST_EXPORT(free) void free(void *p) {
   if (!p) return;
   est_block *b = (est_block *)((unsigned char *)p - 16);
   b->next = est_free_list;
   est_free_list = b;
}

/* --- Maths --- */

#define EST_LN2 0.6931471805599453
#define EST_LN10 2.302585092994046
#define EST_PI 3.141592653589793

static double est_exp(double x) {
   if (x < -700.0) return 0.0;
   if (x > 700.0) x = 700.0;
   int k = (int)(x / EST_LN2 + (x < 0 ? -0.5 : 0.5));
   double r = x - k * EST_LN2, term = 1.0, sum = 1.0;
   for (int i = 1; i < 16; i++) { term *= r / i; sum += term; }
   union { double d; unsigned long long u; } scale;
   scale.u = (unsigned long long)(k + 1023) << 52;
   return sum * scale.d;
}

static double est_db_to_lin(double db) { return db <= -144.0 ? 0.0 : est_exp(db * EST_LN10 / 20.0); }

/* sin(x) for any x: reduced to [-pi, pi], then Taylor to x^17. */
static double est_sin(double x) {
   double turns = x / (2.0 * EST_PI);
   long long n = (long long)(turns + (turns < 0 ? -0.5 : 0.5));
   x -= (double)n * 2.0 * EST_PI;
   double x2 = x * x, term = x, sum = x;
   for (int i = 1; i <= 8; i++) { term *= -x2 / ((2 * i) * (2 * i + 1)); sum += term; }
   return sum;
}

/* "-6.0 dB"-style text for a value (one decimal). */
static void est_format(char *out, size_t cap, double v, const char *unit) {
   char buf[48];
   int i = 0;
   if (v < 0) { buf[i++] = '-'; v = -v; }
   long long tenths = (long long)(v * 10.0 + 0.5);
   long long whole = tenths / 10;
   char digits[24];
   int d = 0;
   do { digits[d++] = (char)('0' + whole % 10); whole /= 10; } while (whole && d < 20);
   while (d) buf[i++] = digits[--d];
   buf[i++] = '.';
   buf[i++] = (char)('0' + tenths % 10);
   if (unit && *unit) { buf[i++] = ' '; while (*unit && i < 46) buf[i++] = *unit++; }
   buf[i] = 0;
   est_strcpy(out, buf, cap);
}

/* A decimal number at the start of `s` (sign, digits, one point); 0 when none. */
static int est_parse(const char *s, double *out) {
   while (*s == ' ') s++;
   double sign = 1.0, v = 0.0, scale = 0.0;
   int any = 0;
   if (*s == '-') { sign = -1.0; s++; } else if (*s == '+') s++;
   for (; *s; s++) {
      if (*s >= '0' && *s <= '9') {
         any = 1;
         if (scale > 0) { v += (*s - '0') * scale; scale /= 10.0; } else v = v * 10.0 + (*s - '0');
      } else if (*s == '.' && scale == 0) scale = 0.1;
      else break;
   }
   if (!any) return 0;
   *out = sign * v;
   return 1;
}

/* Write all of `n` bytes to a CLAP ostream (it may take them in parts). */
static int est_write_all(const clap_ostream_t *s, const void *data, uint64_t n) {
   const unsigned char *p = (const unsigned char *)data;
   while (n) {
      int64_t w = s->write(s, p, n);
      if (w <= 0) return 0;
      p += w;
      n -= (uint64_t)w;
   }
   return 1;
}

static int est_read_all(const clap_istream_t *s, void *data, uint64_t n) {
   unsigned char *p = (unsigned char *)data;
   while (n) {
      int64_t r = s->read(s, p, n);
      if (r <= 0) return 0;
      p += r;
      n -= (uint64_t)r;
   }
   return 1;
}
