// Globális állandók és játékmechanikai értékek (méter, m/s, km/h).

// ---- Útgeometria ----
// 1 egység = 1 méter. Az út az +Z tengely mentén halad (a haladási irány +Z).
export const LANES = 3;
export const LANE_W = 3.75;            // sávszélesség (m)
export const ROAD_HALF = LANE_W * 1.5; // út fele (3 sáv)
export const SHOULDER = 2.2;           // leállósáv/oldal (m)
export const BARRIER_X = ROAD_HALF + SHOULDER + 0.6; // korlát helye
export const GROUND_Y = 0;

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
  drag: 0.0042,     // légellenállás (v² szorzó) — végsebesség ~125 km/h
  steerLerp: 6.0,   // kormány be/kicsiklázás sebessége
  lateralK: 7.0,    // oldalesúszás csillapítás
  yawRate: 1.35,    // max fejfordulási sebesség (rad/s)
};

// ---- Forgalom ----
// Sávonkénti sebességtartomány (m/s) és kamion-arány.
export const TRAFFIC = {
  spawnBase: 0.95,  // átlagos spawn-időköz (s)
  spawnMin: 0.5,
  maxCars: 22,
  waits: [0.2, 0.38, 0.42],   // sáv kiválasztás valószínűsége (bal, közép, jobb)
  speedByLane: [
    [30, 38],   // bal sáv: gyorsak
    [25, 32],   // közép
    [19, 27],   // jobb sáv: lassúak + kamionok
  ],
  truckSpeed: [16, 21], // kamion (jobb sáv)
  truckChance: 0.55,    // a jobb sávban mekkora eséllyel kamion
  spawnNear: 95,        // legközelebbi spawn-távolság (m)
  spawnSpan: 75,        // spawn-eltolástartomány (m)
  minGap: 55,           // azonos sávú min. távolság a spawn-nál
  behindChance: 0.5,    // esély, hogy a spawn hátulról jövő gyors autót rakjon (tükör!)
  behindStart: 70,      // indulási távolság mögöttünk (m)
  behindSpan: 70,
  behindSpeed: [38, 46], // a gyors bal-sávos utolérők sebessége (m/s)
};

// ---- Pontozás ----
export const SCORE = {
  lanePerSec: [0, 1.2, 3.0], // bal, közép, jobb sáv (pont/mp)
  overtake: 30,        // szabályos előzés
  rightPassPenalty: 15,// jobbról előztek / jobbról előztél
  crash: 150,          // baleset levonás
  sectionLen: 10,      // szakasz hossza (s)
  ecoBase: 11,         // bónusz = átlagEco% * 11 * szorzó
  streakGreen: 72,     // átlag felett nő a szorzó
  streakRed: 45,       // alatta nullázódik
  multMax: 3.5,
  multStep: 0.5,
};

// ---- Gazdaságossági mérő ----
export const ECO = {
  harshFloor: 0.18, // e fölött a gáz/fék már "rángatós"
  harshDrain: 60,   // teljes rángatás esetén ennyit veszít /s
  devDrain: 7.0,    // zöldzónától távolodva /s
  recover: 2.4,     // nyugodt vezetés alatt visszatöltés /s
  max: 100,
};

// Kanera/irózók — vezetés közben belső (vezetőülési) nézet, a visszapillantó
// tükör a tényleges hátsó kaméra képét mutatja egy kicsi RT-textúrán.
export const CAMERA = {
  height: 5.0,
  dist: 8.6,
  lookAhead: 5.5,
  fov: 62,
  shakeK: 1.0,
  cockpit: { x: 0.38, y: 1.02, z: 0.12, lookAhead: 20, lookY: 0.55 },
  mirror: { front: 1.05, height: 1.5, fov: 46, lookBack: 70, lookY: 0.25 },
  mirrorSize: { w: 420, h: 105 },
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
};
