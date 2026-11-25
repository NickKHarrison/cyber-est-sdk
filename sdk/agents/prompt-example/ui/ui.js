// The window only reads and writes parameters (by the same ids as the sound code); it makes no sound.
const est = EstUI.connect();
const CUTOFF = 1, RESONANCE = 2, MODE = 3;
const canvas = document.getElementById('curve');
const g = canvas.getContext('2d');
const buttons = Array.from(document.querySelectorAll('.modes button'));

// A control of my own: one click is one gesture (begin, set, end), so it is one undo step in Cyber.
buttons.forEach(function (b) {
  b.addEventListener('click', function () {
    est.begin(MODE); est.set(MODE, Number(b.dataset.mode)); est.end(MODE);
  });
});

// Draw from the parameters' values: called on every change, whoever made it (this window, Cyber, automation).
function draw() {
  const mode = Math.round(est.get(MODE)), f0 = est.get(CUTOFF), q = 0.6 + est.get(RESONANCE) * 8;
  buttons.forEach(function (b) { b.setAttribute('aria-checked', String(Number(b.dataset.mode) === mode)); });
  const w = canvas.width, h = canvas.height;
  g.clearRect(0, 0, w, h);
  g.beginPath();
  for (let x = 0; x <= w; x++) {
    const r = 20 * Math.pow(1000, x / w) / f0;            // 20 Hz to 20 kHz, as a ratio to the cutoff
    const d = Math.sqrt((1 - r * r) * (1 - r * r) + (r / q) * (r / q));
    const mag = mode === 0 ? 1 / d : mode === 1 ? (r / q) / d : mode === 2 ? r * r / d : Math.abs(1 - r * r) / d;
    const y = h * 0.45 - Math.max(-36, Math.min(18, 20 * Math.log10(mag + 1e-6))) * (h / 60);
    if (x === 0) g.moveTo(x, y); else g.lineTo(x, y);
  }
  g.strokeStyle = '#ff8a3d'; g.lineWidth = 2; g.shadowColor = '#ff8a3d'; g.shadowBlur = 12; g.stroke();
}

est.ready.then(function () { est.subscribe(draw); draw(); });
// The output level, about 30 times a second: linear peaks [left, right].
est.onMeter(function (m) { document.getElementById('meter').style.width = Math.min(100, Math.max(m.out[0], m.out[1]) * 100) + '%'; });
