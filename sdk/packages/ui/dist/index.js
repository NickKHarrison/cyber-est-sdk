/* @est/ui (MIT): the EST plugin UI library, frame protocol v2. */

// sdk/packages/ui/src/protocol.ts
var EST_UI_PROTOCOL = 3;
var AUDIO_FFT_SIZES = [64, 128, 256, 512, 1024, 2048];
var AUDIO_PER_SECOND = 30;
var SPECTRUM_FLOOR_DB = -120;
var MAX_MESSAGE_BYTES = 64 * 1024;
var MAX_INIT_BYTES = 512 * 1024;
var HOST_MAX_PER_SECOND = 240;
var SEND_PER_SECOND = 200;
var MAX_METER = 4;
var UI_SIZE_BOUNDS = { w: [120, 2e3], h: [80, 1400] };
var FLAGS = { STEPPED: 1, PERIODIC: 2, HIDDEN: 4, READONLY: 8, BYPASS: 16, AUTOMATABLE: 32 };
var HOST_KEYS = {
  1: { "est:init": "nonce,params,type,v", "est:param": "id,nonce,type,v,value" },
  2: {
    "est:init": "meters,nonce,params,rate,theme,type,v",
    "est:param": "id,nonce,type,v,value",
    "est:meter": "in,nonce,out,type,v",
    "est:theme": "nonce,theme,type,v"
  },
  3: {
    "est:init": "audio,meters,nonce,params,rate,theme,type,v",
    "est:param": "id,nonce,type,v,value",
    "est:meter": "in,nonce,out,type,v",
    "est:theme": "nonce,theme,type,v",
    "est:spectrum": "bins,nonce,rms,type,v"
  }
};
var PARAM_KEYS = "def,flags,id,max,min,module,name,value";
var PARAM_KEYS_SCALED = "def,flags,id,max,min,module,name,scale,value";
function messageSize(m) {
  try {
    const s = JSON.stringify(m);
    return s === void 0 ? Infinity : s.length;
  } catch {
    return Infinity;
  }
}
var isObject = (x) => !!x && typeof x === "object" && !Array.isArray(x);
var finite = (x) => typeof x === "number" && Number.isFinite(x);
var keysOf = (m) => Object.keys(m).sort().join(",");
function checkParam(raw) {
  if (!isObject(raw)) return null;
  const keys = keysOf(raw);
  if (keys !== PARAM_KEYS && keys !== PARAM_KEYS_SCALED) return null;
  const { id, name, module, min, max, def, flags, value, scale } = raw;
  if (keys === PARAM_KEYS_SCALED && scale !== "linear" && scale !== "log") return null;
  if (typeof id !== "number" || !Number.isInteger(id) || id < 0 || id > 4294967295) return null;
  if (typeof name !== "string" || typeof module !== "string") return null;
  if (!finite(min) || !finite(max) || !finite(def) || !finite(value) || min > max) return null;
  if (typeof flags !== "number" || !Number.isInteger(flags) || flags < 0) return null;
  const clamp = (x) => Math.min(max, Math.max(min, x));
  const out = { id, name, module, min, max, def: clamp(def), flags, value: clamp(value) };
  if (scale === "log") out.scale = "log";
  return out;
}
var HEX = /^#[0-9a-f]{6}$/;
function checkTheme(raw) {
  if (!isObject(raw) || keysOf(raw) !== "accent,bg,fg") return null;
  const { bg, fg, accent } = raw;
  if (typeof bg !== "string" || typeof fg !== "string" || typeof accent !== "string") return null;
  if (!HEX.test(bg) || !HEX.test(fg) || !HEX.test(accent)) return null;
  return { bg, fg, accent };
}
function checkPair(raw) {
  if (!Array.isArray(raw) || raw.length !== 2) return null;
  const [l, r] = raw;
  if (!finite(l) || !finite(r) || l < 0 || r < 0 || l > MAX_METER || r > MAX_METER) return null;
  return [l, r];
}
function checkHostMessage(raw, nonce, known) {
  if (!isObject(raw)) return null;
  if (messageSize(raw) > (raw.type === "est:init" ? MAX_INIT_BYTES : MAX_MESSAGE_BYTES)) return null;
  if (raw.v !== 1 && raw.v !== 2 && raw.v !== 3 || typeof raw.nonce !== "string" || raw.nonce !== nonce || typeof raw.type !== "string") return null;
  const v = raw.v;
  const keys = HOST_KEYS[v][raw.type];
  if (!keys || keysOf(raw) !== keys) return null;
  if (raw.type === "est:init") {
    if (!Array.isArray(raw.params)) return null;
    const params = [];
    const seen = /* @__PURE__ */ new Set();
    for (const p2 of raw.params) {
      const ok = checkParam(p2);
      if (!ok || seen.has(ok.id)) return null;
      seen.add(ok.id);
      params.push(ok);
    }
    if (v === 1) return { type: "est:init", v, params, rate: null, theme: null, meters: false, audio: false };
    const rate = raw.rate;
    if (rate !== null && (!finite(rate) || !Number.isInteger(rate) || rate < 8e3 || rate > 384e3)) return null;
    const theme = checkTheme(raw.theme);
    if (!theme || typeof raw.meters !== "boolean") return null;
    if (v === 3 && typeof raw.audio !== "boolean") return null;
    return { type: "est:init", v, params, rate, theme, meters: raw.meters, audio: v === 3 && raw.audio === true };
  }
  if (raw.type === "est:spectrum") {
    const bins = raw.bins, rms = checkPair(raw.rms);
    if (!rms || !Array.isArray(bins) || !AUDIO_FFT_SIZES.includes(bins.length * 2)) return null;
    for (const b of bins) if (typeof b !== "number" || !Number.isInteger(b) || b < SPECTRUM_FLOOR_DB || b > 0) return null;
    return { type: "est:spectrum", v: 3, bins: bins.slice(), rms };
  }
  if (raw.type === "est:meter") {
    const out = checkPair(raw.out);
    const input = raw.in === null ? null : checkPair(raw.in);
    if (!out || raw.in !== null && !input) return null;
    return { type: "est:meter", v, in: input, out };
  }
  if (raw.type === "est:theme") {
    const theme = checkTheme(raw.theme);
    return theme ? { type: "est:theme", v, theme } : null;
  }
  const { id, value } = raw;
  if (typeof id !== "number" || !Number.isInteger(id)) return null;
  const p = known.get(id);
  if (!p || !finite(value) || value < p.min || value > p.max) return null;
  return { type: "est:param", v, id, value };
}
function readFragment(hash) {
  const q = new URLSearchParams(hash.replace(/^#/, ""));
  return { nonce: q.get("n") ?? "", hostOrigin: q.get("p") ?? "" };
}
var readyMessage = (nonce, v = EST_UI_PROTOCOL) => ({ v, type: "est:ready", nonce });
var paramMessage = (nonce, id, value, v = EST_UI_PROTOCOL) => ({ v, type: "est:param", nonce, id, value });
var gestureMessage = (nonce, id, phase, v = EST_UI_PROTOCOL) => ({ v, type: "est:gesture", nonce, id, phase });
var resizeMessage = (nonce, w, h, v = 2) => ({ v, type: "est:resize", nonce, w, h });
var audioMessage = (nonce, fftSize, rate) => ({ v: 3, type: "est:audio", nonce, fftSize, rate });
function clampSize(w, h) {
  const c = (x, [lo, hi]) => Number.isFinite(x) ? Math.min(hi, Math.max(lo, Math.round(x))) : lo;
  return { w: c(w, UI_SIZE_BOUNDS.w), h: c(h, UI_SIZE_BOUNDS.h) };
}
function clampValue(p, v) {
  if (!Number.isFinite(v)) return p.min;
  let x = Math.min(p.max, Math.max(p.min, v));
  if (p.flags & FLAGS.STEPPED) x = Math.min(p.max, Math.max(p.min, Math.round(x)));
  return x;
}
function sendGate(max = SEND_PER_SECOND, now = () => Date.now()) {
  const times = [];
  return {
    ok() {
      const t = now();
      while (times.length && t - times[0] >= 1e3) times.shift();
      return times.length < max;
    },
    take() {
      times.push(now());
    }
  };
}

// sdk/packages/ui/src/connect.ts
function windowTransport(hostOrigin) {
  return {
    // The frame's origin is opaque and the host's differs: '*' is the only target that arrives
    // (the host checks the sender's window and the nonce; nothing secret is sent).
    post: (m) => window.parent.postMessage(m, "*"),
    listen(fn) {
      const on = (e) => fn(e.data, e.source === window.parent && (!hostOrigin || e.origin === hostOrigin));
      window.addEventListener("message", on);
      return () => window.removeEventListener("message", on);
    }
  };
}
var defaultSchedule = (fn) => {
  if (typeof requestAnimationFrame === "function") requestAnimationFrame(() => fn());
  else setTimeout(fn, 16);
};
var current = null;
var waiting = /* @__PURE__ */ new Set();
var currentConnection = () => current;
function whenConnected(fn) {
  if (current) {
    fn(current);
    return () => {
    };
  }
  waiting.add(fn);
  return () => {
    waiting.delete(fn);
  };
}
function connect(opts = {}) {
  const own = !opts.transport;
  if (own && current) return current;
  const frag = typeof location !== "undefined" ? readFragment(location.hash) : { nonce: "", hostOrigin: "" };
  const nonce = opts.nonce ?? frag.nonce;
  const transport = opts.transport ?? windowTransport(opts.hostOrigin ?? frag.hostOrigin);
  const schedule = opts.schedule ?? defaultSchedule;
  const gate = sendGate(void 0, opts.now);
  const known = /* @__PURE__ */ new Map();
  const listeners = /* @__PURE__ */ new Set();
  const meterListeners = /* @__PURE__ */ new Set();
  const themeListeners = /* @__PURE__ */ new Set();
  let rejected = 0;
  let initialised = false;
  let version = EST_UI_PROTOCOL;
  let rate = null;
  let theme = null;
  let meters = false;
  let audioOk = false;
  const spectrumListeners = /* @__PURE__ */ new Set();
  let audioAsk = null;
  const sendAudio = () => {
    if (closed || !nonce || version !== 3 || !audioOk) return;
    drainPending();
    queue.push(audioMessage(nonce, audioAsk?.fftSize ?? 1024, audioAsk && spectrumListeners.size ? audioAsk.rate : 0));
    send();
  };
  const themeTarget = opts.themeTarget !== void 0 ? opts.themeTarget : own && typeof document !== "undefined" ? document.documentElement : null;
  const applyTheme = (t) => {
    theme = t;
    if (themeTarget) {
      themeTarget.style.setProperty("--est-bg", t.bg);
      themeTarget.style.setProperty("--est-fg", t.fg);
      themeTarget.style.setProperty("--est-accent", t.accent);
    }
    for (const fn of [...themeListeners]) {
      try {
        fn({ ...t });
      } catch (err) {
        console.error("[est-ui] a theme listener threw", err);
      }
    }
  };
  let closed = false;
  let resolveReady;
  const ready = new Promise((r) => {
    resolveReady = r;
  });
  let pending = /* @__PURE__ */ new Map();
  const queue = [];
  let scheduled = false;
  const emit = (id, source) => {
    for (const fn of [...listeners]) {
      try {
        fn(id, source);
      } catch (err) {
        console.error("[est-ui] a listener threw", err);
      }
    }
  };
  const drainPending = () => {
    for (const [id, value] of pending) queue.push(paramMessage(nonce, id, value, version));
    pending = /* @__PURE__ */ new Map();
  };
  const send = () => {
    while (queue.length && gate.ok()) {
      gate.take();
      transport.post(queue.shift());
    }
    if (queue.length) later();
  };
  const flush = () => {
    scheduled = false;
    if (closed || !nonce) return;
    drainPending();
    send();
  };
  function later() {
    if (scheduled) return;
    scheduled = true;
    schedule(flush);
  }
  const stop = transport.listen((data, ok) => {
    if (closed) return;
    if (!ok) {
      rejected++;
      return;
    }
    const m = checkHostMessage(data, nonce, known);
    if (!m) {
      rejected++;
      return;
    }
    if (m.type === "est:meter") {
      const v = { in: m.in ? [m.in[0], m.in[1]] : null, out: [m.out[0], m.out[1]] };
      for (const fn of [...meterListeners]) {
        try {
          fn(v);
        } catch (err) {
          console.error("[est-ui] a meter listener threw", err);
        }
      }
      return;
    }
    if (m.type === "est:theme") {
      applyTheme(m.theme);
      return;
    }
    if (m.type === "est:spectrum") {
      const v = { bins: m.bins, rms: [m.rms[0], m.rms[1]] };
      for (const fn of [...spectrumListeners]) {
        try {
          fn(v);
        } catch (err) {
          console.error("[est-ui] a spectrum listener threw", err);
        }
      }
      return;
    }
    if (m.type === "est:init") {
      version = m.v;
      if (m.v >= 2) {
        rate = m.rate;
        meters = m.meters;
        if (m.theme) applyTheme(m.theme);
      }
      audioOk = m.v === 3 && m.audio;
      known.clear();
      for (const p2 of m.params) known.set(p2.id, { ...p2 });
      initialised = true;
      opts.onInit?.(m.params.map((p2) => ({ ...p2 })));
      emit(null, "host");
      resolveReady(m.params.map((p2) => ({ ...p2 })));
      if (audioAsk && spectrumListeners.size) sendAudio();
      return;
    }
    const p = known.get(m.id);
    if (p.value === m.value) return;
    p.value = m.value;
    emit(m.id, "host");
  });
  const conn = {
    nonce,
    ready,
    get rejected() {
      return rejected;
    },
    get initialised() {
      return initialised;
    },
    get version() {
      return version;
    },
    get rate() {
      return rate;
    },
    get theme() {
      return theme ? { ...theme } : null;
    },
    get meters() {
      return meters;
    },
    get audioAvailable() {
      return audioOk;
    },
    audio(o, fn) {
      const want = typeof o.fftSize === "number" && Number.isFinite(o.fftSize) ? o.fftSize : 1024;
      const fftSize = AUDIO_FFT_SIZES.reduce((best, x) => Math.abs(x - want) < Math.abs(best - want) ? x : best, 1024);
      const r = typeof o.rate === "number" && Number.isFinite(o.rate) ? Math.round(o.rate) : AUDIO_PER_SECOND;
      audioAsk = { fftSize, rate: Math.max(1, Math.min(AUDIO_PER_SECOND, r)) };
      spectrumListeners.add(fn);
      sendAudio();
      return () => {
        spectrumListeners.delete(fn);
        if (!spectrumListeners.size) sendAudio();
      };
    },
    onMeter(fn) {
      meterListeners.add(fn);
      return () => {
        meterListeners.delete(fn);
      };
    },
    onTheme(fn) {
      themeListeners.add(fn);
      return () => {
        themeListeners.delete(fn);
      };
    },
    resize(w, h) {
      if (closed || !nonce || version < 2) return false;
      const s = clampSize(w, h);
      drainPending();
      queue.push(resizeMessage(nonce, s.w, s.h, version));
      send();
      return true;
    },
    param: (id) => known.get(id),
    params: () => [...known.values()],
    get: (id) => known.get(id)?.value,
    set(id, value) {
      const p = known.get(id);
      if (!p || closed) return;
      const v = clampValue(p, value);
      if (v === p.value && !pending.has(id)) return;
      p.value = v;
      pending.set(id, v);
      emit(id, "ui");
      later();
    },
    begin(id) {
      if (!known.has(id) || closed || !nonce) return;
      drainPending();
      queue.push(gestureMessage(nonce, id, "begin", version));
      send();
    },
    end(id) {
      if (!known.has(id) || closed || !nonce) return;
      drainPending();
      queue.push(gestureMessage(nonce, id, "end", version));
      send();
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    flush,
    close() {
      if (closed) return;
      flush();
      closed = true;
      stop();
      listeners.clear();
      meterListeners.clear();
      themeListeners.clear();
      spectrumListeners.clear();
      if (current === conn) current = null;
    }
  };
  if (own) {
    current = conn;
    for (const fn of [...waiting]) fn(conn);
    waiting.clear();
  }
  if (nonce) transport.post(readyMessage(nonce));
  return conn;
}

// sdk/packages/ui/src/format.ts
var logOk = (p) => p.min > 0 && p.max > p.min;
function toNorm(p, v, scale = "linear") {
  if (p.max <= p.min) return 0;
  const x = Math.min(p.max, Math.max(p.min, v));
  if (scale === "log" && logOk(p)) return Math.log(x / p.min) / Math.log(p.max / p.min);
  return (x - p.min) / (p.max - p.min);
}
function fromNorm(p, u, scale = "linear") {
  const t = Math.min(1, Math.max(0, Number.isFinite(u) ? u : 0));
  let v = scale === "log" && logOk(p) ? p.min * Math.pow(p.max / p.min, t) : p.min + t * (p.max - p.min);
  if (p.flags & FLAGS.STEPPED) v = Math.round(v);
  return Math.min(p.max, Math.max(p.min, v));
}
var trim = (s) => s.includes(".") ? s.replace(/\.?0+$/, "") : s;
function formatNumber(v) {
  const a = Math.abs(v);
  if (a >= 100) return v.toFixed(0);
  if (a >= 10) return trim(v.toFixed(1));
  return trim(v.toFixed(2));
}
function formatValue(p, v, unit = "", labels) {
  if (p.flags & FLAGS.STEPPED) {
    const i = Math.round(v);
    const label = labels?.[i - Math.round(p.min)];
    if (label) return label;
    return unit ? `${i} ${unit}` : String(i);
  }
  const u = unit.trim();
  if (/^hz$/i.test(u) && Math.abs(v) >= 1e3) return `${formatNumber(v / 1e3)} kHz`;
  if (/^db$/i.test(u)) return `${v > 0 ? "+" : ""}${formatNumber(v)} dB`;
  if (u === "%") return `${formatNumber(v)} %`;
  return u ? `${formatNumber(v)} ${u}` : formatNumber(v);
}

// sdk/packages/ui/src/controls.ts
var Base = typeof HTMLElement === "undefined" ? class {
} : HTMLElement;
var STYLE = ':host{--_bg:var(--est-bg,#14161b);--_fg:var(--est-fg,#e8eaf0);--_accent:var(--est-accent,#5ad1c3);--_dim:var(--est-dim,#a9afbd);--_track:var(--est-track,#343a46);display:inline-flex;flex-direction:column;align-items:center;gap:4px;color:var(--_fg);font:12px/1.3 system-ui,sans-serif;touch-action:none;user-select:none;-webkit-user-select:none;cursor:grab;border-radius:6px;outline:none}:host(:focus-visible){outline:2px solid var(--_accent);outline-offset:2px}:host([aria-disabled="true"]){opacity:.55;cursor:default}.label{color:var(--_dim);white-space:nowrap}.value{font-variant-numeric:tabular-nums;white-space:nowrap}svg{display:block;overflow:visible}.track{stroke:var(--_track)}.fill{stroke:var(--_accent)}.dot{fill:var(--_fg)}';
var EstControl = class extends Base {
  static get observedAttributes() {
    return ["param", "label", "name", "unit", "scale", "labels", "size"];
  }
  _root;
  _src = null;
  _explicitSource = false;
  _unsubscribe = null;
  _unwait = null;
  _drag = null;
  constructor() {
    super();
    this._root = this.attachShadow({ mode: "open" });
    this._root.innerHTML = `<style>${STYLE}${this._extraStyle()}</style>${this._template()}`;
    const on = (type, fn) => this.addEventListener(type, (e) => fn(e));
    on("keydown", (e) => this._onKey(e));
    on("pointerdown", (e) => this._onDown(e));
    on("pointermove", (e) => this._onMove(e));
    for (const t of ["pointerup", "pointercancel", "lostpointercapture"]) on(t, (e) => this._onUp(e));
    on("dblclick", () => this.reset());
  }
  _extraStyle() {
    return "";
  }
  connectedCallback() {
    if (!this.hasAttribute("role")) this.setAttribute("role", "slider");
    if (!this.hasAttribute("tabindex")) this.tabIndex = 0;
    this.setAttribute("aria-orientation", this._orientation);
    if (!this._explicitSource && !this._src) {
      const c = currentConnection();
      if (c) this._attach(c);
      else this._unwait = whenConnected((conn) => {
        if (!this._explicitSource) this._attach(conn);
      });
    }
    this._render();
  }
  disconnectedCallback() {
    this._cancelDrag(false);
    this._unwait?.();
    this._unwait = null;
  }
  attributeChangedCallback() {
    if (this.isConnected) this._render();
  }
  /** The values this control reads and writes (the page's connection unless set). */
  get source() {
    return this._src;
  }
  set source(s) {
    this._explicitSource = !!s;
    this._unwait?.();
    this._unwait = null;
    this._attach(s);
  }
  _attach(s) {
    this._unsubscribe?.();
    this._unsubscribe = null;
    this._src = s;
    if (s) this._unsubscribe = s.subscribe((id) => {
      if (id === null || id === this.paramId) this._render();
    });
    this._render();
  }
  /** The CLAP id from the `param` attribute (null without one). */
  get paramId() {
    const a = this.getAttribute("param");
    if (a === null || a.trim() === "") return null;
    const n = Number(a);
    return Number.isInteger(n) && n >= 0 ? n : null;
  }
  set paramId(id) {
    if (id === null) this.removeAttribute("param");
    else this.setAttribute("param", String(id));
  }
  get info() {
    const id = this.paramId;
    return id === null ? void 0 : this._src?.param(id);
  }
  get value() {
    const id = this.paramId;
    return id === null ? void 0 : this._src?.get(id);
  }
  set value(v) {
    const id = this.paramId;
    if (id !== null && v !== void 0) this._src?.set(id, v);
  }
  /** The `scale` attribute when given ("log" or "linear"), else the parameter's own (est.json's hint, D-44). */
  get _scale() {
    const a = this.getAttribute("scale");
    if (a === "log" || a === "linear") return a;
    return this.info?.scale === "log" ? "log" : "linear";
  }
  get _labels() {
    const l = this.getAttribute("labels");
    return l ? l.split(",").map((s) => s.trim()) : void 0;
  }
  _editable(p) {
    return !!p && !(p.flags & FLAGS.READONLY) && p.max > p.min;
  }
  /** The text shown and announced for the current value. */
  get valueText() {
    const p = this.info;
    const v = this.value;
    if (!p || v === void 0) return "";
    return formatValue(p, v, this.getAttribute("unit") ?? "", this._labels);
  }
  _render() {
    const p = this.info;
    const v = this.value;
    const label = this.getAttribute("label") || p?.name || (this.paramId !== null ? `Parameter ${this.paramId}` : "Parameter");
    const name = this.getAttribute("name") || label;
    const ok = !!p && v !== void 0;
    const text = ok ? this.valueText : "";
    const aria = (k, x) => x === null ? this.removeAttribute(`aria-${k}`) : this.setAttribute(`aria-${k}`, String(x));
    aria("label", name);
    aria("valuemin", ok ? p.min : 0);
    aria("valuemax", ok ? p.max : 1);
    aria("valuenow", ok ? v : 0);
    aria("valuetext", ok ? text : null);
    aria("disabled", this._editable(p) ? null : "true");
    aria("readonly", p && p.flags & FLAGS.READONLY ? "true" : null);
    const show = (sel, t) => {
      const el = this._root.querySelector(sel);
      if (el) el.textContent = t;
    };
    show(".label", label);
    show(".value", ok ? text : "–");
    this._draw(ok ? toNorm(p, v, this._scale) : 0);
  }
  /** One key step, as a new value (null: not a key of ours). */
  _keyValue(e, p, v) {
    const stepped = (p.flags & FLAGS.STEPPED) !== 0;
    const big = stepped ? Math.max(1, Math.round((p.max - p.min) / 10)) : 0.1;
    const small = stepped ? 1 : e.shiftKey ? 1e-3 : 0.01;
    const by = (d) => stepped ? v + d : fromNorm(p, toNorm(p, v, this._scale) + d, this._scale);
    switch (e.key) {
      case "ArrowUp":
      case "ArrowRight":
        return by(small);
      case "ArrowDown":
      case "ArrowLeft":
        return by(-small);
      case "PageUp":
        return by(big);
      case "PageDown":
        return by(-big);
      case "Home":
        return p.min;
      case "End":
        return p.max;
      default:
        return null;
    }
  }
  _onKey(e) {
    const p = this.info;
    const v = this.value;
    if (e.key === "Escape" && this._drag) {
      e.preventDefault();
      this._cancelDrag(true);
      return;
    }
    if (!this._editable(p) || v === void 0 || e.altKey || e.ctrlKey || e.metaKey) return;
    const next = this._keyValue(e, p, v);
    if (next === null) return;
    e.preventDefault();
    this._src.set(p.id, next);
  }
  _onDown(e) {
    const p = this.info;
    const v = this.value;
    if (e.button !== 0 || !this._editable(p) || v === void 0 || this._drag) return;
    e.preventDefault();
    this.focus();
    try {
      this.setPointerCapture(e.pointerId);
    } catch {
    }
    const start = { norm: toNorm(p, v, this._scale), x: e.clientX, y: e.clientY };
    this._drag = { id: p.id, start: v, startNorm: start.norm, x: e.clientX, y: e.clientY, pointer: e.pointerId };
    this._src.begin(p.id);
    this._src.set(p.id, fromNorm(p, this._pointerNorm(e, start), this._scale));
  }
  _onMove(e) {
    const d = this._drag;
    const p = this.info;
    if (!d || e.pointerId !== d.pointer || !p) return;
    this._src.set(d.id, fromNorm(p, this._pointerNorm(e, { norm: d.startNorm, x: d.x, y: d.y }), this._scale));
  }
  _onUp(e) {
    if (!this._drag || e.pointerId !== this._drag.pointer) return;
    this._cancelDrag(false);
  }
  /** End a drag (`restore`: put the value back first, Escape). */
  _cancelDrag(restore) {
    const d = this._drag;
    if (!d) return;
    this._drag = null;
    if (restore) this._src?.set(d.id, d.start);
    this._src?.end(d.id);
    try {
      this.releasePointerCapture(d.pointer);
    } catch {
    }
  }
  /** Back to the parameter's default. */
  reset() {
    const p = this.info;
    if (!this._editable(p)) return;
    this._src.set(p.id, p.def);
  }
};
var EstKnob = class extends EstControl {
  _orientation = "vertical";
  _template() {
    const arc = (c) => `<path class="${c}" fill="none" stroke-width="4" stroke-linecap="round"/>`;
    return `<span class="label" aria-hidden="true"></span><svg viewBox="0 0 48 48" aria-hidden="true">${arc("track")}${arc("fill")}<circle class="dot" r="3"/></svg><span class="value" aria-hidden="true"></span>`;
  }
  _extraStyle() {
    return "svg{width:var(--_size,48px);height:var(--_size,48px)}";
  }
  attributeChangedCallback() {
    const s = Number(this.getAttribute("size"));
    if (Number.isFinite(s) && s > 0) this.style.setProperty("--_size", `${s}px`);
    super.attributeChangedCallback();
  }
  _draw(norm) {
    const a0 = Math.PI * 0.75;
    const sweep = Math.PI * 1.5;
    const at = (t2) => {
      const a = a0 + sweep * t2;
      return [24 + 18 * Math.cos(a), 24 + 18 * Math.sin(a)];
    };
    const arc = (t2) => {
      const [x0, y0] = at(0);
      const [x1, y1] = at(t2);
      return `M${x0.toFixed(2)} ${y0.toFixed(2)}A18 18 0 ${sweep * t2 > Math.PI ? 1 : 0} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
    };
    const t = Math.min(1, Math.max(0, norm));
    this._root.querySelector(".track")?.setAttribute("d", arc(1));
    this._root.querySelector(".fill")?.setAttribute("d", t > 1e-3 ? arc(t) : "");
    const [x, y] = at(t);
    const dot = this._root.querySelector(".dot");
    dot?.setAttribute("cx", x.toFixed(2));
    dot?.setAttribute("cy", y.toFixed(2));
  }
  _pointerNorm(e, start) {
    return start.norm + (start.y - e.clientY) / (e.shiftKey ? 1e3 : 200);
  }
};
var EstSlider = class extends EstControl {
  _orientation = "horizontal";
  _template() {
    return '<span class="row"><span class="label" aria-hidden="true"></span><span class="value" aria-hidden="true"></span></span><span class="bar" aria-hidden="true"><span class="fillbar"></span><span class="thumb"></span></span>';
  }
  _extraStyle() {
    return ":host{align-items:stretch;min-width:120px}.row{display:flex;justify-content:space-between;gap:8px}.bar{position:relative;height:6px;margin:6px 0;border-radius:3px;background:var(--_track)}.fillbar{position:absolute;inset:0 auto 0 0;border-radius:3px;background:var(--_accent)}.thumb{position:absolute;top:50%;width:14px;height:14px;margin:-7px 0 0 -7px;border-radius:50%;background:var(--_fg)}";
  }
  _draw(norm) {
    const pct = `${(Math.min(1, Math.max(0, norm)) * 100).toFixed(2)}%`;
    this._root.querySelector(".fillbar")?.style.setProperty("width", pct);
    this._root.querySelector(".thumb")?.style.setProperty("left", pct);
  }
  _pointerNorm(e) {
    const bar = this._root.querySelector(".bar");
    const r = (bar ?? this).getBoundingClientRect();
    return r.width > 0 ? (e.clientX - r.left) / r.width : 0;
  }
};
function defineElements(registry = typeof customElements === "undefined" ? void 0 : customElements) {
  if (!registry) return;
  if (!registry.get("est-knob")) registry.define("est-knob", EstKnob);
  if (!registry.get("est-slider")) registry.define("est-slider", EstSlider);
}

// sdk/packages/ui/src/bind.ts
function bind(el, paramId, opts = {}) {
  const source = opts.source ?? currentConnection();
  if (!source) throw new Error("@est/ui: bind() needs a source; call connect() first");
  if (el instanceof EstKnob || el instanceof EstSlider) {
    const c = el;
    c.paramId = paramId;
    c.source = source;
    return () => {
      c.source = null;
    };
  }
  const tag = el.tagName.toLowerCase();
  const input = tag === "input" ? el : null;
  const select = tag === "select" ? el : null;
  const kind = input ? input.type === "checkbox" ? "check" : "input" : select ? "select" : "text";
  const logRange = (p) => !!input && input.type === "range" && p.scale === "log" && p.min > 0 && p.max > p.min;
  const show = () => {
    const p = source.param(paramId);
    const v = source.get(paramId);
    if (!p || v === void 0) return;
    if (kind === "input" && input && logRange(p)) {
      input.min = "0";
      input.max = "1";
      input.step = "any";
      input.value = String(toNorm(p, v, "log"));
      input.disabled = (p.flags & FLAGS.READONLY) !== 0;
    } else if (kind === "input" && input) {
      input.min = String(p.min);
      input.max = String(p.max);
      input.step = p.flags & FLAGS.STEPPED ? "1" : "any";
      if (document.activeElement !== input || input.type === "range") input.value = String(v);
      input.disabled = (p.flags & FLAGS.READONLY) !== 0;
    } else if (kind === "check" && input) {
      input.checked = v > (p.min + p.max) / 2;
    } else if (kind === "select" && select) {
      select.value = String(Math.round(v));
    } else {
      el.textContent = opts.format ? opts.format(v, p) : formatNumber(v);
    }
  };
  const read = () => {
    const p = source.param(paramId);
    if (!p) return null;
    if (kind === "check" && input) return input.checked ? p.max : p.min;
    const raw = Number((input ?? select)?.value);
    if (!Number.isFinite(raw)) return null;
    return logRange(p) ? fromNorm(p, raw, "log") : raw;
  };
  const write = () => {
    const v = read();
    if (v !== null) source.set(paramId, v);
  };
  let dragging = false;
  const down = (e) => {
    if (e.button !== 0 || dragging) return;
    dragging = true;
    source.begin(paramId);
    window.addEventListener("pointerup", up, true);
    window.addEventListener("pointercancel", up, true);
  };
  const up = () => {
    if (!dragging) return;
    dragging = false;
    window.removeEventListener("pointerup", up, true);
    window.removeEventListener("pointercancel", up, true);
    write();
    source.end(paramId);
  };
  const offs = [source.subscribe((id) => {
    if (id === null || id === paramId) show();
  })];
  if (kind !== "text") {
    const ev = kind === "input" ? "input" : "change";
    el.addEventListener(ev, write);
    offs.push(() => el.removeEventListener(ev, write));
    if (kind === "input") {
      el.addEventListener("change", write);
      el.addEventListener("pointerdown", down);
      offs.push(() => {
        el.removeEventListener("change", write);
        el.removeEventListener("pointerdown", down);
        up();
      });
    }
  }
  show();
  return () => {
    for (const off of offs) off();
  };
}

// sdk/packages/ui/src/index.ts
defineElements();
export {
  AUDIO_FFT_SIZES,
  AUDIO_PER_SECOND,
  EST_UI_PROTOCOL,
  EstKnob,
  EstSlider,
  FLAGS,
  HOST_MAX_PER_SECOND,
  MAX_MESSAGE_BYTES,
  MAX_METER,
  SEND_PER_SECOND,
  SPECTRUM_FLOOR_DB,
  UI_SIZE_BOUNDS,
  audioMessage,
  bind,
  checkHostMessage,
  clampSize,
  clampValue,
  connect,
  currentConnection,
  defineElements,
  formatNumber,
  formatValue,
  fromNorm,
  gestureMessage,
  paramMessage,
  readFragment,
  readyMessage,
  resizeMessage,
  toNorm,
  whenConnected
};
