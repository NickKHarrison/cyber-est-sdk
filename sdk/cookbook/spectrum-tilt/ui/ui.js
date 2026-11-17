// The spectrum tilt's page. est-ui.js (loaded first, copied into the bundle by `est pack`) puts
// @est/ui on window.EstUI. EST 1.1, frame protocol 3: est.json's `"ui": { "audio": true }` lets the
// page ask the host for an analysis of the plugin's output, `est.audio({ fftSize, rate }, fn)`;
// `fn` gets `{ bins, rms }`: `fftSize / 2` magnitudes in whole dB (-120 to 0) from 0 Hz to half the
// sample rate, and each channel's RMS (linear). **Never samples**: the host computes the analysis
// on its own analysers and sends only these numbers, so the page cannot record the sound.
//
// The page draws the bins on a log-frequency axis, the tilt's own curve over them (computed here
// from the parameters, the same one-pole split as the DSP), and the RMS in words twice a second.
// One requestAnimationFrame loop, drawing only when something changed; nothing moves by itself.
const canvas = document.getElementById('spectrum');
const readout = document.getElementById('readout');
const g = canvas.getContext('2d');
const FFT = 2048;                      // 1024 bins: enough for a smooth curve, the host's largest is 2048
const RATE = 30;                       // analyses a second (the host's most)
const LOW_HZ = 20, FLOOR_DB = -100;
let bins = null, rms = [0, 0], dirty = true, lastText = 0;

// The host's first `est:init` may be an older version's (sent on the frame's load, before this page
// says which it speaks); the version-3 one, which says whether the analysis comes, follows. So the
// words are decided on every init (`onInit`), and the ask below is made once: the library sends it
// again after each init and nothing comes where the host sends no analysis.
const est = EstUI.connect({ onInit: () => { dirty = true; words(); } });

const css = (name, fallback) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
const db = (x) => (x > 0 ? Math.max(FLOOR_DB, 20 * Math.log10(x)) : FLOOR_DB);
const nyquist = () => (est.rate ?? 48000) / 2;
const xOf = (hz, w) => (Math.log(hz / LOW_HZ) / Math.log(nyquist() / LOW_HZ)) * w;

/** The tilt's response at `hz` in dB: lows × 10^((out − tilt/2)/20) plus highs × 10^((out + tilt/2)/20), the one-pole split at Pivot. */
function tiltDb(hz) {
  const sr = est.rate ?? 48000;
  const tilt = est.get(0) ?? 0, pivot = est.get(1) ?? 800, out = est.get(2) ?? 0;
  const a = 1 - Math.exp(-2 * Math.PI * pivot / sr);
  const w = 2 * Math.PI * hz / sr;
  // H_low(z) = a / (1 − (1 − a) z^−1) at z = e^{jw}.
  const dr = 1 - (1 - a) * Math.cos(w), di = (1 - a) * Math.sin(w);
  const den = dr * dr + di * di;
  const lr = (a * dr) / den, li = (-a * di) / den;
  const gl = Math.pow(10, (out - tilt / 2) / 20), gh = Math.pow(10, (out + tilt / 2) / 20);
  const hr = gl * lr + gh * (1 - lr), hi = gl * li - gh * li;
  return 10 * Math.log10(hr * hr + hi * hi);
}

function words() {
  if (!est.audioAvailable) readout.textContent = 'This host sends no analysis of the sound (EST UI protocol 3): the tilt\'s curve only.';
  else if (!bins) readout.textContent = 'Play something through the plugin.';
}

est.ready.then(() => { document.body.dataset.ready = 'true'; words(); });
est.audio({ fftSize: FFT, rate: RATE }, (s) => {
  bins = s.bins;
  rms = s.rms;
  dirty = true;
  const now = performance.now();
  if (now - lastText > 500) {          // the words, twice a second at most
    lastText = now;
    readout.textContent = `RMS L ${db(rms[0]).toFixed(1)} dBFS, R ${db(rms[1]).toFixed(1)} dBFS`;
  }
});
est.subscribe(() => { dirty = true; });

function draw() {
  requestAnimationFrame(draw);
  if (!dirty) return;
  dirty = false;
  const w = canvas.width = canvas.clientWidth || canvas.width;
  const h = canvas.height = canvas.clientHeight || canvas.height;
  const accent = css('--est-accent', '#5ad1c3'), fg = css('--est-fg', '#e8eaf0'), dim = css('--est-dim', '#a9afbd');
  const y = (v) => h - ((Math.max(FLOOR_DB, v) - FLOOR_DB) / -FLOOR_DB) * h;
  g.clearRect(0, 0, w, h);
  // The grid: 100 Hz, 1 kHz and 10 kHz.
  g.fillStyle = dim; g.globalAlpha = 0.25;
  for (const hz of [100, 1000, 10000]) if (hz < nyquist()) g.fillRect(Math.round(xOf(hz, w)), 0, 1, h);
  g.globalAlpha = 1;
  if (bins && bins.length > 1) {
    const binHz = nyquist() / bins.length;
    g.beginPath();
    g.moveTo(0, h);
    for (let i = 1; i < bins.length; i++) {
      const hz = i * binHz;
      if (hz < LOW_HZ) continue;
      g.lineTo(xOf(hz, w), y(bins[i]));
    }
    g.lineTo(w, h);
    g.closePath();
    g.globalAlpha = 0.55; g.fillStyle = accent; g.fill(); g.globalAlpha = 1;
  }
  // The tilt's curve, ±12 dB around the middle of the height.
  g.beginPath();
  for (let px = 0; px <= w; px += 2) {
    const hz = LOW_HZ * Math.pow(nyquist() / LOW_HZ, px / w);
    const v = tiltDb(hz);
    const py = h / 2 - (v / 24) * (h / 2);
    if (px === 0) g.moveTo(px, py); else g.lineTo(px, py);
  }
  g.strokeStyle = fg; g.lineWidth = 1.5; g.stroke();
}
requestAnimationFrame(draw);
