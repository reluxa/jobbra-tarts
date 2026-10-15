// A szimuláció tiszta (grafika nélküli) állapota: a játékos és a forgalom
// puszta számok, amelyből a Game (nézet) minden látványt felépít.
import { CAR, DRIVE, LANE_W, SIGNAL, laneCenterX } from '../constants.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export class SimPlayer {
  constructor() {
    this.x = laneCenterX(2);       // sávpozíció (m)
    this.z = 0;                    // haladási pozíció (m)
    this.y = CAR.restY;            // kasztni-magasság
    this.speed = 0;                // hosszirányú sebesség (m/s)
    this.fwdSpeed = 0;             // alias (HUD/előzés-logika)
    this.steer = 0;                // vizuális befordítás
    this.yaw = 0;                  // fejirány (rad)
    this.laneChange = null;        // {from,to,t} — folyamatban lévő automata váltás
    this.invincible = 0;           // baleset utáni sebezhetetlenség (s)
    this.cruise = DRIVE.cruise;    // utazósebesség (a nehézséggel nő)
    this.radarTarget = 600;        // radar-tempomat célsebesség
    this.radarOn = false;
    this.radarGap = Infinity;
    this.signal = 0;               // -1 bal / 0 ki / +1 jobb
    this.signalT = 0;
    this.blinkPhase = 0;
  }

  laneIndex() {
    return clamp(Math.round(1 - this.x / LANE_W), 0, 2);
  }

  signalAct() { return this.signal !== 0; }

  signalOn() { return this.signal !== 0 && this.blinkPhase < 0.5; }

  requestLaneChange(dir) {
    if (this.laneChange) return false;             // már váltunk
    const from = this.laneIndex();
    const to = clamp(Math.round(from + dir), 0, 2);
    if (to === from) return false;                 // a szélen nem megyünk odébb
    this.laneChange = { from, to, t: 0 };
    return true;
  }

  toggleSignal(dir) {
    this.signal = this.signal === dir ? 0 : dir;
    this.signalT = 0;
  }
}

// Radar-tempomat bemenete: következő jármű elöl, azonos sávban.
// Hiszterézis, hogy ne oszcilláljon (ENGAGE közel / RELEASE távol).
export function setRadar(p, gap, speed) {
  const ENGAGE = 22, RELEASE = 42;
  p.radarGap = gap;
  if (gap === Infinity || gap > RELEASE) {
    p.radarOn = false;
    p.radarTarget = 600;
  } else if (gap < ENGAGE || p.radarOn) {
    p.radarOn = true;
    p.radarTarget = Math.max(1, speed);
  }
}

// Egy forgalmi autó (a fizikai test/kasztni nélkül).
export function makeCar(lane, truck, speed, z, rng) {
  return {
    uid: (rng ? Math.floor(rng() * 1e9) : 0) >>> 0,
    lane,
    x: laneCenterX(lane),
    z,
    speed,
    truck,
    len: truck ? 6.4 : 4.35,
    passed: false,
    ghost: false,
    baseSpeed: speed,
    changeLane: null,
    aiT: rng ? rng() * 2 : 0,
    returnLane: undefined,
    returnT: undefined,
  };
}
