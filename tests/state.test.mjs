import test from 'node:test';
import assert from 'node:assert/strict';
import { SimPlayer, makeCar, setRadar } from '../src/sim/state.js';
import { DRIVE, LANE_W, SIGNAL } from '../src/constants.js';
import { mulberry32 } from '../src/sim/prng.js';

test('SimPlayer: alapértékek (jobb külső sáv, álló)', () => {
  const p = new SimPlayer();
  assert.equal(p.x, -LANE_W);
  assert.equal(p.laneIndex(), 2);
  assert.equal(p.speed, 0);
  assert.equal(p.z, 0);
  assert.equal(p.yaw, 0);
  assert.equal(p.cruise, DRIVE.cruise);
  assert.equal(p.signal, 0);
  assert.equal(p.radarTarget, 600);
  assert.equal(p.radarOn, false);
  assert.ok(p.invincible === 0);
});

test('SimPlayer.laneIndex: x-határok klampolása', () => {
  const p = new SimPlayer();
  p.x = 10000;
  assert.equal(p.laneIndex(), 0, 'belső szélen túl is 0');
  p.x = -10000;
  assert.equal(p.laneIndex(), 2, 'külső szélen túl is 2');
  p.x = 0;
  assert.equal(p.laneIndex(), 1);
});

test('SimPlayer.requestLaneChange: tween indul, a szélen nem megy, foglaltan nem megy', () => {
  const p = new SimPlayer();
  assert.equal(p.requestLaneChange(-1), true, 'jobbról balra mehet');
  assert.deepEqual(p.laneChange, { from: 2, to: 1, t: 0 });
  assert.equal(p.requestLaneChange(1), false, 'folyamatban lévő váltás közben nincs új');
  p.laneChange = null;
  p.x = 0; // középső sáv
  assert.equal(p.requestLaneChange(1), true, 'közép → jobb');
  p.laneChange = null;
  p.x = -LANE_W; // jobb szél
  assert.equal(p.requestLaneChange(1), false, 'a jobb szélen nincs tovább');
});

test('SimPlayer.toggleSignal: be/ki váltás és a timer nullázása', () => {
  const p = new SimPlayer();
  p.toggleSignal(-1);
  assert.equal(p.signal, -1);
  assert.equal(p.signalT, 0);
  p.signalT = 1.5; // auto-off előtt
  p.toggleSignal(-1);
  assert.equal(p.signal, 0, 'ugyanaz a dir kikapcsol');
  assert.equal(p.signalT, 0);
  p.toggleSignal(1);
  assert.equal(p.signal, 1, 'másik dir azonnal átvált');
});

test('SimPlayer: signalAct/signalOn és villogás', () => {
  const p = new SimPlayer();
  assert.equal(p.signalAct(), false);
  assert.equal(p.signalOn(), false);
  p.signal = 1;
  assert.equal(p.signalAct(), true);
  assert.equal(p.signalOn(), true, 'blinkPhase=0 → be');
  p.blinkPhase = 0.7;
  assert.equal(p.signalOn(), false, 'blinkPhase≥0.5 → ki');
  assert.equal(p.blinkPhase, 0.7);
});

test('setRadar: hiszterézis 22/42 m-rel (nincs oszcilláció)', () => {
  const p = new SimPlayer();
  setRadar(p, Infinity, 600);
  assert.equal(p.radarOn, false);
  assert.equal(p.radarTarget, 600);

  setRadar(p, 20, 25);
  assert.equal(p.radarOn, true, '22 alatt BE');
  assert.equal(p.radarTarget, 25);
  setRadar(p, 30, 25);
  assert.equal(p.radarOn, true, '22–42 között MÉG be (hiszterézis)');
  setRadar(p, 42, 25);
  assert.equal(p.radarOn, true, 'épp 42-nél még be');
  setRadar(p, 43, 25);
  assert.equal(p.radarOn, false, '42 felett KI');
  setRadar(p, 50, 25);
  assert.equal(p.radarTarget, 600);

  setRadar(p, 20, 0); // a határ alatt, álló akadály
  assert.equal(p.radarTarget, 1, '0 tempó → 1-re klampolva');
});

test('makeCar: alak, determinizmus, kamion-méret', () => {
  const rng = mulberry32(7);
  const a = makeCar(1, false, 30, 100, rng);
  const rng2 = mulberry32(7);
  const b = makeCar(1, false, 30, 100, rng2);
  assert.deepEqual(a, b, 'azonos rng → azonos autó');
  assert.equal(a.uid, b.uid);
  assert.ok(a.uid >= 0 && Number.isInteger(a.uid));
  assert.equal(a.x, 0);
  assert.equal(a.z, 100);
  assert.equal(a.baseSpeed, 30);
  assert.equal(a.passed, false);
  assert.equal(a.ghost, false);
  assert.equal(a.len, 4.35);
  assert.equal(makeCar(2, true, 26, 0, rng).len, 6.4, 'kamion hosszabb');
  assert.ok(a.aiT >= 0 && a.aiT < 2);
  assert.equal(a.changeLane, null);
});
