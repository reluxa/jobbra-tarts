// A játékmenet EGYETLEN logikája — grafika és fizikafolyam nélkül, tiszta
// számokkal. A valódi játék (main.js) ÉS a fej nélküli ellenőrzések (scripts/)
// ugyanezt a motort futtatják: ami a tesztekben történik, az a játékban is az.
//
// Az eseményeket az `onEvent` hook közli: overtake / penalty / crash / gate /
// wrap / laneChange / laneBlocked / timeout / gameOver — a nézet (Game) ezekből
// popupokat, hangokat és HUD-t épít, a napló pedig az ellenőrzés alapja.
import {
  BARRIER_X, CAR, DRIVE, SCORE, SIGNAL, TRAFFIC, WORLD,
  laneCenterX,
} from '../constants.js';
import { Scoring } from '../scoring.js';
import { makeRng } from './prng.js';
import { SimPlayer, makeCar, setRadar } from './state.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

const PLAYER_HALF_X = 0.95;
const PLAYER_HALF_Z = CAR.half.z; // 2.05
const CAR_HALF_X = 0.95;
const CRASH_CLOSING = 6;          // a cannon-os „enyhe súrlódás” küszöb

export class SimEngine {
  constructor({ seed = null } = {}) {
    this.seed = seed;
    this.rng = makeRng(seed);
    this.onEvent = null;   // (ev) => void
    this.reset();
  }

  reset() {
    this.scoring = new Scoring();
    this.player = new SimPlayer();
    this.cars = [];
    this.spawnTimer = 1.5;
    this.time = 0;
    this.dist = 0;
    this.t = 0;
    this.lives = 3;
    this.crashCount = 0;
    this.prevLane = 2;
    this.timeoutDone = false;
    this.emit({ kind: 'start' });
  }

  emit(ev) {
    ev.t = this.t;
    if (this.onEvent) this.onEvent(ev);
  }

  difficulty() { return Math.min(1, this.dist / 2400); }

  // ---- játékos (a DRIVE/radar/sávváltás portja a régi player.step-ből) ----
  playerStep(dt) {
    const p = this.player;
    const maxV = CAR.maxSpeed;
    const cruiseTarget = p.invincible > 0 ? p.cruise * 0.55 : p.cruise;
    const target = Math.min(cruiseTarget, p.radarTarget);
    let v = p.speed;
    const acc = DRIVE.accel * (1 - v / maxV);
    if (v < target) v = Math.min(target, v + acc * dt);
    else v = Math.max(target, v - DRIVE.brake * dt);
    v -= v * v * DRIVE.drag * dt;
    v = clamp(v, 0, maxV);
    p.speed = v;

    // automatikus sávváltás (smoothstep tween az x-re, enyhe yaw behúzással)
    if (p.laneChange) {
      const lc = p.laneChange;
      lc.t += dt;
      const k = Math.min(1, lc.t / DRIVE.laneChange);
      const e = k * k * (3 - 2 * k);
      p.x = laneCenterX(lc.from) + (laneCenterX(lc.to) - laneCenterX(lc.from)) * e;
      const s = lc.from < lc.to ? -1 : 1;
      p.steer = s;
      p.yaw = s * 0.3 * Math.sin(Math.PI * k);
      if (k >= 1) {
        p.x = laneCenterX(lc.to);
        p.yaw = 0;
        p.steer = 0;
        p.laneChange = null;
      }
    } else {
      p.steer = 0;
      p.yaw = 0;
    }

    // haladás +Z (a cannonos integráció helyett közvetlen)
    p.z += v * dt;
    p.fwdSpeed = v;

    // kasztni-magasság kényelmi visszarántása (orkán nélküli)
    p.y = CAR.restY;

    // korlát: az út szélén nem mehetünk ki
    const limitX = BARRIER_X - 1.6;
    if (Math.abs(p.x) > limitX) {
      p.x = Math.sign(p.x) * limitX;
      p.speed *= 0.85;
      v *= 0.85;
      p.fwdSpeed = v;
    }

    // index (villogás + auto-kikapcsolás)
    if (p.signal) {
      p.signalT += dt;
      p.blinkPhase = (p.blinkPhase + dt * SIGNAL.blinkHz) % 1;
      if (p.signalT >= SIGNAL.autoOff) p.signal = 0;
    }
  }

  // ---- forgalom (a régi traffic.update teljes portja) ----
  aheadInLane(lane, z, maxDist = 140) {
    let best = null, bestDist = Infinity;
    for (const c of this.cars) {
      if (c.ghost || c.lane !== lane) continue;
      const d = c.z - z;
      if (d > 2 && d < bestDist && d < maxDist) { bestDist = d; best = c; }
    }
    return best ? { speed: best.speed, gap: bestDist } : null;
  }

  canChangeTo(to, z) {
    const cx = laneCenterX(to);
    for (const o of this.cars) {
      if (o.ghost) continue;
      const d = o.z - z;
      if (d > -TRAFFIC.changeBehind && d < TRAFFIC.changeAhead &&
          Math.abs(o.x - cx) < 2.3) return false;
    }
    return true;
  }

  // A játékos sávváltásának teljes folyamata (a Game és az agent is ezt hívja):
  // 'ok' sikeres indulás, 'edge' a szélen nem megy, 'busy' már tart egy váltás,
  // 'blocked' a cél-sáv foglalt (laneBlocked esemény).
  playerChangeLane(dir) {
    const p = this.player;
    const from = p.laneIndex();
    const to = clamp(Math.round(from + dir), 0, 2);
    if (p.laneChange) return 'busy';
    if (to === from) return 'edge';
    if (!this.canChangeTo(to, p.z)) {
      this.emit({ kind: 'laneBlocked', from, to, dir });
      return 'blocked';
    }
    p.requestLaneChange(dir);
    return 'ok';
  }

  spawn(playerZ, difficulty = 0, near = 0, forcedLane = -1) {
    if (this.cars.length >= TRAFFIC.maxCars) return;
    const lane = forcedLane >= 0 ? forcedLane : this.pickLane();
    const truck = lane === 2 && this.rng() < TRAFFIC.truckChance;
    const z = near > 0
      ? playerZ + near + this.rng() * 45
      : playerZ + TRAFFIC.spawnNear + this.rng() * TRAFFIC.spawnSpan + difficulty * 15;

    const speed = this.pickSpeed(lane, truck);
    if (near > 0) {
      this.cars.push(makeCar(lane, truck, speed, z, this.rng));
      return;
    }
    for (const c of this.cars) {
      if (c.lane === lane && Math.abs(c.z - z) < TRAFFIC.minGap) return;
    }
    this.cars.push(makeCar(lane, truck, speed, z, this.rng));
  }

  spawnBehind(player) {
    if (this.cars.length >= TRAFFIC.maxCars) return;
    const lane = 0;
    const speed = TRAFFIC.behindSpeed[0] + this.rng() * (TRAFFIC.behindSpeed[1] - TRAFFIC.behindSpeed[0]);
    const z = player.z - (TRAFFIC.behindStart + this.rng() * TRAFFIC.behindSpan);
    this.cars.push(makeCar(lane, false, speed, z, this.rng));
  }

  pickLane() {
    const r = this.rng();
    let acc = 0;
    for (let i = 0; i < 3; i++) {
      acc += TRAFFIC.waits[i];
      if (r < acc) return i;
    }
    return 2;
  }

  pickSpeed(lane, truck) {
    if (truck) {
      const [lo, hi] = TRAFFIC.truckSpeed;
      return lo + this.rng() * (hi - lo);
    }
    const [lo, hi] = TRAFFIC.speedByLane[lane];
    return lo + this.rng() * (hi - lo);
  }

  trafficStep(dt) {
    this.time += dt;
    const p = this.player;
    const difficulty = this.difficulty();

    // mozgás + NPC sávváltás + konvoj-összetapadás
    const byLane = [[], [], []];
    for (const c of this.cars) {
      c.z += c.speed * dt;
      if (c.changeLane != null) this.advanceLaneChange(c, dt);
      if (c.ghost) continue;
      byLane[c.lane].push(c);
    }
    for (const laneArr of byLane) {
      laneArr.sort((a, b) => a.z - b.z);
      for (let i = 1; i < laneArr.length; i++) {
        const rear = laneArr[i - 1], front = laneArr[i];
        if (front.z - rear.z < (front.len + rear.len) / 2 + 16) {
          rear.speed = front.speed;
        }
      }
    }

    // fékezés a sávban elöl haladó lassabb jármű mögött
    for (const c of this.cars) {
      if (c.ghost) continue;
      let braked = false;
      const f = this.frontInLane(c);
      if (f) {
        const fspeed = f.isPlayer ? p.fwdSpeed : f.o.speed;
        const closing = c.speed - fspeed;
        if (closing > 0.5) {
          const safe = 4 + closing * 0.85;
          if (f.gap < safe + 16) {
            const k = 1 - (f.gap / (safe + 16));
            const brake = Math.max(2, closing * 2.2 * (0.3 + 0.7 * k));
            c.speed = Math.max(fspeed, c.speed - brake * dt);
            braked = true;
          }
        } else if (f.gap < 3) {
          c.speed = fspeed;
          braked = true;
        }
      }
      if (!braked) {
        const d = Math.min(1.2 * dt, Math.abs(c.baseSpeed - c.speed));
        if (c.speed < c.baseSpeed) c.speed += d;
        else if (c.speed > c.baseSpeed) c.speed -= d;
      }
    }

    this.npcAI(dt);

    // elhaladás-értékelés (KRESZ-pontozás) — A TÉNYLEGES ELHALADÁS PILLANATÁBAN
    // (az autó a játékos MÖGÉ került), nem a spawn-nál:
    for (const c of this.cars) {
      if (c.ghost) continue;
      if (!c.passed && c.z < p.z - 2) {
        c.passed = true;
        this.evalPass(c);
      }
    }

    // törlés (lemaradtak / nagy távolságra kerültek)
    for (let i = this.cars.length - 1; i >= 0; i--) {
      const c = this.cars[i];
      if (c.ghost) continue;
      if ((c.z < p.z - 40 && c.speed <= p.fwdSpeed + 1) || c.z > p.z + 240) {
        this.cars.splice(i, 1);
      }
    }

    // spawnolás
    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0) {
      if (this.rng() < TRAFFIC.behindChance) this.spawnBehind(p);
      else this.spawn(p.z, difficulty);
      const base = Math.max(TRAFFIC.spawnMin, TRAFFIC.spawnBase - this.time * 0.014);
      this.spawnTimer = base * (0.7 + this.rng() * 0.6);
    }
  }

  advanceLaneChange(c, dt) {
    const tx = laneCenterX(c.changeLane);
    const diff = tx - c.x;
    const step = Math.max(-6 * dt, Math.min(6 * dt, diff));
    c.x += step;
    if (Math.abs(tx - c.x) < 0.02) {
      c.x = tx;
      c.lane = c.changeLane;
      c.changeLane = null;
    }
  }

  frontInLane(c) {
    let best = null, bd = Infinity, len = 2;
    for (const o of this.cars) {
      if (o === c || o.ghost || o.lane !== c.lane) continue;
      const d = o.z - c.z;
      if (d > 0 && d < bd) { bd = d; best = o; len = o.len; }
    }
    const p = this.player;
    if (c.lane === p.laneIndex()) {
      const d = p.z - c.z;
      if (d > 0 && d < bd) { bd = d; best = { player: true }; len = PLAYER_HALF_Z * 2 + 0.2; }
    }
    return best ? { o: best, isPlayer: best.player === true, gap: bd, len } : null;
  }

  blockingCar(c) {
    let best = null, bd = Infinity;
    for (const o of this.cars) {
      if (o === c || o.ghost || o.lane !== c.lane) continue;
      const d = o.z - c.z;
      if (d > 0 && d < bd && o.speed < c.speed - 4) { bd = d; best = o; }
    }
    const p = this.player;
    if (c.lane === p.laneIndex()) {
      const d = p.z - c.z;
      if (d > 0 && d < bd && p.fwdSpeed < c.speed - 4) { bd = d; best = { player: true }; }
    }
    return best ? { o: best, isPlayer: best.player === true, gap: bd } : null;
  }

  laneClear(c, toLane) {
    const cx = laneCenterX(toLane);
    const near = (x) => Math.abs(x - cx) < 2.3;
    for (const o of this.cars) {
      if (o === c || o.ghost) continue;
      const d = o.z - c.z;
      if (Math.abs(d) < 46 && near(o.x)) return false;
    }
    if (Math.abs(this.player.z - c.z) < 46 && near(this.player.x)) return false;
    return true;
  }

  npcAI(dt) {
    for (const c of this.cars) {
      if (c.ghost) continue;
      c.aiT -= dt;
      if (c.changeLane !== null || c.aiT > 0) continue;
      c.aiT = 1.2 + this.rng() * 1.8;

      const L = c.lane, blk = this.blockingCar(c);
      if (blk && L < 2 && this.laneClear(c, L + 1)) {
        c.changeLane = L + 1;
        c.returnLane = L;
        c.returnT = 5 + this.rng() * 5;
        continue;
      }
      if (L > 0 && c.returnLane !== undefined) {
        if (c.returnT !== undefined) c.returnT -= dt;
        if (c.returnT <= 0 && !blk && this.laneClear(c, L - 1)) {
          c.changeLane = L - 1;
          c.returnLane = undefined;
          c.returnT = undefined;
        }
      }
    }
  }

  evalPass(car) {
    const p = this.player;
    if (p.invincible > 0.7) return;
    const pL = p.laneIndex();
    const cL = car.lane;
    const pV = p.fwdSpeed;
    const cV = car.speed;

    if (pL === cL) return;
    if (pL < cL) {
      if (pV >= cV) {
        this.scoring.overtake();
        this.emit({ kind: 'overtake', car, text: '+30 ÉLŐZÉS', color: '#7dffa0' });
      } else {
        this.emit({ kind: 'passed', text: 'Balról előztek (rendben)', color: '#9ad0ff' });
      }
    } else {
      if (pV > cV) {
        this.scoring.penalty(true);
        this.emit({ kind: 'penalty', selfDidIt: true, car, text: 'Jobbról előztél! -15', color: '#ff8a80' });
      }
    }
  }

  // ---- ütközés (geometriai, a cannon-kontakt helyett) ----
  checkCollisions() {
    const p = this.player;
    for (const c of this.cars) {
      if (c.ghost) continue;
      const dz = c.z - p.z;
      const dx = c.x - p.x;
      if (Math.abs(dz) >= PLAYER_HALF_Z + c.len / 2) continue;
      if (Math.abs(dx) >= PLAYER_HALF_X + CAR_HALF_X) continue;
      const approach = Math.max(0, p.fwdSpeed - c.speed);
      if (approach < CRASH_CLOSING) continue;   // enyhe súrlódás, nem baleset
      this.crashWith(c, approach);
      return;
    }
  }

  crashWith(entry, approach) {
    const p = this.player;
    if (p.invincible > 0) return;
    this.lives--;
    this.crashCount++;
    this.scoring.crash();
    p.speed = Math.max(0, p.speed - approach * 0.85);
    p.fwdSpeed = p.speed;
    p.yaw += (this.rng() - 0.5) * 0.9;
    p.invincible = 2.5;
    this.emit({ kind: 'crash', car: entry, approach, lives: this.lives });
  }

  // Teszt-obstacle: a játékos sávjába állított, garantált ütközést adó autó.
  // A régi cannon-változat kinematikus, ÁLLÓ doboz volt — a sim-beli is álljon,
  // különben a radar pont a tempójára fékez, és sosem ér utol.
  addObstacle(speed, z, lane = 2) {
    const entry = makeCar(lane, false, 0, z, this.rng);
    entry.passed = true;
    entry.ghost = false;
    entry.speed = 0;
    entry.baseSpeed = 0;
    entry.changeLane = null;
    entry.aiT = Infinity;   // ne kószáljon el a teszt közben
    this.cars.push(entry);
    return entry.uid;
  }

  removeObstacle(uid) {
    this.cars = this.cars.filter((c) => c.uid !== uid);
  }

  // ---- kapu / wrap ----
  scoringStep(dt) {
    const p = this.player;
    this.scoring.update(dt, p.laneIndex());
    const fwd = Math.max(0, p.fwdSpeed);
    const gatesBefore = this.scoring.gates;
    this.scoring.advance(fwd * dt);
    if (this.scoring.gates !== gatesBefore) {
      const bonus = SCORE.gateBonus + Math.min(this.scoring.gates, 10) * 2;
      this.emit({ kind: 'gate', bonus, gates: this.scoring.gates });
    }
    if (this.scoring.timedOut && !this.timeoutDone) {
      this.timeoutDone = true;
      this.emit({ kind: 'timeout', score: this.scoring.score });
    }
  }

  wrapStep() {
    const p = this.player;
    if (p.z <= WORLD.wrapAt) return;
    const snapZ = p.z - WORLD.wrapTo;
    const delta = Math.round(snapZ / WORLD.tile) * WORLD.tile;
    const before = this.cars.map((c) => c.z - p.z);
    p.z -= delta;
    for (const c of this.cars) c.z -= delta;
    const after = this.cars.map((c) => c.z - p.z);
    this.emit({
      kind: 'wrap', delta, pz: p.z,
      cars: this.cars.length,
      distInvariant: Math.max(0, ...before.map((d, i) => Math.abs(d - after[i]))),
    });
  }

  // ---- teljes lépés (a régi Game.fixed logikája) ----
  tick(dt) {
    this.t += dt;
    this.playerStep(dt);
    this.dist += Math.max(0, this.player.fwdSpeed) * dt;
    this.player.cruise = DRIVE.cruise + (DRIVE.cruiseMax - DRIVE.cruise) * this.difficulty();
    this.trafficStep(dt);
    this.checkCollisions();
    this.scoringStep(dt);

    // radar-tempomat: a saját sávban elöl haladó tempója (a következő lépés célsebessége)
    const ahead = this.aheadInLane(this.player.laneIndex(), this.player.z);
    setRadar(this.player, ahead ? ahead.gap : Infinity, ahead ? ahead.speed : 600);

    // sávváltás-értékelés (KRESZ-pontozás + index-bónusz)
    const lane = this.player.laneIndex();
    if (lane !== this.prevLane) {
      const dir = Math.sign(lane - this.prevLane);
      const p = this.player;
      const led = p.signal === dir && p.signalT >= SIGNAL.minLead;
      // (az automatikus kikapcsolásnál nincs külön felső határ: ha a jelzés
      // közben lejárt, az auto-off miatt úgyis 0-n áll, és nem jár a bónusz)
      this.scoring.signalChange(led);
      this.emit({ kind: 'laneChange', from: this.prevLane, to: lane, dir, led });
      if (led) p.signal = 0;
    }
    this.prevLane = lane;

    if (this.player.invincible > 0) this.player.invincible -= dt;

    this.wrapStep();
    if (this.lives <= 0) {
      this.emit({ kind: 'gameOver', reason: 'crash' });
      this.lives = 99; // ne duplázzuk
    }
  }

  // Az induló forgalom (a régi Game.start 4 közelautó + tükör-autó).
  seedStartTraffic() {
    this.spawn(this.player.z, 0, 25, 1);
    this.spawn(this.player.z, 0, 55, 0);
    this.spawn(this.player.z, 0, 90, 1);
    this.spawn(this.player.z, 0, 140, 2);
    this.spawnBehind(this.player);
  }

  // Nyers képsor-kép az ellenőrzéshez (bármi, amit a napló kér).
  debug() {
    const p = this.player;
    return {
      lives: this.lives, cars: this.cars.length,
      score: Math.round(this.scoring.score), gates: this.scoring.gates,
      gateT: +this.scoring.gateT.toFixed(1),
      kmh: Math.round(Math.abs(p.fwdSpeed) * 3.6),
      pos: [+p.x.toFixed(2), +p.y.toFixed(2), +p.z.toFixed(2)],
      yaw: +(p.yaw * 180 / Math.PI).toFixed(1),
      dist: Math.round(this.dist), crashCount: this.crashCount,
      sig: p.signal, lane: p.laneIndex(),
      radar: p.radarOn ? +p.radarGap.toFixed(1) : 0,
      sigOK: this.scoring.parts.signalsOK,
      sigNo: this.scoring.parts.noSignalCount,
    };
  }
}
