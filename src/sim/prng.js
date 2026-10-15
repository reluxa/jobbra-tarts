// Determinisztikus, seed-elhető PRNG (mulberry32) — a szimuláció futtatásai
// pontosan megismételhetők (azonos seed + azonos bemenetek = azonos kimenet).

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Pilóta: `seed` szám vagy már meglévő rng függvény.
export function makeRng(seed) {
  if (typeof seed === 'function') return seed;
  return mulberry32(seed == null ? 1 : seed);
}
