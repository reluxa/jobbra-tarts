import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { TrafficView } from '../src/traffic.js';

function sceneStub() {
  return { added: [], removed: [], add(...objs) { this.added.push(...objs); }, remove(o) { this.removed.push(o); } };
}

function car(uid, lane, truck, speed, z) {
  return { uid, lane, truck, len: truck ? 6.4 : 4.35, speed, x: lane === 0 ? 4.25 : lane === 1 ? 0 : -4.25, z };
}

test('TrafficView: először felépíti, aztán újrahasználja az azonos uid-eket, a többit törli', () => {
  const scene = sceneStub();
  const tv = new TrafficView(scene);
  const cars = [car(1, 2, false, 25, 100), car(2, 1, false, 30, 200)];
  tv.sync(cars);
  assert.equal(tv.views.size, 2);
  assert.deepEqual(scene.added, [...tv.views.values()], 'mindegyik a scene-be került');

  // 2. szinkron: az egyik autó eltűnt, van egy új; a meglévő azonos elemet használja
  const keep = tv.views.get(1);
  const gone = tv.views.get(2);
  tv.sync([car(1, 2, false, 25, 150), car(3, 0, true, 26, 300)]);
  assert.equal(tv.views.size, 2);
  assert.equal(tv.views.get(1), keep, 'újrahasználja a meglévő látványt');
  assert.deepEqual(scene.removed, [gone], 'a kivezetett autó törlődik a scene-ből');
  // pozíciók frissültek
  assert.equal(tv.views.get(1).position.z, 150);
  assert.equal(tv.views.get(1).position.x, -4.25, 'a sávhoz tartozó x');
});

test('TrafficView: clear() minden látványt kivesz', () => {
  const scene = sceneStub();
  const tv = new TrafficView(scene);
  tv.sync([car(1, 2, false, 25, 100)]);
  tv.clear();
  assert.equal(tv.views.size, 0);
  assert.equal(scene.removed.length, 1);
});

test('buildVisual: modell nélkül dobozos vészrajz — kocsi és kamion egyaránt', () => {
  const scene = sceneStub();
  const tv = new TrafficView(scene);
  const g1 = tv.buildVisual(2, false, 4.35, 25);
  assert.equal(g1.children.length, 3, 'kasztni + tető + hátsó lámpa');
  const g2 = tv.buildVisual(1, true, 6.4, 25);
  assert.ok(g2.children.length >= 3, 'fülke + pótkocsi + lámpa');
  // a hátsó lámpa mindkettőben végigfut a túlnyúló rész alatt
  const tail1 = g1.children[g1.children.length - 1];
  assert.equal(tail1.position.z, -4.35 / 2);
  const tail2 = g2.children[g2.children.length - 1];
  assert.equal(tail2.position.z, -6.4 / 2);
});

test('buildVisual: modelllel a modell klónja a talajra kerül', () => {
  const scene = sceneStub();
  const tv = new TrafficView(scene);
  const sedan = new THREE.Group();
  const truck = new THREE.Group();
  tv.setModels({ sedans: [sedan, sedan.clone()], truck });
  const g = tv.buildVisual(1, false, 4.35, 30);
  assert.ok(g.children[0] instanceof THREE.Group, 'a klón group a fában van');
  assert.equal(g.children[0].position.y, -0.6);
  assert.notEqual(g.children[0], sedan, 'klón, nem az eredeti');
  const t = tv.buildVisual(2, true, 6.4, 25);
  assert.ok(t.children[0] instanceof THREE.Group);
  assert.equal(t.children[0].position.y, -0.6);
});

test('buildVisual: szín-választék determinisztikus a Math.random mockkal', () => {
  const scene = sceneStub();
  const tv = new TrafficView(scene);
  const orig = Math.random;
  Math.random = () => 0.999; // a paletta utolsó eleme
  try {
    tv.buildVisual(2, false, 4.35, 25);
    const truckMesh = tv.buildVisual(1, true, 6.4, 25);
    const cab = truckMesh.children[0];
    assert.ok(cab.material.color, 'van színe');
  } finally {
    Math.random = orig;
  }
});
