/* The maths probe's C half (1.805): <math.h> from C11, the names a C port calls. */
#include <math.h>
#include <string.h>

EST_EXPORT(c_tanhf) float c_tanhf(float x) { return tanhf(x); }
EST_EXPORT(c_powf) float c_powf(float x, float y) { return powf(x, y); }
EST_EXPORT(c_exp) double c_exp(double x) { return exp(x); }
EST_EXPORT(c_isnan) int c_isnan(double x) { return isnan(x) + 2 * isinf(x) + 4 * isfinite(x) + (M_PI > 3.14 ? 8 : 0); }
