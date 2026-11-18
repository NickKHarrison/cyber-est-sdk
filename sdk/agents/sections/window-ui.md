This folder has a window in `ui/` (`ui/index.html`, `ui/ui.js`, `ui/style.css`): an `<est-knob>` for each parameter, and `est.json`'s `"ui"` entry. Change the page to match your parameters.

- `ui/index.html` loads `<script src="est-ui.js"></script>` and then your script, both as files. `npx est pack` copies `est-ui.js` into the bundle: do not add it yourself. It gives `EstUI.connect()`, `EstUI.bind(el, id)` and the `<est-knob param="ID">` and `<est-slider>` elements; `est-ui.d.ts` has its types.
- `est.json`: `"ui": { "path": "ui/index.html", "size": { "w": 440, "h": 180 } }`. Cyber draws the frame at exactly that size (CSS pixels) and never scales it.
- What loads: scripts, CSS, `.png`, `.webp` and `.svg` images and `.woff2` fonts that are files of the bundle (inline `<style>` too). No inline script, no `.jpg` or `.gif`, nothing from another host, no `fetch`. The `EST-U` rules check it.
- `npx est dev` shows the page beside the generated knobs. `npx est dev --json` reports it as `ui` lines: its load, `est:ready`, each message the host refused and why, console errors and files that did not load.
- A plugin other people add shows its own window only once Cyber has reviewed it; until then they see the generated knobs, so keep every control a parameter.
