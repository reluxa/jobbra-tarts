// HUD: DOM-elemek frissítése. Mindent a main hívogat.
const $ = (id) => document.getElementById(id);

// ---- Tiszta formázó-segédek (tesztelhetők) ----

// Az időbar színe a százalékból: zöld (120°H) → piros (6°), soha nem 0-ra.
export const batteryHue = (pct) => Math.max(6, (pct / 100) * 120);

// A kapu-idő kijelzés formázása: másodpercek, sosem negatív, kerekítve.
export const formatGateSecs = (s) => Math.max(0, Math.round(s)).toString();

// Az időbüntetés felirata a KAPU-IDŐ panelre: „−N s", sosem negatív.
export const formatTimeMinus = (s) => '−' + Math.max(0, Math.round(s)) + ' s';

// A kapu-idő „hangulata” a százalékból: bőven van / figyelmeztet / kritikus.
// A kijelző emiatt kap hangulat-osztályt (ecoBox.warn / ecoBox.crit).
export const timeTone = (pct) => (pct <= 25 ? 'crit' : pct <= 50 ? 'warn' : 'ok');

export class HUD {
  constructor() {
    this.el = {
      score: $('score'), best: $('best'), streak: $('streak'),
      ecoFill: $('ecoFill'), ecoVal: $('ecoVal'),
      secFill: $('secFill'), speed: $('speed'), hint: $('hintBox'),
      flash: $('flash'),
      sigL: $('sigL'), sigR: $('sigR'),
      ecoBox: $('ecoBox'), gateT: $('gateT'), gateSub: $('gateSub'),
      timeMinus: $('timeMinus'),
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

  // Kapu-idő kijelző.  pct = a kapu-óra töltöttsége (0..100), gateFrac = haladás
  // a következő kapu felé (0..1), secs = hátralévő másodperc (a nagy szám).
  updateEnergy(pct, gateFrac, secs = null) {
    this.el.ecoVal.textContent = Math.round(pct) + '%';
    this.el.ecoFill.style.width = Math.max(0, Math.min(100, pct)) + '%';
    // piros ha veszélyben az idő, zöld ha bőven van
    this.el.ecoFill.style.background = `hsl(${batteryHue(pct)}, 85%, 42%)`;
    this.el.secFill.style.width = (gateFrac * 100) + '%';
    if (this.el.gateSub) this.el.gateSub.textContent = 'a kapuig ' + Math.round((gateFrac || 0) * 100) + '%';
    if (secs != null && this.el.gateT) this.el.gateT.textContent = formatGateSecs(secs);
    // hangulat-osztályok: figyelmeztetés (narancs), kritikus (piros villogás)
    if (this.el.ecoBox) {
      this.el.ecoBox.classList.toggle('warn', timeTone(pct) === 'warn');
      this.el.ecoBox.classList.toggle('crit', timeTone(pct) === 'crit');
    }
  }

  updateGate(difficulty, req) {
    this.el.streak.textContent =
      'kell ≈ ' + (req || 0).toFixed(1) + ' km/h · ' + Math.round(difficulty * 100) + '%';
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

  // Időbüntetés vizuális jelzése (jobbról-előzés: −5 s): a panel villan és
  // rázkódik, a másodperc-szám rezdül, a „−N s" chip felszáll és elhalványul.
  // Az osztály-restart (remove → reflow → add) miatt gyors egymásután is
  // újraindul az animáció.
  timeHit(secs = 0) {
    if (!this.el.ecoBox || !this.el.gateT || !this.el.timeMinus) return;
    this.el.timeMinus.textContent = formatTimeMinus(secs);
    const restart = (el, cls) => {
      el.classList.remove(cls);
      void el.offsetWidth; // reflow: az animáció újraindul
      el.classList.add(cls);
    };
    restart(this.el.ecoBox, 'hit');
    restart(this.el.gateT, 'numhit');
    restart(this.el.timeMinus, 'show');
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
