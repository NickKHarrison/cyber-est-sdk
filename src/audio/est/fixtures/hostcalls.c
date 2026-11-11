/*
 * EST Host Calls (1.314, LR-8b stream A, EST-02): EST Gain that imports two of the WASI functions
 * the host allows, with their preview-1 types, and asks the host for what it should refuse or bound:
 * on its 10th process() `random_get` with a pointer outside its memory (the host answers EFAULT, 21,
 * at once, and writes nothing); on its 20th `fd_write` with 2^31 iovecs (the host clamps the count
 * to what the memory holds, so the call returns within the block); on its 30th `random_get` over
 * 4 KiB of its own memory (allowed: 0). Each call's return code, over 100, is written to the block's first
 * sample of the left channel, and the 30th block's second sample the share of bytes the host wrote
 * (within the host's ±4 output clamp, so a test reads them from the output). `estProcessor.test.ts`.
 */
#define FIXTURE_ID "org.cyber.est.hostcalls"
#define FIXTURE_NAME "EST Host Calls"
#include "est_rt.h"
__attribute__((import_module("wasi_snapshot_preview1"), import_name("random_get"))) extern int wasi_random_get(unsigned char *buf, unsigned int len);
__attribute__((import_module("wasi_snapshot_preview1"), import_name("fd_write"))) extern int wasi_fd_write(int fd, const void *iovs, unsigned int n, unsigned int *written);
static clap_process_status plugin_process(const clap_plugin_t *p, const clap_process_t *proc);
#define plugin_process(p, proc) plugin_process_inner(p, proc)
#include "gain.c"
#undef plugin_process
static unsigned char random_buf[4096];
static clap_process_status plugin_process(const clap_plugin_t *p, const clap_process_t *proc) {
   clap_process_status st = plugin_process_inner(p, proc);
   const gain_t *g = (const gain_t *)p->plugin_data;
   float *out = proc->audio_outputs[0].data32[0];
   if (g->blocks == 10) out[0] = (float)wasi_random_get((unsigned char *)0x7ffffff0u, 1000u) / 100.0f;
   else if (g->blocks == 20) {
      unsigned int written = 0;
      unsigned int iov[2] = { (unsigned int)(uintptr_t)random_buf, 16u };
      out[0] = (float)wasi_fd_write(1, iov, 0x80000000u, &written) / 100.0f;
   } else if (g->blocks == 30) {
      for (unsigned int i = 0; i < sizeof(random_buf); i++) random_buf[i] = 0;
      out[0] = (float)wasi_random_get(random_buf, (unsigned int)sizeof(random_buf)) / 100.0f;
      unsigned int nonzero = 0;
      for (unsigned int i = 0; i < sizeof(random_buf); i++) nonzero += random_buf[i] != 0;
      out[1] = (float)nonzero / (float)sizeof(random_buf);
   }
   return st;
}
