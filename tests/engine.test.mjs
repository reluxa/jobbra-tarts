import test from 'node:test';
import assert from 'node:assert/strict';
import { SimEngine } from '../src/sim/engine.js';
import { CAR, DRIVE, SCORE, SIGNAL, TRAFFIC, WORLD, BARRIER_X, laneCenterX } from '../src/constants.js';

const fresh = () => new SimEngine({ seed: 42 });

// ---- reset / alap ----
test('reset: indító állapot + start esemény', () => {
  const e = fresh();
  assert.equal(e.lives, 3);
  assert.equal(e.crashCount, 0);
  assert.equal(e.cars.length, 0);
  assert.equal(e.time, 0);
  assert.equal(e.dist, 0);
  assert.equal(e.player.laneIndex(), 2);
  assert.equal(e.prevLane, 2);
});

test('emit: t-időbélyeg és hook', () => {
  const e = fresh();
  const got = [];
  e.onEvent = (ev) => got.push(ev);
  e.t = 7;
  e.emit({ kind: 'crash' });
  assert.equal(got.length, 1);
  assert.equal(got[0].t, 7);
});

test('difficulty: a távval 2400 m-ig nő, majd 1-re telít', () => {
  const e = fresh();
  assert.equal(e.difficulty(), 0);
  e.dist = 1200;
  assert.equal(e.difficulty(), 0.5);
  e.dist = 10000;
  assert.equal(e.difficulty(), 1);
});

// ---- játékos-lépés ----
test('playerStep: gyorsulás az utazósebességig, z integráció', () => {
  const e = fresh();
  e.player.speed = 0;
  for (let i = 0; i < 600; i++) e.playerStep(1 / 60);
  assert.ok(e.player.speed > DRIVE.cruise * 0.99, `v=${e.player.speed}`);
  assert.ok(e.player.speed <= CAR.maxSpeed);
  assert.equal(e.player.y, CAR.restY);
  assert.equal(e.player.steer, 0);
  assert.equal(e.player.yaw, 0);
  assert.equal(e.player.fwdSpeed, e.player.speed);
  // egyetlen lépés integrációja: z nő v·dt-vel
  const z0 = e.player.z;
  e.playerStep(1 / 60);
  assert.ok(Math.abs((e.player.z - z0) - e.player.speed / 60) < 1e-6, 'z += v·dt');
});

test('playerStep: a radar-cél sebesség fölé nem gyorsul', () => {
  const e = fresh();
  const p = e.player;
  p.speed = 20;
  p.radarTarget = 10;
  for (let i = 0; i < 200; i++) e.playerStep(1 / 60);
  assert.ok(p.speed <= 10.01, `fékezés a cél alá: v=${p.speed}`);
  assert.ok(p.speed > 9, 'a tempó alá nem esünk vissza feleslegesen');
});

test('playerStep: invincible alatt fél tempóval halad', () => {
  const e = fresh();
  const p = e.player;
  p.invincible = 2;
  p.radarTarget = 600;
  for (let i = 0; i < 600; i++) e.playerStep(1 / 60);
  const cruiseHalf = DRIVE.cruise * 0.55;
  assert.ok(p.speed <= cruiseHalf + 0.5, `v=${p.speed} ≤ ${cruiseHalf}`);
});

test('playerStep: sávváltás smoothstep-tween a cél közepére, yaw visszaáll', () => {
  const e = fresh();
  const p = e.player;
  p.requestLaneChange(-1); // 2 → 1
  let mid = null;
  for (let i = 0; i < 90; i++) {
    e.playerStep(1 / 60);
    if (i === 45) mid = p.x;
  }
  assert.equal(p.x, laneCenterX(1), 'a tween a cél-sáv közepén landol');
  assert.equal(p.laneChange, null);
  assert.equal(p.yaw, 0);
  assert.ok(laneCenterX(2) < mid && mid < laneCenterX(1), 'a tween valóban átlépett középen');
});

test('playerStep: a tween közben a kormány/fej befordul', () => {
  const e = fresh();
  const p = e.player;
  p.requestLaneChange(-1);
  e.playerStep(1 / 60);
  assert.ok(p.steer !== 0 || p.yaw !== 0, 'a váltás közben van befordulás');
});

test('playerStep: a korlátnál nem megyünk az út szélére', () => {
  const e = fresh();
  const limitX = BARRIER_X - 1.6;
  e.player.x = limitX + 50;
  e.player.speed = 30;
  e.playerStep(1 / 60);
  assert.ok(Math.abs(e.player.x) <= limitX + 1e-9);
  assert.ok(e.player.speed < 30, 'a korlát-érintés lassít');
});

test('playerStep: az index auto-off a SIGNAL.autoOff után kikapcsol', () => {
  const e = fresh();
  const p = e.player;
  p.signal = -1;
  p.signalT = 0;
  for (let i = 0; i < Math.ceil(SIGNAL.autoOff * 60) + 5; i++) e.playerStep(1 / 60);
  assert.equal(p.signal, 0);
  assert.ok(p.signalT >= SIGNAL.autoOff);
  assert.ok(p.blinkPhase >= 0 && p.blinkPhase < 1);
});

// ---- forgalom ----
test('aheadInLane: a legközelebbi azonos sávú autó, ghost kizárva, maxDist', () => {
  const e = fresh();
  e.addObstacle(0, 50, 1);
  e.addObstacle(0, 30, 1);
  e.addObstacle(0, 500, 1); // maxDist-en kívül
  e.addObstacle(0, 40, 0);  // másik sáv
  const a = e.aheadInLane(1, 0, 140);
  assert.ok(a);
  assert.equal(a.gap, 30, 'a legközelebbi elöl lévő');
  assert.equal(e.aheadInLane(1, 0, 25), null, 'maxDist-en kívüli nem jön');
  e.cars[1].ghost = true;
  assert.equal(e.aheadInLane(1, 0, 140).gap, 50, 'ghost nem blokkol');
});

test('canChangeTo: foglalt sáv az [−changeBehind, +changeAhead] ablakban, x-tűrés 2.3', () => {
  const e = fresh();
  assert.equal(e.canChangeTo(1, 0), true);
  e.addObstacle(0, TRAFFIC.changeAhead * 0.5, 1); // ablakon belül elől — blokkol
  assert.equal(e.canChangeTo(1, 0), false);
  e.cars[0].z = -TRAFFIC.changeBehind * 0.5;      // ablakon belül mögött — blokkol
  assert.equal(e.canChangeTo(1, 0), false);
  e.cars[0].z = -(TRAFFIC.changeBehind + 2);      // az ablakon kívül mögött — szabad
  assert.equal(e.canChangeTo(1, 0), true);
  e.cars[0].z = TRAFFIC.changeAhead + 2;          // az ablakon kívül elől — szabad
  assert.equal(e.canChangeTo(1, 0), true);
  e.cars[0].x = laneCenterX(2); // a cél-sáv középpontjától > 2.3 m-re — nem számít
  e.cars[0].z = 5;
  assert.equal(e.canChangeTo(1, 0), true);
});

test('playerChangeLane: ok/edge/busy/blocked eredmények', () => {
  const e = fresh();
  assert.equal(e.playerChangeLane(-1), 'ok');
  assert.equal(e.playerChangeLane(-1), 'busy', 'már váltunk');
  e.player.laneChange = null;
  e.player.x = laneCenterX(0);
  assert.equal(e.playerChangeLane(-1), 'edge', 'a bal szélen balra nem megy');
  const events = [];
  e.onEvent = (ev) => events.push(ev);
  e.cars = [];
  e.addObstacle(0, TRAFFIC.changeAhead * 0.5, 1); // a blokkolási ablakon belül elől
  e.player.x = laneCenterX(2);
  assert.equal(e.playerChangeLane(-1), 'blocked');
  assert.equal(events[0].kind, 'laneBlocked');
  assert.equal(events[0].to, 1);
});

test('spawn: minGap-elutasítás azonos sávban, távoli autó nem akadály', () => {
  const e = new SimEngine({ seed: 1 });
  e.rng = () => 0.5; // determinisztikus: z = 95 + 0.5·75 = 132.5
  e.addObstacle(0, 100, 1); // |100 − 132.5| = 32.5 < 55 → elutasítás
  const before = e.cars.length;
  e.spawn(0, 0, 0, 1);
  assert.equal(e.cars.length, before, 'a közeli azonos sávú autó elutasítja');
  e.cars.pop();
  e.addObstacle(0, 200, 1); // > 55 m-rel elöl → szabad
  e.spawn(0, 0, 0, 1);
  assert.equal(e.cars.length, 2);
  const c = e.cars[1];
  assert.equal(c.lane, 1);
  assert.equal(c.baseSpeed, c.speed);
});

test('spawn: near>0 közvetlen elhelyezés minGap-ellenőrzés nélkül', () => {
  const e = fresh();
  const b = e.cars.length;
  e.spawn(0, 0, 25, 1);
  assert.equal(e.cars.length, b + 1);
  const c = e.cars[b];
  assert.ok(c.z >= 25 && c.z <= 25 + 45);
  assert.equal(c.lane, 1);
});

test('spawn: maxCars fölött nem nyit új autót', () => {
  const e = fresh();
  for (let i = 0; i < TRAFFIC.maxCars; i++) e.addObstacle(0, 100 + i * 20, 1);
  const before = e.cars.length;
  e.spawn(0, 0, 200, 1);
  e.spawnBehind(e.player);
  assert.equal(e.cars.length, before, 'mindkét spawn-ág visszautasít telítésnél');
  const r = e.pickLane();
  assert.ok(r >= 0 && r <= 2);
  const s = e.pickSpeed(2, true);
  assert.ok(s >= TRAFFIC.truckSpeed[0] && s <= TRAFFIC.truckSpeed[1]);
});

test('seedStartTraffic: 5 autó, elöl és hátul is (tükör-autó)', () => {
  const e = fresh();
  e.seedStartTraffic();
  assert.equal(e.cars.length, 5);
  assert.ok(e.cars.some((c) => c.z > e.player.z + 40), 'elöl is vannak autók');
  assert.ok(e.cars.some((c) => c.z < e.player.z), 'van hátulról közeledő');
});

test('spawnBehind: a belső sávból, gyorsan, hátulról', () => {
  const e = fresh();
  e.spawnBehind(e.player);
  const c = e.cars[0];
  assert.ok(c.z < 0);
  assert.equal(c.lane, 0);
  assert.ok(c.speed >= TRAFFIC.behindSpeed[0] && c.speed <= TRAFFIC.behindSpeed[1]);
});

test('frontInLane: a játékos is számít elöl-haladóként', () => {
  const e = fresh();
  e.player.x = laneCenterX(1);
  e.player.z = 100;
  e.player.speed = 30;
  e.player.fwdSpeed = 30;
  const f = e.frontInLane({ lane: 1, z: 50, speed: 30 });
  assert.ok(f);
  assert.equal(f.gap, 50);
  assert.equal(f.isPlayer, true);
});

function pushBaseCar(e, uid, over) {
  return e.cars[e.cars.push({ uid, lane: 1, x: 0, z: 0, speed: 30, truck: false, len: 4.35,
    passed: true, ghost: false, baseSpeed: 30, changeLane: null, aiT: 999999, ...over }) - 1];
}

test('trafficStep: konvoj-összetapadás (a hátsó az elülső tempóján marad)', () => {
  const e = fresh();
  e.player.z = -100; // távoli játékos
  e.player.speed = 30;
  e.player.fwdSpeed = 30;
  e.time = 100;
  e.spawnTimer = 1000; // ne zavarjon spawn
  const front = pushBaseCar(e, 101, { z: 40, speed: 30, baseSpeed: 30 });
  const rear = pushBaseCar(e, 102, { z: 30, speed: 35, baseSpeed: 35 });
  for (let i = 0; i < 20; i++) e.trafficStep(0.1);
  assert.ok(rear.speed <= front.speed + 0.5, `a hátsó nem hagyja el: ${rear.speed} vs ${front.speed}`);
  assert.ok(rear.speed < 32, 'a hátsó lényegesen a saját baseSpeed-je alá fékez');
});

test('trafficStep: lemaradó/távoli autók törlődnek, a ghostok soha', () => {
  const e = fresh();
  e.player.speed = 30;
  e.player.fwdSpeed = 30;
  pushBaseCar(e, 201, { z: 500, speed: 30 });
  pushBaseCar(e, 202, { z: -80, speed: 20, baseSpeed: 20 }); // 1 s alatt 60 m-re jut
  pushBaseCar(e, 203, { z: -600, speed: 20, baseSpeed: 20, ghost: true });
  e.time = 0;
  e.spawnTimer = 1000;
  e.trafficStep(1.0);
  assert.ok(!e.cars.some((c) => c.uid === 201), 'távoli elöl törlődik');
  assert.ok(!e.cars.some((c) => c.uid === 202), 'lassú lemaradó törlődik');
  assert.ok(e.cars.some((c) => c.uid === 203), 'ghost marad (a paritás-tükör!)');
});

test('trafficStep: lejárt spawnTimer újratelepít; fékezett autó visszatér a baseSpeed-hez', () => {
  const e = fresh();
  e.player.z = 0;
  e.time = 1000;
  e.spawnTimer = 0.01;
  const before = e.cars.length;
  e.trafficStep(1.0);
  assert.equal(e.cars.length, before + 1, 'a lejárt timer új autót szül');

  // a fékezett autó (20) visszagyorsul a base-jére (30), amíg nincs elöl lassabb
  // (külön sávban, a játékostól távol: a fékező/figyelmeztető szabályok nem avatkoznak)
  const c = pushBaseCar(e, 301, { lane: 1, x: laneCenterX(1), z: -250, speed: 20, baseSpeed: 30 });
  e.player.z = 0;          // a játékos messze elöl, másik sávban
  e.player.fwdSpeed = 18;  // lassabb a 20-nál → nem üti ki a "lassú lemaradó" szabály
  e.spawnTimer = 1000;
  for (let i = 0; i < 10; i++) e.trafficStep(1.0);
  assert.equal(c.speed, 30, 'a fékek nélküli autó visszatér a baseSpeed-hez');
});

test('npcAI: lassú elöl → jobbra húz, foglalt jobb sávban marad', () => {
  // a blokkolt NPC-ász a L+1 (jobbra) irányban keres menekülést; a jobb sáv foglalt
  // => várakozik, és a returnLane-szabállyal térhet vissza balra
  const e = fresh();
  e.cars = [];
  const fast = pushBaseCar(e, 301, { lane: 1, x: laneCenterX(1), z: 20, speed: 30, baseSpeed: 30, aiT: 0 });
  pushBaseCar(e, 302, { lane: 1, x: laneCenterX(1), z: 30, speed: 15, baseSpeed: 15, aiT: 0 });
  e.player.z = -300;
  e.npcAI(0.1);
  assert.equal(fast.changeLane, 2, 'a lassabb elvágja → jobbra húz');
  assert.equal(fast.lane, 1, 'a saját sávja még a középső');

  // foglalt jobb sáv esetén nem mozdul
  const e2 = fresh();
  e2.cars = [];
  const fast2 = pushBaseCar(e2, 311, { lane: 1, x: laneCenterX(1), z: 20, speed: 30, baseSpeed: 30, aiT: 0 });
  pushBaseCar(e2, 312, { lane: 1, x: laneCenterX(1), z: 30, speed: 15, baseSpeed: 15, aiT: 0 });
  pushBaseCar(e2, 313, { lane: 2, x: laneCenterX(2), z: 22, speed: 30, baseSpeed: 30, aiT: 0 });
  e2.player.z = -300;
  e2.npcAI(0.1);
  assert.equal(fast2.changeLane, null, 'foglalt cél-sáv: nem húz ki');
});

test('npcAI: felszabadult út után a returnLane felé tér vissza balra', () => {
  const e = fresh();
  e.cars = [];
  const c = pushBaseCar(e, 321, { lane: 1, x: laneCenterX(1), z: 20, speed: 30, baseSpeed: 30, aiT: 0 });
  // a jobb (L+1) sávba húz, amikor elöl lassú van
  pushBaseCar(e, 322, { lane: 1, x: laneCenterX(1), z: 30, speed: 15, baseSpeed: 15, aiT: 0 });
  e.player.z = -300;
  e.npcAI(0.1);
  assert.equal(c.changeLane, 2);
  assert.deepEqual(c.returnLane, 1);
  assert.ok(c.returnT !== undefined && c.returnT > 0 && c.returnT <= 10);
  // a visszatérési logika a laneClear(L-1) mellett balra megy
  c.changeLane = null;
  c.lane = 2;
  c.x = laneCenterX(2);
  c.returnLane = 1;
  c.returnT = 0;
  c.aiT = 0;
  e.cars = [c]; // az akadály már nincs pályán
  e.npcAI(0.1);
  assert.equal(c.changeLane, 1, 'felszabadult út → visszatér a returnLane-be');
});

test('advanceLaneChange: folyamatos x-átmozgás és befejezés', () => {
  const e = fresh();
  const c = { uid: 9, lane: 2, x: laneCenterX(2), changeLane: 1, truck: false, len: 4.35 };
  e.player.z = -1000;
  for (let i = 0; i < 2000 && c.changeLane !== null; i++) e.advanceLaneChange(c, 1 / 60);
  assert.equal(c.changeLane, null);
  assert.equal(c.lane, 1);
  assert.equal(c.x, laneCenterX(1));
});

// ---- előzés-értékelés ----
test('evalPass: szabályos balról-előzés + pontok', () => {
  const e = fresh();
  e.player.x = laneCenterX(1);
  e.player.fwdSpeed = 30;
  const evs = [];
  e.onEvent = (ev) => evs.push(ev);
  e.evalPass({ lane: 2, speed: 20 });
  assert.equal(e.scoring.parts.overtakes, 1);
  assert.equal(e.scoring.parts.overtake, SCORE.overtake);
  assert.equal(evs[0].kind, 'overtake');
});

test('evalPass: balról megelőztek minket (rendben, semmi pont)', () => {
  const e = fresh();
  e.player.x = laneCenterX(1);
  e.player.fwdSpeed = 20;
  const evs = [];
  e.onEvent = (ev) => evs.push(ev);
  e.evalPass({ lane: 2, speed: 30 }); // jobb sávú, gyorsabb → átmennek rajtunk
  assert.equal(evs.length, 1);
  assert.equal(evs[0].kind, 'passed');
  assert.equal(e.scoring.parts.overtakes, 0);
});

test('evalPass: jobbról-előzés büntetés (és időfogyás)', () => {
  const e = fresh();
  e.player.x = laneCenterX(2); // játékos a JOBB sávban
  e.player.fwdSpeed = 30;
  const gateT = e.scoring.gateT;
  const evs = [];
  e.onEvent = (ev) => evs.push(ev);
  e.evalPass({ lane: 1, speed: 15 }); // a középső sávban lassúbb autót jobbról megelőztük
  assert.equal(evs[0].kind, 'penalty');
  assert.ok(evs[0].selfDidIt);
  assert.ok(e.scoring.gateT < gateT, 'a bevágás az órát is apasztja');
});

test('evalPass: azonos sáv / invincible nem pontoz', () => {
  const e = fresh();
  e.player.x = laneCenterX(1);
  e.player.invincible = 2;
  e.evalPass({ lane: 2, speed: 1 });
  assert.equal(e.scoring.parts.overtakes, 0);
  e.player.invincible = 0;
  e.evalPass({ lane: 1, speed: 20 });
  assert.equal(e.scoring.parts.overtakes, 0, 'azonos sáv nem előzés');
});

// ---- ütközés ----
test('checkCollisions: azonos tempóval nem baleset (enyhe súrlódás)', () => {
  const e = fresh();
  e.player.x = laneCenterX(2);
  e.player.z = 0;
  e.player.fwdSpeed = 30;
  e.addObstacle(0, 4, 2);
  e.cars[0].speed = 30; // nincs zárósebesség-különbség
  e.checkCollisions();
  assert.equal(e.lives, 3, 'nincs baleset');
});

test('checkCollisions: gyors közeledés → baleset + invincibility', () => {
  const e = fresh();
  e.player.x = laneCenterX(2);
  e.player.z = 0;
  e.player.fwdSpeed = 30;
  const spy = [];
  e.onEvent = (ev) => spy.push(ev);
  e.addObstacle(0, 3.5, 2);
  e.checkCollisions();
  assert.equal(e.lives, 2);
  assert.equal(e.crashCount, 1);
  assert.ok(e.scoring.score < 0, 'a baleset pontot von');
  assert.ok(e.player.invincible > 2.4, 'invincibility-ablak nyílik');
  assert.ok(e.player.speed <= 4.5, 'nagy sebesség-levonás (approach·0.85)');
  assert.equal(spy[0].kind, 'crash');
  assert.equal(spy[0].lives, 2);
  const lives2 = e.lives;
  e.checkCollisions();
  assert.equal(e.lives, lives2, 'invincible alatt nincs újabb baleset');
});

test('checkCollisions: a zónán kívül (z vagy x) nincs ütközés', () => {
  const e = fresh();
  e.player.x = laneCenterX(2);
  e.player.z = 0;
  e.player.fwdSpeed = 40;
  e.addObstacle(0, 10, 2);  // z-távolság túl nagy
  e.checkCollisions();
  assert.equal(e.lives, 3);
  e.cars.pop();
  e.addObstacle(0, 2, 1);   // másik sáv
  e.checkCollisions();
  assert.equal(e.lives, 3);
});

test('gameOver: az utolsó élet is megy → lives=99 (nem duplázódik)', () => {
  const e = fresh();
  e.lives = 1;
  e.player.invincible = 0;
  e.player.x = laneCenterX(2);
  e.player.z = 0;
  e.player.speed = 30; // a tick a speed-ből számol fwdSpeed-et
  e.player.fwdSpeed = 30;
  const spy = [];
  e.onEvent = (ev) => spy.push(ev);
  e.addObstacle(0, 3, 2);
  e.tick(1 / 60);
  assert.equal(e.lives, 99);
  assert.ok(spy.some((ev) => ev.kind === 'gameOver' && ev.reason === 'crash'));
});

// ---- scoringStep / wrap ----
test('scoringStep: kapu-átlépés esemény és timeout-esemény', () => {
  const e = fresh();
  e.player.speed = 20;
  e.player.fwdSpeed = 20;
  const spy = [];
  e.onEvent = (ev) => spy.push(ev);
  for (let i = 0; i < Math.ceil(SCORE.gateDist / 20) + 5; i++) e.scoringStep(1);
  assert.ok(spy.some((ev) => ev.kind === 'gate' && ev.gates === 1), 'kapu-esemény jött');
  e.scoring.gateT = 0.01;
  e.scoringStep(0.1);
  assert.ok(spy.some((ev) => ev.kind === 'timeout'));
  assert.equal(e.timeoutDone, true);
  const before = spy.length;
  e.scoringStep(0.1);
  assert.equal(spy.length, before, 'a timeout csak egyszer jön');
});

test('wrapStep: tile-többszörös delta, relatív pozíciók megmaradnak, invariáns 0', () => {
  const e = fresh();
  e.player.z = WORLD.wrapAt + 3;
  e.addObstacle(0, 400, 1);
  const carZ = e.cars[0].z;
  const dzBefore = carZ - e.player.z;
  const spy = [];
  e.onEvent = (ev) => spy.push(ev);
  e.wrapStep();
  assert.ok(e.player.z < WORLD.wrapAt);
  assert.equal((400 + 3 - e.player.z) % WORLD.tile, 0, 'a delta a tile többszöröse');
  // a player.től való relatív távolságok VÁLTOZATLANOK (a wrap nem húzza szét a forgalmat)
  assert.equal(e.cars[0].z - e.player.z, dzBefore);
  assert.equal(spy[0].kind, 'wrap');
  assert.equal(spy[0].distInvariant, 0);
});

test('wrapStep: wrapAt alatt nem tekercsel', () => {
  const e = fresh();
  e.player.z = WORLD.wrapAt - 1;
  const spy = [];
  e.onEvent = (ev) => spy.push(ev);
  e.wrapStep();
  assert.equal(spy.length, 0);
});

// ---- tick integráció ----
test('tick: t/dist/radar/forgalom/értékelés egy lépésben', () => {
  const e = fresh();
  e.onEvent = () => {};
  const p = e.player;
  p.speed = 20;
  p.fwdSpeed = 20;
  e.addObstacle(0, 10, 2);
  e.cars[0].speed = 10;
  e.cars[0].baseSpeed = 10; // a trafficStep ne húzza vissza 0-ra
  e.tick(1 / 60);
  assert.equal(e.t, 1 / 60);
  assert.ok(e.dist > 0);
  assert.equal(p.radarOn, true, '10 m rés → radar be');
  assert.equal(p.radarTarget, 10);
  assert.equal(e.cars[0].speed, 10, 'az addObstacle akadály áll');
});

test('tick: indexelt sávváltás → led laneChange esemény, index kikapcsol', () => {
  const e = fresh();
  const p = e.player;
  const spy = [];
  e.onEvent = (ev) => spy.push(ev);
  // a tween már célba ért (a previous-lane eltérés a lényeg: a tick értékeli)
  p.laneChange = null;
  p.x = laneCenterX(1);
  p.signal = -1;
  p.signalT = 0.5; // minLead fölött
  e.tick(1 / 60);
  const lc = spy.find((ev) => ev.kind === 'laneChange');
  assert.ok(lc, 'laneChange esemény jött');
  assert.equal(lc.led, true);
  assert.equal(p.signal, 0, 'az index az indexelt váltás után kikapcsol');
});

test('tick: jelzés nélküli váltás → noSignal-büntetés és időfogyás', () => {
  const e = fresh();
  e.onEvent = () => {};
  const p = e.player;
  p.laneChange = null;
  p.x = laneCenterX(1);
  p.signal = 0;
  p.signalT = 0;
  const gateT0 = e.scoring.gateT;
  e.tick(1 / 60);
  assert.equal(e.scoring.parts.noSignalCount, 1);
  assert.ok(e.scoring.gateT < gateT0, 'index nélkül az óra is fogy');
  assert.ok(e.scoring.score < 0, 'és pontlevonás is jár');
});

test('tick: radar cé kikapcsol 42 m feletti távolságnál (hiszterézis)', () => {
  const e = fresh();
  e.onEvent = () => {};
  e.player.x = laneCenterX(2);
  e.player.fwdSpeed = 20;
  e.addObstacle(0, 50, 2); // távol → ki
  e.tick(1 / 60);
  assert.equal(e.player.radarOn, false);
  assert.equal(e.player.radarTarget, 600);
});

test('debug: a képsor-kép minden mezője', () => {
  const e = fresh();
  const d = e.debug();
  for (const k of ['lives', 'cars', 'score', 'gates', 'gateT', 'kmh', 'pos', 'yaw',
    'dist', 'crashCount', 'sig', 'lane', 'radar', 'sigOK', 'sigNo']) {
    assert.ok(k in d, `hiányzó mező: ${k}`);
  }
  assert.ok(Array.isArray(d.pos) && d.pos.length === 3);
  assert.equal(d.kmh, 0);
  assert.equal(d.lane, 2);
  assert.equal(e.debug().sigOK, 0);
  assert.equal(e.debug().sigNo, 0);
});

test('addObstacle/removeObstacle: álló akadály, uid-kezelés, idempotens törlés', () => {
  const e = fresh();
  const uid = e.addObstacle(0, 100, 1);
  const o = e.cars[0];
  assert.equal(o.uid, uid);
  assert.equal(o.speed, 0);
  assert.equal(o.baseSpeed, 0);
  assert.equal(o.passed, true);
  assert.equal(o.ghost, false);
  assert.equal(o.changeLane, null);
  assert.equal(o.aiT, Infinity);
  const n = e.cars.length;
  e.removeObstacle(uid);
  assert.equal(e.cars.length, n - 1);
  e.removeObstacle(uid); // nincs ilyen — nem dob
  assert.equal(e.cars.length, n - 1);
});

test('determinizmus: azonos seed ugyanazt a futást adja', () => {
  const a = new SimEngine({ seed: 4242 });
  const b = new SimEngine({ seed: 4242 });
  const eventsA = [], eventsB = [];
  a.onEvent = (ev) => eventsA.push(ev.kind + ev.t);
  b.onEvent = (ev) => eventsB.push(ev.kind + ev.t);
  for (let i = 0; i < 120; i++) { a.tick(1 / 60); b.tick(1 / 60); }
  assert.deepEqual(eventsA, eventsB);
  assert.deepEqual(a.debug(), b.debug());
});
