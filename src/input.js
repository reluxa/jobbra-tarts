// Bemenetkezelés: billentyűzet + érintőgombok.
// Sávváltás-fókuszú irányítás: a bal/jobb gomb EGY automatikus sávváltást indít
// (a tényleges váltást a Player végzi), nem folyamatos kormányzás.

// Tiszta billentyű→akció leképezés (tesztelhető).
// Visszaad: null (nem játszó gomb) vagy { bind: 'lane'|'signal', dir, prevent, repeat }.
export function keyAction(key, repeat) {
  const k = String(key).toLowerCase();
  const prevent = ['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].includes(k);
  if (k === 'a' || k === 'arrowleft') return { bind: 'lane', dir: -1, prevent, repeat };
  if (k === 'd' || k === 'arrowright') return { bind: 'lane', dir: 1, prevent, repeat };
  if (k === 'q') return { bind: 'signal', dir: -1, prevent, repeat };
  if (k === 'e') return { bind: 'signal', dir: 1, prevent, repeat };
  return prevent ? { bind: null, dir: 0, prevent, repeat } : null;
}

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
    const act = keyAction(e.key, e.repeat);
    if (act && act.prevent) e.preventDefault();
    if (this.onAnyKey) this.onAnyKey();
    // az ismételt gombnyomás (lenyomva tartás) ne spamelje a sávváltást
    if (!act || !act.bind || act.repeat) return;
    if (act.bind === 'lane') this.onLane && this.onLane(act.dir);
    else this.onSignal && this.onSignal(act.dir);
  }
}
