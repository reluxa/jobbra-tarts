import test from 'node:test';
import assert from 'node:assert/strict';
import { installDomStubs } from './helpers/dom-stubs.js';
import { HUD, batteryHue, formatTimeMinus } from '../src/hud.js';

const { document, localStorage, makeEl } = installDomStubs();

function mkHud() {
  const ids = ['score', 'best', 'streak', 'ecoFill', 'ecoVal',
    'ecoBox', 'gateT', 'gateSub', 'secFill', 'speed', 'hintBox', 'flash', 'sigL', 'sigR',
    'timeMinus'];
  const el = {};
  for (const id of ids) el[id] = makeEl();
  document.register(el);
  return new HUD();
}

// ---- tiszta formázó-segédek ----
test('batteryHue: 100% → zöld, 0% → piros, monoton csökken', () => {
  assert.equal(batteryHue(100), 120);
  assert.equal(batteryHue(0), 6);
  assert.equal(batteryHue(50), 60);
  let prev = batteryHue(100);
  for (let p = 90; p >= 0; p -= 10) {
    const h = batteryHue(p);
    assert.ok(h >= prev || h <= prev + 1e-9, `monoton: ${p} → ${h}`);
    prev = h;
  }
  assert.ok(batteryHue(150) > 120, '100 felett is számol (a CSS-nek kell clampolnia)');
});

// ---- a DOM-pilléreken futó HUD ----
test('HUD: a legjobb pontszám a localStorage-ból jön, frissül, ha új csúcs van', () => {
  localStorage.setItem('jobbra_tartas_best', '1234');
  const h = new HUD();
  assert.equal(h.best, 1234);
  h.showBestIfNew(500);
  assert.equal(h.best, 1234, 'alacsonyabb nem írja felül');
  h.showBestIfNew(2000);
  assert.equal(h.best, 2000);
  assert.equal(localStorage.getItem('jobbra_tartas_best'), '2000');
});

test('HUD: elemmegjelenítések', () => {
  const h = mkHud();
  h.updateScore(12345);
  assert.equal(h.el.score.textContent, '12 345');
  assert.ok(h.el.score.textContent.length >= 5);
  h.updateSpeed(97.6);
  assert.equal(h.el.speed.textContent, 98);
  h.updateGate(0.75, 74.5);
  assert.ok(h.el.streak.textContent.includes('74.5'));
});

test('HUD: updateEnergy a százalékot és a színárnyalatot állítja', () => {
  const h = mkHud();
  h.updateEnergy(34, 0.5);
  assert.equal(h.el.ecoVal.textContent, '34%');
  assert.equal(h.el.ecoFill.style.width, '34%');
  assert.equal(h.el.ecoFill.style.background, `hsl(${batteryHue(34)}, 85%, 42%)`);
  assert.equal(h.el.secFill.style.width, '50%');
  h.updateEnergy(150, 1); // clamp a HUD-on
  assert.equal(h.el.ecoFill.style.width, '100%');
  h.updateEnergy(-5, 0);
  assert.equal(h.el.ecoFill.style.width, '0%');
});

test('HUD: updateSignal — csak változáskor újrarajzol, a helyes oldalt villogtatja', () => {
  const h = mkHud();
  h.updateSignal(-1);
  assert.equal(h.el.sigL.style.animation, 'sigblink 1.32s linear infinite');
  assert.equal(h.el.sigR.style.animation, 'none');
  // ugyanaz a jel: korai visszatérés, semmi nem íródik
  h.el.sigL.style.animation = 'MANUAL';
  h.updateSignal(-1);
  assert.equal(h.el.sigL.style.animation, 'MANUAL', 'azonos jelnél nincs újrarajzolás');
  h.updateSignal(1);
  assert.equal(h.el.sigR.style.animation, 'sigblink 1.32s linear infinite');
  assert.equal(h.el.sigL.style.animation, 'none');
  assert.equal(h.el.sigR.style.opacity, 0.25, 'a másik oldal a korábbi off-kezelést tartja');
  h.updateSignal(0);
  assert.equal(h.el.sigR.style.animation, 'none');
  assert.equal(h.el.sigL.style.opacity, 0.25);
});

test('HUD: flash és setHint a DOM-ra ír', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const h = mkHud();
  h.flash();
  assert.equal(h.el.flash.style.opacity, 0.8);
  assert.equal(h.el.flash.style.transition, 'none');
  t.mock.timers.tick(50); // a rAF lefut
  assert.equal(h.el.flash.style.opacity, 0);
  assert.equal(h.el.flash.style.transition, 'opacity 0.5s ease');
  h.setHint('<b>kia</b>');
  assert.equal(h.el.hint.innerHTML, '<b>kia</b>');
});

// ---- időbüntetés-vizualizáció (jobbról-előzés): chip + panel/szám-reakció ----

test('formatTimeMinus: −N s, kerekítve, sosem negatív', () => {
  assert.equal(formatTimeMinus(5), '−5 s');
  assert.equal(formatTimeMinus(4.4), '−4 s');
  assert.equal(formatTimeMinus(4.6), '−5 s');
  assert.equal(formatTimeMinus(0), '−0 s');
  assert.equal(formatTimeMinus(-3), '−0 s');
});

test('HUD: timeHit — chip felirat + a hit/numhit/show osztályok felkerülnek', () => {
  const h = mkHud();
  // osztály-rögzítő classList a panelre/számra/chipre (a gatetime teszt mintájára)
  const rec = (el) => {
    const classes = new Set();
    el.classList = {
      add: (c) => classes.add(c),
      remove: (c) => classes.delete(c),
      toggle: (c, on) => (on ? classes.add(c) : classes.delete(c)),
    };
    el._classes = classes;
  };
  rec(h.el.ecoBox); rec(h.el.gateT); rec(h.el.timeMinus);

  h.timeHit(5);
  assert.equal(h.el.timeMinus.textContent, '−5 s');
  assert.ok(h.el.ecoBox._classes.has('hit'), 'a panel megkapja a .hit osztályt');
  assert.ok(h.el.gateT._classes.has('numhit'), 'a másodperc-szám a .numhit-et');
  assert.ok(h.el.timeMinus._classes.has('show'), 'a chip a .show-t');

  h.timeHit(0); // újabb büntetés → az osztályok újraindulnak (remove+add)
  assert.equal(h.el.timeMinus.textContent, '−0 s');
  assert.ok(h.el.ecoBox._classes.has('hit'), 'új hívásnál is felkerül a .hit');
  assert.ok(h.el.gateT._classes.has('numhit'));
  assert.ok(h.el.timeMinus._classes.has('show'));
});
