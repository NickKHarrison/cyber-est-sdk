/*
 * A hostile EST fixture (the sandbox attack order, stream E): EST Gain whose every string the DSP
 * reports is an attack. A parameter's name and module are read from the plugin's memory at run time
 * (never the manifest's validated text), so they carry what est.json's `plainText` would refuse:
 * markup, a `javascript:` URL, control bytes (a newline, U+007F, C1 controls) and the longest text
 * CLAP's fields hold (255 and 1023 bytes). Tries: to be drawn anywhere as other than plain text.
 */
#define FIXTURE_ID "dev.a1b2c3d4e5.text-everywhere"
#define FIXTURE_NAME "<img src=x onerror=\"window.__estPwned=1\">"
#include "est_rt.h"
static bool params_get_info(const clap_plugin_t *p, uint32_t index, clap_param_info_t *info);
#define params_get_info(p, index, info) params_get_info_inner(p, index, info)
#include "gain.c"
#undef params_get_info
static void fill(char *dst, const char *head, size_t cap) {
   size_t i = 0;
   for (; head[i] && i + 1 < cap; i++) dst[i] = head[i];
   /* pad to the field's whole length with more markup */
   const char *pad = "<svg onload=window.__estPwned=1>";
   for (size_t k = 0; i + 1 < cap; i++, k++) dst[i] = pad[k % 32];
   dst[i] = 0;
}
static bool params_get_info(const clap_plugin_t *p, uint32_t index, clap_param_info_t *info) {
   bool ok = params_get_info_inner(p, index, info);
   if (ok && index == 0) {
      fill(info->name, "<img src=x onerror=\"window.__estPwned=1\">\n\x7f\x85\x9b]0;x\x07 javascript:window.__estPwned=1 ", sizeof(info->name));
      fill(info->module, "__proto__/</script><script>window.__estPwned=1</script>/constructor/", sizeof(info->module));
   }
   return ok;
}
