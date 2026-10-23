// A cockpit-fotó kimaszkolása tiszta px-műveletként: a fotón a szélvédőn
// át látszó "világ" valójában egy stúdiófal (egyetmonszürke, opák). A
// falat — a magvokból kiinduló flood-filllel — átlátszóvá alakítjuk, hogy
// a 3D világ látszaton át rajta. A sötét keretek (A-oszlop, tető,
// műszerfal szegélye) és a színes felületek (kijelzők) természetes
// megállási pontok.
//
// Oszloponkénti „fal-alj”: az a sor, ahol a fentről egybefüggő, világos és
// színtelen stúdiófal ALUL lezárul (a következő minRun sor már nem fal).
// A maszk csak efölött élhet: a műszerfal teteje is lehet világos-szürke
// (a fényküszöbökön átmegy), de a fotón a fal aljánál éles törés van.
// Visszaad egy Uint16Array-t (oszloponként az első „nem-fal” sor — a maszk
// csak < ezen a soron élhet; ha nincs ilyen, a kép alja a határ).
export function wallCeiling(d, W, H, opt = {}) {
  const minB = opt.minB ?? 165;   // fal = ennél világosabb …
  const maxSat = opt.maxSat ?? 45;
  const minRun = opt.minRun ?? 4; // ennyi egymás utáni nem-fal sor = fal-alj
  const from = Math.max(0, Math.floor(opt.from ?? H * 0.35));
  const to = Math.min(H, Math.floor(opt.to ?? H * 0.8));
  const isWall = (x, y) => {
    const i = (y * W + x) * 4;
    const mx = Math.max(d[i], d[i + 1], d[i + 2]);
    const mn = Math.min(d[i], d[i + 1], d[i + 2]);
    return mx >= minB && mx - mn <= maxSat;
  };
  const ceil = new Uint16Array(W);
  for (let x = 0; x < W; x++) {
    let gap = 0, seen = false, c = to, hit = false;
    for (let y = from; y < to; y++) {
      if (isWall(x, y)) { seen = true; gap = 0; }
      else if (seen) {
        gap++;
        if (gap >= minRun) { c = y - minRun + 1; hit = true; break; }
      }
    }
    // a sáv aljáig maradt rés: a sáv alja a határ; ha fent nem volt fal
    // (belteri oszlop), nincs határ
    if (!hit) c = to - gap;
    ceil[x] = c;
  }
  return ceil;
}

// data: Uint8ClampedArray (RGBA, egy ImageData.data). Módosítja a helyszínen
// (az α csatornát zeri). Visszaadja a kimaszkolt px számát.
//
// A yMax lehet szám VAGY Uint16Array (wallCeiling): a maszk csak e sora
// fölött élhet — a világos műszerfal-tetejét így nem éri el.
export function carveTransparent(d, W, H, seeds, opt = {}) {
  const minB = opt.minBright ?? 125;
  const maxB = opt.maxBright ?? 255;
  const maxSat = opt.maxSat ?? 55;
  const yMaxAll = opt.yMax == null ? H : opt.yMax; // szám vagy per-oszlop Uint16Array
  const yMaxArr = ArrayBuffer.isView(yMaxAll) ? yMaxAll : null;
  const yMaxRow = yMaxArr ? null : Math.floor(yMaxAll); // a maszk csak a felső részen él
  const darkB = opt.darkB ?? 100; // a „sötét keret”-nek számítási küszöb

  const capAt = (x) => (yMaxArr ? yMaxArr[x] : yMaxRow);
  // a per-oszlop fal-alj mindig szigorúbb: a világos műszerfal-tetejét nem érjük el
  const qualifies = (i) => {
    const p = i >> 2, x = p % W;
    if (p - x >= capAt(x) * W) return false;
    const r = d[i], g = d[i + 1], b = d[i + 2];
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    return mx - mn <= maxSat && mx >= minB && mx <= maxB;
  };

  const seen = new Uint8Array(W * H);
  const stack = [];
  let carved = 0;

  for (const [sx, sy] of seeds) {
    const x = Math.min(W - 1, Math.max(0, Math.round(sx)));
    const y = Math.min(capAt(x) - 1, Math.max(0, Math.round(sy)));
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
      if (y2 < H - 1) { const q = p + W; if (!seen[q] && qualifies(q * 4)) { seen[q] = 1; stack.push(q); } }
    }
  }

  // Takarítás: a flood a sötét keretek (pl. A-oszlop) világosabb fénycsíkjaiba
  // is beeshet, és egy vékony, foga-szabálytalan sávot mar.  Ilyen pixel
  // MINDKÉT oldalról sötét szomszédot kap (a sáv a sötét mező közepén
  // fut) — visszaállítjuk.  A maszk széle (pl. a fal alsó sora a beltér
  // fölött) csak az egyik oldalról sötét, azt megtartjuk átlátszónak.
  const isDark = (i) => Math.max(d[i], d[i + 1], d[i + 2]) < darkB;
  const cleanH = yMaxArr ? H : yMaxRow;
  for (let y = 1; y < cleanH - 1; y++) {
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

  // A sötét szerkezetek (A-oszlop, tető, ablakkeret) VILÁGOS fénycsíkjait a
  // flood is kimarhatja: az oszlop élén foga-szabálytalan, átlátszó sáv fut
  // végig, amin átlátszik a 3D világ. A sötét magból kifelé 3 rétegnyi
  // szegély-pixelt visszaállítunk (a megmaradt, fedő szegélyen át nincs
  // távolabb terjedés), így a keretek fedettek maradnak.
  const isDarkCore = (i) => Math.max(d[i], d[i + 1], d[i + 2]) < darkB - 20;
  const restored = new Uint8Array(W * H);
  for (let pass = 0; pass < 3; pass++) {
    let changed = false;
    for (let y = 1; y < cleanH - 1; y++) {
      for (let x = 1; x < W - 1; x++) {
        const p = y * W + x;
        if (d[p * 4 + 3] !== 0) continue;
        const nearDark = pass === 0
          ? isDarkCore((p - 1) * 4) || isDarkCore((p + 1) * 4) ||
            isDarkCore((p - W) * 4) || isDarkCore((p + W) * 4)
          : restored[p - 1] || restored[p + 1] || restored[p - W] || restored[p + W];
        if (nearDark) { d[p * 4 + 3] = 255; restored[p] = 1; changed = true; }
      }
    }
    if (!changed) break;
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
  const yMaxAll = opt.yMax == null ? H : opt.yMax;
  const yMaxArr = ArrayBuffer.isView(yMaxAll) ? yMaxAll : null;
  const maxC = yMaxArr ? H : Math.floor(yMaxAll);
  const minC = Math.floor(opt.yMin ?? 0);
  const minBright = opt.minBright ?? 80;
  const maxSat = opt.maxSat ?? 60;
  const seen = new Uint8Array(W * H);
  const stack = [];
  let carved = 0;
  const qualifies = (i) => {
    const p = i >> 2, x = p % W;
    if (yMaxArr && p - x >= yMaxArr[x] * W) return false;
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

// Kézi maszk érvényesítése — a public/mask-editor.html-ben rajzolt vonások.
// A zöld vonás üveget jelent (átlátszó), a piros keretet (fedő); a többi
// pixelhez nem nyúlunk (az algoritmikus maszk eredménye marad). A tool
// zöldje #00ff78, pirosa #ff3b3b. mdata: RGBA Uint8ClampedArray, pontosan
// W×H méretű. Visszaadja, hány üveg- és hány keret-pixelt érvényesített.
export function applyHandMask(d, W, H, mdata, opt = {}) {
  const glassMinG = opt.glassMinG ?? 100;
  const frameMinR = opt.frameMinR ?? 100;
  let glass = 0;
  let frame = 0;
  for (let p = 0; p < W * H; p++) {
    const i = p * 4;
    const r = mdata[i];
    const g = mdata[i + 1];
    if (g > glassMinG && r <= frameMinR) {
      d[i + 3] = 0;
      glass++;
    } else if (r > frameMinR && g <= glassMinG) {
      d[i + 3] = 255;
      frame++;
    }
  }
  return { glass, frame };
}
