// The plugin's UI script. est-ui.js (loaded first, copied into the bundle by `est pack`) puts
// @cyber-est/ui on window.EstUI and defines <est-knob> and <est-slider>; each control in index.html
// follows its `param` (a CLAP parameter id) and writes it. connect() makes the page's connection:
// it reads the host's nonce from the page's fragment, sends est:ready and takes est:init.
const est = EstUI.connect();
est.ready.then(() => { document.body.dataset.ready = 'true'; });
