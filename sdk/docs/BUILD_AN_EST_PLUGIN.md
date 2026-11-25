# Build an EST plugin

From an idea to your own plugin playing in Cyber, in four steps. You need Node 20 or newer and a terminal. No tools at all? Copy [the one prompt](ONE_PROMPT.md) in Cyber (Home → EST PLUGINS → Make your own), paste it into your AI, and paste its answer into **Add a plugin file**: Cyber builds it, window included. [The playground](playground.md) takes the same answer.

An EST plugin is one file, a `.est` bundle: your sound code compiled to WebAssembly, plus a manifest (`est.json`). Cyber runs it in a sandbox: it cannot reach the network, your files or the page.

## 1. Make the folder

```sh
npx @cyber-est/cli new
```

It asks three things: what the plugin should do, effect or instrument, and a name. It makes the folder, writes your sentence into its `AGENTS.md` under **What to build**, pins the kit in `package.json` and installs it. To skip the questions (an assistant has no terminal to answer on): `npx @cyber-est/cli new --kind effect --name "My FX" --idea "a warm drive"`, or name a template and a folder: `npx @cyber-est/cli new effect-as my-fx`.

In that folder, `npx est <command>` is the kit. **Never type a bare `npx est` in a folder without it**: npm would fetch an unrelated package. Elsewhere, write `npx @cyber-est/cli <command>`.

## 2. Build it

**With an AI assistant:** open the folder in it and say "build it". The folder's `AGENTS.md` holds your sentence, the rules and the library on one page.

**By hand:** the plugin is `assembly/index.ts`. Here is a whole effect, a soft-clipping drive with two knobs:

```ts
// My FX: a soft-clipping drive. Drive pushes the signal into a tanh curve; Output sets the level after it.
import { Descriptor, Effect, Io, Param, Plugin, Smoother, alloc, dbToGain, isReady, setup } from "est";

// The export block: keep it as it is.
export { clap_entry, free } from "est";
export function malloc(size: usize): usize {
  if (!isReady()) setup(describe(), parameters(), make);
  return alloc(size);
}
function make(): Plugin { return new MyFx(); }

function describe(): Descriptor {
  return new Descriptor("com.example.my-fx", "My FX", "Example", "1.0.0",
    "A soft-clipping drive.", ["audio-effect", "distortion", "stereo"], "MYFX", 1);
}

const DRIVE: u32 = 0;
const OUTPUT: u32 = 1;

function parameters(): Param[] {
  return [
    new Param(DRIVE, "Drive").range(0, 24).default(6).unit("dB").decimals(1),
    new Param(OUTPUT, "Output").range(-24, 6).default(-6).unit("dB").decimals(1),
  ];
}

class MyFx extends Effect {
  // Everything that allocates happens here or in activate, never in render.
  drive: Smoother = new Smoother(0.01);
  output: Smoother = new Smoother(0.01);

  activate(sampleRate: f64, maxFrames: u32): bool {
    this.drive.setSampleRate(sampleRate);
    this.output.setSampleRate(sampleRate);
    this.reset();
    return true;
  }

  reset(): void { this.drive.reset(); this.output.reset(); }

  paramChanged(id: u32, value: f64): void {
    if (id == DRIVE) this.drive.setTarget(dbToGain(value));
    else if (id == OUTPUT) this.output.setTarget(dbToGain(value));
  }

  render(io: Io, from: i32, to: i32): void {
    for (let n = from; n < to; n++) {
      const d = this.drive.next(), g = this.output.next();
      for (let c = 0; c < io.channels; c++) {
        const x = <f64>io.input(c, n);
        io.output(c, n, <f32>(Math.tanh(x * d) * g));
      }
    }
  }
}

// No imports: a trap instead of the runtime's env.abort (asconfig.json's "use").
function abort(message: usize, file: usize, line: u32, column: u32): void { unreachable(); }
```

`describe()` is the plugin's identity and must match `est.json`. `parameters()` declares each knob once, by a number that never changes. Cyber calls `paramChanged` with every new value and `render` for each block: read `io.input`, write `io.output`. Keep `est.json` in step:

```json
"description": "A soft-clipping drive.",
"features": ["audio-effect", "distortion", "stereo"],
"parameters": [
  { "id": 0, "name": "Drive", "unit": "dB" },
  { "id": 1, "name": "Output", "unit": "dB" }
],
```

and the golden test's events (`test/golden.json`), which name parameters by id:

```json
"events": [
  { "type": "param", "time": 0, "id": 0, "value": 18 },
  { "type": "param", "time": 0.12, "id": 1, "value": -12 }
],
```

## 3. Hear it

```sh
npx est dev             # plays it at http://localhost:4430 and rebuilds when you save
npx est validate        # every check Cyber runs when a plugin is added
npx est test --update   # the sound changed on purpose: render the golden again
```

Every command ends with one line that starts `Next:`: the first error with its fix, or the next step. Do that one thing. `npx est doctor` says what is wrong with the folder. A failed check has a rule id (`EST-…`), what was found and the fix; `dist/validation.json` has the same for an assistant. A **note** about the output's peak is advice: the checks drive every knob to its extreme.

## 4. Drop it into Cyber

`npx est validate` wrote `dist/<id>-1.0.0.est`. In Cyber, on Home: **EST PLUGINS → Add a plugin**, and drop that file on it. Cyber runs the same checks, then it is yours: open it, or put it on a track.

Publishing it for others comes later, when you want it: [publish on the EST Store](PUBLISH_ON_THE_EST_STORE.md).

## What you can't do

The sandbox keeps every plugin safe to add and every render the same on every machine:

- **No `Math.random`, no clock.** `Math.random` asks the host for a seed, an import EST refuses (`EST-W004`, naming `env.seed`). Step a seed of your own. Count samples instead of reading the time.
- **No allocation in `render()`.** `new`, arrays and strings only in field initialisers, the constructor or `activate`, or the plugin runs out of memory and stops (`EST-C013`, "probably allocating in render()").
- **No imports, no top-level code** but constants. Keep the `abort` function at the bottom.
- **A version you gave someone never changes.** Bump `version` in `est.json` and `describe()`.

Every check: [validator-rules.md](validator-rules.md).

## Where next

- An instrument, a sampler, a note effect, the cookbook: [templates.md](templates.md), [cookbook.md](cookbook.md).
- Your own page as the plugin's window: `est new … --ui` ([ui.md](ui.md)).
- C or C++ you already have: `npx @cyber-est/cli port <folder>` ([Port your plugin](PORT_YOUR_VST.md)).

## Paste this into your assistant

With no folder open (a chat assistant), use [the one prompt](ONE_PROMPT.md): `npx @cyber-est/cli prompt "what it should do"` prints it. With the folder open:

```
Read AGENTS.md in this folder, then build what its "What to build" says.
Run `npx est validate` and follow its `Next:` line until it passes, then `npx est test --update`.
Tell me what you built and the choices you made for me.
```

More prompts: [the prompt kit](PROMPT_KIT.md). Sharing what you made: [SHARING.md](SHARING.md).
