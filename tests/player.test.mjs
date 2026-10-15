import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Player } from '../src/player.js';
import { CAMERA } from '../src/constants.js';

function sceneStub() {
  return { added: [], add(o) { this.added.push(o); } };
}

const mkPlayer = () => new Player(sceneStub());

// ---- felépítés ----
test('Player: a csoport a scene-be kerül, a rétegek helyesek', () => {
  const scene = sceneStub();
  const p = new Player(scene);
  assert.equal(scene.added[0], p.group);
  // a külcsoport 1-es, a belcsoport 2-es rétegű minden gyerekkel
  assert.equal(p.extGroup.layers.isEnabled(1), true);
  assert.equal(p.extGroup.layers.isEnabled(0), false);
  assert.equal(p.intGroup.layers.isEnabled(2), true);
  let extLayers = 0;
  p.extGroup.traverse((o) => { if (o.layers.isEnabled(1)) extLayers++; });
  assert.ok(extLayers > 2, 'a külső váz minden eleme az 1-es rétegen');
  assert.equal(p.group.children.length, 2);
});

test('Player: a kerekek, az indexlámpák és a kormány léteznek', () => {
  const p = mkPlayer();
  assert.ok(p.wheelMeshes.length >= 4, `${p.wheelMeshes.length} kerék`);
  assert.ok(p.sigLights.length === 4, '2+2 indexlámpa');
  assert.ok(p.steerWheel, 'kormány');
  assert.equal(p.fwd.length(), 1);
});

// ---- szinkron ----
test('syncFrom: pozíció/irány átvétel + kerékpörgés + kormány-lerp', () => {
  const p = mkPlayer();
  const sim = { x: 3, y: 0.62, z: 50, yaw: 0.4, fwdSpeed: 30, steer: 1, signal: 0, signalT: 0, blinkPhase: 0,
    signalOn: () => false };
  p.syncFrom(sim, 1 / 60);
  assert.equal(p.group.position.x, 3);
  assert.deepEqual([p.group.position.y, p.group.position.z], [0.62, 50]);
  assert.equal(p.group.rotation.y, 0.4);
  for (const w of p.wheelMeshes) {
    assert.ok(w.spin < 0, 'a kerék előre forog (negatív spin)');
  }
  // a kormány a target felé tart (a lerp a cél ~10%-a egy tick alatt dt=1/60, k=1-e^-1)
  assert.ok(Math.abs(p.steerWheel.rotation.z) > 0 && Math.abs(p.steerWheel.rotation.z) < 0.85);
});

test('updateSignalViz: jelzés ki/bekapcsolás és a villogás-fázis', () => {
  const p = mkPlayer();
  const sim = { signal: -1, signalOn: () => true, signalT: 1 };
  p.updateSignalViz(sim, 1 / 60);
  const lefts = p.sigLights.slice(0, 2);
  const rights = p.sigLights.slice(2);
  for (const m of lefts) assert.equal(m.material.emissiveIntensity, 2.2);
  for (const m of rights) assert.equal(m.material.emissiveIntensity, 0.05);
  assert.equal(p.sigDash[0].material.emissiveIntensity, 2.2, 'balra nyíl');
  assert.equal(p.sigDash[1].material.emissiveIntensity, 0.02, 'jobbra nyíl ki');

  // ki-fázis: halvány minden
  p.updateSignalViz({ signal: -1, signalOn: () => false }, 1 / 60);
  assert.equal(p.sigLights[0].material.emissiveIntensity, 0.05);
  // nincs jelzés: minden halvány + az emelő visszaáll
  p.sigStalk.rotation.x = 0.4;
  p.updateSignalViz({ signal: 0, signalOn: () => false }, 1 / 60);
  assert.equal(p.sigStalk.rotation.x, 0);
  // jobbra jelzés a másik oldalt világítja
  p.updateSignalViz({ signal: 1, signalOn: () => true }, 1 / 60);
  assert.equal(p.sigLights[2].material.emissiveIntensity, 2.2);
  assert.equal(p.sigLights[0].material.emissiveIntensity, 0.05);
});

test('forwardWorld: a yaw irányába mutat', () => {
  const p = mkPlayer();
  p.group.rotation.y = 0;
  assert.deepEqual([...p.forwardWorld()], [0, 0, 1]);
  p.group.rotation.y = Math.PI / 2;
  const f = p.forwardWorld();
  assert.ok(Math.abs(f.x - 1) < 1e-6, `yaw=90°: (1,0,0) → ${f.toArray()}`);
});

test('updateCamera: chase-mód lerp-elve közelít a kívánt helyzethez, shake hozzáadódik', () => {
  const p = mkPlayer();
  const cam = new THREE.PerspectiveCamera(60, 1.6, 0.1, 500);
  p.group.position.set(0, 0.62, 100);
  const shakeOff = new THREE.Vector3(0.2, -0.1, 0);
  for (let i = 0; i < 120; i++) p.updateCamera(cam, 1 / 60, shakeOff, 'chase');
  const desired = new THREE.Vector3(0, 0.62 + CAMERA.height, 100).addScaledVector(p.fwd, -CAMERA.dist);
  assert.ok(Math.abs(cam.position.x - (desired.x + 0.2)) < 0.01, `x=${cam.position.x}`);
  assert.ok(Math.abs(cam.position.z - (desired.z)) < 0.01);
  assert.ok(Math.abs(cam.position.y - (desired.y - 0.1)) < 0.01, 'a shake felfelé/lefelé is hat');
  const dir = cameraDir(cam);
  assert.ok(dir.z > 0.8, `előre néz: z=${dir.z}`);
  assert.ok(dir.y < 0 && dir.y > -0.75, 'a járműre néz le kissé');
});

test('updateCamera: cockpit-mód hard-glue, csak a tekintet simított', () => {
  const p = mkPlayer();
  const cam = new THREE.PerspectiveCamera(60, 1.6, 0.1, 500);
  p.group.position.set(5, 0.62, 200);
  const yaw = 0.3;
  p.group.rotation.y = yaw;
  for (let i = 0; i < 10; i++) p.updateCamera(cam, 1 / 60, null, 'cockpit');
  const o = CAMERA.cockpit;
  // teljes Y-forgás (jobbkéz-szabály): x' = x·cos + z·sin, z' = −x·sin + z·cos
  const rx = o.x * Math.cos(yaw) + o.z * Math.sin(yaw);
  const rz = -o.x * Math.sin(yaw) + o.z * Math.cos(yaw);
  // a kamera pontosan az ülés-pontban ül (nincs lerp-lemaradás)
  assert.ok(Math.abs(cam.position.x - (5 + rx)) < 1e-6, `x=${cam.position.x}`);
  assert.ok(Math.abs(cam.position.z - (200 + rz)) < 1e-6, `z=${cam.position.z}`);
  assert.equal(cam.position.y, o.y);
});

test('positionMirror: a szélvédő vonalából hátranéz (lookBack mögé)', () => {
  const p = mkPlayer();
  const cam = new THREE.PerspectiveCamera(46, 3.375, 0.1, 500);
  p.group.position.set(10, 0.62, 300);
  p.group.rotation.y = 0;
  p.positionMirror(cam);
  const m = CAMERA.mirror;
  assert.ok(Math.abs(cam.position.x - 10) < 1e-6, 'a tükör a pálya közepén marad');
  assert.ok(Math.abs(cam.position.z - (300 + m.front)) < 1e-6);
  assert.equal(cam.position.y, m.height);
  // a tekintet a járművön TÚL, HÁTRA mutat
  const dir = cameraDir(cam);
  assert.ok(dir.z < 0, `hátranéz: ${dir.z}`);
  assert.ok(Math.abs(dir.x) < 0.05, 'nem kanyarodik el');
});

test('wheelDbg: állapot-sor a kerekekről', () => {
  const p = mkPlayer();
  const out = p.wheelDbg({ steer: 1 });
  assert.equal(out.length, 4);
  for (const w of out) {
    assert.ok(typeof w.y === 'number' && w.y < 2);
    assert.equal(typeof w.idx, 'number');
  }
  // a két első kerék (0,1) követi a kormányt, a hátsó kettő nem
  assert.deepEqual(out.map((w) => w.steer), [1, 1, 0, 0]);
  const out0 = p.wheelDbg(null);
  assert.equal(out0[0].steer, 0, 'jel nélkül nincs befordítás');
});

test('setModel: a vészlátvány helyett a modell-csoport jelenik meg, csak az indexek maradnak', () => {
  const p = mkPlayer();
  const model = new THREE.Group();
  model.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial()));
  p.setModel(model);
  assert.equal(p.wheelMeshes.length, 0, 'a kerekek eltűntek');
  const kept = p.extGroup.children.filter((c) => p.sigLights.includes(c)).length;
  assert.equal(kept, p.sigLights.length, 'az indexlámpák megmaradnak');
  assert.equal(p.extGroup.children.length, kept + 1, 'a wrapper az egyetlen új gyerek');
  // a modell minden eleme az 1-es rétegen
  p.extGroup.traverse((o) => { if (o instanceof THREE.Group && o !== p.extGroup) assert.equal(o.layers.isEnabled(1), true); });
});

test('setMirrorTexture: UV-flip beállítások a tükörüvegre', () => {
  const p = mkPlayer();
  const tex = {
    center: new THREE.Vector2(), offset: new THREE.Vector2(),
    repeat: new THREE.Vector2(), wrapS: 0, needsUpdate: false,
  };
  // three 0.169: a needsUpdate SETTER inkrementálja az anyag version-jét
  const mat = p.mirrorGlass.material;
  const v0 = mat.version;
  p.setMirrorTexture(tex);
  assert.equal(tex.offset.x, 1);
  assert.equal(tex.repeat.x, -1);
  assert.equal(tex.wrapS, 1001);
  assert.equal(tex.needsUpdate, true);
  assert.equal(mat.map, tex);
  assert.ok(mat.version > v0, 'az anyag újrafordításra vár');
  // nincs üveg: nem dob
  const p2 = mkPlayer();
  p2.mirrorGlass = null;
  p2.setMirrorTexture(tex);
});

function cameraDir(cam) {
  cam.updateMatrixWorld(true);
  const v = new THREE.Vector3();
  cam.getWorldDirection(v);
  return v;
}

function cameraTargetDir(cam) {
  cam.updateMatrixWorld(true);
  const t = new THREE.Vector3();
  cam.getWorldDirection(t);
  return t;
}
