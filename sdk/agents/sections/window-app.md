This folder's window is an app: `ui-app/` is its source, and `npm run build:ui` builds it into `ui/`, the page `est.json`'s `"ui"` names. Change the app in `ui-app/`, never in `ui/`: the build empties `ui/` each time. Then `npx est validate` and `npx est dev` as usual.

| File | What |
|---|---|
| `package.json` | `npm run build:ui`, and `npm run dev:ui` (the app in a plain browser with a stand-in engine) |
| `ui-app/vite.config.ts` | The build: one classic script, relative URLs, fonts from the script, other hosts cut out |
| `ui-app/index.html` | The page; its `est-ui-size` meta gave `est.json`'s `ui.size` |
| `ui-app/main.ts` | The example app, no framework: a slider per parameter. Replace it with yours |
| `ui-app/store.ts` | The app's state: the app reads and writes only this |
| `ui-app/bridge.ts` | The link to the host: `applyHost`, `pushStore` (a drag is one gesture), `decodeReadout` |
| `ui-app/engine.ts` | The stand-in for `npm run dev:ui`; the build swaps it for `bridge.ts` |
| `ui-app/bits.ts` | `packFields` and `unpackFields`: the app's own data in hidden parameters |
| `ui-app/fonts.ts` | `registerFonts`: a font imported as `?base64` and registered from its bytes |

What the frame needs (the build does it, and `npx est validate` checks it):

- **One classic script**: no `<script type="module">`, no `crossorigin`, no `modulepreload` (`EST-U005`), or the frame stays blank.
- **Nothing from another host** (`EST-U002`), and never `fetch`: put the data the app needs in the script.
- **Fonts in the script**: import each as `?base64` and call `registerFonts`.
- **The host plays.** The sound, the transport, the keys and the tempo are Cyber's: no play button or keyboard in the app.
- **Every piece of state is a parameter** (up to 512): knobs are ordinary ones, the app's own data `hidden()` ones packed with `bits.ts`, what the plugin is playing `hidden().readOnly()` ones the DSP sets.
- **The size is fixed**: change the `est-ui-size` meta and `est.json`'s `ui.size` together.
