# The prompt that finishes the port

`overdrive-est/` beside this file was made in two moves: one command, then one prompt.

## 1. The command

```sh
npx @cyber-est/cli port original --out overdrive-est --id org.example.port-overdrive --name Overdrive
cd overdrive-est
npm install --save-dev --save-exact @cyber-est/cli
npx est validate        # PASS at once: the sound passes through, the original is not compiled yet
```

`est port` read `original/Overdrive.h` (it ran nothing and changed nothing there) and wrote the folder: the kit's C++ template, the four knobs it found declared, the original copied to `src/original/`, and `PORT_PLAN.md`. The plan in `overdrive-est/` is that file exactly as it was written.

## 2. The prompt

Give your assistant the folder and this, word for word:

> Follow PORT_PLAN.md. Finish the port: make `src/adapter.hpp` call the original class in `src/original/`, and do not change any file under `src/original/`. Set each parameter's range, default and unit in `kParams` in `src/plugin.cpp` and in `est.json`, so that the two agree. Give the state its own four letters. Then run `npx est validate` and fix what it reports until it says PASS; run `npx est test --update`, then `npx est test`. Leave no `TODO(port)` in `src/`. At the end tell me what you changed, and anything in the plan that turned out wrong.

Everything the assistant needs is in the folder: the plan names the class, its set-up and audio methods with their lines, each knob with its setter and where its range was seen, the maths a module has, and the checks.

## 3. What it changes

- `src/adapter.hpp`: includes `original/Overdrive.h`, holds one `Overdrive`, and passes it the sample rate, the four knobs and the audio. About forty lines. One rule is new, the plan's "Silence" step: after a quarter second of digital silence it clears the original's filter state, because WebAssembly has no flush-to-zero and the state would otherwise sit just above zero for ever (the validator's EST-C027 found it at low Tone). The original says `std::pow`, `std::exp` and `std::tanh` from `<cmath>`; the kit's own `<cmath>` answers, so the original compiles as it is.
- `src/plugin.cpp`: the four rows of `kParams` get their defaults (0 dB, 6000 Hz, 0 dB, 1) and the state its letters.
- `est.json`: a description, the feature `distortion`, and `"scale": "log"` on Tone.
- `test/golden.json` and `test/golden.f32`: events on all four knobs, and the render.

Nothing under `src/original/` changes. The kit's tests build this folder, run the validator's checks on it, and compare its output with the original's arithmetic written out again: they agree to within 1e-5 (in practice far closer).

## 4. What this saves

Before `est port` existed, a test builder was given the same original and the plain C++ template, with one sentence. Measured: **the first validate passed at 1.1 minutes, and the port was done in 3.9 minutes**, after 11 commands. That builder had to read six files to learn the build, rewrite the DSP into the template's own class, write a `tanh` (the runtime had none), and then replace a slow `exp` to clear the block-cost warning.

With `est port` the folder starts green, the original is kept as it is, and `tanh` and a fast `exp` are in the kit. Those numbers are the "before"; no "after" is claimed here.

## Try it yourself

```sh
cp -r original /tmp/my-original
npx @cyber-est/cli port /tmp/my-original
```

Then give your assistant the prompt above in the folder it names.
