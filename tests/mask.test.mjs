import test from 'node:test';
import assert from 'node:assert/strict';
import { carveTransparent, wallCeiling } from '../src/mask.js';

// 20×10 RGBA kép: sötét háttér + egy világos-szürke fal + színes kijelző +
// a falban egy sötét sáv, ami kettévágja az alsó részt.
function makeImg() {
  const W = 20, H = 10;
  const d = new Uint8ClampedArray(W * H * 4);
  const px = (x, y, r, g, b) => {
    const i = (y * W + x) * 4;
    d[i] = r; d[i + 1] = g; d[i + 2] = b; d[i + 3] = 255;
  };
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) px(x, y, 20, 22, 24); // sötét háttér
  for (let y = 2; y < 7; y++) for (let x = 3; x < 17; x++) px(x, y, 178, 180, 182); // a fal
  for (let y = 4; y < 7; y++) for (let x = 8; x < 12; x++) px(x, y, 90, 92, 95);     // sötét sáv (elválasztó)
  px(5, 4, 240, 190, 40);   // színes "kijelző" a falban
  px(6, 3, 150, 152, 155); // szelíd-szürke folt a fal KÖZEPÉN (minden szomszédja fal)
  return { d, W, H };
}

test('carveTransparent: a magból flood-fill a világos-szürke egybefüggőre', () => {
  const { d, W, H } = makeImg();
  const n = carveTransparent(d, W, H, [[13, 4]]);
  assert.ok(n > 40, `elég px legyen kimaszkolva (volt: ${n})`);
  assert.equal(d[(4 * W + 13) * 4 + 3], 0, 'a mag pixel is átlátszó');
  assert.equal(d[(3 * W + 6) * 4 + 3], 0, 'a falba ágyazott szelíd folt is kimaszkolva');
  assert.equal(d[(4 * W + 15) * 4 + 3], 0, 'a fal belseje a jobb széléig');
  assert.equal(d[(4 * W + 16) * 4 + 3], 0, 'a fal szél-pixele is átlátszó marad (csak egyik oldalról sötét)');
  assert.equal(d[(4 * W + 18) * 4 + 3], 255, 'a falon túl (háttér) érintetlen');
  assert.equal(d[(5 * W + 9) * 4 + 3], 255, 'a sötét sáv megállítja (nem maszkol)');
  assert.equal(d[(4 * W + 5) * 4 + 3], 255, 'a színes felület nem (sat magas)');
});

test('carveTransparent: a vízszintes/keret határok megállítják (a fal alatti sötét sor)', () => {
  const { d, W, H } = makeImg();
  carveTransparent(d, W, H, [[9, 4]], { yMax: H });
  assert.equal(d[(H - 1) * 4 + 3], 255, 'a kép alja (háttér) nem érintett');
});

test('carveTransparent: rossz mag (nem falon) nem maszkol semmit', () => {
  const { d, W, H } = makeImg();
  const n = carveTransparent(d, W, H, [[2, 8]]); // sötét háttérben
  assert.equal(n, 0);
});

test('carveTransparent: maxBright kizárja a tülvilágított foltokat', () => {
  const { d, W, H } = makeImg();
  d[(6 * W + 6) * 4] = 255; d[(6 * W + 6) * 4 + 1] = 255; d[(6 * W + 6) * 4 + 2] = 255; // fehér folt a fal közepén
  carveTransparent(d, W, H, [[9, 4]], { maxB: 230 });
  assert.equal(d[(6 * W + 6) * 4 + 3], 255, 'a fehér folt bennt marad (nem fal-árnyalat)');
});

test('carveTransparent: a sötét keret fénycsíkja átlátszó marad (széli csík)', () => {
  const W = 20, H = 10;
  const d = new Uint8ClampedArray(W * H * 4);
  const px = (x, y, r, g, b) => { const i = (y * W + x) * 4; d[i] = r; d[i + 1] = g; d[i + 2] = b; d[i + 3] = 255; };
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) px(x, y, 20, 22, 24);   // sötét háttér
  for (let y = 1; y < 9; y++) for (let x = 4; x < 7; x++) px(x, y, 40, 42, 44);   // „A-oszlop” (sötét)
  for (let y = 1; y < 9; y++) px(7, y, 245, 245, 248);                            // a keret széli fénycsíkja
  for (let y = 1; y < 9; y++) for (let x = 8; x < 16; x++) px(x, y, 178, 180, 182); // a fal
  carveTransparent(d, W, H, [[12, 4]]);
  assert.equal(d[(4 * W + 7) * 4 + 3], 0, 'a széli fénycsík kimaszkolva marad (csak az egyik oldalról sötét)');
  assert.equal(d[(4 * W + 12) * 4 + 3], 0, 'a fal közepe kimaszkolva');
  assert.equal(d[(4 * W + 8) * 4 + 3], 0, 'a fal a fénycsík mellett is kimaszkolva');
  assert.equal(d[(4 * W + 4) * 4 + 3], 255, 'az oszlop érintetlen');
});

// A wallCeiling oszloponként megkeresi a fal alját: fent világos-szürke fal,
// lent a „műszerfal-teteje” is világos-szürke (átmegy a fényküszöbön), de a
// fal alja éles törés — a maszknak ott kell megállnia.
test('wallCeiling: a fal alja a törésnél van, a világos műszerfal-teteje nem fal', () => {
  const W = 20, H = 10;
  const d = new Uint8ClampedArray(W * H * 4);
  const px = (x, y, r, g, b) => { const i = (y * W + x) * 4; d[i] = r; d[i + 1] = g; d[i + 2] = b; d[i + 3] = 255; };
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) px(x, y, 20, 22, 24);
  for (let y = 0; y < 5; y++) for (let x = 3; x < 17; x++) px(x, y, 178, 180, 182); // a fal
  for (let y = 5; y < 9; y++) for (let x = 3; x < 17; x++) px(x, y, 150, 152, 155); // világos „műszerfal-teteje”
  const ceil = wallCeiling(d, W, H, { from: 0, to: H });
  assert.equal(ceil[5], 5, 'a fal alja y=5 (a törésnél), nem a kép alja');
  assert.equal(ceil[19], 10, 'nincs fal a bal/jobb oldalon: nincs határ');
});

test('carveTransparent: a wallCeiling alá nem ér a maszk', () => {
  const W = 20, H = 10;
  const d = new Uint8ClampedArray(W * H * 4);
  const px = (x, y, r, g, b) => { const i = (y * W + x) * 4; d[i] = r; d[i + 1] = g; d[i + 2] = b; d[i + 3] = 255; };
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) px(x, y, 20, 22, 24);
  for (let y = 0; y < 7; y++) for (let x = 3; x < 17; x++) px(x, y, 178, 180, 182); // a fal + „világos beltér”
  for (let y = 7; y < 10; y++) for (let x = 3; x < 17; x++) px(x, y, 150, 152, 155);
  const ceil = wallCeiling(d, W, H, { from: 0, to: H });
  carveTransparent(d, W, H, [[10, 3]], { yMax: ceil });
  assert.equal(d[(3 * W + 10) * 4 + 3], 0, 'a fal teteje átlátszó');
  assert.equal(d[(6 * W + 10) * 4 + 3], 0, 'a fal alja (a törésig) átlátszó');
  assert.equal(d[(8 * W + 10) * 4 + 3], 255, 'a fal-alj alatt (világos műszerfal-teteje) opák');
});
