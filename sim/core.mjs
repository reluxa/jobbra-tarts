// ============================================================================
// Sáv-alapú kapu-játék MAG-szimulátor (fej nélküli, paraméterezett).
// Cél: a játékelv tesztelése és hangolása MIELŐTT bekerül az src/ játékba.
//
// Alapelv amit modellezünk (a "csak jobbra tartva lehet nyerni" játékmód):
//   - 3 sáv: 0=külső(jobb, hazai), 1=középső, 2=belső(bal).
//   - Minden sávnak van időfogyasztási szorzója (laneRate): a kapu órája
//     a külső sávban fogy a leglassabban => itt "ér meg" tartózkodni.
//   - Minden sávnak van sebesség-határa, és időnként lassabb akadály (pl. teherautó)
//     jelenik meg a külső sávban, amit ki kell kerülni (sávváltás balra), majd
//     vissza kell térni, mert balra az óra gyorsabban megy.
//   - Átlagsebesség-követelményt a kezdő "időbérlet" kódolja: T = táv / kértÁtlag.
//     Óradrain (laneRate + büntetések) lényegében a "mennyire voltál hatékony".
//
// Minden determinisztikus (seedelt), hogy reprodukálhatóan lehessen hangolni.
// ============================================================================

export const KMH = (kmh) => kmh / 3.6;

// egyszerű, gyors, reprodukálható PRNG (mulberry32)
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ============================================================================
//  Konfiguráció (alapértelmezések — minden testreszabható)
// ============================================================================
export function defaultConfig() {
  return {
    // --- pálya / kapu ---
    laneCount: 3,              // 0=elkülső(jobb) .. laneCount-1=legbelső(bal)
    gateDist: 1650,            // kapu táv (m)
    gates: 12,                 // hány kapu egy "futam"
    reqStart: 92,            // kért átlag hányadik kapunál indul (km/h)
    reqStep: 0.45,             // átlagemelkedés kapunként (km/h)

    // --- sávok ---
    // laneRate[i] = kapu-óra fogyási szorzója i. sávban (1 = normál).
    //  => külső sáv (i=0) a legelőnyösebb. Ez teremti a "tarts jobbra" ösztönzést.
    laneRate: [1.0, 1.35, 1.8],
    // laneCap[i] = mekkora csúcssebességet enged az i. sáv (m/s). 
    laneCap: [KMH(120), KMH(132), KMH(150)],

    // --- játékos ---
    cruise: KMH(124),          // utazósebesség (m/s) — a tempó felső cél
    accel: 2.2,                // gyorsulás (m/s^2)
    decel: 3.5,                // fékezés követésnél (m/s^2)

    // --- forgalom ---
    // követés biztonsági távolság és előzés utáni "elengedés" távolság (m)
    followGap: 18,
    passClearance: 22,
    // akadály (külső sávú teherautó): sebesség tartomány (km/h) és átlagos térköz (m)
    truckSpeed: [KMH(72), KMH(88)],
    truckSpacing: 620,          // átlagos távolság teherautók közt a külső sávban
    // középső/belső sáv forgalmi széle (ritkán lassítanak a játékost)
    laneCarSpeed: [KMH(108), KMH(135)],

    // --- büntetések ---
    noSignalPen: 3,            // sávváltás index nélkül (s)
    cutInPen: 5,               // bevágás elé (s)
    cutInBehindDist: 26,       // ha ilyen közel van mögötted egy gyorsabb jármű a cél-sávban => bevágás

    // --- véletlen ---
    seed: 12345,

    // --- irányítási stratégia (policy) ---
    // 'keepRight'   : visszatér a külső sávba az előzés után (a nyerő stílus)
    // 'leftCamper'  : az adott (preferált) sávban marad, hogy lássuk, miért veszítesz
    // 'liberal'     : tart a baloldalfelé, ha gyorsabb, ritkábban tér vissza
    policy: 'keepRight',
    preferLane: 2,             // leftCamper / liberal preferált sávja
    dwellAfterPass: 3.2,       // s, amit előzés után még a bal sávban tölt, mielőtt visszatér
  };
}

// ============================================================================
//  Futás egyetlen kapun keresztül.  Visszaadja az eseménynaplót + állapotot.
// ============================================================================

export class GateRun {
  constructor(cfg, rng) {
    this.cfg = cfg;
    this.rng = rng;
    this.t = 0;                 // összes (valós) eltelt idő ezen a kapun
    this.dist = 0;              // megtett táv ezen a kapun (kapu elejétől)
    this.speed = 0;
    this.lane = 0;
    this.clock = cfg.gateDist / KMH(cfg.reqStart); // kezdő időköltségvetés (s)
    this.laneS = [0, 0, 0];     // összes tényleges ott-tartózkodási idő sávonként
    this.shifts = 0;
    this.noSignal = 0;
    this.cutIns = 0;
    this.following = null;      // {z, speed, done} az aktuális blokkoló akadály
    this.blockStack = [];       // egyszerre csak a "legközelebbi még nem elhagyott" akadály kell,
                                // de a policy szempontjából tároljuk a kiindulást is
    this.passTarget = null;     // a jelenleg éppen kikerülendő akadály (akiről vissza akarunk térni)
    this.dwell = 0;             // visszatérés előtti várakozás (s)
    this.acclimit = 0;          // 0 => sima cél sebesség, balra váltás utáni gyorsitás jele
    this.cutZoneLanes = new Map(); // für das Merge-Behind-Detection per sáv
  }

  // a jelenlegi sáv csúcssebessége
  cap() { return this.cfg.laneCap[this.lane]; }

  targetSpeed() {
    const c = this.cfg;
    let tgt = Math.min(c.cruise, this.cap());
    if (this.following && !this.following.done) {
      tgt = Math.min(tgt, this.following.speed);
    }
    return tgt;
  }

  // akadály generálása a kapu elején a külső sávba
  buildObstacles() {
    const c = this.cfg, out = [];
    let z = c.truckSpeed[0] * 0 + c.truckSpacing * this.rng();
    while (z < c.gateDist) {
      const spd = c.truckSpeed[0] + this.rng() * (c.truckSpeed[1] - c.truckSpeed[0]);
      out.push({ z, speed: spd, done: false });
      z += c.truckSpacing * (0.5 + this.rng() * 1.0);
    }
    this.obstacles = out;         // mind a külső sávban
    this.nextObsIdx = 0;
    return out;
  }

  // a legközelebbi, még el nem hagyott akadály előttünk (a jelenlegi sávban).
  //  Csak a külső sávban generálunk akadályt, ezért ha nem ott vagyunk, nincs blokk.
  currentBlocker() {
    if (this.lane !== 0) return null;
    const list = this.obstacles || [];
    for (let i = this.nextObsIdx; i < list.length; i++) {
      const o = list[i];
      if (o.done) continue;
      const gap = o.z - this.dist;
      if (gap <= this.cfg.followGap + 2) return o;
      if (gap > 20) return null;
    }
    return null;
  }

  step(dt) {
    const c = this.cfg;
    this.t += dt;

    // ---- óra ----
    this.clock -= c.laneRate[this.lane] * dt;
    this.laneS[this.lane] += dt;

    // ---- akadályok frissítése (átlépett marker), és az aktuális blokkoló ----
    this.gcObstacles();
    this.following = this.currentBlocker();

    // ---- politika (sávdöntés) ----
    this.act(dt);

    // ---- sebesség (lerp a cél felé, aszim-metrikus accel/decel) ----
    const tgt = this.targetSpeed();
    const maxA = (tgt >= this.speed) ? c.accel : c.decel;
    const dv = Math.max(-maxA * dt, Math.min(maxA * dt, tgt - this.speed));
    this.speed += dv;
    if (this.speed < 0) this.speed = 0;

    // ---- haladás ----
    this.dist += this.speed * dt;

    return this;
  }

  gcObstacles() {
    const list = this.obstacles;
    for (let i = 0; i < list.length; i++) {
      const o = list[i];
      if (!o.done && this.dist > o.z + this.cfg.passClearance) {
        o.done = true;
        if (this.nextObsIdx < i + 1) this.nextObsIdx = i + 1;
      }
    }
  }

  // ---- sávváltás ----
  changeLane(to, signalled) {
    const c = this.cfg, from = this.lane;
    if (to === from) return;
    this.lane = to;
    this.shifts++;
    // függetlenül ettől a visszatérési szándék törlése
    if (this.lane === 0) { this.passTarget = null; this.dwell = 0; }

    // index nélkül (a taktika nem jelez)
    if (!signalled) { this.noSignal++; this.clock -= c.noSignalPen; }

    // bevágás: ha a cél-sávban mögöttünk egy gyorsabb jármű van (modell:
    //    minden balra váltás a külső sáv akadályát kerüli; középső/belső sávban
    //    gyors autók futhatnak). Ha "átvágunk" egy ilyen elé a közeli zónában.
    if (to > from) {
      const ahead = this.behindMergingSpeed(to);
      if (ahead !== null) { this.cutIns++; this.clock -= c.cutInPen; }
    }
  }

  // mekkora sebességgel "jön mögötted" egy gyorsabb jármű a to sávban a merge zónában
  behindMergingSpeed(to) {
    // ritka, érdemi "bevágás": csak ha tényleg majdnem nekimesz valakinek.
    // A szim arra épül, hogy a legtöbb sávváltás tiszta, a botlás a kivétel.
    const r = this.rng();
    if (r < 0.96) return null;   // szabad slot — nincs bevágás (ritka hiba)
    return this.cfg.laneCarSpeed[0] + r * (this.cfg.laneCarSpeed[1] - this.cfg.laneCarSpeed[0]);
  }

  // ---- politika ----
  act(dt) {
    const c = this.cfg, L = this.lane;

    if (c.policy === 'leftCamper') {
      // maradj a preferált sávban
      if (L !== c.preferLane) this.changeLane(c.preferLane, true);
      return;
    }

    if (c.policy === 'liberal') {
      // balra húzódik ha gyorsabb sáv van és nem kötött a haladás
      if (L < c.laneCount - 1) {
        const fasterCap = c.laneCap[L + 1];
        if (fasterCap > this.cap() + 2) { this.changeLane(L + 1, false); return; }
      }
      return;
    }

    // ---- keepRight (a nyerő stílus) ----
    const blk = this.currentBlocker();

    if (L < c.laneCount - 1 && blk) {
      // van akadály előttünk -> előzés balra
      this.dwell = c.dwellAfterPass;
      this.changeLane(L + 1, true);            // jelezvel
      this.passTarget = blk;
      return;
    }

    // már elhagytuk az akadályt -> térjünk vissza jobbra
    if (L > 0) {
      const stillPassing = this.passTarget && !this.passTarget.done;
      if (!stillPassing) {
        if (this.dwell > 0) { this.dwell -= dt; return; }
        this.changeLane(L - 1, true);          // visszatérés jobbra, jelezvel
        return;
      }
      // még az akadály mellett vagyunk
      return;
    }

    // külső sávban, szabad út
    return;
  }

  // kulcs-állapot a kapu végére
  summarize() {
    const c = this.cfg;
    const laneFrac = this.laneS.map((s) => this.t ? s / this.t : 0);
    const achievedAvg = this.dist / this.t * 3.6;   // km/h (valós átlag)
    return {
      passed: this.clock > 0 && this.dist >= c.gateDist - 1e-6,
      time: this.t,
      dist: this.dist,
      clock: this.clock,
      achievedAvg,
      laneFrac,
      shifts: this.shifts,
      noSignal: this.noSignal,
      cutIns: this.cutIns,
    };
  }
}

// ============================================================================
//  Egy teljes futam (több kapu), strategy-politikával.
//  Visszaadja a kapu-szintű részleteket és hogy leállt-e game-over.
// ============================================================================
export function runRace(cfg, seed = cfg.seed) {
  const rng = mulberry32(seed);
  let req = cfg.reqStart;
  const gates = [];
  let carrySpeed = 0;

  for (let gi = 0; gi < cfg.gates; gi++) {
    const run = new GateRun(cfg, rng);
    run.clock = cfg.gateDist / KMH(req);
    run.t = 0; run.dist = 0; run.speed = carrySpeed; run.lane = 0;
    run.buildObstacles();

    const maxSim = 400; // biztonsági kapocs (s), hogy ne pörögjön örökké
    while (run.dist < cfg.gateDist && run.clock > 0 && run.t < maxSim) {
      run.step(0.05);
    }
    const s = run.summarize();
    gates.push({ gi, req, ...s });

    if (!s.passed) {
      return { won: false, failedGate: gi, reqAtFail: req, gates };
    }
    carrySpeed = run.speed;     // a kocsi nem áll meg a kapu-teljesítésnél
    req = req + cfg.reqStep;
  }
  return { won: true, failedGate: null, gates };
}
