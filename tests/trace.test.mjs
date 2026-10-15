import test from 'node:test';
import assert from 'node:assert/strict';
import { TraceRecorder } from '../src/sim/trace.js';
import { SimEngine } from '../src/sim/engine.js';
import { rightLaneAgent } from '../src/sim/agents.js';

test('TraceRecorder: az eseményeket a rögzítés pillanatában mélymásolja', () => {
  const e = new SimEngine({ seed: 1 });
  const rec = new TraceRecorder(e);
  const car = { lane: 1, z: 100 };
  e.emit({ kind: 'overtake', car });
  car.z = 9999; // utólagos módosítás nem szivároghat a naplóba
  assert.equal(rec.events[0].car.z, 100);
  assert.notEqual(rec.events[0].car, car);
  assert.equal(rec.events[0].t, 0, 'az emit t-időbélyeget ad');
});

test('TraceRecorder: run() tickel, mintáz, és timeoutnál áll le', () => {
  const e = new SimEngine({ seed: 42 });
  const rec = new TraceRecorder(e);
  rec.run(rightLaneAgent, 5);
  assert.ok(e.t > 0 && e.t <= 5.0001);
  assert.ok(rec.samples.length >= 4, `${rec.samples.length} minta 5 mp alatt`);
  const s = rec.samples[0];
  assert.deepEqual(
    Object.keys(s).sort(),
    ['cars', 'energy', 'gateFrac', 'gates', 'gateT', 'kmh', 'lane', 'score', 't', 'x', 'z'].sort(),
  );
  // a 'start' a konstruktorban jött, a rögzítő csak az utána következőket látja
  assert.ok(!rec.events.some((x) => x.kind === 'start'));
  for (const sm of rec.samples) {
    assert.ok(sm.lane >= 0 && sm.lane <= 2);
    assert.ok(sm.kmh >= 0 && sm.kmh <= 200);
  }
});

test('TraceRecorder: ended() reagál a timeout/gameOver eseményekre', () => {
  const e = new SimEngine({ seed: 3 });
  const rec = new TraceRecorder(e);
  e.emit({ kind: 'timeout', score: 1 });
  assert.equal(rec.ended(), true);
  const e2 = new SimEngine({ seed: 3 });
  const rec2 = new TraceRecorder(e2);
  e2.emit({ kind: 'gameOver', reason: 'crash' });
  assert.equal(rec2.ended(), true);
});

test('TraceRecorder: eventsByKind és summary() statisztikák', () => {
  const e = new SimEngine({ seed: 7 });
  const rec = new TraceRecorder(e);
  e.emit({ kind: 'wrap', delta: 2400 });
  e.emit({ kind: 'wrap', delta: 2400 });
  e.emit({ kind: 'overtake', car: {} });
  assert.equal(rec.eventsByKind('wrap').length, 2);
  const s = rec.summary();
  assert.equal(s.wraps, 2);
  assert.equal(s.overtakes, 1);
  assert.equal(s.penalties, 0);
  assert.ok(Number.isFinite(s.score) && s.score >= 0);
  assert.equal(typeof s.t, 'number');
  assert.equal(s.lives, 3);
});

test('TraceRecorder: toJSON teljes szerkezete', () => {
  const e = new SimEngine({ seed: 11 });
  const rec = new TraceRecorder(e);
  rec.run(null, 0.2);
  const j = rec.toJSON();
  assert.deepEqual(Object.keys(j), ['meta', 'events', 'samples', 'summary']);
  assert.equal(j.meta.seed, 11);
  assert.equal(j.meta.dt, 1 / 60);
  assert.equal(j.summary.end, 'futás vége');
});

test('TraceRecorder: readable() minden eseményfajtát megjelenít', () => {
  const e = new SimEngine({ seed: 2 });
  const rec = new TraceRecorder(e);
  e.emit({ kind: 'start' });
  e.emit({ kind: 'laneChange', from: 2, to: 1, dir: -1, led: true });
  e.emit({ kind: 'laneChange', from: 1, to: 2, dir: 1, led: false });
  e.emit({ kind: 'overtake', car: { lane: 0 } });
  e.emit({ kind: 'penalty', selfDidIt: true, car: { lane: 0 } });
  e.emit({ kind: 'passed', text: 'x' });
  e.emit({ kind: 'laneBlocked', from: 2, to: 1, dir: -1 });
  e.emit({ kind: 'crash', car: { lane: 1 }, approach: 5, lives: 2 });
  e.emit({ kind: 'gate', bonus: 42, gates: 1 });
  e.emit({ kind: 'wrap', delta: 2400, distInvariant: 0 });
  e.emit({ kind: 'gameOver', reason: 'crash' });
  const txt = rec.readable();
  for (const needle of ['INDULÁS', 'SÁVVÁLTÁS 2→1', 'INDEXELVE', 'index NÉLKÜL',
    '+30 ELŐZÉS', 'JOBBRÓL-ELŐZÉS', 'megelőztek', 'SÁV FOGLALT', 'BALESET',
    'KAPU ✓ #1', 'WRAP δ=2400m', 'JÁTÉK VÉGE', 'ÖSSZEFOGLALÓ']) {
    assert.ok(txt.includes(needle), `hiányzik: ${needle}`);
  }
});

test('TraceRecorder: ismeretlen eseményfajta is megjelenik (default ág)', () => {
  const e = new SimEngine({ seed: 2 });
  const rec = new TraceRecorder(e);
  e.emit({ kind: 'ismeretlen', a: 1 });
  assert.ok(rec.readable().includes('ismeretlen'));
});
