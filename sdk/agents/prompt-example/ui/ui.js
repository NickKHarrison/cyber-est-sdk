// Only the display is drawn here: every control in the page is wired by Cyber's kit.
var est = EstUI.connect();
var CUTOFF = 1, RESONANCE = 2, MODE = 3; // the same ids as the sound code

// Called after every change (this window, Cyber, automation) and on resize; w and h are CSS pixels.
EstUI.display('#curve', function (g, w, h) {
  if (est.get(CUTOFF) === undefined) return; // before Cyber's first message
  var mode = Math.round(est.get(MODE)), f0 = est.get(CUTOFF), q = 0.6 + est.get(RESONANCE) * 8;
  g.beginPath();
  for (var x = 0; x <= w; x++) {
    var r = 20 * Math.pow(1000, x / w) / f0; // 20 Hz to 20 kHz, as a ratio to the cutoff
    var d = Math.sqrt((1 - r * r) * (1 - r * r) + (r / q) * (r / q));
    var mag = mode === 0 ? 1 / d : mode === 1 ? (r / q) / d : mode === 2 ? r * r / d : Math.abs(1 - r * r) / d;
    var y = h * 0.45 - Math.max(-36, Math.min(18, 20 * Math.log10(mag + 1e-6))) * (h / 60);
    if (x === 0) g.moveTo(x, y); else g.lineTo(x, y);
  }
  g.strokeStyle = '#ff8a3d'; g.lineWidth = 2; g.shadowColor = '#ff8a3d'; g.shadowBlur = 12; g.stroke();
});
