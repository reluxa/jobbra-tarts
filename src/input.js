// Bemenetkezelés: billentyűzet + érintőgombok.
// Sávváltás-fókuszú irányítás: a bal/jobb gomb EGY automatikus sávváltást indít
// (a tényleges váltást a Player végzi), nem folyamatos kormányzás.

export class Input {
  constructor() {
    this.enabled = true;
    this.onAnyKey = null; // autoplay-hang felszabadításához
    this.onLane = null;   // (dir: -1 balra, +1 jobbra) => void
    this.onSignal = null; // (dir) => void

    window.addEventListener('keydown', (e) => this.keydown(e));

    // Érintőgombok: balra/jobbra = egy sávváltás, indexjelző = egy jelzés.
    const bindOnce = (id, fn) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.addEventListener('pointerdown', (ev) => { ev.preventDefault(); fn(); });
    };
    bindOnce('tL', () => this.onLane && this.onLane(-1));
    bindOnce('tR', () => this.onLane && this.onLane(1));
    bindOnce('tSigL', () => this.onSignal && this.onSignal(-1));
    bindOnce('tSigR', () => this.onSignal && this.onSignal(1));
  }

  keydown(e) {
    const k = e.key.toLowerCase();
    if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].includes(k)) e.preventDefault();
    if (this.onAnyKey) this.onAnyKey();

    // az ismételt gombnyomás (lenyomva tartás) ne spamelje a sávváltást
    if (k === 'a' || k === 'arrowleft' || k === 'd' || k === 'arrowright' ||
        k === 'q' || k === 'e') {
      if (e.repeat) return;
      if (k === 'a' || k === 'arrowleft') this.onLane && this.onLane(-1);
      else if (k === 'd' || k === 'arrowright') this.onLane && this.onLane(1);
      else if (k === 'q') this.onSignal && this.onSignal(-1);
      else if (k === 'e') this.onSignal && this.onSignal(1);
    }
  }
}
