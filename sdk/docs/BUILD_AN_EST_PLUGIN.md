# Build an EST plugin

This page takes you from nothing to a working audio effect that Cyber installs, with npm alone. You need Node 20 or newer and a terminal; nothing else. If you work with a chat assistant, give it this page (the block at the end says how).

An EST plugin is one file, a `.est` bundle: your sound code compiled to WebAssembly, plus a manifest (`est.json`). Cyber runs it in a sandbox: it cannot reach the network, your files or the page.

## 1. Install the kit and make a plugin

```sh
npx @cyber-est/cli new effect-as my-fx --id com.example.my-fx --name "My FX"
cd my-fx
npm install --save-dev --save-exact @cyber-est/cli@0.1.0
npx est doctor
```

Until the kit is on npm (coming soon), `npx @cyber-est/cli` answers 404 (not found).

The first line makes the folder `my-fx` from the `effect-as` template: an effect written in AssemblyScript (TypeScript's syntax, compiled straight to WebAssembly, so there is no other toolchain to install). The id is yours: a reversed domain you own, or `com.example.…` while you try things out. It never changes once you share the plugin.

The `npm install` puts `est` and the compiler in the folder. From then on, in this folder, `npx est <command>` is the kit. **Never type a bare `npx est` in a folder without it**: npm would fetch an unrelated package called `est`. Elsewhere, write `npx @cyber-est/cli <command>`. `npx est doctor` says if anything is missing, with the command that fixes it.

The folder holds:

| File | What it is |
|---|---|
| `assembly/index.ts` | your plugin's code |
| `est.json` | the manifest: id, name, version, the parameters |
| `test/golden.json` | the golden render: an input and parameter changes, and the output they must give |
| `est/` | the kit's DSP library (smoothers, filters, oscillators, delay lines): read it, do not edit it |
| `AGENTS.md`, `llms.txt` | the template explained, for you and for a coding agent |
| `est-validator-rules.json` | every check, with its id, what it means and the fix |

## 2. The code

The template starts as a gain into a filter. Here is a whole effect instead, a soft-clipping drive with two knobs. Replace `assembly/index.ts` with it:

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

How it fits together: `describe()` is the plugin's identity and must match `est.json`. `parameters()` declares each knob once, by a number that never changes. Cyber calls `paramChanged` with every new value, and `render` for each block of samples: read `io.input`, write `io.output`. The smoothers glide each change over 10 ms, so a knob turned fast does not click.

Now keep `est.json` in step. Set its `parameters` to the same ids and names, and the description and features to the ones above:

```json
"description": "A soft-clipping drive.",
"features": ["audio-effect", "distortion", "stereo"],
"parameters": [
  { "id": 0, "name": "Drive", "unit": "dB" },
  { "id": 1, "name": "Output", "unit": "dB" }
],
```

`test/golden.json`'s `events` name parameters by id, and the template's name four. Replace them with two of yours:

```json
"events": [
  { "type": "param", "time": 0, "id": 0, "value": 18 },
  { "type": "param", "time": 0.12, "id": 1, "value": -12 }
],
```

## 3. Validate, test, play

```sh
npx est validate        # builds, packs, runs every check Cyber's install runs
npx est test --update   # the sound changed on purpose: render the golden again
npx est test            # from now on: the golden render must stay the same
npx est dev             # play it at http://localhost:4430; it rebuilds when you save
```

`est validate` writes `dist/com.example.my-fx-1.0.0.est` and `dist/validation.json`. It prints **PASS** or **FAIL**. Each failed check has a rule id (`EST-…`), what was found, and the fix; the JSON has the same, for an assistant to read. Fix, run it again, until it passes. A **note** about the output's peak is advice, not a failure: the checks drive every knob to its extreme with full-scale clicks, so a drive at +24 dB peaks above 1.0 there.

`est dev` opens a page that runs your plugin in Cyber's own runtime, with its knobs, a test signal and meters. Without a screen (an agent), `npx est dev --json --seconds 3 < /dev/null` prints the meters as JSON lines; it needs Playwright's Chromium once (`npm install --save-dev --save-exact @playwright/test@1.64.1 && npx playwright install chromium`).

When a block costs too much (`EST-P001`, a warning), `npx est profile --debug` lists the functions that spend it, by name.

Then load it in Cyber, while adding your own plugins is open there: on Home, **EST PLUGINS → Add a plugin**, and drop the `.est` on it. A developer with a registered signing key can also use **Settings → Plugins → Developer tools → Load a bundle file…**. What you load stays on your own account. Cyber runs the same checks and names the same rule ids.

## 4. What you can't do

The sandbox makes every plugin safe to install and makes every render the same on every machine. So:

- **No `Math.random`, no clock.** AssemblyScript's `Math.random` asks the host for a seed, an import EST refuses (`EST-W004`, naming `env.seed`). For noise, keep a seed of your own and step it (the cookbook's `drum-synth` has a three-line xorshift). `Date` is the clock: count samples instead.
- **No allocation in `render()`.** `new`, arrays and strings only in field initialisers, the constructor or `activate`. The kit's heap never gives memory back, so a buffer made every block runs it out and the plugin stops (`EST-C013`, "probably allocating in render()").
- **No imports.** No `console`, no `trace`, no host functions, no network. Keep the `abort` function at the bottom and asconfig.json's `"use"` line: they turn a failed assertion into a trap instead of an import.
- **No top-level code** but constants (an EST module may have no start function).
- **A shipped version never changes.** Bump `version` (in `est.json` and `describe()`) for every change you give anyone.

Every check is in the rules table: [validator-rules.md](validator-rules.md), and `est-validator-rules.json` in your folder.

## 5. Where next

- Other starting points: `npx est new instrument-as my-synth`, and the cookbook's ten recipes (`compressor`, `chorus`, `bitcrusher`, `wavetable`, `drum-synth`, `ring-mod`, `widener`, `auto-wah`, `schroeder-reverb`, `step-sequencer`): `npx @cyber-est/cli new chorus my-chorus`. [templates.md](templates.md) and [cookbook.md](cookbook.md) say what each is.
- Your own page as the plugin's window: `est new … --ui` ([ui.md](ui.md)).
- The whole contract: [concepts.md](concepts.md), and [for-agents.md](for-agents.md) for an agent's loop.

## Paste this into your assistant

```
I am building an EST audio plugin for Cyber with the @cyber-est/cli kit, in AssemblyScript.
The folder was made by `npx @cyber-est/cli new effect-as <dir>`; read its AGENTS.md first.
Rules: no Math.random or Date (no imports at all; seed an xorshift of your own); no allocation
in render(), process or paramChanged (only field initialisers, the constructor or activate);
no top-level code but constants; keep the export block and the abort function as they are.
Keep est.json's id and parameters in step with describe() and parameters(), and
test/golden.json's events in step with the parameter ids.
The loop: `npx est validate`, read dist/validation.json (each failed check has rule, message,
fix), fix, repeat until it passes; then `npx est test` (after a deliberate change to the sound,
`npx est test --update` first) and `npx est dev --json --seconds 3 < /dev/null` to see the meters.
What I want the plugin to do: <describe it here>
```

More prompts, one for every template and recipe and for the usual follow-ups: [the prompt kit](PROMPT_KIT.md). When it works: [sharing what you made](SHARING.md).
