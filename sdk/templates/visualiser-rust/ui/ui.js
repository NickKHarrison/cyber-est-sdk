// The visualiser's page. est-ui.js (loaded first, copied into the bundle by `est pack`) puts
// @est/ui on window.EstUI. The page never sees samples: protocol v2's `est:meter` brings the
// strip's peaks (linear, [left, right]) at most 30 times a second, and the page draws their history
// on the canvas: each channel's peak as a filled trace (in dBFS, -60 at the bottom of its half), a
// slower average over it, and the peak's hold. Change `draw` to draw something else from the same
// numbers. One requestAnimationFrame loop; nothing is drawn while no meter comes.
const est = EstUI.connect();
const canvas = document.getElementById('scope');
const readout = document.getElementById('readout');
const g = canvas.getContext('2d');
const RATE = 30;                       // the most meters a second (the history's resolution)
const FLOOR = -60;                     // dBFS at the bottom of each channel's half
let history = new Float32Array(RATE * 20 * 2);
let at = 0, count = 0, dirty = false;
const avg = [0, 0], hold = [0, 0], held = [0, 0];
let lastText = 0;

const db = (x) => (x > 0 ? Math.max(FLOOR, 20 * Math.log10(x)) : FLOOR);
const css = (name, fallback) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;

est.ready.then(() => {
  document.body.dataset.ready = 'true';
  if (!est.meters) readout.textContent = 'This host sends no meters (EST UI protocol 1): nothing to draw.';
});

est.onMeter(({ out }) => {
  const now = performance.now();
  for (let c = 0; c < 2; c++) {
    const v = out[c] ?? 0;
    history[at * 2 + c] = v;
    avg[c] += (v - avg[c]) * 0.15;
    if (v >= hold[c] || now - held[c] > 1500) { hold[c] = v; held[c] = now; }
  }
  at = (at + 1) % (history.length / 2);
  count = Math.min(count + 1, history.length / 2);
  dirty = true;
  if (now - lastText > 500) {                      // the readout's text, twice a second at most
    lastText = now;
    readout.textContent = `Peak L ${db(hold[0]).toFixed(1)} dBFS, R ${db(hold[1]).toFixed(1)} dBFS`;
  }
});

function draw() {
  requestAnimationFrame(draw);
  if (!dirty) return;
  dirty = false;
  const w = canvas.width, h = canvas.height, half = h / 2;
  const seconds = est.get(1) ?? 6;
  const shown = Math.min(count, Math.round(seconds * RATE));
  const accent = css('--est-accent', '#5ad1c3'), fg = css('--est-fg', '#e8eaf0');
  g.clearRect(0, 0, w, h);
  for (let c = 0; c < 2; c++) {
    const top = c * half, y = (v) => top + half - ((db(v) - FLOOR) / -FLOOR) * (half - 2);
    g.beginPath();
    g.moveTo(w, top + half);
    for (let i = 0; i < shown; i++) {
      const k = (at - 1 - i + history.length) % (history.length / 2);
      g.lineTo(w - (i / Math.max(1, Math.round(seconds * RATE) - 1)) * w, y(history[k * 2 + c]));
    }
    g.lineTo(w - (shown / Math.max(1, Math.round(seconds * RATE) - 1)) * w, top + half);
    g.closePath();
    g.globalAlpha = 0.55; g.fillStyle = accent; g.fill(); g.globalAlpha = 1;
    g.fillStyle = fg;
    g.fillRect(0, y(avg[c]) - 0.5, w, 1);            // the average
    g.fillRect(w - 6, y(hold[c]) - 1, 6, 2);         // the hold
  }
}
requestAnimationFrame(draw);
