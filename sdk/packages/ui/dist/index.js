/* @est/ui (MIT): the EST plugin UI library and window kit. */

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

// sdk/packages/ui/src/bound.ts
var foldName = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");
function resolveParam(ref, params) {
  if (ref === null || ref === void 0) return void 0;
  const t = ref.trim();
  if (!t) return void 0;
  if (/^\d+$/.test(t)) return params.find((p) => p.id === Number(t));
  const want = foldName(t);
  if (!want) return void 0;
  const hits = params.filter((p) => foldName(p.name) === want);
  return hits.length === 1 ? hits[0] : void 0;
}
function readHints(json) {
  const out = /* @__PURE__ */ new Map();
  if (!json) return out;
  let raw;
  try {
    raw = JSON.parse(json);
  } catch {
    return out;
  }
  if (!Array.isArray(raw)) return out;
  for (const r of raw.slice(0, 512)) {
    if (!r || typeof r !== "object") continue;
    const { id, unit, labels } = r;
    if (typeof id !== "number" || !Number.isInteger(id) || id < 0) continue;
    const h = { id };
    if (typeof unit === "string" && unit.length <= 16) h.unit = unit;
    if (Array.isArray(labels) && labels.length <= 128 && labels.every((l) => typeof l === "string")) h.labels = labels.map((l) => l.slice(0, 64));
    out.set(id, h);
  }
  return out;
}
var editable = (p) => !!p && !(p.flags & FLAGS.READONLY) && p.max > p.min;
function controlFor(p) {
  if (p.flags & FLAGS.STEPPED) {
    const n = Math.round(p.max - p.min) + 1;
    if (n === 2) return "est-switch";
    if (n <= 8) return "est-select";
  }
  return "est-knob";
}
var shownParams = (params) => params.filter((p) => !(p.flags & (FLAGS.HIDDEN | FLAGS.BYPASS)));
var Base = typeof HTMLElement === "undefined" ? class {
} : HTMLElement;
var hints = null;
function pageHints() {
  if (hints) return hints;
  const el = typeof document === "undefined" ? null : document.querySelector('meta[name="est-params"]');
  hints = readHints(el?.getAttribute("content"));
  return hints;
}
var autoQueued = false;
function autoConnect() {
  if (autoQueued || currentConnection() || typeof location === "undefined") return;
  autoQueued = true;
  const go = () => {
    autoQueued = false;
    if (!currentConnection() && /[#&]n=/.test(location.hash)) connect();
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", go, { once: true });
  else setTimeout(go, 0);
}
var EstBound = class extends Base {
  _src = null;
  _explicitSource = false;
  _unsubscribe = null;
  _unwait = null;
  connectedCallback() {
    if (!this._explicitSource && !this._src) {
      const c = currentConnection();
      if (c) this._attach(c);
      else {
        this._unwait = whenConnected((conn) => {
          if (!this._explicitSource) this._attach(conn);
        });
        autoConnect();
      }
    }
    this._connected();
    this._render();
  }
  disconnectedCallback() {
    this._unwait?.();
    this._unwait = null;
    this._disconnected();
  }
  attributeChangedCallback(_name, _old, _next) {
    if (this.isConnected) this._render();
  }
  _connected() {
  }
  _disconnected() {
  }
  /** Whether a change of parameter `id` concerns this element. */
  _concerns(id) {
    return id === this.paramId;
  }
  /** The values this element reads and writes (the page's connection unless set). */
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
      if (id === null || this._concerns(id)) this._render();
    });
    if (this.isConnected) this._render();
  }
  /** The parameter an attribute names (by id or name). */
  _lookup(attr) {
    const s = this._src;
    return s ? resolveParam(this.getAttribute(attr), s.params()) : void 0;
  }
  /** The CLAP id the `param` attribute resolves to (null without one, or before the host's values). */
  get paramId() {
    const a = this.getAttribute("param");
    if (a === null || a.trim() === "") return null;
    if (/^\s*\d+\s*$/.test(a)) return Number(a);
    return this._lookup("param")?.id ?? null;
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
  /** The `unit` attribute, else the page's hint for the parameter. */
  get _unit() {
    const a = this.getAttribute("unit");
    if (a !== null) return a;
    const p = this.info;
    return p && pageHints().get(p.id)?.unit || "";
  }
  /** The `labels` attribute ("A, B, C"), else the page's hint. */
  get _labels() {
    const l = this.getAttribute("labels");
    if (l) return l.split(",").map((s) => s.trim());
    const p = this.info;
    return p ? pageHints().get(p.id)?.labels : void 0;
  }
  /**
   * Mark the element as bound or not: `data-est-unbound` while its attribute names nothing the plugin
   * has (once the host's values are in), so the page, a test and a person can all see it.
   */
  _mark(attrs = ["param"]) {
    const s = this._src;
    const known = !!s && s.params().length > 0;
    const missing = known && attrs.some((a) => this.hasAttribute(a) && !this._lookup(a));
    const none = known && !attrs.some((a) => this.hasAttribute(a));
    if (missing || none) this.setAttribute("data-est-unbound", "");
    else this.removeAttribute("data-est-unbound");
    return !(missing || none);
  }
  /** One whole change as its own gesture (a click, a key, a typed value): one undo step in the host. */
  _commit(id, value) {
    const s = this._src;
    if (!s) return;
    s.begin(id);
    s.set(id, value);
    s.end(id);
  }
};

// sdk/packages/ui/src/contrast.ts
var MIN_CONTRAST = 4.5;
function parseColour(s) {
  const t = s.trim().toLowerCase();
  let m = /^#([0-9a-f]{3,8})$/.exec(t);
  if (m) {
    const h = m[1];
    if (h.length === 3 || h.length === 4) return [0, 1, 2].map((i) => parseInt(h[i] + h[i], 16));
    if (h.length === 6 || h.length === 8) return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
    return null;
  }
  m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/.exec(t);
  if (!m) return null;
  const c = [Number(m[1]), Number(m[2]), Number(m[3])];
  return c.every((x) => Number.isFinite(x)) ? c.map((x) => Math.min(255, Math.max(0, x))) : null;
}
function toHex(c) {
  return `#${c.map((x) => Math.round(Math.min(255, Math.max(0, x))).toString(16).padStart(2, "0")).join("")}`;
}
function luminance(c) {
  const f = (x) => {
    const v = x / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
}
function contrast(a, b) {
  const la = luminance(a), lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
var mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
function ensureContrast(fg, bgs, min = MIN_CONTRAST) {
  const list = typeof bgs[0] === "number" ? [bgs] : bgs;
  const worst = (c) => Math.min(...list.map((b) => contrast(c, b)));
  const round = (c) => [Math.round(c[0]), Math.round(c[1]), Math.round(c[2])];
  if (worst(round(fg)) >= min) return fg;
  let best = fg, bestRatio = worst(fg);
  for (const end of [[255, 255, 255], [0, 0, 0]]) {
    if (worst(end) < bestRatio) continue;
    for (let i = 1; i <= 20; i++) {
      const c = round(mix(fg, end, i / 20));
      const r = worst(c);
      if (r >= min) {
        if (bestRatio < min || i < 20) {
          best = c;
          bestRatio = r;
        }
        break;
      }
      if (r > bestRatio && bestRatio < min) {
        best = c;
        bestRatio = r;
      }
    }
    if (bestRatio >= min) break;
  }
  return best;
}
function onColour(bg) {
  const dark = [16, 16, 20], light = [255, 255, 255];
  return contrast(dark, bg) >= contrast(light, bg) ? dark : light;
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
function parseTyped(text, p, labels) {
  const t = text.trim().toLowerCase().replace(/−/g, "-").replace(",", ".");
  if (!t) return null;
  if (labels) {
    const i = labels.findIndex((l) => l.trim().toLowerCase() === t);
    if (i >= 0) return Math.round(p.min) + i;
  }
  const m = /^([+-]?(?:\d+\.?\d*|\.\d+))\s*(k|m)?/.exec(t);
  if (!m) return null;
  let v = Number(m[1]);
  if (!Number.isFinite(v)) return null;
  if (m[2] === "k") v *= 1e3;
  if (p.flags & FLAGS.STEPPED) v = Math.round(v);
  return Math.min(p.max, Math.max(p.min, v));
}
function wheelPixels(e) {
  return e.deltaMode === 1 ? e.deltaY * 16 : e.deltaMode === 2 ? e.deltaY * 400 : e.deltaY;
}

// sdk/packages/ui/src/controls.ts
var BASE_STYLE = ':host{--_bg:var(--est-bg,#14161b);--_fg:var(--est-fg,#e8eaf0);--_accent:var(--est-accent,#5ad1c3);--_dim:var(--est-dim,#a9afbd);--_track:var(--est-track,#343a46);display:inline-flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;color:var(--_fg);font:12px/1.3 var(--est-font,system-ui,sans-serif);touch-action:none;user-select:none;-webkit-user-select:none;border-radius:var(--est-radius,6px);outline:none;box-sizing:border-box;position:relative}:host(:focus-visible){outline:2px solid var(--_accent);outline-offset:2px}:host([aria-disabled="true"]){opacity:.55;cursor:default}:host([data-est-unbound]){opacity:.5;outline:1px dashed var(--_dim)}.label{color:var(--_dim);white-space:nowrap;max-width:100%;overflow:hidden;text-overflow:ellipsis;letter-spacing:var(--est-tracking,0)}.value{font-variant-numeric:tabular-nums;white-space:nowrap;max-width:100%;overflow:hidden;text-overflow:ellipsis}.label,.value{width:var(--est-text-w,auto);min-width:var(--est-text-min,0);text-align:center}@media (pointer:coarse){:host{min-width:44px;min-height:44px}}';
var STYLE = BASE_STYLE + ":host{cursor:grab}svg{display:block;overflow:visible}.track{stroke:var(--_track)}.fill{stroke:var(--_accent)}.dot{fill:var(--_fg)}.cap{fill:var(--est-cap,transparent);stroke:var(--est-cap-edge,transparent)}.entry{position:absolute;left:50%;bottom:0;transform:translateX(-50%);width:72px;max-width:100%;box-sizing:border-box;text-align:center;font:inherit;color:var(--_fg);background:var(--_bg);border:1px solid var(--_accent);border-radius:4px;padding:1px 2px;outline:none}";
var EstControl = class extends EstBound {
  static get observedAttributes() {
    return ["param", "label", "name", "unit", "scale", "labels", "size", "vertical"];
  }
  _root;
  _drag = null;
  _wheel = null;
  _entry = null;
  constructor() {
    super();
    this._root = this.attachShadow({ mode: "open" });
    this._root.innerHTML = `<style>${STYLE}${this._extraStyle()}</style>${this._template()}`;
    const on = (type, fn, o) => this.addEventListener(type, (e) => fn(e), o);
    on("keydown", (e) => this._onKey(e));
    on("pointerdown", (e) => this._onDown(e));
    on("pointermove", (e) => this._onMove(e));
    for (const t of ["pointerup", "pointercancel", "lostpointercapture"]) on(t, (e) => this._onUp(e));
    on("dblclick", () => this.reset());
    on("wheel", (e) => this._onWheel(e), { passive: false });
  }
  _extraStyle() {
    return "";
  }
  _connected() {
    if (!this.hasAttribute("role")) this.setAttribute("role", "slider");
    if (!this.hasAttribute("tabindex")) this.tabIndex = 0;
  }
  _disconnected() {
    this._cancelDrag(false);
    this._endWheel();
    this._closeEntry(false);
  }
  /** The `scale` attribute when given ("log" or "linear"), else the parameter's own (est.json's hint, D-44). */
  get _scale() {
    const a = this.getAttribute("scale");
    if (a === "log" || a === "linear") return a;
    return this.info?.scale === "log" ? "log" : "linear";
  }
  /** The text shown and announced for the current value. */
  get valueText() {
    const p = this.info;
    const v = this.value;
    if (!p || v === void 0) return "";
    return formatValue(p, v, this._unit, this._labels);
  }
  _render() {
    const bound = this._mark();
    const p = this.info;
    const v = this.value;
    const ref = this.getAttribute("param");
    const label = this.getAttribute("label") || p?.name || (ref !== null && /^\s*\d+\s*$/.test(ref) ? `Parameter ${ref.trim()}` : ref || "Parameter");
    const name = this.getAttribute("name") || label;
    const ok = !!p && v !== void 0;
    const text = ok ? this.valueText : "";
    const aria = (k, x) => x === null ? this.removeAttribute(`aria-${k}`) : this.setAttribute(`aria-${k}`, String(x));
    this.setAttribute("aria-orientation", this._orientation);
    aria("label", bound ? name : `${name} (not connected)`);
    aria("valuemin", ok ? p.min : 0);
    aria("valuemax", ok ? p.max : 1);
    aria("valuenow", ok ? v : 0);
    aria("valuetext", ok ? text : null);
    aria("disabled", editable(p) ? null : "true");
    aria("readonly", p && p.flags & FLAGS.READONLY ? "true" : null);
    const show = (sel, t) => {
      const el = this._root.querySelector(sel);
      if (el && el.textContent !== t) el.textContent = t;
    };
    show(".label", label);
    show(".value", ok ? text : bound ? "–" : "?");
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
    if (this._entry) return;
    const p = this.info;
    const v = this.value;
    if (e.key === "Escape" && this._drag) {
      e.preventDefault();
      this._cancelDrag(true);
      return;
    }
    if (!editable(p) || v === void 0 || e.altKey || e.ctrlKey || e.metaKey) return;
    if (e.key === "Enter" || /^[0-9.-]$/.test(e.key)) {
      e.preventDefault();
      this._openEntry(e.key === "Enter" ? null : e.key);
      return;
    }
    if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      this.reset();
      return;
    }
    const next = this._keyValue(e, p, v);
    if (next === null) return;
    e.preventDefault();
    this.source.set(p.id, next);
  }
  /** Type a value: a small field over the readout. Enter takes it, Escape leaves it. */
  _openEntry(first) {
    const p = this.info;
    if (!editable(p) || this._entry) return;
    const input = document.createElement("input");
    input.className = "entry";
    input.type = "text";
    input.setAttribute("inputmode", "decimal");
    input.setAttribute("aria-label", `${this.getAttribute("aria-label") ?? "Value"}: type a value`);
    input.value = first ?? this.valueText.replace(/[^\d.+\-−k]/gi, "").replace("−", "-");
    input.addEventListener("keydown", (ev) => {
      ev.stopPropagation();
      if (ev.key === "Enter") {
        ev.preventDefault();
        this._closeEntry(true);
      } else if (ev.key === "Escape") {
        ev.preventDefault();
        this._closeEntry(false);
      }
    });
    input.addEventListener("keyup", (ev) => ev.stopPropagation());
    input.addEventListener("blur", () => this._closeEntry(true));
    for (const t of ["pointerdown", "dblclick", "wheel"]) input.addEventListener(t, (ev) => ev.stopPropagation());
    this._entry = input;
    this._root.append(input);
    input.focus();
    if (first === null) input.select();
  }
  _closeEntry(take) {
    const input = this._entry;
    if (!input) return;
    this._entry = null;
    const p = this.info;
    const had = input === this._root.activeElement;
    if (take && editable(p)) {
      const v = parseTyped(input.value, p, this._labels);
      if (v !== null && v !== this.value) this._commit(p.id, v);
    }
    input.remove();
    if (had && this.isConnected) this.focus();
  }
  _onDown(e) {
    const p = this.info;
    const v = this.value;
    if (e.button !== 0 || !editable(p) || v === void 0 || this._drag || this._entry) return;
    e.preventDefault();
    this.focus();
    try {
      this.setPointerCapture(e.pointerId);
    } catch {
    }
    const start = { norm: toNorm(p, v, this._scale), x: e.clientX, y: e.clientY };
    this._drag = { id: p.id, start: v, startNorm: start.norm, x: e.clientX, y: e.clientY, pointer: e.pointerId };
    this.source.begin(p.id);
    this.source.set(p.id, fromNorm(p, this._pointerNorm(e, start), this._scale));
  }
  _onMove(e) {
    const d = this._drag;
    const p = this.info;
    if (!d || e.pointerId !== d.pointer || !p) return;
    this.source.set(d.id, fromNorm(p, this._pointerNorm(e, { norm: d.startNorm, x: d.x, y: d.y }), this._scale));
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
    if (restore) this.source?.set(d.id, d.start);
    this.source?.end(d.id);
    try {
      this.releasePointerCapture(d.pointer);
    } catch {
    }
  }
  /** The wheel: one gesture for a run of notches (ended after a quarter second of quiet). */
  _onWheel(e) {
    const p = this.info;
    const v = this.value;
    const s = this.source;
    if (!editable(p) || v === void 0 || !s || this._drag || this._entry || e.ctrlKey) return;
    e.preventDefault();
    const px = wheelPixels(e);
    if (!this._wheel || this._wheel.id !== p.id) {
      this._endWheel();
      s.begin(p.id);
      this._wheel = { id: p.id, acc: 0, timer: setTimeout(() => this._endWheel(), 250) };
    } else {
      clearTimeout(this._wheel.timer);
      this._wheel.timer = setTimeout(() => this._endWheel(), 250);
    }
    if (p.flags & FLAGS.STEPPED) {
      this._wheel.acc -= px;
      const steps = Math.trunc(this._wheel.acc / 50);
      if (steps) {
        this._wheel.acc -= steps * 50;
        s.set(p.id, v + steps);
      }
    } else {
      s.set(p.id, fromNorm(p, toNorm(p, v, this._scale) - px / (e.shiftKey ? 1e4 : 1e3), this._scale));
    }
  }
  _endWheel() {
    const w = this._wheel;
    if (!w) return;
    this._wheel = null;
    clearTimeout(w.timer);
    this.source?.end(w.id);
  }
  /** Back to the parameter's default (one undo step). */
  reset() {
    const p = this.info;
    if (!editable(p) || this._entry) return;
    if (this._drag) this.source.set(p.id, p.def);
    else this._commit(p.id, p.def);
  }
};
var EstKnob = class extends EstControl {
  _ro = null;
  _size = 0;
  _want = 0;
  _sizing = 0;
  get _orientation() {
    return "vertical";
  }
  _template() {
    const arc = (c) => `<path class="${c}" fill="none" stroke-width="4" stroke-linecap="round"/>`;
    return `<span class="label" aria-hidden="true"></span><svg viewBox="0 0 48 48" aria-hidden="true"><circle class="cap" cx="24" cy="24" r="13"/>${arc("track")}${arc("fill")}<circle class="dot" r="3"/></svg><span class="value" aria-hidden="true"></span>`;
  }
  _extraStyle() {
    return "svg{width:var(--_size,48px);height:var(--_size,48px);flex:none}";
  }
  attributeChangedCallback(name, old, next) {
    const s = Number(this.getAttribute("size"));
    if (Number.isFinite(s) && s > 0) this.style.setProperty("--_size", `${s}px`);
    super.attributeChangedCallback(name, old, next);
  }
  _connected() {
    super._connected();
    if (this.hasAttribute("size") || !this.closest("est-window") || typeof ResizeObserver === "undefined") return;
    this._ro = new ResizeObserver((entries) => {
      const r = entries[0]?.contentRect;
      if (!r) return;
      this._want = Math.max(28, Math.min(120, Math.floor(Math.min(r.width - 4, r.height - 40))));
      if (this._sizing || this._want === this._size) return;
      this._sizing = requestAnimationFrame(() => {
        this._sizing = 0;
        if (this._want === this._size) return;
        this._size = this._want;
        this.style.setProperty("--_size", `${this._size}px`);
      });
    });
    this._ro.observe(this);
  }
  _disconnected() {
    super._disconnected();
    this._ro?.disconnect();
    this._ro = null;
    if (this._sizing) cancelAnimationFrame(this._sizing);
    this._sizing = 0;
    this._size = 0;
  }
  _draw(norm) {
    const a0 = Math.PI * 0.75;
    const sweep = Math.PI * 1.5;
    const at = (t2, r = 18) => {
      const a = a0 + sweep * t2;
      return [24 + r * Math.cos(a), 24 + r * Math.sin(a)];
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
  get _orientation() {
    return this.hasAttribute("vertical") ? "vertical" : "horizontal";
  }
  _template() {
    return '<span class="row"><span class="label" aria-hidden="true"></span><span class="value" aria-hidden="true"></span></span><span class="bar" aria-hidden="true"><span class="fillbar"></span><span class="thumb"></span></span>';
  }
  _extraStyle() {
    return ":host{align-items:stretch;min-width:120px;cursor:pointer}.row{display:flex;justify-content:space-between;gap:8px}.row .label,.row .value{width:auto;min-width:0}.bar{position:relative;height:6px;margin:6px 0;border-radius:3px;background:var(--_track)}.fillbar{position:absolute;inset:0 auto 0 0;border-radius:3px;background:var(--_accent)}.thumb{position:absolute;top:50%;width:14px;height:14px;margin:-7px 0 0 -7px;border-radius:50%;background:var(--_fg)}:host([vertical]){min-width:44px;min-height:96px;align-items:center}:host([vertical]) .row{flex-direction:column;align-items:center;gap:2px;order:2}:host([vertical]) .bar{width:6px;height:auto;flex:1 1 0;min-height:48px;margin:6px 0}:host([vertical]) .fillbar{inset:auto 0 0 0}:host([vertical]) .thumb{top:auto;left:50%;margin:0 0 -7px -7px}";
  }
  _draw(norm) {
    const pct = `${(Math.min(1, Math.max(0, norm)) * 100).toFixed(2)}%`;
    const fill = this._root.querySelector(".fillbar");
    const thumb = this._root.querySelector(".thumb");
    if (!fill || !thumb) return;
    const v = this.hasAttribute("vertical");
    fill.style.width = v ? "" : pct;
    fill.style.height = v ? pct : "";
    thumb.style.left = v ? "" : pct;
    thumb.style.bottom = v ? pct : "";
  }
  _pointerNorm(e) {
    const bar = this._root.querySelector(".bar");
    const r = (bar ?? this).getBoundingClientRect();
    if (this.hasAttribute("vertical")) return r.height > 0 ? (r.bottom - e.clientY) / r.height : 0;
    return r.width > 0 ? (e.clientX - r.left) / r.width : 0;
  }
};

// sdk/packages/ui/src/kit.ts
var Base2 = typeof HTMLElement === "undefined" ? class {
} : HTMLElement;
var reducedMotion = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
var THEMES = {
  studio: { bg: "#14171c", panel: "#1d222a", fg: "#eef1f6", dim: "#a8b0bf", accent: "#5ad1c3", track: "#39414f", cap: "#262d38", radius: "8px", font: "system-ui,sans-serif", tracking: "0" },
  neon: { bg: "#0b0714", panel: "#160d26", fg: "#f6efff", dim: "#b9a6dc", accent: "#ff4fd8", track: "#3a2560", cap: "#1d1233", radius: "4px", font: "ui-monospace,Menlo,Consolas,monospace", tracking: ".06em" },
  paper: { bg: "#f1ebdd", panel: "#fbf7ec", fg: "#23201a", dim: "#5e574a", accent: "#b3341f", track: "#cfc6b1", cap: "#e6dfcd", radius: "2px", font: 'Georgia,"Times New Roman",serif', tracking: ".02em" },
  ember: { bg: "#1a120e", panel: "#261a14", fg: "#fbeee2", dim: "#c9ac97", accent: "#ff8a3d", track: "#4a3327", cap: "#33231a", radius: "12px", font: "system-ui,sans-serif", tracking: ".04em" },
  moss: { bg: "#e9efe6", panel: "#f6f9f3", fg: "#1b261d", dim: "#4c5d4f", accent: "#1f7a4d", track: "#bccabc", cap: "#dde6da", radius: "16px", font: '"Trebuchet MS",Verdana,sans-serif', tracking: "0" }
};
var DEFAULT_THEME = "studio";
var vars = (t) => Object.entries(t).map(([k, v]) => `--est-${k}:${v}`).join(";");
var PAGE_STYLE = [
  ":where(html:has(est-window),html:has(est-window) body){margin:0;width:100%;height:100%;overflow:hidden}",
  `:where(est-window){${vars(THEMES[DEFAULT_THEME])};display:flex;flex-direction:column;gap:6px;box-sizing:border-box;width:100%;height:100%;padding:6px;overflow:hidden;background:var(--est-bg);color:var(--est-fg);font:12px/1.3 var(--est-font);accent-color:var(--est-accent)}`,
  ...Object.entries(THEMES).map(([name, t]) => `:where(est-window[theme="${name}"]){${vars(t)}}`),
  ":where(est-window *){box-sizing:border-box}",
  ":where(est-window)>:where(header.est-head){flex:none;display:flex;align-items:center;justify-content:space-between;gap:12px;min-height:24px}",
  ":where(header.est-head) :where(h1){margin:0;font-size:14px;font-weight:800;letter-spacing:.24em;text-transform:uppercase;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
  ":where(header.est-head) :where(est-meter){flex:0 1 120px}",
  ":where(est-row){display:flex;flex:1 1 0;gap:8px;align-items:stretch}",
  ":where(est-row)>:where(*){flex:1 1 0}",
  // A panel flows its controls side by side and wraps them (a row inside it takes a whole line), so a
  // panel written as a plain list of controls is a row of them, never a tall stack.
  ":where(est-panel){display:flex;flex-flow:row wrap;align-content:stretch;flex:1 1 0;gap:4px 6px;padding:4px 6px;background:var(--est-panel);border:1px solid var(--est-track);border-radius:var(--est-radius)}",
  ":where(est-panel)>:where(.est-panel-label){flex:0 0 100%;color:var(--est-dim);font-size:10px;letter-spacing:.18em;text-transform:uppercase}",
  ":where(est-panel)>:where(:not(.est-panel-label)){flex:1 1 0}",
  ":where(est-panel)>:where(est-row,est-panel,est-spectrum,canvas,est-slider:not([vertical])){flex:1 1 100%}",
  // A display is part of the window, never most of it (under 40 % of the frame: scripts/estWindowFill.mjs' backdrop rule).
  ":where(est-window)>:where(est-spectrum,canvas,est-xy){flex:.8 1 0;max-height:38%}",
  // What each element needs at the least: a window too small for its content is scaled to fit (EstWindow._fit), never squashed.
  ":where(est-window est-knob){min-width:60px;min-height:84px}:where(est-window est-switch){min-width:56px;min-height:64px}",
  ":where(est-window est-slider){min-width:110px;min-height:38px}:where(est-window est-slider[vertical]){min-width:46px;min-height:104px}",
  ":where(est-window est-select){min-width:80px;min-height:54px}:where(est-window est-xy){min-width:96px;min-height:110px}",
  ":where(est-window est-spectrum,est-window canvas){min-width:0;min-height:56px}",
  ":where(est-window){transform-origin:0 0;--est-text-w:0;--est-text-min:100%}",
  ":where(est-window)>:where(est-slider:not([vertical])){flex:none}",
  ":where(est-row,est-panel)>:where(est-switch,est-meter[vertical]){flex:.5 1 0}",
  ":where(est-window canvas){display:block;width:100%;border-radius:var(--est-radius);background:var(--est-panel)}",
  ":where(est-all){display:contents}"
].join("");
var styled = false;
function addPageStyle() {
  if (styled || typeof document === "undefined" || !document.head) return;
  styled = true;
  const s = document.createElement("style");
  s.setAttribute("data-est-kit", "");
  s.textContent = PAGE_STYLE;
  document.head.prepend(s);
}
var TEXT_VARS = ["fg", "dim"];
function guardContrast(win) {
  if (typeof getComputedStyle !== "function") return;
  const probe = document.createElement("span");
  probe.style.cssText = "position:absolute;width:0;height:0;overflow:hidden;pointer-events:none";
  win.append(probe);
  const read = (name) => {
    probe.style.color = "";
    probe.style.color = `var(--est-${name})`;
    return parseColour(getComputedStyle(probe).color);
  };
  for (const k of [...TEXT_VARS, "on-accent"]) win.style.removeProperty(`--est-${k}`);
  const bg = read("bg"), panel = read("panel"), accent = read("accent");
  if (bg) {
    const bgs = panel ? [bg, panel] : [bg];
    for (const k of TEXT_VARS) {
      const c = read(k);
      if (!c) continue;
      const fixed = ensureContrast(c, bgs);
      if (fixed !== c) win.style.setProperty(`--est-${k}`, toHex(fixed));
    }
  }
  if (accent) win.style.setProperty("--est-on-accent", toHex(onColour(accent)));
  probe.remove();
}
var EstWindow = class extends Base2 {
  static get observedAttributes() {
    return ["name", "theme", "meter"];
  }
  _mo = null;
  _kids = null;
  _queued = 0;
  _later = () => {
    if (!this._queued && typeof requestAnimationFrame === "function") this._queued = requestAnimationFrame(() => {
      this._queued = 0;
      this._fit();
    });
  };
  /**
   * The window's content at its least (every control at its minimum size) may need more room than the
   * frame gives: then the whole window is laid out larger and scaled down to the frame by one factor,
   * so nothing overlaps or is cut off. With room to spare it is left alone (the rows share the space).
   * Measured on a resize or when elements come and go, never per frame.
   */
  _fit() {
    if (!this.isConnected) return;
    const st = this.style;
    const W = document.documentElement.clientWidth, H = document.documentElement.clientHeight;
    st.width = st.height = st.transform = "";
    if (W < 1 || H < 1) return;
    let k = 1;
    for (let i = 0; i < 5; i++) {
      const w = W / k, h = H / k;
      if (k < 1) {
        st.width = `${w}px`;
        st.height = `${h}px`;
      }
      const needW = this.scrollWidth, needH = this.scrollHeight;
      if (needW <= w + 1 && needH <= h + 1) break;
      k = Math.max(0.4, k * Math.min(w / needW, h / needH) * 0.985);
    }
    if (k < 1) st.transform = `scale(${k.toFixed(4)})`;
    if (k < 1) this.setAttribute("data-est-scaled", k.toFixed(2));
    else this.removeAttribute("data-est-scaled");
  }
  connectedCallback() {
    addPageStyle();
    addEventListener("resize", this._later);
    if (typeof MutationObserver !== "undefined") {
      this._kids = new MutationObserver(this._later);
      this._kids.observe(this, { childList: true, subtree: true });
    }
    if (document.readyState !== "complete") addEventListener("load", this._later, { once: true });
    whenConnected((c) => {
      c.subscribe((id) => {
        if (id === null) this._later();
      });
    });
    this._later();
    if (!this.hasAttribute("role")) this.setAttribute("role", "main");
    this._head();
    const guard = () => guardContrast(this);
    guard();
    if (document.readyState !== "complete") addEventListener("load", guard, { once: true });
    if (typeof MutationObserver !== "undefined") {
      this._mo = new MutationObserver(guard);
      this._mo.observe(this, { attributes: true, attributeFilter: ["theme", "class"] });
    }
    if (!currentConnection()) probeConnect(this);
  }
  disconnectedCallback() {
    this._mo?.disconnect();
    this._kids?.disconnect();
    this._mo = this._kids = null;
    removeEventListener("resize", this._later);
  }
  attributeChangedCallback() {
    if (this.isConnected) this._head();
  }
  _head() {
    const name = this.getAttribute("name");
    let head = this.querySelector(":scope > header.est-head");
    if (!name) {
      head?.remove();
      return;
    }
    if (!head) {
      head = document.createElement("header");
      head.className = "est-head";
      head.append(document.createElement("h1"));
      this.prepend(head);
    }
    const h1 = head.querySelector("h1");
    if (h1.textContent !== name) h1.textContent = name;
    const meter = head.querySelector("est-meter");
    if (this.hasAttribute("meter") && !meter) head.append(document.createElement("est-meter"));
    else if (!this.hasAttribute("meter") && meter) meter.remove();
  }
};
function probeConnect(win) {
  if (win.querySelector("est-value[data-est-probe]")) return;
  const v = document.createElement("est-value");
  v.setAttribute("data-est-probe", "");
  v.hidden = true;
  win.append(v);
}
var EstPanel = class extends Base2 {
  static get observedAttributes() {
    return ["label"];
  }
  // A panel is a drawn box: it counts as the window's content (`data-fill`, scripts/estWindowFill.mjs).
  connectedCallback() {
    addPageStyle();
    this.setAttribute("data-fill", "");
    this._label();
  }
  attributeChangedCallback() {
    if (this.isConnected) this._label();
  }
  _label() {
    const label = this.getAttribute("label");
    let el = this.querySelector(":scope > .est-panel-label");
    if (!label) {
      el?.remove();
      this.removeAttribute("role");
      return;
    }
    if (!el) {
      el = document.createElement("div");
      el.className = "est-panel-label";
      el.setAttribute("aria-hidden", "true");
      this.prepend(el);
    }
    if (el.textContent !== label) el.textContent = label;
    this.setAttribute("role", "group");
    this.setAttribute("aria-label", label);
  }
};
var EstRow = class extends Base2 {
  connectedCallback() {
    addPageStyle();
  }
};
var shadow = (el, style, html) => {
  const root = el.attachShadow({ mode: "open" });
  root.innerHTML = `<style>${BASE_STYLE}${style}</style>${html}`;
  return root;
};
var EstSwitch = class extends EstBound {
  static get observedAttributes() {
    return ["param", "label", "name"];
  }
  _root = shadow(
    this,
    ':host{cursor:pointer}.sw{width:36px;height:20px;border-radius:10px;background:var(--_track);position:relative;flex:none}.sw i{position:absolute;top:3px;left:3px;width:14px;height:14px;border-radius:50%;background:var(--_fg)}:host([aria-checked="true"]) .sw{background:var(--_accent)}:host([aria-checked="true"]) .sw i{left:19px;background:var(--est-on-accent,var(--_bg))}',
    '<span class="label" aria-hidden="true"></span><span class="sw" aria-hidden="true"><i></i></span><span class="value" aria-hidden="true"></span>'
  );
  constructor() {
    super();
    this.addEventListener("click", () => this.toggle());
    this.addEventListener("keydown", (e) => {
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      if (e.key === " " || e.key === "Enter") {
        e.preventDefault();
        this.toggle();
      } else if (e.key === "Delete" || e.key === "Backspace") {
        const p = this.info;
        if (editable(p)) {
          e.preventDefault();
          this._commit(p.id, p.def);
        }
      }
    });
  }
  _connected() {
    if (!this.hasAttribute("role")) this.setAttribute("role", "switch");
    if (!this.hasAttribute("tabindex")) this.tabIndex = 0;
  }
  get on() {
    const p = this.info, v = this.value;
    return !!p && v !== void 0 && v > (p.min + p.max) / 2;
  }
  toggle() {
    const p = this.info;
    if (!editable(p)) return;
    this._commit(p.id, this.on ? p.min : p.max);
  }
  _render() {
    const bound = this._mark();
    const p = this.info;
    const label = this.getAttribute("label") || p?.name || this.getAttribute("param") || "Switch";
    const name = this.getAttribute("name") || label;
    this.setAttribute("aria-label", bound ? name : `${name} (not connected)`);
    this.setAttribute("aria-checked", String(this.on));
    if (editable(p)) this.removeAttribute("aria-disabled");
    else this.setAttribute("aria-disabled", "true");
    const labels = this._labels;
    const text = !p ? bound ? "–" : "?" : labels?.[this.on ? labels.length - 1 : 0] ?? (this.on ? "On" : "Off");
    const set = (sel, t) => {
      const el = this._root.querySelector(sel);
      if (el && el.textContent !== t) el.textContent = t;
    };
    set(".label", label);
    set(".value", text);
  }
};
var EstSelect = class extends EstBound {
  static get observedAttributes() {
    return ["param", "label", "name", "labels", "menu", "unit"];
  }
  _root = shadow(
    this,
    ':host{align-items:stretch;cursor:default}.label{text-align:center}.opts{display:flex;flex-wrap:wrap;gap:4px;justify-content:center}button,select{font:inherit;color:var(--_dim);background:transparent;border:1px solid var(--_track);border-radius:var(--est-radius,6px);padding:5px 9px;cursor:pointer;min-height:26px;touch-action:manipulation}button{flex:1 1 auto}button[aria-checked="true"]{background:var(--_accent);border-color:var(--_accent);color:var(--est-on-accent,var(--_bg));font-weight:700}button:focus-visible,select:focus-visible{outline:2px solid var(--_fg);outline-offset:1px}select{color:var(--_fg);background:var(--_bg)}@media (pointer:coarse){button,select{min-height:44px;min-width:44px}}',
    '<span class="label" aria-hidden="true"></span><span class="opts"></span>'
  );
  _key = "";
  _connected() {
    this.setAttribute("data-fill", "");
  }
  constructor() {
    super();
    this._root.addEventListener("click", (e) => {
      const b = e.target?.closest?.("button");
      const p = this.info;
      if (b && editable(p)) this._commit(p.id, Number(b.getAttribute("data-v")));
    });
    this._root.addEventListener("change", (e) => {
      const p = this.info;
      const t = e.target;
      if (t && t.tagName === "SELECT" && editable(p)) this._commit(p.id, Number(t.value));
    });
    for (const t of ["keydown", "keyup"]) this._root.addEventListener(t, (ev) => {
      if (ev.target?.tagName === "SELECT") ev.stopPropagation();
    });
    this._root.addEventListener("keydown", (ev) => {
      const e = ev;
      const p = this.info, v = this.value;
      if (!editable(p) || v === void 0 || this.hasAttribute("menu") || e.altKey || e.ctrlKey || e.metaKey) return;
      const step = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
      const to = step ? Math.round(v) + step : e.key === "Home" ? p.min : e.key === "End" ? p.max : e.key === "Delete" || e.key === "Backspace" ? p.def : null;
      if (to === null) return;
      e.preventDefault();
      const next = Math.min(p.max, Math.max(p.min, to));
      if (next !== v) this._commit(p.id, next);
      this._root.querySelector(`button[data-v="${next}"]`)?.focus();
    });
  }
  _render() {
    const bound = this._mark();
    const p = this.info, v = this.value;
    const label = this.getAttribute("label") || p?.name || this.getAttribute("param") || "Choice";
    const name = this.getAttribute("name") || label;
    const lab = this._root.querySelector(".label");
    if (lab.textContent !== label) lab.textContent = label;
    const opts = this._root.querySelector(".opts");
    const menu = this.hasAttribute("menu");
    const labels = this._labels;
    const key = p ? `${menu}|${p.id}|${p.min}|${p.max}|${labels?.join("") ?? ""}|${this._unit}|${name}|${editable(p)}` : `none|${bound}`;
    if (key !== this._key) {
      this._key = key;
      opts.textContent = "";
      if (!p) {
        const s = document.createElement("span");
        s.className = "value";
        s.textContent = bound ? "–" : "?";
        opts.append(s);
      } else {
        const lo = Math.round(p.min), n = Math.min(128, Math.round(p.max) - lo + 1);
        const text = (i) => labels?.[i] ?? formatValue({ ...p, flags: p.flags | FLAGS.STEPPED }, lo + i, this._unit);
        if (menu) {
          const sel2 = document.createElement("select");
          sel2.setAttribute("aria-label", name);
          sel2.disabled = !editable(p);
          for (let i = 0; i < n; i++) {
            const o = document.createElement("option");
            o.value = String(lo + i);
            o.textContent = text(i);
            sel2.append(o);
          }
          opts.append(sel2);
        } else {
          opts.setAttribute("role", "radiogroup");
          opts.setAttribute("aria-label", name);
          for (let i = 0; i < n; i++) {
            const b = document.createElement("button");
            b.type = "button";
            b.setAttribute("role", "radio");
            b.setAttribute("data-v", String(lo + i));
            b.disabled = !editable(p);
            b.textContent = text(i);
            opts.append(b);
          }
        }
      }
    }
    if (!p || v === void 0) return;
    const now = Math.round(v);
    const sel = opts.querySelector("select");
    if (sel) {
      if (sel.value !== String(now)) sel.value = String(now);
      return;
    }
    for (const b of Array.from(opts.querySelectorAll("button"))) {
      const onNow = Number(b.getAttribute("data-v")) === now;
      b.setAttribute("aria-checked", String(onNow));
      b.tabIndex = onNow ? 0 : -1;
    }
  }
};
var EstXY = class extends EstBound {
  static get observedAttributes() {
    return ["x", "y", "label", "name", "x-unit", "y-unit"];
  }
  _root = shadow(
    this,
    ":host{cursor:crosshair;align-items:stretch;min-width:88px;min-height:88px}.pad{position:relative;flex:1 1 0;min-height:60px;border:1px solid var(--_track);border-radius:var(--est-radius,6px);background:linear-gradient(var(--_track),var(--_track)) 50% 0/1px 100% no-repeat,linear-gradient(var(--_track),var(--_track)) 0 50%/100% 1px no-repeat,var(--est-panel,var(--_bg));overflow:hidden}.dot{position:absolute;width:14px;height:14px;margin:-7px 0 0 -7px;border-radius:50%;background:var(--_accent);box-shadow:0 0 0 2px var(--_fg)}.value{text-align:center}",
    '<span class="label" aria-hidden="true"></span><span class="pad" aria-hidden="true"><span class="dot"></span></span><span class="value" aria-hidden="true"></span>'
  );
  _drag = null;
  constructor() {
    super();
    const on = (type, fn) => this.addEventListener(type, (e) => fn(e));
    on("pointerdown", (e) => this._down(e));
    on("pointermove", (e) => {
      if (this._drag && e.pointerId === this._drag.pointer) this._at(e);
    });
    for (const t of ["pointerup", "pointercancel", "lostpointercapture"]) on(t, (e) => {
      if (this._drag && e.pointerId === this._drag.pointer) this._end(false);
    });
    on("keydown", (e) => this._key(e));
    on("dblclick", () => {
      for (const p of this._pair()) if (editable(p)) this._commit(p.id, p.def);
    });
  }
  _connected() {
    if (!this.hasAttribute("role")) this.setAttribute("role", "slider");
    if (!this.hasAttribute("tabindex")) this.tabIndex = 0;
  }
  _disconnected() {
    this._end(false);
  }
  _concerns(id) {
    return this._pair().some((p) => p?.id === id);
  }
  _pair() {
    return [this._lookup("x"), this._lookup("y")];
  }
  _scale(p) {
    return p.scale === "log" ? "log" : "linear";
  }
  _down(e) {
    const s = this.source;
    const ps = this._pair().filter(editable);
    if (e.button !== 0 || !s || !ps.length || this._drag) return;
    e.preventDefault();
    this.focus();
    try {
      this.setPointerCapture(e.pointerId);
    } catch {
    }
    this._drag = { pointer: e.pointerId, ids: ps.map((p) => p.id), start: ps.map((p) => s.get(p.id) ?? p.def) };
    for (const p of ps) s.begin(p.id);
    this._at(e);
  }
  _at(e) {
    const s = this.source;
    const r = this._root.querySelector(".pad").getBoundingClientRect();
    if (!s || r.width <= 0 || r.height <= 0) return;
    const [x, y] = this._pair();
    if (editable(x)) s.set(x.id, fromNorm(x, (e.clientX - r.left) / r.width, this._scale(x)));
    if (editable(y)) s.set(y.id, fromNorm(y, (r.bottom - e.clientY) / r.height, this._scale(y)));
  }
  _end(restore) {
    const d = this._drag, s = this.source;
    if (!d) return;
    this._drag = null;
    d.ids.forEach((id, i) => {
      if (restore) s?.set(id, d.start[i]);
      s?.end(id);
    });
    try {
      this.releasePointerCapture(d.pointer);
    } catch {
    }
  }
  _key(e) {
    if (e.key === "Escape" && this._drag) {
      e.preventDefault();
      this._end(true);
      return;
    }
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const [x, y] = this._pair();
    const s = this.source;
    const step = e.shiftKey ? 2e-3 : 0.02;
    const move = (p, d) => {
      if (!editable(p) || !s) return false;
      const v = s.get(p.id) ?? p.def;
      s.set(p.id, p.flags & FLAGS.STEPPED ? v + Math.sign(d) : fromNorm(p, toNorm(p, v, this._scale(p)) + d, this._scale(p)));
      return true;
    };
    const used = e.key === "ArrowRight" ? move(x, step) : e.key === "ArrowLeft" ? move(x, -step) : e.key === "ArrowUp" ? move(y, step) : e.key === "ArrowDown" ? move(y, -step) : e.key === "Delete" || e.key === "Backspace" ? [x, y].map((p) => {
      if (editable(p)) this._commit(p.id, p.def);
      return editable(p);
    }).some(Boolean) : false;
    if (used) e.preventDefault();
  }
  _render() {
    const bound = this._mark(["x", "y"]);
    const [x, y] = this._pair();
    const s = this.source;
    const label = this.getAttribute("label") || [x?.name, y?.name].filter(Boolean).join(" / ") || "Pad";
    const name = this.getAttribute("name") || label;
    const text = (p, unit) => p && s ? `${p.name} ${formatValue(p, s.get(p.id) ?? p.def, unit ?? "")}` : "";
    const value = [text(x, this.getAttribute("x-unit")), text(y, this.getAttribute("y-unit"))].filter(Boolean).join(", ");
    this.setAttribute("aria-label", bound ? name : `${name} (not connected)`);
    this.setAttribute("aria-valuemin", String(x?.min ?? 0));
    this.setAttribute("aria-valuemax", String(x?.max ?? 1));
    this.setAttribute("aria-valuenow", String((x && s?.get(x.id)) ?? 0));
    this.setAttribute("aria-valuetext", value || "not connected");
    if (editable(x) || editable(y)) this.removeAttribute("aria-disabled");
    else this.setAttribute("aria-disabled", "true");
    const set = (sel, t) => {
      const el = this._root.querySelector(sel);
      if (el && el.textContent !== t) el.textContent = t;
    };
    set(".label", label);
    set(".value", value || (bound ? "–" : "?"));
    const dot = this._root.querySelector(".dot");
    const n = (p) => p && s ? toNorm(p, s.get(p.id) ?? p.def, this._scale(p)) : 0.5;
    dot.style.left = `${(n(x) * 100).toFixed(2)}%`;
    dot.style.top = `${((1 - n(y)) * 100).toFixed(2)}%`;
  }
};
var EstValue = class extends EstBound {
  static get observedAttributes() {
    return ["param", "unit", "labels"];
  }
  _render() {
    if (this.hasAttribute("data-est-probe")) return;
    const bound = this._mark();
    const p = this.info, v = this.value;
    const t = p && v !== void 0 ? formatValue(p, v, this._unit, this._labels) : bound ? "–" : "?";
    if (this.textContent !== t) this.textContent = t;
  }
};
var EstLive = class extends Base2 {
  _off = null;
  _unwait = null;
  connectedCallback() {
    this._setup();
    this._unwait = whenConnected((c) => {
      this._off = this._listen(c);
    });
    if (!currentConnection()) probeConnect(this.closest("est-window") ?? this);
  }
  disconnectedCallback() {
    this._unwait?.();
    this._off?.();
    this._off = this._unwait = null;
    this._teardown();
  }
  _teardown() {
  }
};
var meterNorm = (peak) => peak <= 1e-3 ? 0 : Math.min(1, Math.max(0, 1 + 20 * Math.log10(peak) / 60));
var EstMeter = class extends EstLive {
  _bars = [];
  _said = 0;
  _setup() {
    if (!this.shadowRoot) {
      shadow(
        this,
        ":host{flex-direction:column;align-items:stretch;gap:2px;min-width:40px;cursor:default}.m{height:4px;border-radius:2px;background:var(--_track);overflow:hidden}.m i{display:block;height:100%;width:0;background:var(--_accent)}:host([vertical]){flex-direction:row;align-items:stretch;justify-content:center;gap:3px;min-width:14px;min-height:40px}:host([vertical]) .m{height:auto;width:5px;flex:none;display:flex;align-items:flex-end}:host([vertical]) .m i{width:100%;height:0}",
        '<span class="m"><i></i></span><span class="m"><i></i></span>'
      );
    }
    this._bars = Array.from(this.shadowRoot.querySelectorAll("i"));
    this.setAttribute("role", "meter");
    if (!this.hasAttribute("aria-label")) this.setAttribute("aria-label", this.hasAttribute("in") ? "Input level" : "Output level");
    this.setAttribute("aria-valuemin", "-60");
    this.setAttribute("aria-valuemax", "0");
    this.setAttribute("aria-valuenow", "-60");
  }
  _listen(c) {
    return c.onMeter((m) => {
      const pair = this.hasAttribute("in") ? m.in : m.out;
      if (!pair) return;
      const vertical = this.hasAttribute("vertical");
      pair.forEach((peak2, i) => {
        const bar = this._bars[i];
        if (!bar) return;
        const pct = `${(meterNorm(peak2) * 100).toFixed(1)}%`;
        if (vertical) bar.style.height = pct;
        else bar.style.width = pct;
      });
      const now = Date.now();
      if (now - this._said < 500) return;
      this._said = now;
      const peak = Math.max(pair[0], pair[1]);
      this.setAttribute("aria-valuenow", String(peak <= 1e-3 ? -60 : Math.max(-60, Math.min(0, Math.round(20 * Math.log10(peak))))));
    });
  }
};
function fitCanvas(canvas, redraw) {
  const size = () => {
    const r = canvas.getBoundingClientRect();
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    const w = Math.max(1, Math.round(r.width * dpr)), h = Math.max(1, Math.round(r.height * dpr));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    redraw();
  };
  if (typeof ResizeObserver === "undefined") {
    size();
    return () => {
    };
  }
  const ro = new ResizeObserver(size);
  ro.observe(canvas);
  return () => ro.disconnect();
}
var EstSpectrum = class extends EstLive {
  _canvas;
  _unfit = null;
  _bins = null;
  _trace = [];
  _setup() {
    if (!this.shadowRoot) {
      shadow(
        this,
        ":host{align-items:stretch;min-height:48px;cursor:default}canvas{display:block;width:100%;height:100%;flex:1 1 0;min-height:0;border-radius:var(--est-radius,6px);background:var(--est-panel,var(--_bg));border:1px solid var(--_track);box-sizing:border-box}",
        "<canvas></canvas>"
      );
    }
    this._canvas = this.shadowRoot.querySelector("canvas");
    this.setAttribute("role", "img");
    if (!this.hasAttribute("aria-label")) this.setAttribute("aria-label", "The sound's spectrum");
    this._unfit = fitCanvas(this._canvas, () => this._draw());
  }
  _teardown() {
    this._unfit?.();
    this._unfit = null;
  }
  _listen(c) {
    let stopAudio = null;
    const ask = () => {
      if (stopAudio || !c.audioAvailable) return;
      stopAudio = c.audio({ fftSize: 512, rate: reducedMotion() ? 8 : 24 }, (s) => {
        this._bins = s.bins;
        this._draw();
      });
    };
    const offInit = c.subscribe((id) => {
      if (id === null) ask();
    });
    ask();
    const offMeter = c.onMeter((m) => {
      if (this._bins) return;
      this._trace.push(meterNorm(Math.max(m.out[0], m.out[1])));
      if (this._trace.length > 120) this._trace.shift();
      this._draw();
    });
    return () => {
      offInit();
      offMeter();
      stopAudio?.();
    };
  }
  _draw() {
    const cv = this._canvas;
    const g = cv.getContext("2d");
    if (!g) return;
    const w = cv.width, h = cv.height;
    const cs = getComputedStyle(this);
    const accent = cs.getPropertyValue("--est-accent").trim() || "#5ad1c3";
    g.clearRect(0, 0, w, h);
    g.beginPath();
    const bins = this._bins;
    if (bins) {
      const n = bins.length;
      for (let x = 0; x <= w; x += 2) {
        const i = Math.min(n - 1, Math.max(1, Math.round(Math.pow(n - 1, x / w))));
        const y = h - Math.min(1, Math.max(0, (bins[i] + 96) / 96)) * (h - 2) - 1;
        if (x === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
    } else {
      const t = this._trace;
      g.moveTo(0, h - 1);
      g.lineTo(Math.max(0, (120 - t.length) / 119 * w), h - 1);
      t.forEach((v, i) => g.lineTo((120 - t.length + i) / 119 * w, h - v * (h - 2) - 1));
      if (!t.length) g.lineTo(w, h - 1);
    }
    g.strokeStyle = accent;
    g.lineWidth = Math.max(1, (window.devicePixelRatio || 1) * 1.5);
    g.lineJoin = "round";
    g.stroke();
    g.lineTo(w, h);
    g.lineTo(0, h);
    g.closePath();
    g.globalAlpha = 0.18;
    g.fillStyle = accent;
    g.fill();
    g.globalAlpha = 1;
  }
};
var BOUND_SELECTOR = "est-knob,est-slider,est-switch,est-select,est-value:not([data-est-probe])";
function shownIds(root, params, skip) {
  const ids = /* @__PURE__ */ new Set();
  const add = (el, attr) => {
    if (skip.contains(el)) return;
    const hit = resolveParam(el.getAttribute(attr), params);
    if (hit) ids.add(hit.id);
  };
  root.querySelectorAll(BOUND_SELECTOR).forEach((el) => add(el, "param"));
  root.querySelectorAll("est-xy").forEach((el) => {
    add(el, "x");
    add(el, "y");
  });
  return ids;
}
var EstAll = class extends EstBound {
  static get observedAttributes() {
    return ["params"];
  }
  _made = "";
  _concerns() {
    return false;
  }
  _render() {
    const s = this.source;
    if (!s) return;
    const all = shownParams(s.params());
    if (!all.length) return;
    const only = this.getAttribute("params");
    let want;
    if (only !== null) {
      const ids = only.split(",").map((x) => Number(x.trim())).filter((x) => Number.isInteger(x));
      want = all.filter((p) => ids.includes(p.id));
    } else {
      const have = shownIds(this.getRootNode(), all, this);
      want = all.filter((p) => !have.has(p.id));
    }
    const key = want.map((p) => `${p.id}:${controlFor(p)}`).join(",");
    if (key === this._made) return;
    this._made = key;
    this.textContent = "";
    for (const p of want) {
      const el = document.createElement(controlFor(p));
      el.setAttribute("param", String(p.id));
      if (s !== currentConnection()) el.source = s;
      this.append(el);
    }
  }
};
function display(target, draw, opts = {}) {
  const canvas = typeof target === "string" ? document.querySelector(target) : target;
  if (!canvas || canvas.tagName !== "CANVAS") {
    console.error("[est-ui] display(): no such canvas", target);
    return () => {
    };
  }
  const cv = canvas;
  if (!cv.hasAttribute("role")) {
    cv.setAttribute("role", "img");
    if (!cv.hasAttribute("aria-label")) cv.setAttribute("aria-label", "Display");
  }
  let queued = 0, stopped = false;
  const paint = () => {
    queued = 0;
    if (stopped) return;
    const g = cv.getContext("2d");
    if (!g) return;
    const dpr = cv.width / Math.max(1, cv.getBoundingClientRect().width) || 1;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, cv.width / dpr, cv.height / dpr);
    try {
      draw(g, cv.width / dpr, cv.height / dpr, performance.now() / 1e3);
    } catch (err) {
      console.error("[est-ui] a display threw", err);
    }
    if (opts.animate && !reducedMotion()) later();
  };
  function later() {
    if (!queued && !stopped) queued = requestAnimationFrame(paint);
  }
  const unfit = fitCanvas(cv, later);
  let off = null;
  const unwait = whenConnected((c) => {
    off = c.subscribe(later);
  });
  later();
  return () => {
    stopped = true;
    if (queued) cancelAnimationFrame(queued);
    unfit();
    unwait();
    off?.();
  };
}
function defineElements(registry = typeof customElements === "undefined" ? void 0 : customElements) {
  if (!registry) return;
  const all = {
    "est-knob": EstKnob,
    "est-slider": EstSlider,
    "est-switch": EstSwitch,
    "est-select": EstSelect,
    "est-xy": EstXY,
    "est-value": EstValue,
    "est-meter": EstMeter,
    "est-spectrum": EstSpectrum,
    "est-all": EstAll,
    "est-row": EstRow,
    "est-panel": EstPanel,
    "est-window": EstWindow
  };
  for (const [name, ctor] of Object.entries(all)) if (!registry.get(name)) registry.define(name, ctor);
}
var KIT_ELEMENTS = ["est-window", "est-row", "est-panel", "est-knob", "est-slider", "est-switch", "est-select", "est-xy", "est-value", "est-meter", "est-spectrum", "est-all"];

// sdk/packages/ui/src/bind.ts
function bind(el, paramId, opts = {}) {
  const source = opts.source ?? currentConnection();
  if (!source) throw new Error("@est/ui: bind() needs a source; call connect() first");
  if (el instanceof EstBound) {
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
  DEFAULT_THEME,
  EST_UI_PROTOCOL,
  EstAll,
  EstBound,
  EstKnob,
  EstMeter,
  EstPanel,
  EstRow,
  EstSelect,
  EstSlider,
  EstSpectrum,
  EstSwitch,
  EstValue,
  EstWindow,
  EstXY,
  FLAGS,
  HOST_MAX_PER_SECOND,
  KIT_ELEMENTS,
  MAX_MESSAGE_BYTES,
  MAX_METER,
  MIN_CONTRAST,
  PAGE_STYLE,
  SEND_PER_SECOND,
  SPECTRUM_FLOOR_DB,
  THEMES,
  UI_SIZE_BOUNDS,
  audioMessage,
  bind,
  checkHostMessage,
  clampSize,
  clampValue,
  connect,
  contrast,
  controlFor,
  currentConnection,
  defineElements,
  display,
  ensureContrast,
  foldName,
  formatNumber,
  formatValue,
  fromNorm,
  gestureMessage,
  guardContrast,
  luminance,
  meterNorm,
  onColour,
  paramMessage,
  parseColour,
  parseTyped,
  readFragment,
  readHints,
  readyMessage,
  resizeMessage,
  resolveParam,
  shownParams,
  toHex,
  toNorm,
  wheelPixels,
  whenConnected
};
