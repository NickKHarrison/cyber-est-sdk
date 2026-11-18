/* EST's freestanding <string.h> (1.805): the four memory functions est/runtime.hpp gives a module
 * (memset, memcpy, memmove, memcmp), so a source that includes <string.h> or <cstring> for them
 * compiles as it is. No string functions (strlen, strcmp …): `est::streq`, `est::strcpy`. */
#ifndef EST_FREESTANDING_STRING_H
#define EST_FREESTANDING_STRING_H
#include <est/runtime.hpp>
#endif
