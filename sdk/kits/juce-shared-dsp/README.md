# juce-shared-dsp: one source tree, a JUCE plugin and an EST plugin

The EST kit's JUCE example (EST-DEV-3, DEV-G). The guide is [porting-juce.md](../../docs/porting-juce.md).

| Folder | What | Built by Cyber's suite |
|---|---|---|
| `dsp/SharedGain.h` | the shared DSP: no JUCE, no CLAP, no EST | yes (both ways) |
| `est/` | the EST plugin: `est new cpp-clap` with the DSP from `../dsp` | yes, where a clang for wasm32 is found (its committed module is `sdk/fixtures/kits/juce-shared-dsp.wasm`) |
| `reference/render.cpp` | the shared DSP over a WAV, natively, for `est compare` | yes, where a native C++ compiler is found |
| `juce/` | the JUCE `AudioProcessor` | **no**: it needs your own JUCE checkout (`-DJUCE_DIR=…`); no JUCE source is in this repository |

```
cmake -S . -B build -DJUCE_DIR=/path/to/JUCE -DEST_CLI=/path/to/cyber/sdk/packages/cli/bin/est.mjs
cmake --build build                 # the JUCE plugin and the reference renderer
cmake --build build --target est    # the EST bundle
```

MIT, as the rest of the SDK. **JUCE's terms:** the desktop half links JUCE, so building it puts that plugin under JUCE's licence, the AGPLv3 (JUCE 8; GPLv3 for JUCE 7), unless you hold a commercial JUCE licence. The EST bundle links no JUCE code: `est/` compiles only `dsp/SharedGain.h`, its own `src/plugin.cpp` and the EST kit's MIT headers (keep JUCE out of `dsp/` and it stays so).
