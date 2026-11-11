# The UI library: `@cyber-est/ui`

A plugin without a UI gets a generated one: knobs for its parameters, grouped by module. A plugin with `"ui"` in its `est.json` can show its own page instead, in a sandboxed frame on the plugin origin. `@cyber-est/ui` (MIT, no dependencies, about 16 KB minified and 6 KB gzipped) is the library for that page: the handshake, every message checked, parameter binding, and two accessible controls.

## Start from the example: `est new … --ui`

```
est new effect-rust my-chorus --id org.example.my-chorus --name "My Chorus" --ui
```

adds to the new folder a working UI for the template's parameters and its `est.json` entry:

| File | What |
|---|---|
| `ui/index.html` | the page: an `<est-knob>` per parameter, grouped |
| `ui/ui.js` | the script: `EstUI.connect()` |
| `ui/style.css` | the styles, a file of the bundle |
| `est.json`'s `"ui"` | `{ "path": "ui/index.html", "size": { "w": 440, "h": 180 } }` |
| `est-ui.d.ts` | the library's types, for a UI written in TypeScript (every `est new` folder has it) |

It passes `est validate`, `EST-U` rules included, and shows in `est dev`. This is the effect's, complete:

`ui/index.html`:

```html
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="est-ui-size" content="440x180">
<title>My Chorus</title>
<link rel="stylesheet" href="style.css">
</head>
<body>
<h1>My Chorus</h1>
<div class="groups">
  <fieldset>
    <legend>Output</legend>
    <div class="knobs">
      <est-knob param="0" label="Gain" unit="dB"></est-knob>
    </div>
  </fieldset>
  <fieldset>
    <legend>Filter</legend>
    <div class="knobs">
      <est-knob param="1" label="Cutoff" unit="Hz" scale="log"></est-knob>
      <est-knob param="2" label="Resonance"></est-knob>
      <est-knob param="3" label="Mode" labels="Low-pass, Band-pass, High-pass, Notch"></est-knob>
    </div>
  </fieldset>
</div>
<script src="est-ui.js"></script>
<script src="ui.js"></script>
</body>
</html>
```

`ui/ui.js`:

```js
const est = EstUI.connect();
est.ready.then(() => { document.body.dataset.ready = 'true'; });
```

`ui/style.css`:

```css
:root { color-scheme: dark; --est-bg: #14161b; --est-fg: #e8eaf0; --est-dim: #a9afbd; --est-accent: #5ad1c3; }
* { box-sizing: border-box; }
html, body { margin: 0; height: 100%; }
body { padding: 12px 16px; background: var(--est-bg); color: var(--est-fg); font: 13px/1.4 system-ui, sans-serif; }
h1 { margin: 0 0 8px; font-size: 12px; font-weight: 600; letter-spacing: .08em; text-transform: uppercase; color: var(--est-dim); }
.groups { display: flex; flex-wrap: wrap; gap: 8px 20px; }
fieldset { margin: 0; padding: 0; border: 0; min-width: 0; }
legend { padding: 0; margin-bottom: 4px; font-size: 11px; color: var(--est-dim); }
.knobs { display: flex; gap: 12px; }
```

Each `<est-knob param="…">` follows its parameter (the CLAP id, the same number as in the DSP and `est.json`) and writes it; `connect()` makes the connection they use. When you add, remove or renumber a parameter, change the page to match.

You do not copy `est-ui.js` into your folder: **`est pack` copies it into the bundle's `ui/` when a page directly in `ui/` loads it** (`<script src="est-ui.js">`), the SDK's own build, replacing any copy you made. `est pack` packs everything under `ui/`, so keep sources that are not part of the page (TypeScript, design files) outside it.

Why a classic script and not a module: the frame's origin is opaque (`sandbox="allow-scripts"`), and a module script would need CORS headers the plugin origin does not send. `est-ui.js` puts the library on `window.EstUI`.

## What a UI page may load: the plugin origin's policy

Cyber serves a bundle's files from the plugin origin with this content security policy, on every file (the dev host serves them with the same code):

```
default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline';
img-src 'self' data: blob:; font-src 'self'; connect-src 'none'; frame-ancestors <Cyber>;
form-action 'none'; base-uri 'none'; sandbox allow-scripts
```

and it serves only files with these extensions (any other is a 404): `.html`, `.js`, `.mjs`, `.css`, `.json`, `.wasm`, `.svg`, `.png`, `.webp`, `.woff2`, `.txt`. So, exactly:

- **Scripts**: files of the bundle only (`<script src="ui.js">`). No inline `<script>`, no `on…=` attributes, no `eval` or `new Function`.
- **CSS**: files of the bundle (`<link rel="stylesheet" href="style.css">`, `@import` of another `.css` in the bundle), `<style>` elements and `style="…"` attributes are all allowed. Nothing from another host (no web fonts or style sheets from a CDN).
- **Images**: `.png`, `.webp` and `.svg` files of the bundle, in `<img>`, CSS `url(…)` and `background-image`; `data:` URIs; `blob:` URLs the page makes itself (a canvas's `toBlob`). No `.jpg`, `.jpeg` or `.gif` (convert them to `.webp` or `.png`), nothing from another host.
- **Fonts**: `.woff2` files of the bundle only.
- **No network at all** (`connect-src 'none'`): no `fetch`, XHR, WebSocket or EventSource, not even of the bundle's own files: put data the page needs in a script. No `<audio>`, `<video>`, `<iframe>`, `<object>` or forms.
- **Names**: a file's path is `/`-separated segments of `[A-Za-z0-9._-]` (`EST-B005`); refer to it by a relative URL (`img/knob.png`, never `/ui/img/knob.png`): `EST-U003` checks that every URL in the page, its scripts and its styles resolves to a file in the bundle, `EST-U002` that none names another host. The UI's files together should stay under 4 MiB (`EST-U004`, a warning).

The frame has no storage (no cookies, `localStorage` or IndexedDB: the origin is opaque), no access to the host's page, and no microphone, camera or MIDI.

## The frame's size

`est.json`'s `ui.size` (`w` 120 to 2000, `h` 80 to 1400, CSS pixels) is the frame's size, and the page should fit it exactly:

- **Cyber draws the frame at exactly `w` × `h` CSS pixels and never scales it.** It sits in the plugin's window under a 40 px row (the Generated | Plugin UI switch). An effect's window opens `w` wide (at least 520, at most 1200) and `h` + 48 tall (at least 300, at most 800); an instrument's is at least 820 wide, with its preset row and arpeggiator above. When the window is narrower than the frame, the frame's width is cut to the window's and the rest scrolls; when it is wider or taller, the frame stays its size. Resizing the window reflows Cyber's part, not your page.
- `ui.resizable: true` lets the page ask for another size with `est.resize(w, h)` (frame protocol version 2): Cyber sizes the frame to it, within the manifest's own bounds (w 120–2000, h 80–1400), the window's width still capping it. Without it a resize is refused and counted. Lay the page out for `w` × `h` first.
- The dev host shows the frame at the same size.

In Cyber the custom UI shows for Cyber's reference plugins, for plugins installed from the registry (Phase 5b), and since EST Phase 5a for **a bundle loaded in Developer mode**: when you choose Plugin UI, Cyber sends the bundle to the plugin origin for the session (a one-time ticket from Cyber's server; the plugin origin checks that the bytes are the bundle's hash and keeps only the UI's folder, in memory) and frames it from there, exactly as a reference plugin's page, under the same policy. If the server is not set up for it, the window says so and shows the generated knobs. Use `est dev` to see and test your page as you work: it runs it in Cyber's own frame component under the same policy.

## A whole app as the window

A plugin can be a whole instrument with its own sequencer, pages and sound library, and its window can be that app's own interface, built for the frame. The first plugin made this way is ACIDZ 303 (a TB-303 with its step sequencer, keyframe motion and five tabs, a React app of about 900 KB minified). What it took, so the next one is quicker:

**One classic script, nothing from elsewhere.** Build the app into one `iife` bundle and load it with a plain `<script defer src="assets/app.js">`: a sandboxed page's origin is opaque, so a `type="module"` script or a `crossorigin` attribute makes a CORS request the plugin origin does not answer. Relative URLs only (`base: './'`). Nothing in the built files may name another host (`EST-U002`): React's minified error path carries `https://react.dev/errors/` and Tailwind's CSS a banner URL, so a build step strips them. Leave the web app's own worklet or workers out of the bundle (the plugin's DSP is its Wasm module).

**Fonts travel in the script.** The policy allows fonts from the bundle's own files only, but the sandboxed page cannot fetch them (the same CORS rule), and a `data:` font is refused by `font-src 'self'`. So import each font as base64 into the script, register it from bytes (`document.fonts.add(new FontFace(family, bytes, { weight }))`, which fetches nothing) and strip the `@font-face` rules from the built CSS. Latin subsets of five families were about 90 KB.

**The page is the whole document.** Whatever the web app's shell set on `<html>` (a `class="dark"`, a `data-theme`) goes in the plugin's page, which has no shell around it.

**The engine becomes the link.** Replace the app's audio-engine module (the one that owned an `AudioContext` and a worklet) with one of the same shape that reads and writes parameters through `EstUI.connect()`, and keep the rest of the app as it is. The host plays the sound and owns the transport, the keys, MIDI, tempo and files: hide the app's play button, keyboard, MIDI connect, tap tempo and export, or make them say what the host does instead.

**Every piece of state is a parameter.** Cyber saves parameters with the project and puts edits in its undo history, so the app's state has to fit in them (the SDK allows 512):

- the knobs and switches: ordinary parameters;
- the app's own data (patterns, a chain, keyframes): `hidden()` parameters holding whole numbers below 2^53, packed as bit fields (ACIDZ keeps five 10-bit steps in one value, and 512 steps in 103 values). A hidden parameter stays out of the generated panel and the automation picker, but the plugin's own window gets it and may write it (Cyber 1.330 or newer);
- what the plugin is playing (the step, an envelope, a level): `hidden().readOnly()` parameters the DSP sets itself, by pushing `CLAP_EVENT_PARAM_VALUE` events on its output list about 30 times a second. The window hears them as `est:param` changes from the host (1.330) and can never write them.

**The sequencer runs in the DSP, on the host's clock.** `io.transport` gives the song's beat, tempo and whether it plays, at every render; a sequencer steps from that beat, resyncs when it jumps (a seek, a loop) and stops with the host, so patterns follow the song, and a render is the same every time.

**The window hears no audio.** Draw a scope from the readout (pitch, level, cutoff) rather than from samples. With `"abi": { "est": "1.1" }` and `"ui": { …, "audio": true }`, `est.audio()` gives the host's spectrum of the plugin's output for a spectrum view.

**Size it for the frame.** Give `ui.size` the app's real dimensions (ACIDZ uses 1184 × 688 with `resizable: true`) and let the app scale its design canvas into the frame. The dev host's column is narrower than Cyber's window: check the page at `ui.size` itself (`est dev` with the frame widened in the browser's inspector, or a screenshot script).

A Vite config for the window needs only: `base: './'`, `publicDir: false`, the engine swap as a `resolveId` plugin, `build.rollupOptions.output: { format: 'iife', inlineDynamicImports: true }`, and a `transformIndexHtml` step that turns the module script tag into a classic one and drops `crossorigin`. Then `est validate` (it checks `EST-U002` and `EST-U003` on the built files, and since 1.335 `EST-U005`: a page with a `type="module"` script, a `crossorigin` attribute or a `<link rel="modulepreload">`, which shows a blank frame) and `est dev`.

**Start from the scaffold: `est new <instrument-*|effect-*> <dir> --app`** (1.335) makes all of this: `ui-app/` with that Vite config (and on Vite 8, Rolldown's `codeSplitting: false` for Rollup's `inlineDynamicImports: true`), the font loader (`fonts.ts`, an import with `?base64`), the external-host strip, a `bridge.ts` skeleton (connect, `applyHost`, `pushStore`, the readout decode), the engine stand-in it swaps for (`engine.ts`), `bits.ts` for packing hidden parameters, and a small example app without a framework; `package.json` at the folder's root, whose `npm run build:ui` writes `ui/`; and est.json's `"ui"` entry. `npm install` once (or build with a Cyber clone's Vite: `<cyber>/node_modules/.bin/vite build --config ui-app/vite.config.ts`), then `npm run build:ui && est validate`. The template's `AGENTS.md` ("The window as an app") has the details.

## Writing the UI in TypeScript

Every folder `est new` makes has `est-ui.d.ts`, the types of `window.EstUI`. Write the script outside `ui/` and bundle it into one classic script in `ui/`:

```ts
// ui-src/main.ts
/// <reference path="../est-ui.d.ts" />
const est = EstUI.connect();
est.subscribe((id, source) => { /* redraw */ });
```

```
<cyber>/node_modules/.bin/esbuild ui-src/main.ts --bundle --format=iife --minify --outfile=ui/ui.js
```

(`<cyber>` is the Cyber clone the kit runs from: its esbuild is a dev dependency, so nothing is fetched. Plain JavaScript in `ui/` needs no build at all.)

## `connect(options?)`

```ts
const est = EstUI.connect();
await est.ready;                 // the first est:init: every parameter with its value
est.get(3);                      // a parameter's value (plain: Hz, dB …)
est.param(3);                    // { id, name, module, min, max, def, flags, value }
est.params();                    // all of them
est.set(3, 1200);                // clamped to the range, whole for a stepped one; sent on the next frame
est.begin(3); …; est.end(3);     // a gesture: the host writes the changes between once (one undo step)
est.subscribe((id, source) => …);// id null after est:init; source 'host' or 'ui'
est.rejected;                    // inbound messages dropped
// Frame protocol version 2 (EST Phase 5a):
est.version;                     // 2, or 1 when the host is older (then the next four are null, null, false, false)
est.rate;                        // the host's sample rate in Hz, or null (no audio running)
est.theme;                       // { bg, fg, accent } as #rrggbb, also set as --est-bg, --est-fg, --est-accent
est.meters;                      // whether est:meter comes
est.onMeter(({ in: i, out }) => …); // at most 30 a second: linear peaks [l, r]; `in` null where Cyber meters no input
est.onTheme(t => …);             // each theme (est:init, then est:theme on a change)
est.resize(640, 360);            // ask for a size (taken only with ui.resizable); false to an older host
// Frame protocol version 3 (EST 1.1, Cyber 1.327): the plugin's output, analysed by the host.
est.audioAvailable;              // true when est.json says "ui": { …, "audio": true } and the host speaks version 3
const stop = est.audio({ fftSize: 1024, rate: 30 }, ({ bins, rms }) => …); // bins: fftSize / 2 magnitudes in whole dB (−120…0); rms: [l, r]
stop();                          // the host stops sending
```

It reads the nonce and the host's origin from the page's fragment (`#n=…&p=…`; since Cyber 1.413 `p` is the plugin origin itself: Cyber frames your page inside a small page of its own on the plugin origin, which passes the host's messages on both ways, so a page that posts with targetOrigin `'*'` or `p` and checks `e.origin` against `p` works unchanged), sends `est:ready`, and takes `est:init` (sent on the frame's load and again on `est:ready`) and `est:param` (a change from anywhere else: a knob in the host, automation, a collaborator, a preset). Every inbound message is checked as the host checks the frame's: from the parent window and the host's origin only, version 1, 2 or 3, the nonce, exactly the protocol's keys, at most 64 KiB, a known parameter, a value in its range. Anything else is dropped and counted (`est.rejected`). Since EST 1.286 a parameter in `est:init` may carry one more key, `scale: 'log'`, when est.json marks it `"scale": "log"` (absent, linear); `toNorm`, `fromNorm`, the controls and `bind()` follow it.

Outbound changes are coalesced to the animation frame (the newest value of each parameter) and kept under the host's rate limit (240 messages a second; the library sends at most 200); a gesture's `begin` and `end` are never dropped and keep their order around the values. The host checks what the page sends the same way and refuses (and counts) what fails; `est dev --json` prints each refusal with its reason ([the dev host](dev-host.md#the-custom-ui-headless)).

The first `connect()` makes the page's connection, which the controls use; later calls return it.

## `bind(el, paramId, { source?, format? })`

One element follows one parameter and writes it; returns the unbind.

| Element | What it does |
|---|---|
| `<est-knob>`, `<est-slider>` | sets its `param` and `source` |
| `<input type="range">`, `<input type="number">` | min, max and step from the parameter; a pointer drag is a gesture |
| `<input type="checkbox">` | checked is the top of the range, unchecked the bottom (an on/off parameter) |
| `<select>` | each `<option value>` is a parameter value (a stepped choice) |
| anything else (`<output>`, `<span>`) | shows the value: `format(value, param)`, else the number |

## `<est-knob>` and `<est-slider>`

```html
<est-knob param="1" label="Cutoff" unit="Hz" scale="log" size="48"></est-knob>
<est-slider param="7" label="Level" unit="dB"></est-slider>
<est-knob param="0" labels="Saw, Square, Sine"></est-knob>
<est-knob param="22" label="Q" name="Peak 1 Q"></est-knob>
```

Attributes: `param` (the CLAP id), `label` (the visible text; default the parameter's name), `name` (the accessible name when the label is short; default the label), `unit` (`Hz` shows kHz past 1000, `dB` shows a sign, `%`, `ms` …), `scale="log"` (a frequency; without the attribute the knob follows the parameter's own `scale` from `est:init`, so a parameter est.json marks `"scale": "log"` moves logarithmically everywhere), `labels` (a stepped parameter's choices, from its minimum up: the protocol carries values, not their names), `size` (the knob, px). Properties: `source` (any object with the `connect()` methods: the default is the page's connection), `paramId`, `value`, `valueText`, `reset()`.

Each is one Tab stop with `role="slider"`, its name, `aria-valuemin`, `aria-valuemax`, `aria-valuenow` (the plain value) and `aria-valuetext` (with the unit), and `aria-disabled` until `est:init` arrives or for a read-only parameter. Keys: the arrows step by 1 % of the range (Shift: 0.1 %; a stepped parameter by 1), Page Up and Page Down by 10 %, Home and End go to the ends; a modifier chord is left to the page. A drag (pointer events: mouse, touch and pen) sends `est:gesture` begin and end around its changes; the knob moves 200 px over its range (Shift for fine), the slider follows the pointer along its bar; Escape during a drag puts the value back; a double click returns the default. A UI built from these controls passes the keyboard and naming checks by construction; give the page a `lang`, a `<title>`, and text at 4.5:1 contrast.

Colours are CSS variables, with defaults matching Cyber's dark look: `--est-bg` (`#14161b`), `--est-fg` (`#e8eaf0`), `--est-accent` (`#5ad1c3`), and `--est-dim`, `--est-track` for the quieter parts.

## Other exports

`formatValue(param, value, unit, labels?)`, `formatNumber(value)`, `toNorm(param, value, scale)` and `fromNorm(param, u, scale)` (0…1 along a control, log or linear), `FLAGS` (CLAP's parameter flags: `STEPPED` 1, `PERIODIC` 2, `HIDDEN` 4, `READONLY` 8, `BYPASS` 16, `AUTOMATABLE` 32), `EST_UI_PROTOCOL` (3), `AUDIO_FFT_SIZES`, `AUDIO_PER_SECOND` (30), `SPECTRUM_FLOOR_DB` (−120), `currentConnection()`, `whenConnected(fn)`. `est-ui.d.ts` has every signature.

## Protocol version 2

Version 2 (EST Phase 5a) adds what a page draws besides its parameters. Host to page: `est:init` also carries `rate` (the sample rate the plugin runs at, so a frequency response is drawn at the real rate: EST EQ 1.0.2 does), `theme` (`{ bg, fg, accent }` from Cyber's colours, which the library sets as the CSS variables `--est-bg`, `--est-fg`, `--est-accent` on `<html>`: use them and the page matches Cyber) and `meters`; `est:meter { in, out }` comes at most 30 times a second while the window is open, the strip's own levels as linear peaks (Cyber's strip meter is after the fader, so `in` is null there); `est:theme` comes when Cyber's colours change. Page to host: `est:resize { w, h }`, taken only when est.json says `ui.resizable`.

The page says `est:ready` in version 2. A host from before version 2 refuses it and sends a version-1 `est:init` on the frame's load; the library then speaks version 1, and `rate`, `theme` and the meters are absent. So a page built with this library works in both, and a page built with the version-1 library keeps working in a version-2 host, which answers each frame in the version it speaks.

## Protocol version 3: the UI sees audio (EST 1.1)

Version 3 (Cyber 1.327) lets a page draw the plugin's sound: a spectrum, a level, a gain-reduction trace. Opt in with `"ui": { …, "audio": true }` and `"abi": { "est": "1.1", "clap": "1.2" }` in est.json (a 1.0 manifest with `ui.audio` is refused, EST-M020). Page to host: `est:audio { fftSize, rate }` (`fftSize` 64, 128 … 2048; `rate` 1 to 30 a second; 0 stops). Host to page: `est:spectrum { bins, rms }` at that rate while the window is open and the page is visible: `bins` the magnitudes of the plugin's output in whole dB, −120 to 0, `fftSize / 2` of them from 0 Hz up to half the sample rate (`est.rate`), `rms` each channel's RMS, linear. They come from the host's own analysers on the plugin's output. **Never samples**: a page cannot record what the user plays through the plugin, by design (Cyber's security architecture §4); if your page needs a figure the analysis does not give, compute it in the DSP and report it as a read-only parameter. `est:init` in version 3 also says `audio` (whether the host will answer); the library's `est.audioAvailable` reads it.

The page says `est:ready` in version 3. A host from before version 3 refuses it and answers in version 1 (rate, theme and meters absent); a version-2 page keeps working in a version-3 host, which answers it in version 2.

## The computer keys stay Cyber's (Cyber 1.346)

A click in your page gives it the keyboard, but Cyber's computer keys keep working there: the plugin origin's frame guard (Cyber's own script, first in your page) hands every printable key with no Ctrl, Cmd or Alt back to Cyber, so the letters A to ; play notes, Z X and C V set the octave and velocity, and Space plays the song, exactly as when the person clicked anywhere else in Cyber. Your page does nothing for this. Two things stay yours: a key typed into a text field, a textarea, a select or a contenteditable element (a preset name, a search box) is never handed back; and a key your page takes with `event.preventDefault()` in its `keydown` handler is not handed back either, so a page with keyboard shortcuts of its own keeps them (take only what you need: the person expects the letters to play). Sliders, checkboxes and buttons type nothing, so their letters go to Cyber; Space on a focused control of your page (a button, a checkbox, a switch, a slider) stays yours, so it presses or toggles it as usual. You never see this traffic and it is not a protocol message of yours.

## Trying a UI

`est dev` shows the custom UI beside the generated one, in Cyber's own frame from a second origin, and `est dev --json` reports what it does ([the dev host](dev-host.md)); its `{"cmd":"ui-param","id":n,"value":v}` makes the page write a parameter through the library's own connection, so an agent without a screen can prove that the UI reaches the host. To work on a UI before the DSP exists, `est dev <folder> --ui-preview params.json` runs it against a parameter list from a file.
