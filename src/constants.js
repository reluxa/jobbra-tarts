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
  accel: 13.0,      // m/s² teljes gáznál (analóg gázzal finoman adagolható)
  brake: 24.0,      // m/s² teljes fékezésnél
  drag: 0.014,      // légellenállás (v² szorzó)
  steerLerp: 6.0,   // kormány be/kicsiklázás sebessége
  lateralK: 7.0,    // oldalesúszás csillapítás
  yawRate: 1.35,    // max fejfordulási sebesség (rad/s)
};

// ---- Forgalom ----
// Sávonkénti sebességtartomány (m/s) és kamion-arány.
export const TRAFFIC = {
  spawnBase: 2.1,   // kezdeti átlagos spawn-időköz (s)
  spawnMin: 0.8,
  maxCars: 16,
  waits: [0.16, 0.3, 0.54],   // sáv kiválasztás valószínűsége (bal, közép, jobb)
  speedByLane: [
    [30, 38],   // bal sáv: gyorsak
    [25, 32],   // közép
    [19, 27],   // jobb sáv: lassúak + kamionok
  ],
  truckSpeed: [16, 21], // kamion (jobb sáv)
  truckChance: 0.55,    // a jobb sávban mekkora eséllyel kamion
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

// ---- Kamera ----
export const CAMERA = {
  height: 5.0,
  dist: 8.6,
  lookAhead: 5.5,
  fov: 62,
  shakeK: 1.0,
};

// Fizikai rögzített lépés (Hz)
export const PHYS_FIXED = 1 / 60;
