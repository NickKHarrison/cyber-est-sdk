// The desktop side's offline renderer (sdk/docs/porting-juce.md, "Checking the port"): the shared
// DSP, built natively with no JUCE, run over a WAV, so `est compare` can hold the EST module against
// what the desktop build computes. Your JUCE plugin can do the same from a unit test; this one needs
// only a C++17 compiler, so it builds on any machine and in CI.
//
//     reference <input.wav> <output.wav> [--gain <dB> [--at <seconds>]]
//
// The input is a 32-bit float stereo WAV (`est compare --write-input` writes one). The gain is set
// after prepare(), at frame `--at`'s, as the EST host delivers a parameter event at its frame.
#include "SharedGain.h"

#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <vector>

namespace {

bool readFloatWav(const char *path, std::vector<float> &l, std::vector<float> &r, uint32_t &rate) {
   FILE *f = std::fopen(path, "rb");
   if (!f) return false;
   std::vector<unsigned char> b;
   unsigned char buf[65536];
   size_t n;
   while ((n = std::fread(buf, 1, sizeof buf, f)) > 0) b.insert(b.end(), buf, buf + n);
   std::fclose(f);
   auto u32 = [&](size_t at) { uint32_t v; std::memcpy(&v, &b[at], 4); return v; };
   auto u16 = [&](size_t at) { uint16_t v; std::memcpy(&v, &b[at], 2); return v; };
   if (b.size() < 12 || std::memcmp(&b[0], "RIFF", 4) || std::memcmp(&b[8], "WAVE", 4)) return false;
   uint16_t format = 0, channels = 0, bits = 0;
   for (size_t at = 12; at + 8 <= b.size();) {
      uint32_t size = u32(at + 4);
      size_t body = at + 8;
      if (!std::memcmp(&b[at], "fmt ", 4)) { format = u16(body); channels = u16(body + 2); rate = u32(body + 4); bits = u16(body + 14); }
      else if (!std::memcmp(&b[at], "data", 4)) {
         if (format != 3 || bits != 32 || channels < 1) return false;
         size_t frames = (size < b.size() - body ? size : b.size() - body) / (4u * channels);
         l.resize(frames); r.resize(frames);
         for (size_t i = 0; i < frames; i++) {
            std::memcpy(&l[i], &b[body + i * 4 * channels], 4);
            if (channels > 1) std::memcpy(&r[i], &b[body + i * 4 * channels + 4], 4); else r[i] = l[i];
         }
         return true;
      }
      at = body + size + (size & 1);
   }
   return false;
}

bool writeFloatWav(const char *path, const std::vector<float> &l, const std::vector<float> &r, uint32_t rate) {
   FILE *f = std::fopen(path, "wb");
   if (!f) return false;
   const uint32_t frames = (uint32_t)l.size(), data = frames * 8, riff = 36 + data, sixteen = 16, byteRate = rate * 8;
   const uint16_t fmt = 3, ch = 2, align = 8, bits = 32;
   std::fwrite("RIFF", 1, 4, f); std::fwrite(&riff, 4, 1, f); std::fwrite("WAVEfmt ", 1, 8, f);
   std::fwrite(&sixteen, 4, 1, f); std::fwrite(&fmt, 2, 1, f); std::fwrite(&ch, 2, 1, f); std::fwrite(&rate, 4, 1, f);
   std::fwrite(&byteRate, 4, 1, f); std::fwrite(&align, 2, 1, f); std::fwrite(&bits, 2, 1, f);
   std::fwrite("data", 1, 4, f); std::fwrite(&data, 4, 1, f);
   for (uint32_t i = 0; i < frames; i++) { std::fwrite(&l[i], 4, 1, f); std::fwrite(&r[i], 4, 1, f); }
   return std::fclose(f) == 0;
}

} // namespace

int main(int argc, char **argv) {
   if (argc < 3) { std::fprintf(stderr, "usage: reference <input.wav> <output.wav> [--gain <dB> [--at <seconds>]]\n"); return 2; }
   double gainDb = 0.0, at = 0.0;
   bool setGain = false;
   for (int i = 3; i + 1 < argc; i += 2) {
      if (!std::strcmp(argv[i], "--gain")) { gainDb = std::atof(argv[i + 1]); setGain = true; }
      else if (!std::strcmp(argv[i], "--at")) at = std::atof(argv[i + 1]);
   }
   std::vector<float> l, r;
   uint32_t rate = 0;
   if (!readFloatWav(argv[1], l, r, rate)) { std::fprintf(stderr, "reference: %s is not a 32-bit float WAV\n", argv[1]); return 1; }
   std::vector<float> ol(l.size()), orr(r.size());
   shared::Gain gain;
   gain.prepare(rate);
   const uint32_t frames = (uint32_t)l.size();
   const uint32_t when = setGain ? (uint32_t)(at * rate + 0.5) : frames;
   const float *in[2] = { l.data(), r.data() };
   float *out[2] = { ol.data(), orr.data() };
   const uint32_t split = when < frames ? when : frames;
   gain.process(in, out, 2, 0, split);
   if (setGain) gain.setGainDb(gainDb);
   gain.process(in, out, 2, split, frames);
   if (!writeFloatWav(argv[2], ol, orr, rate)) { std::fprintf(stderr, "reference: cannot write %s\n", argv[2]); return 1; }
   return 0;
}
