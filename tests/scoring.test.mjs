import test from 'node:test';
import assert from 'node:assert/strict';
import { Scoring } from '../src/scoring.js';
import { SCORE, SIGNAL, laneRateByLane, PEN } from '../src/constants.js';

const gateAvail = () => SCORE.gateDist / (SCORE.reqStart / 3.6);

test('init: üres és teljes időköltségvetés', () => {
  const s = new Scoring();
  assert.equal(s.score, 0);
  assert.equal(s.gates, 0);
  assert.equal(s.gateAcc, 0);
  assert.equal(s.timedOut, false);
  assert.equal(s.req, SCORE.reqStart);
  assert.ok(Math.abs(s.gateAvail - gateAvail()) < 1e-9);
  assert.equal(s.gateT, s.gateAvail);
  assert.deepEqual(s.parts, {
    right: 0, overtake: 0, overtakes: 0, gate: 0,
    penalty: 0, crash: 0, signal: 0, signalsOK: 0, noSignal: 0, noSignalCount: 0,
  });
});

test('update: sáv-függő pont és óra-fogyás', () => {
  const s = new Scoring();
  s.update(10, 2); // jobb sáv
  assert.ok(Math.abs(s.score - SCORE.lanePerSec[2] * 10) < 1e-9);
  assert.ok(Math.abs(s.gateT - (s.gateAvail - laneRateByLane[2] * 10)) < 1e-9);
  assert.ok(s.parts.right > 0);

  const s2 = new Scoring();
  s2.update(10, 0); // belső sáv: negatív pontok, gyors fogyás
  assert.ok(s2.score < 0);
  assert.equal(s2.parts.right, 0);
  assert.ok(s2.gateT < s.gateT, 'belső sáv gyorsabban apaszt');
});

test('update: explicit rate felülírja a sáv-alapot (a beragadt-kivételhez), a pont marad sávszerint', () => {
  const s = new Scoring();
  s.update(10, 1, laneRateByLane[2]); // középső sávban, de óra 1,0×-szal fogy
  assert.ok(Math.abs(s.gateT - (s.gateAvail - 10)) < 1e-9);
  assert.equal(s.score, 0, 'közép sáv pont-flavor: 0');
});

test('update: lejárt idő csak egyszer jelölődik, gateT 0-ra klampolt az első átforduláskor', () => {
  const s = new Scoring();
  s.gateT = 0.5;
  s.update(10, 2); // 10s × 1.0 = 10 > 0.5
  assert.equal(s.gateT, 0);
  assert.equal(s.timedOut, true);
  s.update(10, 2);
  assert.equal(s.timedOut, true, 'a timeout jelzés nem ismétlődik');
  assert.ok(s.gateT < 0, 'a kijelzés-clamp már nem fut le újra (a HUD clampolja)');
});

test('advance: kapu-átlépés bónusszal, kért átlag nő, óra újratöltődik', () => {
  const s = new Scoring();
  s.advance(SCORE.gateDist * 1.0);
  assert.equal(s.gates, 1);
  assert.equal(s.gateAcc, 0);
  const expected = SCORE.gateBonus + Math.min(1, 10) * 2;
  assert.equal(s.score, expected);
  assert.equal(s.parts.gate, expected);
  assert.equal(s.req, SCORE.reqStart + SCORE.reqStep);
  assert.ok(Math.abs(s.gateAvail - SCORE.gateDist / (s.req / 3.6)) < 1e-9);
  assert.equal(s.gateT, s.gateAvail);
});

test('advance: a kapu-bónusz 10 kapu után nem nő tovább', () => {
  const s = new Scoring();
  for (let i = 0; i < 12; i++) s.advance(SCORE.gateDist);
  assert.equal(s.gates, 12);
  let expected = 0;
  for (let i = 1; i <= 12; i++) expected += SCORE.gateBonus + Math.min(i, 10) * 2;
  assert.equal(s.parts.gate, expected);
  // a 11. és 12. kapu járuléka már azonos (cap)
  assert.equal(SCORE.gateBonus + Math.min(11, 10) * 2, SCORE.gateBonus + Math.min(12, 10) * 2);
});

test('advance: átfutó többlet átvihető a következő kapura', () => {
  const s = new Scoring();
  s.advance(SCORE.gateDist * 1.5);
  assert.equal(s.gates, 1);
  assert.ok(Math.abs(s.gateAcc - SCORE.gateDist * 0.5) < 1e-9);
});

test('gateFrac/energyFrac: clamp 0..1', () => {
  const s = new Scoring();
  s.gateAcc = -5;
  assert.equal(s.gateFrac(), 0);
  s.gateAcc = SCORE.gateDist * 2;
  assert.equal(s.gateFrac(), 1);
  s.gateT = -1;
  assert.equal(s.energyFrac(), 0);
  s.gateT = s.gateAvail * 5;
  assert.equal(s.energyFrac(), 1);
});

test('overtake/crash: pontok és részek', () => {
  const s = new Scoring();
  s.overtake();
  assert.equal(s.parts.overtakes, 1);
  assert.equal(s.score, SCORE.overtake);
  assert.equal(s.parts.overtake, SCORE.overtake);
  s.crash();
  assert.equal(s.score, SCORE.overtake - SCORE.crash);
  assert.equal(s.parts.crash, SCORE.crash);
});

test('penalty: pontlevonás; withTime-nél az óra is fogy', () => {
  const s = new Scoring();
  s.penalty(true);
  assert.ok(Math.abs(s.gateT - (s.gateAvail - PEN.cutIn)) < 1e-9);
  assert.equal(s.score, -SCORE.rightPassPenalty);
  s.penalty(false);
  assert.equal(s.score, -2 * SCORE.rightPassPenalty);
  assert.ok(Math.abs(s.gateT - (s.gateAvail - PEN.cutIn)) < 1e-9, 'withTime=false nem apasztja az órát');
  // és az óra timeout-olhat a büntetésből
  const t = new Scoring();
  t.gateT = 1;
  t.penalty(true);
  assert.equal(t.timedOut, true);
  assert.equal(t.gateT, 0);
});

test('signalChange: szabályos + pont, szabálytalan –pont és időbüntetés', () => {
  const s = new Scoring();
  s.signalChange(true);
  assert.equal(s.score, SIGNAL.points);
  assert.equal(s.parts.signalsOK, 1);
  assert.equal(s.parts.noSignalCount, 0);

  const s2 = new Scoring();
  s2.signalChange(false);
  assert.equal(s2.score, -SIGNAL.noSignalPenalty);
  assert.equal(s2.parts.noSignalCount, 1);
  assert.ok(Math.abs(s2.gateT - (s2.gateAvail - PEN.noSignal)) < 1e-9);
});

test('breakdown: 8 sor, negatív tételek a büntetések', () => {
  const s = new Scoring();
  s.overtake();
  s.penalty();
  s.crash();
  s.signalChange(false);
  const rows = s.breakdown();
  assert.equal(rows.length, 8);
  const find = (name) => rows.find(([n]) => n.startsWith(name));
  assert.equal(find('Szabályos előzés')[2], '1 alkalom');
  assert.equal(find('Index nélküli sávváltás')[1], -SIGNAL.noSignalPenalty);
  assert.ok(find('Bevágás')[1] < 0);
  assert.ok(find('Baleseti levonás')[1] < 0);
});
