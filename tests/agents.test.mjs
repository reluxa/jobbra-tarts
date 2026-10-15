import test from 'node:test';
import assert from 'node:assert/strict';
import { SimEngine } from '../src/sim/engine.js';
import { rightLaneAgent, overtakeAgent, messyAgent, signalAgent, recordedAgent, agentByName } from '../src/sim/agents.js';
import { laneCenterX } from '../src/constants.js';

function freshEngine() {
  return new SimEngine({ seed: 42 });
}

test('rightLaneAgent: jobb külső sávban nem avatkozik be', () => {
  const e = freshEngine();
  e.player.cruise = 36;
  e.player.speed = 36;
  e.spawn(e.player.z, 0, 50, 2); // előttünk, jobb sávban egy kamion-tempójú autó
  e.cars[0].speed = 36; // nem lassú (cruise-4 = 32 alatt lenne)
  const before = { x: e.player.x, signal: e.player.signal, lane: e.player.laneIndex() };
  rightLaneAgent.decide(e);
  assert.equal(e.player.laneIndex(), before.lane);
  assert.equal(e.player.signal, 0);
  assert.equal(e.player.laneChange, null);
});

test('rightLaneAgent: lassú jármű előtt balra indexelve előz', () => {
  const e = freshEngine();
  e.player.cruise = 36;
  e.player.x = laneCenterX(2);
  const slow = e.addObstacle(0, e.player.z + 30, 2);
  e.cars.find((c) => c.uid === slow).speed = 25; // lassú a saját (jobb) sávunkban
  e.cars.find((c) => c.uid === slow).baseSpeed = 25;
  rightLaneAgent.decide(e);
  assert.equal(e.player.signal, -1, 'előzéshez balra indexel');
  assert.ok(e.player.laneChange, 'átgurul a középső sávba');
  assert.equal(e.player.laneChange.from, 2);
  assert.equal(e.player.laneChange.to, 1);
});

test('rightLaneAgent: a jobb sávban közvetlenül balról lassú → balra mozdul (nem előz jobbról)', () => {
  const e = freshEngine();
  e.player.cruise = 36;
  const slow = e.addObstacle(0, e.player.z + 20, 1); // középső sávban lassú
  e.cars.find((c) => c.uid === slow).speed = 24;
  e.cars.find((c) => c.uid === slow).baseSpeed = 24;
  rightLaneAgent.decide(e);
  assert.ok(e.player.laneChange, 'balra mozdul el a forgalmas sávból');
});

test('rightLaneAgent: középső lassú NÉLKÜL visszatér jobbra', () => {
  const e = freshEngine();
  e.player.x = laneCenterX(1);
  e.player.cruise = 36;
  e.player.speed = 36;
  rightLaneAgent.decide(e);
  assert.equal(e.player.signal, 1, 'visszatéréshez jobbra indexel');
  assert.equal(e.player.laneChange.to, 2);
});

test('rightLaneAgent: hátulról közeledő autó miatt NEM tér vissza jobbra', () => {
  const e = freshEngine();
  e.player.x = laneCenterX(1);
  e.player.cruise = 36;
  const behind = e.addObstacle(0, e.player.z - 10, 0);
  e.cars.find((c) => c.uid === behind).speed = 40;
  rightLaneAgent.decide(e);
  assert.equal(e.player.laneChange, null, 'a jobbra-sorolás jobbról-előzés büntetést vonna maga után');
});

test('rightLaneAgent: folyamatban lévő váltás közben nem dönt', () => {
  const e = freshEngine();
  e.player.requestLaneChange(-1);
  const before = e.player.laneChange;
  rightLaneAgent.decide(e);
  assert.equal(e.player.laneChange, before);
});

test('overtakeAgent: lassú elöl balra, szabad út esetén vissza jobbra', () => {
  const e = freshEngine();
  e.player.x = laneCenterX(1);
  e.player.cruise = 36;
  const slow = e.addObstacle(0, e.player.z + 25, 1);
  e.cars.find((c) => c.uid === slow).speed = 20;
  e.cars.find((c) => c.uid === slow).baseSpeed = 20;
  overtakeAgent.decide(e);
  assert.equal(e.player.laneChange.to, 0, 'a középső sávba balra előz');

  // most nincs lassú elöl → vissza középre/jobbra
  const e2 = freshEngine();
  e2.player.x = laneCenterX(0);
  e2.player.cruise = 36;
  overtakeAgent.decide(e2);
  assert.equal(e2.player.laneChange.to, 1, 'üres út esetén jobbra húzódik');
  assert.equal(e2.player.signal, 1);
});

test('messyAgent: csak a 3.2 mp-es fázisablakban dönt, index nélkül, ciklikus iránnyal', () => {
  const e = freshEngine();
  // t=0: az 1. ablak — balra megy, index NINCS
  messyAgent.decide(e);
  assert.equal(e.player.laneChange.to, 1);
  assert.equal(e.player.signal, 0, 'a rendetlen agent nem indexel');

  // az ablakon kívül (pl. t=1) nem dönt
  e.player.laneChange = null;
  e.t = 1.0;
  messyAgent.decide(e);
  assert.equal(e.player.laneChange, null);

  // a 2. ablak t=3.2: irányváltás a másik oldalra
  e.t = 3.2;
  e.player.x = laneCenterX(1);
  messyAgent.decide(e);
  assert.equal(e.player.laneChange.to, 2, 'a ciklus második fázisa jobbra húz');
  assert.equal(e.player.signal, 0);
});

test('signalAgent: indexelve vált balra, majd 9 mp múlva indexelve vissza jobbra', () => {
  const e = freshEngine();
  e.t = 0;
  signalAgent.decide(e);
  assert.equal(e.player.signal, -1, '1. fázis: balra indexel');
  assert.equal(e.player.laneChange.to, 1);

  e.player.laneChange = null;
  e.player.x = laneCenterX(1);
  e.t = 9.0;
  signalAgent.decide(e);
  assert.equal(e.player.signal, 1, '2. fázis: jobbra indexel');
  assert.equal(e.player.laneChange.to, 2);
});

test('recordedAgent: az időzített lépések sorrendben futnak le, 0 = kihagyás', () => {
  const e = freshEngine();
  e.t = 0;
  e.player.x = laneCenterX(1);
  const agent = recordedAgent([[1.0, 2], [1.0, 1], [1.5, 0], [3.0, -1]]);
  agent.decide(e); // t=0: még semmi
  assert.equal(e.player.laneChange, null);
  assert.equal(e.player.signal, 0);

  e.t = 1.0;
  agent.decide(e);
  assert.equal(e.player.signal, 1, 'a ±2 indexelés bekapcsol');
  assert.equal(e.player.laneChange.to, 2, 'a ±1 sávváltás jobbra megy');

  e.player.laneChange = null;
  e.t = 3.0;
  agent.decide(e);
  assert.equal(e.player.laneChange.to, 0, 'a 3.0s-i időzítés balra vált (1 → 0)');
});

test('recordedAgent: a stream időrendezve fut (sorrend-érzéketlen bevitel)', () => {
  const e = freshEngine();
  e.t = 10;
  e.player.x = laneCenterX(1);
  const agent = recordedAgent([[10, 1], [0, -1]]); // fordított sorrendben adva meg
  agent.decide(e);
  assert.ok(e.player.laneChange, 'a lépések időrendben futnak le');
  assert.equal(e.player.laneChange.to, 0, 'az időben korábbi lépés érvényesül (a későbbi busy)');
});

test('agentByName: ismert nevek + ismeretlen dobás', () => {
  assert.equal(agentByName('right'), rightLaneAgent);
  assert.equal(agentByName('overtake'), overtakeAgent);
  assert.equal(agentByName('messy'), messyAgent);
  assert.equal(agentByName('signal'), signalAgent);
  assert.throws(() => agentByName('bogarász'), /ismeretlen agent/);
});
