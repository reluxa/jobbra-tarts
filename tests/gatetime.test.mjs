// KAPU-IDŐ kijelző — dedikált tesztek.
//
// Fedi:
//  1. a tiszta formázó/hangulat segédeket (formatGateSecs, timeTone),
//  2. a HUD kapu-idő írását (másodperc, %, sávok, hangulat-osztályok),
//  3. a motor-regressziót: reset() NEM cserélheti le a Scoring-példányt
//     (a nézet elavult referenciája miatt ragadt 100%-on a kapu-idő), és a
//     kapu-óra életciklusát (fogyás, átlépés, újratöltés, timeout).
import test from 'node:test';
import assert from 'node:assert/strict';
import { installDomStubs } from './helpers/dom-stubs.js';
import { HUD, formatGateSecs, timeTone, batteryHue } from '../src/hud.js';
import { SimEngine } from '../src/sim/engine.js';
import { SCORE, PHYS_FIXED } from '../src/constants.js';

const { document, makeEl } = installDomStubs();

function mkHud() {
  const ids = ['score', 'best', 'mult', 'streak', 'ecoFill', 'ecoVal',
    'ecoBox', 'gateT', 'gateSub', 'secFill', 'speed', 'hintBox', 'flash', 'sigL', 'sigR'];
  const el = {};
  for (const id of ids) el[id] = makeEl();
  // a classList-stub ne csak nyelje, hanem rögzítse is a hangulat-osztályokat
  const classes = new Set();
  el.ecoBox.classList = {
    add: (c) => classes.add(c),
    remove: (c) => classes.delete(c),
    toggle: (c, on) => (on ? classes.add(c) : classes.delete(c)),
  };
  el.ecoBox._classes = classes;
  document.register(el);
  return new HUD();
}

// ---- tiszta segédek ----

test('formatGateSecs: kerekít, sosem negatív', () => {
  assert.equal(formatGateSecs(82.44), '82');
  assert.equal(formatGateSecs(82.5), '83');
  assert.equal(formatGateSecs(0), '0');
  assert.equal(formatGateSecs(-4.2), '0');
  assert.equal(formatGateSecs(120), '120');
});

test('timeTone: >50% bőven van, 26–50% figyelmeztet, ≤25% kritikus', () => {
  assert.equal(timeTone(100), 'ok');
  assert.equal(timeTone(51), 'ok');
  assert.equal(timeTone(50), 'warn');
  assert.equal(timeTone(26), 'warn');
  assert.equal(timeTone(25), 'crit');
  assert.equal(timeTone(0), 'crit');
});

// ---- HUD kapu-idő kijelző ----

test('updateEnergy: a nagy szám a hátralévő másodperc, a % és a sávok frissülnek', () => {
  const h = mkHud();
  h.updateEnergy(100, 0.1, 82.44);
  assert.equal(h.el.gateT.textContent, '82');
  assert.equal(h.el.ecoVal.textContent, '100%');
  assert.equal(h.el.ecoFill.style.width, '100%');
  assert.equal(h.el.secFill.style.width, '10%');
  assert.equal(h.el.gateSub.textContent, 'a kapuig 10%');
  // a kijelző „bőven van idő” üzemmódban van: nincs figyelmeztető osztály
  assert.equal(h.el.ecoBox._classes.has('warn'), false);
  assert.equal(h.el.ecoBox._classes.has('crit'), false);
});

test('updateEnergy: fogyó idő → figyelmeztetés, majd kritikus osztály + klamp', () => {
  const h = mkHud();
  h.updateEnergy(40, 0.5, 33);
  assert.equal(h.el.ecoBox._classes.has('warn'), true);
  assert.equal(h.el.ecoBox._classes.has('crit'), false);
  h.updateEnergy(24, 0.6, 20);
  assert.equal(h.el.ecoBox._classes.has('warn'), false, 'kritikus felülírja a figyelmeztetést');
  assert.equal(h.el.ecoBox._classes.has('crit'), true);
  // a sáv a %-hoz képest clamp-olódik, a másodpercek nem mennek negatívba
  h.updateEnergy(150, 1, -3);
  assert.equal(h.el.ecoFill.style.width, '100%');
  assert.equal(h.el.gateT.textContent, '0');
});

test('updateEnergy: secs nélkül is megy (a régi hívók kompatibilisek maradnak)', () => {
  const h = mkHud();
  h.updateEnergy(66, 0.25);
  assert.equal(h.el.ecoVal.textContent, '66%');
  assert.equal(h.el.secFill.style.width, '25%');
  assert.equal(h.el.gateT.textContent, '', 'a másodperc-kijelzőt nem írja felül');
});

test('updateEnergy: a sáv színe a batteryHue szerint megy' /* egybe a meglévőkkel */, () => {
  const h = mkHud();
  h.updateEnergy(30, 0, 25);
  assert.equal(h.el.ecoFill.style.background, `hsl(${batteryHue(30)}, 85%, 42%)`);
});

// ---- motor-regresszió: a kapu-óra életciklusa ----

test('ENGINE: reset() ugyanazt a Scoring-példányt tartja — a nézet referenciája nem avul el', () => {
  const e = new SimEngine({ seed: 7 });
  const s = e.scoring;
  const gateT0 = s.gateT; // számként mentjük el: a példány azonos marad, az ÉRTÉKE változik
  // játsszunk egy kicsit: az óra fogy, a haladás nő
  for (let i = 0; i < 300; i++) e.tick(PHYS_FIXED);
  assert.ok(e.scoring.gateT < gateT0, 'játék közben az óra fogy');
  assert.ok(e.scoring.gateAcc > 0, 'és a kapu-felé haladás nő');
  e.reset();
  assert.equal(e.scoring, s, 'reset után is AZONOS példány (ez volt a kapu-idő-ragadás oka)');
  assert.equal(e.scoring.gates, 0);
  assert.equal(e.scoring.score, 0);
  assert.equal(e.scoring.gateAcc, 0);
  assert.equal(e.scoring.timedOut, false);
  assert.equal(e.scoring.gateT, e.scoring.gateAvail, 'az óra újratöltődik a friss költségvetésre');
});

test('ENGINE: a kapu-óra valóban fogy, és a timeout-esemény egyszer lő', () => {
  const e = new SimEngine({ seed: 1 });
  const events = [];
  e.onEvent = (ev) => events.push(ev.kind);
  const gateT0 = e.scoring.gateT;
  // 20 s játék: az óra fogy, de még nincs vége
  for (let i = 0; i < 20 / PHYS_FIXED; i++) e.tick(PHYS_FIXED);
  assert.ok(e.scoring.gateT < gateT0, 'az óra fogy');
  assert.ok(e.scoring.gateT > 0, '20 s alatt még nem jár le');
  assert.equal(events.filter((k) => k === 'timeout').length, 0);
  // lejárat: az óra kinullázódik és timeout esemény jön
  e.scoring.gateT = 0.01;
  e.tick(PHYS_FIXED);
  assert.equal(e.scoring.gateT, 0);
  assert.equal(e.scoring.timedOut, true);
  assert.equal(events.filter((k) => k === 'timeout').length, 1);
  e.tick(PHYS_FIXED);
  assert.equal(events.filter((k) => k === 'timeout').length, 1, 'a timeout nem duplázódik');
});

test('ENGINE: kapu-átlépés újratölti az órát és gate-eseményt lő', () => {
  const e = new SimEngine({ seed: 3 });
  const p = e.player;
  p.speed = 30; p.fwdSpeed = 30; // utazósebesség: determinisztikus, nem a gyorsulástól függ
  const events = [];
  e.onEvent = (ev) => events.push(ev.kind);
  e.scoring.gateAcc = SCORE.gateDist - 0.5; // egy lépésre a kaputól (30 m/s → 0.5 m/lépés)
  e.tick(PHYS_FIXED);
  assert.equal(e.scoring.gates, 1);
  assert.ok(events.includes('gate'), 'gate-esemény lő');
  assert.equal(e.scoring.gateT, e.scoring.gateAvail, 'az óra az új költségvetésre töltődik');
  assert.ok(Math.abs(e.scoring.gateT - SCORE.gateDist / (e.scoring.req / 3.6)) < 1e-9);
});
