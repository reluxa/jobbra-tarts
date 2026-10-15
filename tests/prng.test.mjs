import test from 'node:test';
import assert from 'node:assert/strict';
import { mulberry32, makeRng } from '../src/sim/prng.js';

test('mulberry32: determinisztikus, [0,1) tartomány', () => {
  const a = mulberry32(42);
  const b = mulberry32(42);
  const seqA = Array.from({ length: 100 }, () => a());
  const seqB = Array.from({ length: 100 }, () => b());
  assert.deepEqual(seqA, seqB, 'ugyanaz a seed => ugyanaz a sorozat');
  for (const v of seqA) {
    assert.ok(v >= 0 && v < 1, `érték ${v} a [0,1) tartományban van`);
    assert.ok(typeof v === 'number');
  }
});

test('mulberry32: különböző seedek különböznek', () => {
  const a = mulberry32(1);
  const b = mulberry32(2);
  let diff = 0;
  for (let i = 0; i < 20; i++) if (a() !== b()) diff++;
  assert.ok(diff > 0, 'a sorozatok ne legyenek bitre azonosak');
});

test('mulberry32: seed nélkül is működik (undefined → 0)', () => {
  const a = mulberry32();
  const b = mulberry32(0); // undefined >>> 0 === 0
  assert.equal(a(), b());
});

test('makeRng: függvényt átadva önmagát adja vissza', () => {
  const fn = () => 0.5;
  assert.equal(makeRng(fn), fn);
});

test('makeRng: null seed → determinisztikus (1)', () => {
  const a = makeRng(null);
  const b = makeRng(1);
  for (let i = 0; i < 10; i++) assert.equal(a(), b());
});
