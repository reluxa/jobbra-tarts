import test from 'node:test';
import assert from 'node:assert/strict';
import { LANE_W, WORLD, SCORE, DRIVE, TRAFFIC, SIGNAL, CAR, BARRIER_X, ROAD_HALF, SHOULDER, laneCenterX, reqAvg, laneRateByLane, PEN } from '../src/constants.js';

test('laneCenterX: sáv-középpontok szimmetrikusak, élesen széttartók', () => {
  assert.equal(laneCenterX(1), 0, 'közép sáv középen van');
  assert.equal(laneCenterX(0), LANE_W, 'belső sáv +X');
  assert.equal(laneCenterX(2), -LANE_W, 'külső sáv -X');
  const step = laneCenterX(0) - laneCenterX(1);
  assert.equal(step, LANE_W);
});

test('reqAvg: a kért átlag kapunként monoton nő', () => {
  const values = Array.from({ length: 20 }, (_, i) => reqAvg(i));
  for (let i = 1; i < values.length; i++) {
    assert.ok(values[i] > values[i - 1], `reqAvg(${i}) nő`);
  }
  assert.equal(reqAvg(0), SCORE.reqStart);
  assert.equal(reqAvg(1), SCORE.reqStart + SCORE.reqStep);
});

test('laneRateByLane: a külső sáv a leglassabb fogyás (nyerő), belső a leggyorsabb', () => {
  assert.ok(laneRateByLane[0] > laneRateByLane[1]);
  assert.ok(laneRateByLane[1] > laneRateByLane[2]);
  assert.equal(laneRateByLane[2], 1.0);
  assert.ok(laneRateByLane[0] >= 1);
});

test('world: a wrap távolság a tile egész többszöröse (zökkenőmentes textúra)', () => {
  const [wrapAt, wrapTo, tile] = [WORLD.wrapAt, WORLD.wrapTo, WORLD.tile];
  assert.equal((wrapAt - wrapTo) % tile, 0);
  assert.ok(wrapTo < 0 && wrapAt > 0);
  assert.ok(WORLD.length > wrapAt + 1000, 'a világ hosszabb a wrap-pontnál (a tükör-autóknak hely kell)');
});

test('world: az út geometriája konzisztens', () => {
  assert.equal(ROAD_HALF, LANE_W * 1.5);
  assert.ok(BARRIER_X > ROAD_HALF + SHOULDER, 'a korlát a leállósávon KÍVÜL van');
});

test('SCORE: a büntetés kisebb, mint az előzés bónusza, az időbüntetés pozitív', () => {
  assert.ok(SCORE.overtake > SCORE.rightPassPenalty);
  assert.ok(SCORE.lanePerSec[0] < 0 && SCORE.lanePerSec[1] === 0 && SCORE.lanePerSec[2] > 0,
    'belső sáv veszít, közép 0, külső nyer');
  assert.ok(PEN.noSignal > 0 && PEN.cutIn > 0);
  assert.ok(SCORE.gateDist > 0 && SCORE.gateBonus > 0);
});

test('TRAFFIC: a gyorshajtók a belső sávban, kamionok a jobb sávban', () => {
  assert.ok(TRAFFIC.speedByLane[0][0] >= TRAFFIC.speedByLane[1][0]);
  assert.ok(TRAFFIC.speedByLane[1][0] >= TRAFFIC.speedByLane[2][0]);
  assert.ok(TRAFFIC.behindSpeed[0] >= TRAFFIC.speedByLane[0][1], 'a tükör-utolérők gyorsabbak a belső sávnál');
  assert.ok(TRAFFIC.maxCars >= 4);
});

test('SIGNAL/DRIVE/CAR minimális invariánsai', () => {
  assert.ok(SIGNAL.autoOff > SIGNAL.minLead, 'az auto-off bőven a minLead után jön');
  assert.ok(DRIVE.laneChange > 0);
  assert.ok(DRIVE.cruiseMax > DRIVE.cruise);
  assert.ok(CAR.maxSpeed > DRIVE.cruiseMax, 'a végsebesség felette van az utazónak');
});
