import test from 'node:test';
import assert from 'node:assert/strict';
import { applyHandMask } from '../src/mask.js';

// 4×2-es teszt-kép: minden pixel opák fehér (255,255,255,255).
function makeImg(W, H, alpha = 255) {
  const d = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < d.length; i += 4) {
    d[i] = 255; d[i + 1] = 255; d[i + 2] = 255; d[i + 3] = alpha;
  }
  return d;
}

test('applyHandMask: zöld vonás átlátszóra, piros fedőre, más pixelhez nem nyúl', () => {
  const W = 8, H = 4;
  const d = makeImg(W, H);
  const m = new Uint8ClampedArray(W * H * 4); // mindenhol 0 = érintetlen
  // üveg: (2,0)…(3,0) zöld
  for (let x = 2; x <= 3; x++) {
    const i = (0 * W + x) * 4;
    m[i] = 0; m[i + 1] = 255; m[i + 2] = 120; m[i + 3] = 255;
  }
  // keret: (5,3) piros
  {
    const i = (3 * W + 5) * 4;
    m[i] = 255; m[i + 1] = 60; m[i + 2] = 60; m[i + 3] = 255;
  }
  const { glass, frame } = applyHandMask(d, W, H, m);
  assert.equal(glass, 2);
  assert.equal(frame, 1);
  for (let x = 2; x <= 3; x++) assert.equal(d[(0 * W + x) * 4 + 3], 0, 'üveg → átlátszó');
  assert.equal(d[(3 * W + 5) * 4 + 3], 255, 'keret → fedő');
  // más pixelek érintetlenek maradnak
  assert.equal(d[(0 * W + 0) * 4 + 3], 255);
  assert.equal(d[(1 * W + 4) * 4 + 3], 255);
});

test('applyHandMask: csak az érintett pixelek változnak (az algoritmikus maszk marad)', () => {
  const W = 4, H = 2;
  const d = makeImg(W, H, 0); // mindenhol már átlátszó (pl. procedurális maszk)
  // egy keret-vonás visszahozza a fedést
  const m = new Uint8ClampedArray(W * H * 4);
  {
    const i = (1 * W + 1) * 4;
    m[i] = 255; m[i + 1] = 0; m[i + 2] = 0; m[i + 3] = 255;
  }
  const { glass, frame } = applyHandMask(d, W, H, m);
  assert.equal(glass, 0);
  assert.equal(frame, 1);
  assert.equal(d[(1 * W + 1) * 4 + 3], 255);
  assert.equal(d[(0 * W + 0) * 4 + 3], 0, 'a többi átlátszó marad');
});

test('applyHandMask: szürke/átlátszó maszk-pixel nem változtat', () => {
  const W = 4, H = 2;
  const d = makeImg(W, H);
  const m = new Uint8ClampedArray(W * H * 4); // 0,0,0,0 = nincs vonás
  const r = applyHandMask(d, W, H, m);
  assert.equal(r.glass + r.frame, 0);
  for (let p = 0; p < W * H; p++) assert.equal(d[p * 4 + 3], 255);
});

test('applyHandMask: rendre érzéketlen — a zöld/piros küszöbök csak a domináns csatornát nézik', () => {
  const W = 3, H = 1;
  const d = makeImg(W, H);
  const m = new Uint8ClampedArray(W * H * 4);
  // zöld, piros árnyalattal: (0,0)
  { const i = 0; m[i] = 40; m[i + 1] = 255; m[i + 2] = 40; m[i + 3] = 255; }
  // piros, zöld árnyalattal: (1,0)
  { const i = 4; m[i] = 255; m[i + 1] = 40; m[i + 2] = 40; m[i + 3] = 255; }
  const r = applyHandMask(d, W, H, m);
  assert.equal(r.glass, 1);
  assert.equal(r.frame, 1);
  assert.equal(d[3], 0, '(0,0) üveg');
  assert.equal(d[7], 255, '(1,0) keret');
  assert.equal(d[11], 255, '(2,0) érintetlen');
});
