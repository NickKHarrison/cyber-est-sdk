// EST Visualiser Template (AS) (org.example.est-visualiser-template-as): a UI-first EST effect in
// AssemblyScript, made from the visualiser-as template. The DSP passes the audio through (with a
// smoothed trim); the page in ui/ draws what the host measures after it, from protocol v2's
// meters (`est:meter`, at most 30 a second: the strip's peaks, never samples), on a canvas. Keep
// est.json's identity and parameters in step with `describe()` and `parameters()`, then (see
// AGENTS.md):
//
//     est pack        # asc (asconfig.json's release target), then the bundle in dist/ (ui/ and est-ui.js too)
//     est validate    # the checks Cyber's install runs, the EST-U rules on the page included
//     est test        # the golden render in test/ plus the conformance run
//     est dev         # the page, live, beside the generated knobs
//
// History is the page's setting, kept as a parameter so it saves with the project: the DSP reads
// it and does nothing with it. Allocate only in field initialisers and `activate`; no top-level
// code but constants.

import { Descriptor, Effect, Io, Param, Plugin, Smoother, alloc, dbToGain, isReady, setup } from "est";

// --- The export block every EST plugin in AssemblyScript carries.
export { clap_entry, free } from "est";
export function malloc(size: usize): usize {
  if (!isReady()) setup(describe(), parameters(), make);
  return alloc(size);
}
function make(): Plugin { return new Template(); }

function describe(): Descriptor {
  return new Descriptor("org.example.est-visualiser-template-as", "EST Visualiser Template (AS)", "Example", "1.0.0",
    "Audio through, and a page that draws the level after it: the starting point for an EST plugin with a visual UI in AssemblyScript.",
    ["audio-effect", "analyzer", "stereo"], "TMPV", 1);
}

const TRIM: u32 = 0;
const HISTORY: u32 = 1;

function parameters(): Param[] {
  return [
    new Param(TRIM, "Trim").range(-24, 12).default(0).unit("dB").decimals(1),
    new Param(HISTORY, "History").range(2, 20).default(6).unit("s").decimals(0).module("Display"),
  ];
}

class Template extends Effect {
  trim: Smoother = new Smoother(0.01);

  activate(sampleRate: f64, maxFrames: u32): bool {
    this.trim.setSampleRate(sampleRate);
    this.trim.reset();
    return true;
  }

  reset(): void { this.trim.reset(); }

  paramChanged(id: u32, value: f64): void {
    if (id == TRIM) this.trim.setTarget(dbToGain(value));
  }

  render(io: Io, from: i32, to: i32): void {
    for (let n = from; n < to; n++) {
      const g = this.trim.next();
      for (let c = 0; c < io.channels; c++) io.output(c, n, <f32>(<f64>io.input(c, n) * g));
    }
  }
}

// No imports: a trap instead of the runtime's `env.abort` (asconfig.json: "use": ["abort=..."]).
function abort(message: usize, file: usize, line: u32, column: u32): void { unreachable(); }
