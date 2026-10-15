import test from 'node:test';
import assert from 'node:assert/strict';
import { installDomStubs } from './helpers/dom-stubs.js';
import { World, posMod, hasTree, hasSign, treeOffset, roadOffset } from '../src/world.js';
import { BARRIER_X, ROAD_HALF, SHOULDER, WORLD } from '../src/constants.js';

const { document } = installDomStubs();

function sceneStub() {
  return { added: [], add(...objs) { this.added.push(...objs); } };
}

// ---- tisztán tesztelhető díszlet-matematika ----
test('posMod: negatív z-n is pozitív, [0, m) tartomány', () => {
  assert.equal(posMod(-1, 5), 4);
  assert.equal(posMod(-5, 5), 0);
  assert.equal(posMod(7, 5), 2);
  assert.equal(posMod(0, 11), 0);
  for (let n = -50; n < 50; n++) {
    const v = posMod(n, 9);
    assert.ok(v >= 0 && v < 9, `${n} → ${v}`);
  }
});

test('hasTree/hasSign: a 14 m-es rácsot ugyanúgy osztják el, mint a ciklusok', () => {
  const W_END = WORLD.start + WORLD.length;
  let nTree = 0, nSign = 0, nPost = 0;
  for (let z = WORLD.start; z < W_END; z += 14) {
    for (const side of [-1, 1]) {
      nPost += 2;
      if (hasTree(z, side)) nTree++;
      if (hasSign(z, side)) { nSign++; }
    }
  }
  assert.ok(nPost > 1000, `a teljes hosszon sűrű az oszlop-kihelyezés: ${nPost}`);
  assert.ok(nTree > 100 && nTree < nPost / 2, `fa-arány ~40%: ${nTree}`);
  assert.ok(nSign > 30, `táblák is vannak: ${nSign}`);
});

test('a fák soha nem érnek az útburkolatra vagy a leállósávra', () => {
  const W_END = WORLD.start + WORLD.length;
  const minClear = ROAD_HALF + SHOULDER + 2.4; // az út+leálló teljes szélén túl
  for (let z = WORLD.start; z < W_END; z += 14) {
    for (const side of [-1, 1]) {
      if (!hasTree(z, side)) continue;
      const x = side * (BARRIER_X + 2.5 + treeOffset(z));
      assert.ok(Math.abs(x) >= minClear, `z=${z} side=${side} fa x=${x} túl közel az úthoz`);
    }
  }
});

test('treeOffset: a 9-es periodus (a wrap-tile-hoz illeszkedik)', () => {
  for (const z of [0, 12, 24, 36, 48, 60, 72, 84, 96, 108]) {
    assert.ok(Number.isInteger(treeOffset(z)) && treeOffset(z) >= 0 && treeOffset(z) < 9, `z=${z}`);
  }
  assert.equal(treeOffset(0), 0);
  assert.equal(treeOffset(9), 0, '9 m periódus');
  // a teljes tekercselt hosszon (a wrap 12 m lépéskénk) az offset determinisztikus
  assert.equal(treeOffset(-49), treeOffset(9 * 100 - 49));
});

test('roadOffset: 12 m-es periódus, (-1, 0] tartomány, 0-nál 0', () => {
  assert.ok(Math.abs(roadOffset(0, 12)) < 1e-15);
  assert.ok(Math.abs(roadOffset(12, 12)) < 1e-15, '12 m = teljes periódus');
  assert.ok(Math.abs(roadOffset(13, 12) + 1 / 12) < 1e-12);
  assert.ok(Math.abs(roadOffset(25, 12) + 1 / 12) < 1e-12);
  for (let d = 0; d < 500; d += 3.7) {
    assert.ok(roadOffset(d, 12) > -1 && roadOffset(d, 12) <= 0, `d=${d}`);
    assert.ok(Math.abs(roadOffset(d, 12) - roadOffset(d + 12, 12)) < 1e-9, 'a 12 m periódus');
  }
});

// ---- a valódi World-konstrukció ----
test('World: felépül, a textúra/világítás/kapu a helyére kerül', () => {
  const scene = sceneStub();
  const w = new World(scene);
  assert.ok(w.roadTex, 'az aszfalt textúra létrejön');
  assert.equal(w.roadTex.repeat.y, WORLD.length / WORLD.tile);
  assert.ok(w.hemi && w.sun && w.shadowTarget, 'fények');
  assert.ok(w.gate, 'a kapu csoport');
  assert.ok(w.staticGroup, 'statikus csoport');

  const added = scene.added;
  assert.ok(added.includes(w.staticGroup));
  assert.ok(added.includes(w.gate));
  assert.ok(added.includes(w.hemi));
  assert.ok(added.includes(w.sun));

  // a 6 instanced díszlet-mesh a staticGroup-ban van
  const inst = w.staticGroup.children.filter((o) => o.isInstancedMesh);
  assert.equal(inst.length, 6, 'oszlopok + fehér oszlopok + fák + lombok + táblaposták + táblák');
  for (const m of inst) {
    assert.ok(m.count > 0, 'egyik sem üres');
    // three 0.169: a needsUpdate SETTER növeli a version-t (a feltöltés jele)
    assert.ok(m.instanceMatrix.version > 0, 'az instance-mátrix frissült (feltöltésre vár)');
  }
});

test('World: update() és positionGate() a látható elemeket mozgatja', () => {
  const w = new World(sceneStub());
  w.update(123);
  assert.ok(Math.abs(w.roadTex.offset.y - ((-123 / w.tileLen) % 1)) < 1e-12);
  w.update(null); // a 0 él is biztos
  assert.ok(Math.abs(w.roadTex.offset.y) < 1e-15);
  w.positionGate(400);
  assert.equal(w.gate.position.z, 400);
});

test('World: a korlát az út két szélén túl, szimmetrikusan', () => {
  const w = new World(sceneStub());
  const barriers = w.staticGroup.children.filter(
    (o) => o.geometry && o.position.x !== 0 && Math.abs(o.position.x) === BARRIER_X,
  );
  assert.equal(barriers.length, 2);
  const xs = barriers.map((b) => b.position.x).sort((a, b) => a - b);
  assert.deepEqual(xs, [-BARRIER_X, BARRIER_X]);
});

test('World: a kapu oszlopai szimmetrikusak, a gerenda a teljes szélességet átfogja', () => {
  const w = new World(sceneStub());
  const pillars = w.gate.children.filter(
    (o) => o.position && Math.abs(Math.abs(o.position.x)).toFixed(2) === '8.15',
  );
  assert.ok(pillars.length >= 10, `${pillars.length} pillérszegmens`);
  const beams = w.gate.children.filter((o) => o.position.y > 5);
  assert.ok(beams.length >= 3, 'gerenda + csíkok');
});

test('World: a föld az út alatt van, az út fölötte a 0-szint jogán', () => {
  const w = new World(sceneStub());
  const positions = w.staticGroup.children.map((o) => o.position.y);
  const road = w.staticGroup.children.find((o) => o === w.road);
  assert.ok(road.position.y >= 0);
  assert.ok(positions.some((y) => y < 0), 'van a 0-szint alá süllyedt elem (fű)');
});
