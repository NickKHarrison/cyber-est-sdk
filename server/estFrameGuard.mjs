// server/estFrameGuard.mjs — 1.314 (LR-8b stream B, EST-03; EST_SECURITY_ARCHITECTURE.md §4): the
// plugin origin's **frame guard**, a host-written script served at `/est/frame-guard.js` (same
// origin, so `pluginCsp`'s `script-src 'self'` allows it) and injected as the first script of every
// `.html` page served under `/est/b/` and `/est/dev/`. The review's probe showed a plugin UI under
// `connect-src 'none'` sending STUN packets through `RTCPeerConnection`: CSP has no directive
// Chromium enforces for WebRTC and the Permissions-Policy has no feature for it, so the guard
// removes the constructors instead. It deletes and freezes `RTCPeerConnection`,
// `webkitRTCPeerConnection`, `RTCDataChannel`, `RTCRtpSender`, `RTCRtpReceiver`,
// `RTCIceTransport` (and their kin) on the window, and, since a same-document `about:blank` child
// is a fresh realm with fresh constructors, strips every child window too: on
// `HTMLIFrameElement.prototype.contentWindow`/`contentDocument`, on every insertion of a frame
// (the DOM's insertion methods and the HTML setters are hooked to sweep the subtree), and on a
// timer sweep of `window.frames`. The bytes under the hash folder never change; the served page
// differs by this one tag (`injectFrameGuard`) and every served script by the guard at its head
// (`guardScript`, the review of #449), which EST-12's image check allows for `.html` and `.js`.
//
// Defence in depth, not a proof (the security document says so): a plugin script that keeps a
// reference to a constructor the guard missed, or a browser that hands out a realm the sweeps do
// not see, is what row 10's independent review looks at. Never plugin JavaScript, never in the
// app's page: the guard is the host's own file on the plugin origin only.

export const FRAME_GUARD_PATH = '/est/frame-guard.js';

/** The guard, as served (plain ES5: it runs before anything else in the page and must never throw). */
export const FRAME_GUARD_JS = `(function () {
  'use strict';
  // The review of #449: the guard runs first in every realm the plugin's code can run in. It is the
  // first script of every page and (since the review) the head of every script this origin serves,
  // so a srcdoc or blob child that loads one of the plugin's own files runs it first too. One run a
  // realm, keyed on the realm's own global (a navigated frame is a new global, so it runs again).
  var G = typeof globalThis !== 'undefined' ? globalThis : typeof self !== 'undefined' ? self : this;
  var MARK = '__estFrameGuard';
  try { if (Object.prototype.hasOwnProperty.call(G, MARK)) return; Object.defineProperty(G, MARK, { value: true, writable: false, configurable: false, enumerable: false }); } catch (e) { return; }
  var NAMES = ['RTCPeerConnection', 'webkitRTCPeerConnection', 'mozRTCPeerConnection', 'RTCDataChannel', 'RTCRtpSender',
    'RTCRtpReceiver', 'RTCRtpTransceiver', 'RTCIceTransport', 'RTCDtlsTransport', 'RTCSctpTransport', 'RTCPeerConnectionIceEvent',
    'RTCSessionDescription', 'RTCIceCandidate', 'RTCDataChannelEvent', 'RTCTrackEvent', 'RTCCertificate', 'RTCError', 'RTCErrorEvent',
    'RTCEncodedAudioFrame', 'RTCEncodedVideoFrame', 'RTCRtpScriptTransform', 'RTCTransformEvent'];
  function strip(w) {
    if (!w) return;
    // Another realm that has not run the guard (Chromium refuses a sandboxed frame's script any
    // other document's realm, so this is belt and braces): stripped once, marked on its own global.
    try { if (w !== G) { if (Object.prototype.hasOwnProperty.call(w, MARK)) return; Object.defineProperty(w, MARK, { value: true, writable: false, configurable: false, enumerable: false }); } } catch (e) { return; }
    for (var i = 0; i < NAMES.length; i++) {
      var n = NAMES[i];
      try {
        if (!(n in w)) continue;
        try { delete w[n]; } catch (e) { /* not deletable: redefine below */ }
        Object.defineProperty(w, n, { value: undefined, writable: false, configurable: false, enumerable: false });
      } catch (e) { /* already frozen */ }
    }
    try { sweepFrames(w); } catch (e) { /* no frames */ }
  }
  function sweepFrames(w) {
    var n = 0;
    try { n = w.frames.length; } catch (e) { return; }
    for (var i = 0; i < n; i++) { try { strip(w.frames[i]); } catch (e) { /* cross-origin: not ours */ } }
  }
  function sweepNode(node) {
    if (!node || node.nodeType !== 1 && node.nodeType !== 11) return;
    try {
      if (node.nodeName === 'IFRAME' || node.nodeName === 'FRAME') strip(node.contentWindow);
      var all = node.querySelectorAll ? node.querySelectorAll('iframe,frame') : [];
      for (var i = 0; i < all.length; i++) strip(all[i].contentWindow);
    } catch (e) { /* detached */ }
  }
  strip(G);
  if (typeof Node !== 'function' || typeof document === 'undefined') return; // a worker: no frames
  // A child frame's window as the plugin reaches it.
  var proto = typeof HTMLIFrameElement === 'function' ? HTMLIFrameElement.prototype : null;
  function getter(obj, name, wrap) {
    try {
      var d = Object.getOwnPropertyDescriptor(obj, name);
      if (d && d.get && d.configurable) Object.defineProperty(obj, name, { configurable: false, enumerable: d.enumerable, get: function () { return wrap(d.get.call(this)); } });
    } catch (e) { /* not configurable */ }
  }
  if (proto) {
    getter(proto, 'contentWindow', function (w) { strip(w); return w; });
    getter(proto, 'contentDocument', function (d) { if (d) strip(d.defaultView); return d; });
  }
  // Every way a frame enters the document: sweep what was inserted, synchronously.
  function hook(obj, name, which) {
    if (!obj || typeof obj[name] !== 'function') return;
    var real = obj[name];
    try {
      Object.defineProperty(obj, name, { configurable: false, writable: false, value: function () {
        var r = real.apply(this, arguments);
        try {
          if (which === 'self') sweepNode(this);
          else if (which === 'parent') sweepNode(this.parentNode || this);
          else for (var i = 0; i < arguments.length; i++) sweepNode(arguments[i]);
        } catch (e) { /* never break the call */ }
        return r;
      } });
    } catch (e) { /* not configurable */ }
  }
  function setter(obj, name, after) {
    try {
      var d = Object.getOwnPropertyDescriptor(obj, name);
      if (d && d.set && d.configurable) Object.defineProperty(obj, name, { configurable: false, enumerable: d.enumerable, get: d.get, set: function (v) { var p = this.parentNode; d.set.call(this, v); try { sweepNode(after === 'parent' ? p : this); } catch (e) { /* detached */ } } });
    } catch (e) { /* not configurable */ }
  }
  var protos = [typeof Node === 'function' && Node.prototype, typeof Element === 'function' && Element.prototype, typeof DocumentFragment === 'function' && DocumentFragment.prototype,
    typeof ShadowRoot === 'function' && ShadowRoot.prototype, typeof Document === 'function' && Document.prototype, typeof CharacterData === 'function' && CharacterData.prototype,
    typeof DocumentType === 'function' && DocumentType.prototype];
  for (var k = 0; k < protos.length; k++) {
    var P = protos[k];
    if (!P) continue;
    hook(P, 'appendChild', 'args'); hook(P, 'insertBefore', 'args'); hook(P, 'replaceChild', 'args'); hook(P, 'moveBefore', 'args');
    hook(P, 'append', 'self'); hook(P, 'prepend', 'self'); hook(P, 'replaceChildren', 'self');
    hook(P, 'after', 'parent'); hook(P, 'before', 'parent'); hook(P, 'replaceWith', 'parent');
    hook(P, 'insertAdjacentElement', 'parent'); hook(P, 'insertAdjacentHTML', 'parent');
    hook(P, 'setHTMLUnsafe', 'self'); hook(P, 'setHTML', 'self');
    setter(P, 'innerHTML', 'self'); setter(P, 'outerHTML', 'parent');
  }
  hook(Document.prototype, 'write', 'self'); hook(Document.prototype, 'writeln', 'self');
  // A frame that navigates (srcdoc, src) is a new realm behind the same element: swept on its load,
  // in the capture phase, before the plugin's own handler on the element.
  try { document.addEventListener('load', function (e) { var t = e.target; if (t && (t.nodeName === 'IFRAME' || t.nodeName === 'FRAME')) strip(t.contentWindow); }, true); } catch (e) { /* no document */ }
  // And a sweep on a timer, for any realm the hooks did not see.
  setInterval(function () { try { sweepFrames(G); } catch (e) { /* nothing to sweep */ } }, 100);
  // 1.346: the computer keys stay the host's. A click in a plugin's window gives the frame the
  // keyboard, so its keys never reached Cyber's computer keys (notes, Z X C V, Space's transport).
  // In the plugin's own frame (since 1.413 the frame wrapper's child, server/estFrameWrap.mjs, which
  // relays it to the host; its nonce in the fragment), a printable key
  // with no Ctrl, Cmd or Alt that the plugin did not take (preventDefault) and that is not typed
  // into a field goes to the host as est:key; the host checks it (checkKeyMessage) and plays it only
  // while this frame has the focus. Bubble phase on the window, after the plugin's own handlers.
  try {
    // The wrapper's child (the wrapper the host's), or, before 1.413, the host's own.
    if (G.parent === G || (G.parent !== G.top && G.parent.parent !== G.top)) return;
    var nm = /[#&]n=([0-9a-f]{32})(?:&|$)/.exec(String(location.hash));
    if (!nm) return;
    var nonce = nm[1];
    var CODE = /^(Key[A-Z]|Digit[0-9]|Space|Semicolon|Quote|Comma|Period|Slash|Backslash|BracketLeft|BracketRight|Minus|Equal|Backquote)$/;
    var typing = function (t) {
      if (!t || t.nodeType !== 1) return false;
      // A slider, box or button input types nothing: its letters are the host's (as Cyber's own, ownsPlayKeys).
      if (t.nodeName === 'INPUT') return !/^(range|checkbox|radio|button|submit|reset|color|file|image)$/.test(String(t.type));
      if (/^(SELECT|TEXTAREA)$/.test(t.nodeName) || t.isContentEditable) return true;
      try { return !!(t.closest && t.closest('[role="combobox"],[role="listbox"],[role="menu"],[role="textbox"],[contenteditable="true"]')); } catch (e) { return false; }
    };
    var control = function (t) {
      try { return !!(t && t.nodeType === 1 && t.closest && t.closest('button,input,select,textarea,a[href],summary,[role="button"],[role="checkbox"],[role="switch"],[role="radio"],[role="slider"],[role="tab"],[role="menuitem"],[role="option"]')); } catch (e) { return false; }
    };
    var send = function (e, down) {
      try {
        if (!e || e.ctrlKey || e.metaKey || e.altKey || e.isComposing) return;
        if (typeof e.key !== 'string' || e.key.length !== 1 || !CODE.test(String(e.code))) return;
        if (down && e.defaultPrevented) return;
        if (typing(e.target)) return;
        // Space presses a focused control of the page's own (a checkbox, a button, a switch): its
        // keyboard use stays the page's. Elsewhere in the page Space is Cyber's transport.
        if (e.key === ' ' && control(e.target)) return;
        G.parent.postMessage({ v: 1, type: 'est:key', nonce: nonce, key: e.key, code: e.code, shift: !!e.shiftKey, down: down, repeat: !!e.repeat }, '*');
        // The host plays it: the frame's own default (a scroll on Space) must not happen too.
        if (down && e.key === ' ') e.preventDefault();
      } catch (err) { /* never break the page */ }
    };
    G.addEventListener('keydown', function (e) { send(e, true); }, false);
    G.addEventListener('keyup', function (e) { send(e, false); }, false);
  } catch (e) { /* no keys */ }
})();
`;

/** The tag the served page carries first. */
export const FRAME_GUARD_TAG = `<script src="${FRAME_GUARD_PATH}"></script>`;

/**
 * The page with the guard as its first script. The review of #449: never found by searching the
 * plugin's text (`<!--<head>-->` put the tag in a comment, `<script src=ui.js></script><head>` let
 * the plugin's script run first): the tag goes straight after a doctype that opens the file
 * (after an optional byte-order mark and whitespace, so the document keeps its mode), else at byte 0.
 * @param {Buffer | string} html
 * @returns {Buffer}
 */
export function injectFrameGuard(html) {
  const text = Buffer.isBuffer(html) ? html.toString('utf8') : String(html);
  const m = /^\uFEFF?[\t\n\f\r ]*<!doctype[^>]*>/i.exec(text);
  const i = m ? m[0].length : 0;
  return Buffer.from(text.slice(0, i) + FRAME_GUARD_TAG + text.slice(i), 'utf8');
}

/**
 * The review of #449 (EST-03): every script the plugin origin serves, with the guard at its head,
 * so the guard runs first in any realm where the plugin's own code runs (a `srcdoc` or `blob:` child
 * that loads one of the bundle's files ran it before with WebRTC intact). The guard is idempotent per
 * realm and a plain statement, valid at the top of a classic script, a module and a worker.
 * @param {Buffer | string} js
 * @returns {Buffer}
 */
export function guardScript(js) {
  const text = Buffer.isBuffer(js) ? js.toString('utf8') : String(js);
  return Buffer.from(FRAME_GUARD_JS + '\n' + text, 'utf8');
}
