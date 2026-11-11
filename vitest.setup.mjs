// jsdom lacks these; the UI library's tests use them (as Cyber's src/test-setup.ts provides).
/** @type {any} */
const g = globalThis;
const win = g.window;
if (win && !win.matchMedia) {
  win.matchMedia = (/** @type {string} */ query) => ({ matches: false, media: query, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false });
}
if (!('ResizeObserver' in g)) {
  g.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
}
if (win && typeof win.PointerEvent === 'undefined') {
  /** @param {string} type @param {any} [init] */
  const PointerEventPolyfill = function PointerEvent(type, init = {}) {
    const e = new g.MouseEvent(type, init);
    Object.defineProperty(e, 'pointerId', { value: init.pointerId ?? 1 });
    Object.defineProperty(e, 'pointerType', { value: init.pointerType ?? 'mouse' });
    return e;
  };
  PointerEventPolyfill.prototype = g.MouseEvent.prototype;
  win.PointerEvent = PointerEventPolyfill;
  g.PointerEvent = PointerEventPolyfill;
}
