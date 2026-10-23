// Globális állandók és játékmechanikai értékek (méter, m/s, km/h).

// ---- Útgeometria ----
// 1 egység = 1 méter. Az út az +Z tengely mentén halad (a haladási irány +Z).
export const LANES = 3;
export const LANE_W = 4.25;           // sávszélesség (m) — a rajzolt sávokkal egyező, tágasabb
export const ROAD_HALF = LANE_W * 1.5; // út fele (3 sáv)
export const SHOULDER = 2.2;           // leállósáv/oldal (m)
export const BARRIER_X = ROAD_HALF + SHOULDER + 0.6; // korlát helye
export const GROUND_Y = 0;

// Végtelennek tetsző autópálya: a statikus világ (út, terep, korlát, díszlet)
// hosszú, de véges; amikor a játékos a „végéhez” ér, az egész világot (út + 
// terep + korlát + díszlet + forgalom + játékos) egyszerre visszatekerjük, így
// a nézet változatlan marad (nincs látható ugrás). A textúra a 12 m-es tile-el
// ismétlődik, ezért a tekercs a tile többszöröse kell legyen a zökkenőmentességhez.
export const WORLD = {
  length: 4950,   // út/terep teljes hossza (m) — statikus; a játékost a wrapTo-ba teleportáljuk
  start: -1100,   // a z = start széltől húzódik (start = wrapTo mögött, a tükörnek)
  wrapAt: 1900,   // ha a játékos ideér, a start (wrapTo) felé tekercseljük VISSZA
  wrapTo: -500,   // ide ültetjük vissza a játékost minden ciklusban
  tile: 12,        // textúra-periódus (m) — a tekercs ehhez igazodik
};

// Sávindex -> vezetősáv közepe X-en.
// lane 0 = bal (képernyő-bal), lane 2 = jobb (képernyő-jobb).
export const laneCenterX = (lane) => (1 - lane) * LANE_W;

// ---- Játékos autó ----
export const CAR = {
  mass: 160,
  half: { x: 0.95, y: 0.42, z: 2.05 },
  wheelRadius: 0.36,
  restY: 0.62,        // nyugalmi kasztni-magasság
  maxSpeed: 46,       // ~166 km/h
};

// Hajtás-érzés (boltozatos, irányítható) — az ütközés ezektől függetlenül a cannonon megy.
export const DRIVE = {
  accel: 15.0,      // m/s² teljes gáznál (analóg gázzal finoman adagolható)
  brake: 26.0,      // m/s² teljes fékezésnél
  drag: 0.0005,     // légellenállás (v² szorzó) — végsebesség ~153 km/h, így az auto tempó (130) elérhető
  steerLerp: 6.0,   // kormány be/kicsiklázás sebessége
  lateralK: 7.0,    // oldalesúszás csillapítás
  yawRate: 1.35,    // max fejfordulási sebesség (rad/s)
  // Sávváltás-fókuszú irányítás: nincs kézi gáz/fék/kormányzás, a játék
  // automatikusan halad (utazósebesség) és a balra/jobbra gomb egy EGY sávváltást
  // ad, amit maga elvégez (átgurul + kiegyenesedik).
  cruise: 36.1,      // induló automata utazósebesség (m/s ≈ 130 km/h — tiszta úton erre gyorsul)
  cruiseMax: 38,     // max utazósebesség magas nehézségnél (m/s ≈ 137 km/h)
  laneChange: 1.2,   // egy sávváltás időtartama (mp)
};

// ---- Forgalom ----
// Sávonkénti sebességtartomány (m/s) és kamion-arány.
export const TRAFFIC = {
  spawnBase: 1.25,  // átlagos spawn-időköz (s)
  spawnMin: 0.85,
  maxCars: 12,      // felső autó-limit; enélkül az út telítődik (22/210 m ≈ 14 m kocsinként!)
  waits: [0.2, 0.38, 0.42],   // sáv kiválasztás valószínűsége (bal, közép, jobb)
  speedByLane: [
    [30, 38],   // bal (belső): gyorsak 108–137
    [26, 32],   // közép: 94–115
    [25, 31],   // jobb (külső haladási sáv): min. 90–115
  ],
  truckSpeed: [25, 31], // kamion (jobb sáv) — min. ~90–111 km/h
  truckChance: 0.55,    // a jobb sávban mekkora eséllyel kamion
  spawnNear: 95,        // legközelebbi spawn-távolság (m)
  spawnSpan: 75,        // spawn-eltolástartomány (m)
  minGap: 55,           // azonos sávú min. távolság a spawn-nál
  behindChance: 0.35,   // esély, hogy a spawn hátulról jövő gyors autót rakjon (tükör!)
  behindStart: 70,      // indulási távolság mögöttünk (m)
  behindSpan: 70,
  behindSpeed: [38, 46], // a gyors bal-sávos utolérők sebessége (m/s)
  changeAhead: 4.5,      // játékos sávváltás: ezen belül ELŐL blokkol a cél-sávban lévő autó (m)
  changeBehind: 10,      // játékos sávváltás: ezen belül MÖGÖTT is blokkol (m)
};

// ---- Pontozás / kapu-pálya --------------------
// A játék kapuk közt megy: minden kapunak van egy „időköltségvetése”, amit a
// kért átlagsebesség ad:  idő = táv / kértÁtlag.  Az óra a következő kapuig
// fogy; ha lejár, mielőtt odaérsz, vége a futásnak.
//
//  * KAPU-ÓRA SÁVONKÉNTI FOGYÁSA  — a „csak jobbra tartva lehet nyerni” mag.
//    A külső (jobb) sáv a leglassabb ütésű (1.0) => a nyerő sáv; a belső (bal)
//    sáv 1.8-szor gyorsabban zabálja az idődet, ezért ott senki sem maradhat
//    hosszan.  lane 0 = belső(bal), 1 = közép, 2 = külső(jobb).
export const laneRateByLane = [1.8, 1.35, 1.0];

export const SCORE = {
  // tiszta pont-flavor (a KAPU-ÓRA a nyerő/vésztes tényező, ez csak a kijelzés)
  lanePerSec: [-6, 0, 2.0],   // belső(0): levonás; közép(1): 0; külső/jobb(2): +pont
  overtake: 30,        // szabályos balról előzés
  rightPassPenalty: 15,// jobbról előztél
  crash: 150,          // baleset levonás
  gateDist: 1650,      // két kapu közti távolság (m)
  reqStart: 72,        // kért átlag a legelső kapunál (km/h)  — 20%-kal könnyebb
  reqStep: 0.64,       // átlag-elvárás emelkedése kapunként (km/h)
  gateBonus: 40,       // kapun való áthaladás bónuszpontja
};
// A kért átlagsebesség az adott számú teljesített kapu után (km/h).
export const reqAvg = (gates) => SCORE.reqStart + SCORE.reqStep * gates;

// Idő-alapú büntetések (s) — közvetlenül a kapu-órát apasztják, hogy a hatás
// látható legyen (az időbar pirosra/resell).  A kapu-szimulációból jön.
export const PEN = {
  noSignal: 3,   // index nélküli sávváltás
  cutIn: 5,      // bevágás / jobbról-előzés
};

// Kanera/irózók — vezetés közben belső (vezetőülési) nézet, a visszapillantó
// tükör a tényleges hátsó kaméra képét mutatja egy kicsi RT-textúrán.
export const CAMERA = {
  height: 5.0,
  dist: 8.6,
  lookAhead: 5.5,
  fov: 62,
  shakeK: 1.0,
  cockpit: { x: 0.32, y: 1.2, z: 0.12, lookAhead: 16, lookY: -2.6 },
  mirror: { front: 1.05, height: 1.5, fov: 46, lookBack: 70, lookY: 0.25 },
  // a céltextúra oldalarányát az üveghez igazítjuk (úveg 0.27x0.08 → 3.375:1),
  // hogy ne torzuljon; magasabb felbontás = élesebb tükörkép.
  mirrorSize: { w: 540, h: 160 },
};

// ---- Index(irányjelző) - KRESZ ----------------
export const SIGNAL = {
  points: 12,       // szabályosan indexelt sávváltás bónusz
  noSignalPenalty: 8, // irányjelzés nélküli sávváltás levonás
  autoOff: 3.0,     // ennyi idő után magától kikapcsol (mp)
  minLead: 0.2,     // a jelzés legalább ennyivel előzze meg a váltást
  blinkHz: 1.5,     // villogás frekvencia (percenkénti ciklus)
};

// Fizikai rögzített lépés (Hz)
export const PHYS_FIXED = 1 / 60;

// GlTF autómodellek (public/models) — betöltés előtt/véletlenül hiányzó fájl
// esetén a dobozos vészrájzolás marad, tehát nincs semmi függőség.
export const MODELS = {
  player: '/models/ferrari.glb',
  sedans: ['/models/ferrari.glb', '/models/sedan.glb'],
  truck: '/models/truck.glb',
  playerLen: 4.3,
  carLen: 4.35,
  truckLen: 6.4,
  // a threejs.org ferrari.glb orra -Z-be néz, így ezt a fájlt 180°-kal meg kell
  // fordítani; a sedan (ClearCoatCarPaint) és a truck orra már +Z-be (+ elöl van az orr).
  flip: { '/models/ferrari.glb': true },
};
