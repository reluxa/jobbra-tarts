// Minimális DOM-stubok a node:test-hez. A nézetmodulok (hud/input/effects/world/
// audio) csak ezeket érik el a böngészőből — nem kell jsdom, elég a
// cél-call-trace. Minden tesztfájl a saját processében fut, így a globálisok
// nem szivárognak át a többi tesztre.

export function installDomStubs() {
  // --- HTMLElement-jellegű fake (call-ok rögzítése) ---
  const makeEl = () => {
    const handlers = new Map();
    return {
      style: {}, className: '', textContent: '', innerHTML: '',
      classList: { add() {}, remove() {}, toggle() {} },
      appendChild() {}, remove() {}, setAttribute() {}, getAttribute: () => null,
      addEventListener: (t, cb) => handlers.set(t, cb),
      removeEventListener: (t) => handlers.delete(t),
      fire: (t) => { const cb = handlers.get(t); if (cb) cb({ preventDefault() {} }); },
    };
  };

  // --- dokumentum: getElementById adott elemekkel, createElement canvas/div ---
  const els = new Map();
  const document = {
    elements: els,
    getElementById: (id) => els.get(id) ?? null,
    register: (elsMap) => { for (const [id, el] of Object.entries(elsMap)) els.set(id, el); },
    createElement: (tag) => {
      if (tag === 'canvas') {
        const ctx = new Proxy({}, {
          get: (t, p) => (p in t ? t[p] : () => {}),
          set: (t, p, v) => { t[p] = v; return true; },
        });
        return { width: 0, height: 0, style: {}, getContext: () => ctx };
      }
      return makeEl();
    },
  };

  // --- ablak: bármilyen eventet elnyel, koordináták a popup-vetítéshez ---
  const window = {
    innerWidth: 800,
    innerHeight: 600,
    addEventListener() {},
    removeEventListener() {},
    AudioContext: undefined,
    webkitAudioContext: undefined,
  };

  // --- localStorage (opcionális, a main nélkül is jó) ---
  const store = new Map();
  const localStorage = {
    store,
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear(),
  };

  // --- rAF: a setTimeout mockján át fut (mock.timers-szel együtt lépked) ---
  const requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 0);
  const cancelAnimationFrame = () => {};

  // --- Audio a zenei startMusic()-hoz ---
  class AudioStub {
    constructor(src) { this.src = src; this.loop = false; this.volume = 0.3; }
    play() { return Promise.resolve(); }
    pause() {}
  }

  const restore = () => {
    for (const g of ['document', 'window', 'localStorage', 'requestAnimationFrame',
      'cancelAnimationFrame', 'Audio']) delete globalThis[g];
  };

  restore();
  globalThis.document = document;
  globalThis.window = window;
  globalThis.localStorage = localStorage;
  globalThis.requestAnimationFrame = requestAnimationFrame;
  globalThis.cancelAnimationFrame = cancelAnimationFrame;
  globalThis.Audio = AudioStub;

  return { document, window, localStorage, Audio: AudioStub, makeEl, restore };
}
