// A cockpit-fotó kimaszkolása tiszta px-műveletként: a fotón a szélvédőn
// át látszó "világ" valójában egy stúdiófal (egyetmonszürke, opák). A
// falat — a magvokból kiinduló flood-filllel — átlátszóvá alakítjuk, hogy
// a 3D világ látszaton át rajta. A sötét keretek (A-oszlop, tető,
// műszerfal szegélye) és a színes felületek (kijelzők) természetes
// megállási pontok.
//
// data: Uint8ClampedArray (RGBA, egy ImageData.data). Módosítja a helyszínen
// (az α csatornát zeri). Visszaadja a kimaszkolt px számát.
export function carveTransparent(d, W, H, seeds, opt = {}) {  const minB = opt.minBright ?? 125;
  const maxB = opt.maxBright ?? 255;
  const maxSat = opt.maxSat ?? 55;
  const yMax = Math.floor(opt.yMax == null ? H : opt.yMax); // a maszk csak a felső részen él
  const darkB = opt.darkB ?? 100; // a „sötét keret”-nek számítási küszöb

  const qualifies = (i) => {
    const r = d[i], g = d[i + 1], b = d[i + 2];
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    return mx - mn <= maxSat && mx >= minB && mx <= maxB;
  };

  const seen = new Uint8Array(W * yMax);
  const stack = [];
  let carved = 0;

  for (const [sx, sy] of seeds) {
    const x = Math.min(W - 1, Math.max(0, Math.round(sx)));
    const y = Math.min(yMax - 1, Math.max(0, Math.round(sy)));
    const start = y * W + x;
    if (seen[start] || !qualifies(start * 4)) continue;
    stack.length = 0;
    stack.push(start);
    seen[start] = 1;
    while (stack.length) {
      const p = stack.pop();
      d[p * 4 + 3] = 0;
      carved++;
      const x2 = p % W, y2 = (p - x2) / W;
      if (x2 > 0) { const q = p - 1; if (!seen[q] && qualifies(q * 4)) { seen[q] = 1; stack.push(q); } }
      if (x2 < W - 1) { const q = p + 1; if (!seen[q] && qualifies(q * 4)) { seen[q] = 1; stack.push(q); } }
      if (y2 > 0) { const q = p - W; if (!seen[q] && qualifies(q * 4)) { seen[q] = 1; stack.push(q); } }
      if (y2 < yMax - 1) { const q = p + W; if (!seen[q] && qualifies(q * 4)) { seen[q] = 1; stack.push(q); } }
    }
  }

  // Takarítás: a flood a sötét keretek (pl. A-oszlop) világosabb fénycsíkjaiba
  // is beeshet, és egy vékony, foga-szabálytalan sávot mar.  Ilyen pixel
  // MINDKÉT oldalról sötét szomszédot kap (a sáv a sötét mező közepén
  // fut) — visszaállítjuk.  A maszk széle (pl. a fal alsó sora a beltér
  // fölött) csak az egyik oldalról sötét, azt megtartjuk átlátszónak.
  const isDark = (i) => Math.max(d[i], d[i + 1], d[i + 2]) < darkB;
  for (let y = 1; y < yMax - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const p = y * W + x;
      if (d[p * 4 + 3] !== 0) continue;
      let darkN = 0;
      let darkL = false, darkR = false, darkU = false, darkD = false;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          if (isDark((p + dy * W + dx) * 4)) {
            darkN++;
            if (dx < 0 && dy === 0) darkL = true;
            if (dx > 0 && dy === 0) darkR = true;
            if (dy < 0 && dx === 0) darkU = true;
            if (dy > 0 && dx === 0) darkD = true;
          }
        }
      }
      if (darkN >= 3 && ((darkL && darkR) || (darkU && darkD))) d[p * 4 + 3] = 255;
    }
  }
  return carved;
}

// A szélvédő alján a softbox-árnyék lezárhatja a fő floodot úgy, hogy a fal
// világosabb zsebe a maszk alatt marad. A carvePockets célzott magokkal
// (a zseb belsejéből) szívja ki ezeket; a zseb falai a sötét sávok, tehát a
// maszk a kormányt/műszerfalat nem éri. Visszaadja a kimaszkolt px számát.
//
// opt: minBright (80), maxSat (60), yMin/yMax (a zseb-kieresztő sáv).
export function carvePockets(d, W, H, seeds, opt = {}) {
  const maxC = Math.floor(opt.yMax == null ? H : opt.yMax);
  const minC = Math.floor(opt.yMin ?? 0);
  const minBright = opt.minBright ?? 80;
  const maxSat = opt.maxSat ?? 60;
  const seen = new Uint8Array(W * H);
  const stack = [];
  let carved = 0;
  const qualifies = (i) => {
    const r = d[i], g = d[i + 1], b = d[i + 2];
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    return mx - mn <= maxSat && mx >= minBright;
  };
  const tryQ = (q) => {
    if (seen[q]) return;
    const qy = (q - q % W) / W;
    if (qy < minC || qy >= maxC) return;
    if (qualifies(q * 4)) { seen[q] = 1; stack.push(q); }
  };
  for (const [sx, sy] of seeds) {
    const x = Math.min(W - 1, Math.max(0, Math.round(sx)));
    const y = Math.min(maxC - 1, Math.max(minC, Math.round(sy)));
    const start = y * W + x;
    if (seen[start] || !qualifies(start)) continue;
    stack.length = 0;
    stack.push(start);
    seen[start] = 1;
    while (stack.length) {
      const p = stack.pop();
      if (d[p * 4 + 3] !== 0) {
        d[p * 4 + 3] = 0;
        carved++;
      }
      const x2 = p % W, y2 = (p - x2) / W;
      if (x2 > 0) tryQ(p - 1);
      if (x2 < W - 1) tryQ(p + 1);
      if (y2 > minC) tryQ(p - W);
      if (y2 < maxC - 1) tryQ(p + W);
    }
  }
  return carved;
}
