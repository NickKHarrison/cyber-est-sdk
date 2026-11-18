# Port your plugin: a worked example

A small C++ effect taken to a validated EST plugin, start to finish.

| | |
|---|---|
| `original/Overdrive.h` | The "before": a stereo overdrive in plain C++, four knobs. It knows nothing of EST. It was written for this example and is taken from no product (MIT). |
| `overdrive-est/` | The "after": the folder `est port` wrote from it, finished. `PORT_PLAN.md` in it is as `est port` wrote it. |
| `PROMPT.md` | The one command and the one prompt that did it, and what a builder measured without `est port`. |

`overdrive-est/` is a normal plugin folder: `npx est validate`, `npx est test`, `npx est dev`. It leaves out the copies `est port` also writes beside `est.json` (the assistant files, the manifest schema, the validator's rules, the ABI), which are the same in every folder.

The original is compiled into the module **unchanged**: `overdrive-est/src/original/Overdrive.h` is the same file, and `src/adapter.hpp` is the only new sound-side code (about forty lines). The kit's test (`sdk/tests/port.test.ts`) holds that, and checks the module's output against the original's arithmetic.

What an EST plugin cannot bring along (a native window, threads, files, the network) is said in every `PORT_PLAN.md`, by file and line; this original has none of them. The page: [Port your plugin](../../docs/PORT_YOUR_VST.md).
