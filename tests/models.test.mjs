import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { normalizeModel } from '../src/models.js';

function simpleScene(dims = [1, 2, 3], pos = [0, 0, 0]) {
  const g = new THREE.Group();
  const m = new THREE.Mesh(
    new THREE.BoxGeometry(...dims),
    new THREE.MeshStandardMaterial(),
  );
  m.position.set(...pos);
  g.add(m);
  return g;
}

test('normalizeModel: a modell a kívánt hosszra méreteződik, Z középen, alja a talajon', () => {
  const g = normalizeModel(simpleScene([1, 2, 3]), 4.3, false);
  const box = new THREE.Box3().setFromObject(g);
  const size = box.getSize(new THREE.Vector3());
  assert.ok(Math.abs(size.z - 4.3) < 1e-6, `z-hossz: ${size.z}`);
  // az alja a talajon: min.y == 0
  assert.ok(Math.abs(box.min.y) < 1e-6, `min.y: ${box.min.y}`);
  // vízszintesen középre húzott: |center.x|, |center.z| pici
  const center = box.getCenter(new THREE.Vector3());
  assert.ok(Math.abs(center.x) < 1e-6 && Math.abs(center.z) < 1e-6);
});

test('normalizeModel: flipYaw 180°-kal fordít', () => {
  const plain = normalizeModel(simpleScene([1.2, 1, 1]), 1, false);
  const flipped = normalizeModel(simpleScene([1.2, 1, 1]), 1, true);
  // a várható Y-forgás: 90° (x>z eset) + esetleg a flip 180°-a
  const base = Math.PI / 2;
  assert.ok(Math.abs(plain.rotation.y - base) < 1e-6, `alap: ${plain.rotation.y}`);
  assert.ok(Math.abs(flipped.rotation.y - (base + Math.PI)) < 1e-6, `flip: ${flipped.rotation.y}`);
});

test('normalizeModel: az X-elterülő modellt megforgatja (x>z eset)', () => {
  const wide = simpleScene([3, 1, 1]); // hosszabb az X-en
  const g = normalizeModel(wide, 4.35, false);
  const box = new THREE.Box3().setFromObject(g);
  const size = box.getSize(new THREE.Vector3());
  assert.ok(Math.abs(size.z - 4.35) < 1e-6, 'a hossz a Z-re kerül');
  assert.ok(size.x < 4.35);
});

test('normalizeModel: minden mesh cast+receive árnyékot kap', () => {
  const g = normalizeModel(simpleScene(), 4.3, false);
  let meshes = 0;
  g.traverse((o) => { if (o.isMesh) { meshes++; assert.equal(o.castShadow, true); assert.equal(o.receiveShadow, true); } });
  assert.equal(meshes, 1);
});
