// Bemenetkezelés: billentyűzet + érintőgombok.
// Közös absztrakció, hogy a játéklogika és a motor-fizika ugyanazt használja.

export class Input {
  constructor() {
    this.keys = new Set();
    this.touch = { gas: false, brake: false, left: false, right: false };
    this.enabled = true;
    this.onAnyKey = null; // autoplay-hang felszabadításához

    window.addEventListener('keydown', (e) => this.keydown(e));
    window.addEventListener('keyup', (e) => this.keyup(e));
    window.addEventListener('blur', () => { this.keys.clear(); });

    // Érintőgombok
    const bind = (id, key) => {
      const el = document.getElementById(id);
      if (!el) return;
      const set = (v) => (ev) => { ev.preventDefault(); this.touch[key] = v; };
      el.addEventListener('pointerdown', set(true));
      el.addEventListener('pointerup', set(false));
      el.addEventListener('pointercancel', set(false));
      el.addEventListener('pointerleave', set(false));
    };
    bind('tGas', 'gas');
    bind('tBrk', 'brake');
    bind('tL', 'left');
    bind('tR', 'right');
    // index (irányjelző) gombok: nyomásra egyszeri jelzés
    const bindSig = (id, dir) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.addEventListener('pointerdown', (ev) => {
        ev.preventDefault();
        if (this.onSignal) this.onSignal(dir);
      });
    };
    bindSig('tSigL', -1);
    bindSig('tSigR', 1);
  }

  keydown(e) {
    const k = e.key.toLowerCase();
    if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].includes(k)) e.preventDefault();
    if (this.onAnyKey) this.onAnyKey();
    if ((k === 'q' || k === 'e') && this.onSignal) this.onSignal(k === 'q' ? -1 : 1);
    this.keys.add(k);
  }
  keyup(e) {
    this.keys.delete(e.key.toLowerCase());
  }

  get gas() { return this.enabled && (this.keys.has('w') || this.keys.has('arrowup') || this.touch.gas); }
  get brake() { return this.enabled && (this.keys.has('s') || this.keys.has('arrowdown') || this.touch.brake); }
  // -1 = balra, +1 = jobbra
  get steer() {
    let v = 0;
    if (this.keys.has('a') || this.keys.has('arrowleft') || this.touch.left) v -= 1;
    if (this.keys.has('d') || this.keys.has('arrowright') || this.touch.right) v += 1;
    return v;
  }
}
