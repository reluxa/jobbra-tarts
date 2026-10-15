import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { installDomStubs } from './helpers/dom-stubs.js';
import { Effects } from '../src/effects.js';

const stubs = installDomStubs();

function sceneStub() { return { added: [], add(o) { this.added.push(o); } }; }

function mkEffects() {
  const scene = sceneStub();
  const camera = new THREE.PerspectiveCamera(62, 1.5, 0.1, 500);
  const labelRoot = { appended: [], appendChild(el) { this.appended.push(el); } };
  const fx = new Effects(scene, camera, labelRoot);
  return { scene, camera, labelRoot, fx };
}

test('Effects: a részecske-rendszer létrejön, elrejtve', () => {
  const { scene, fx } = mkEffects();
  assert.equal(scene.added[0], fx.points);
  assert.equal(fx.points.visible, false);
  assert.equal(fx.pos.length, fx.N * 3, 'a Float32Array 3D-pontonként');
  assert.equal(fx.geo.attributes.position.count, fx.N, 'a vertex-count az N');
  assert.equal(fx.vel.length, fx.N);
  assert.equal(fx.life.length, fx.N);
  assert.equal(fx.shakeT, 0);
});

test('shake/tickShake: pörgés csillapodik, lejártával 0', () => {
  const { fx } = mkEffects();
  fx.shake(2, 1.0);
  assert.equal(fx.shakeT, 1.0);
  assert.equal(fx.shakeMag, 2);
  fx.tickShake(0.3);
  assert.ok(fx.shakeT > 0.69 && fx.shakeT <= 0.71);
  fx.tickShake(10);
  assert.equal(fx.shakeT, 0);
  fx.tickShake(1); // negatívba már nem megy
  assert.equal(fx.shakeT, 0);
});

test('getShakeOffset: lejárt rázkódásnál nulla, aktívnál a mágnessel arányos', () => {
  const { fx } = mkEffects();
  const out = new THREE.Vector3();
  const orig = Math.random;
  try {
    Math.random = () => 0.5; // középen → eltolás = 0
    fx.getShakeOffset(out);
    assert.deepEqual([out.x, out.y, out.z], [0, 0, 0], 'nincs rázkódás');
    fx.shake(2, 1);
    fx.getShakeOffset(out);
    assert.deepEqual([out.x, out.y, out.z], [0, 0, 0], 'közép-értéknél 0');
    Math.random = () => 1;
    fx.getShakeOffset(out);
    assert.equal(out.x, 1, 'max: mag/2 of 2 · t=1 … x = 0.5·2 = 1');
    assert.ok(Math.abs(out.y) <= 0.5 * fx.shakeMag * 0.7 + 1e-9);
    assert.ok(Math.abs(out.z) <= 0.5 * fx.shakeMag * 0.4 + 1e-9);
  } finally {
    Math.random = orig;
  }
});

test('getShakeOffset: az erő a t-idővel arányosan csökken', () => {
  const { fx } = mkEffects();
  const orig = Math.random;
  try {
    Math.random = () => 1;
    fx.shake(2, 1);
    fx.tickShake(0.5);
    const out = new THREE.Vector3();
    fx.getShakeOffset(out);
    assert.equal(out.x, 0.5, 't=0.5 → mag 2 · 0.5 · 0.5 = 0.5');
  } finally {
    Math.random = orig;
  }
});

test('burst/updateParticles: feltölti a halott résztvevőket, gravitáció + csillapítás, majd elrejtés', () => {
  const { fx } = mkEffects();
  const orig = Math.random;
  try {
    Math.random = () => 0.5;
    const pos = new THREE.Vector3(10, 0, 20);
    fx.burst(pos, 4);
    assert.equal(fx.points.visible, true);
    let alive = 0;
    for (let i = 0; i < fx.N; i++) if (fx.life[i] > 0) alive++;
    assert.equal(alive, 4, '4 részecske éledt fel');
  assert.equal(fx.mat.color.getHex(), 0xffb74d);
  const p0y = fx.pos[1];
  const v0y = fx.vel[0].y;
  fx.updateParticles(0.1);
  // a részecske felfelé indul (random=0.5 → up=3.5), a gravitáció+damping apasztják
  assert.ok(fx.vel[0].y < v0y, `a gravitáció apasztja a felfelé-hatást: ${fx.vel[0].y} < ${v0y}`);
  const dy = fx.pos[1] - p0y;
  assert.ok(dy > 0.2 && dy < 0.35, `a pálya-integráció értelmes (dy=${dy})`);
  assert.ok(fx.life[0] < 0.85 && fx.life[0] > 0.7, 'az élettartam fogy');
  // mind elpusztítva (a következő lépésben halnak meg) → elrejtés
  for (let i = 0; i < fx.N; i++) fx.life[i] = 0;
  fx.life[0] = 0.01;
  fx.updateParticles(1.0);
  assert.equal(fx.pos[1], -100, 'a halott részecske a kép alá kerül (a life átfordult)');
  // a tomto lefutása után már semmi él → elrejti
  fx.updateParticles(1.0);
  assert.equal(fx.points.visible, false);
  } finally {
    Math.random = orig;
  }
});

test('burst: színt válthat, a N felett nincs több részecske', () => {
  const { fx } = mkEffects();
  const orig = Math.random;
  try {
    Math.random = () => 0.5;
    fx.burst(new THREE.Vector3(), fx.N + 50, 0x00ff00);
    assert.equal(fx.mat.color.getHex(), 0x00ff00);
    let alive = 0;
    for (let i = 0; i < fx.N; i++) if (fx.life[i] > 0) alive++;
    assert.equal(alive, fx.N, 'max N részecske');
    // a halottakat újrahasznosítja: mind meghalt → új burst ugyanazt a tömböt tölti
    for (let i = 0; i < fx.N; i++) fx.life[i] = 0;
    fx.burst(new THREE.Vector3(), 10);
    alive = 0;
    for (let i = 0; i < fx.N; i++) if (fx.life[i] > 0) alive++;
    assert.equal(alive, 10);
  } finally {
    Math.random = orig;
  }
});

test('popup: kamerával szemben a képernyő-koordinátákra kerül', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { camera, labelRoot, fx } = mkEffects();
  camera.position.set(0, 5, 0);
  camera.lookAt(0, 5, 10);
  camera.updateMatrixWorld(true); // a render-loop frissítés (a vektor-írás ehhez képest)
  fx.popup('ELŐZÉS', '#7dffa0', new THREE.Vector3(0, 5, 8));
  assert.equal(labelRoot.appended.length, 1);
  const el = labelRoot.appended[0];
  assert.equal(el.className, 'pop3d');
  assert.equal(el.textContent, 'ELŐZÉS');
  assert.equal(el.style.color, '#7dffa0');
  assert.ok(Number.isFinite(parseFloat(el.style.left)), `left: ${el.style.left}`);
  assert.ok(Number.isFinite(parseFloat(el.style.top)), `top: ${el.style.top}`);
  // a rAF + 900 ms után lekerül
  t.mock.timers.tick(1000);
  // (a remove() a stub-ban no-op — a lényeg, hogy a 900 ms-os ütemezés lefutott)
});

test('popup: a kamera MÖGÖTTI pont azonnal törlődik', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { camera, labelRoot, fx } = mkEffects();
  camera.position.set(0, 0, 0);
  camera.lookAt(0, 0, 1);
  camera.updateMatrixWorld(true);
  // a kamera mögé vetített pont (z>1 NDC): nem jelenhet meg
  fx.popup('MÖGÖTT', '#fff', new THREE.Vector3(0, 0, -5));
  assert.equal(labelRoot.appended.length, 1, 'létrehozva (a törlés flag: a style.left nem lett beállítva)');
  assert.ok(!('left' in labelRoot.appended[0].style), 'nem lett képernyő-pozíciója');
});
