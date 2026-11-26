# @cyber-est/ui

The library for an EST plugin's own UI in [Cyber](https://cyber-audio.fly.dev): the frame protocol, parameter binding, and the window kit: `<est-window>`, `<est-row>`, `<est-panel>`, `<est-knob>`, `<est-slider>`, `<est-switch>`, `<est-select>`, `<est-xy>`, `<est-value>`, `<est-meter>`, `<est-spectrum>`, `<est-all>`, each wiring itself to its parameter by id or by name, with five themes. No dependencies. MIT.

A plugin's UI is a web page in a sandboxed frame on a separate origin; it reaches its host only through this protocol. Two ways to use it:

- **A classic script.** Name `est-ui.js` in your `ui/index.html` (`<script src="est-ui.js"></script>`); `est pack` copies this package's `dist/est-ui.js` into the bundle beside it, and `window.EstUI` is the library. The types for that global are `@cyber-est/ui/est-ui.d.ts`.
- **An ES module**, for a UI written in TypeScript and bundled into one script: `import { connect, bind } from '@cyber-est/ui'`.

```js
const ui = EstUI.connect();
await ui.ready;
EstUI.bind(document.querySelector('#mix'), 0);   // an <input type=range>, a <select>, a checkbox or text
```

A window made only of the kit needs no script of its own:

```html
<est-window name="Glow Filter" theme="ember" meter>
  <est-row><est-knob param="Cutoff"></est-knob><est-select param="Mode"></est-select></est-row>
</est-window>
<script src="est-ui.js"></script>
```

`@cyber-est/ui/copy-rule` is the rule `est pack` uses to copy the script. The full guide is `sdk/docs/ui.md` in Cyber's repository.
