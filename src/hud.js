// HUD: DOM-elemek frissítése. Mindent a main hívogat.
const $ = (id) => document.getElementById(id);

export class HUD {
  constructor() {
    this.el = {
      score: $('score'), best: $('best'), mult: $('mult'), streak: $('streak'),
      lives: $('lives'), ecoFill: $('ecoFill'), ecoVal: $('ecoVal'),
      secFill: $('secFill'), speed: $('speed'), hint: $('hintBox'),
      flash: $('flash'),
      sigL: $('sigL'), sigR: $('sigR'),
    };
    this.sigTimer = 0;
    this.best = 0;
    try {
      this.best = parseInt(localStorage.getItem('jobbra_tartas_best') || '0', 10) || 0;
    } catch { this.best = 0; }
  }

  updateScore(s) {
    this.el.score.textContent = Math.round(s).toLocaleString('hu-HU');
    this.el.best.textContent = 'legjobb: ' + this.best.toLocaleString('hu-HU');
  }

  updateSpeed(kmh) {
    this.el.speed.textContent = Math.round(kmh);
  }

  updateEco(eco, sectionFrac) {
    this.el.ecoVal.textContent = Math.round(eco) + '%';
    this.el.ecoFill.style.width = eco + '%';
    this.el.ecoFill.style.background = `hsl(${120 * eco / 100}, 85%, 42%)`;
    this.el.secFill.style.width = (sectionFrac * 100) + '%';
  }

  updateLives(n) {
    this.el.lives.textContent = '❤'.repeat(n) + '🖤'.repeat(Math.max(0, 3 - n));
  }

  updateMult(mult, streak) {
    const m = mult.toFixed(1).replace('.', ',');
    this.el.mult.textContent = '×' + m;
    this.el.streak.textContent = streak > 0 ? '✦'.repeat(Math.min(streak, 5)) : '';
  }

  // indexjelző nyilak (0 = ki, -1 = balra, +1 = jobbra)
  updateSignal(sig) {
    if (sig === this.lastSig) return;
    this.lastSig = sig;
    const l = this.el.sigL;
    const r = this.el.sigR;
    const blink = (el, on) => {
      if (on) el.style.animation = 'sigblink 1.32s linear infinite';
      else { el.style.animation = 'none'; el.style.opacity = 0.25; }
    };
    if (sig === -1) { blink(l, true); blink(r, false); }
    else if (sig === 1) { blink(l, false); blink(r, true); }
    else { blink(l, false); blink(r, false); }
  }

  flash() {
    const f = this.el.flash;
    f.style.transition = 'none';
    f.style.opacity = 0.8;
    requestAnimationFrame(() => {
      f.style.transition = 'opacity 0.5s ease';
      f.style.opacity = 0;
    });
  }

  setHint(text) {
    this.el.hint.innerHTML = text;
  }

  showBestIfNew(score) {
    if (score > this.best) {
      this.best = score;
      try { localStorage.setItem('jobbra_tartas_best', String(score)); } catch { /* */ }
    }
  }
}
