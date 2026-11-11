/*
 * A planted fault for the rate parity suite (1.342, R-K: src/audio/est/install/parity.test.ts):
 * EST Gain plus an echo, its output and the same 100 ms later at half each (so a full-scale click
 * at +12 dB stays under the host's +-4 clamp), with the echo's delay sized as a constant of frames
 * (4800: 100 ms only at 48 kHz). At 44.1 kHz the echo lands 108.8 ms late,
 * 8.8 ms (about 1 % of a second) off, so the suite's 44.1 against 48 kHz comparison refuses it
 * with the rate named. It passes the validator and installs: no install rule can see a rate
 * fault, which is why the parity suite exists (so it is listed in passing.json, not fixtures.json).
 * rate-seconds.c is the same plugin done right (the delay from activate's rate: 0.1 s × rate).
 */
#ifndef FIXTURE_ID
#define FIXTURE_ID "org.cyber.est.broken-rate-frames"
#define FIXTURE_NAME "Broken Rate (frames)"
#endif
#include "est_rt.h"
static bool plugin_activate(const clap_plugin_t *p, double sr, uint32_t min_frames, uint32_t max_frames);
static clap_process_status plugin_process(const clap_plugin_t *p, const clap_process_t *proc);
#define plugin_activate(p, sr, a, b) plugin_activate_inner(p, sr, a, b)
#define plugin_process(p, proc) plugin_process_inner(p, proc)
#include "gain.c"
#undef plugin_activate
#undef plugin_process

/* The longest echo buffer: 100 ms at 96 kHz. */
#define ECHO_MAX 9600
static float echo[2][ECHO_MAX];
static uint32_t echo_len, echo_pos;

static bool plugin_activate(const clap_plugin_t *p, double sr, uint32_t min_frames, uint32_t max_frames) {
#if defined(RATE_SECONDS)
   double frames = 0.1 * sr + 0.5; /* right: 100 ms at the rate activate gives */
   echo_len = frames > ECHO_MAX ? ECHO_MAX : (uint32_t)frames;
#else
   echo_len = 4800; /* the fault: 100 ms only at 48 kHz */
#endif
   echo_pos = 0;
   memset(echo, 0, sizeof(echo));
   return plugin_activate_inner(p, sr, min_frames, max_frames);
}

static clap_process_status plugin_process(const clap_plugin_t *p, const clap_process_t *proc) {
   clap_process_status st = plugin_process_inner(p, proc);
   const clap_audio_buffer_t *out = &proc->audio_outputs[0];
   uint32_t chans = out->channel_count < 2 ? out->channel_count : 2;
   for (uint32_t i = 0; i < proc->frames_count; i++) {
      for (uint32_t c = 0; c < chans; c++) {
         float y = out->data32[c][i], d = echo[c][echo_pos];
         echo[c][echo_pos] = y;
         out->data32[c][i] = 0.5f * (y + d);
      }
      if (++echo_pos >= echo_len) echo_pos = 0;
   }
   return st;
}
