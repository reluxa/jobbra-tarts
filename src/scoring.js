// Pontrendszer: jobbra tartás + előzés/balon-araszolás szabályai + gazdaságossági
// szakasz-bónusz. A gáz/fék analóg értéket (0..1) kap, hogy a finom vezetésnek
// legyen tétje: a "rángatós" használat vágja a simaság-mérőt.
import { ECO, SCORE } from './constants.js';

export class Scoring {
  constructor() {
    this.onSection = null; // (bonus, avgEco, mult, streak) => void
    this.init();
  }

  init() {
    this.score = 0;
    this.parts = {
      right: 0, overtake: 0, overtakes: 0,
      bonus: 0, penalty: 0, crash: 0,
    };
    this.eco = 100;
    this.sectionSum = 0;
    this.sectionFrames = 0;
    this.sectionT = SCORE.sectionLen;
    this.streak = 0;
    this.bonusCount = 0;
  }

  get mult() {
    return Math.min(SCORE.multMax, 1 + SCORE.multStep * this.streak);
  }

  // dt, lane (0..2), speedMps, throttleA (0..1), brakeA (0..1)
  update(dt, lane, speedMps, throttleA, brakeA) {
    // -- jobbra tartás --
    const lanePts = SCORE.lanePerSec[lane] * dt;
    this.score += lanePts;
    this.parts.right += lanePts;

    // -- gazdaságosság --
    const harshness = Math.max(0, (Math.max(throttleA, brakeA) - ECO.harshFloor)) / (1 - ECO.harshFloor);
    const dev = Math.abs(speedMps - 29) / 40; // zöldzóna: ~97-112 km/h
    this.eco = Math.max(0, Math.min(ECO.max,
      this.eco - harshness * ECO.harshDrain * dt - dev * ECO.devDrain * dt + ECO.recover * dt));

    this.sectionSum += this.eco;
    this.sectionFrames++;
    this.sectionT -= dt;
    if (this.sectionT <= 0) {
      this.sectionT += SCORE.sectionLen;
      this.settleSection();
    }
  }

  settleSection() {
    const avg = this.sectionFrames > 0 ? this.sectionSum / this.sectionFrames : 0;
    this.sectionSum = 0;
    this.sectionFrames = 0;

    if (avg >= SCORE.streakGreen) this.streak += 1;
    else if (avg < SCORE.streakRed) this.streak = 0;

    const bonus = Math.round(avg * SCORE.ecoBase * this.mult);
    if (bonus >= 5) {
      this.score += bonus;
      this.parts.bonus += bonus;
      this.bonusCount++;
      if (this.onSection) this.onSection(bonus, avg, this.mult, this.streak);
    }
  }

  overtake() {
    this.score += SCORE.overtake;
    this.parts.overtake += SCORE.overtake;
    this.parts.overtakes++;
  }

  penalty() {
    this.score -= SCORE.rightPassPenalty;
    this.parts.penalty += SCORE.rightPassPenalty;
  }

  crash() {
    this.score -= SCORE.crash;
    this.parts.crash += SCORE.crash;
    this.streak = 0;
  }

  // Az állapot "halad a szakasz" arányát adja a HUD-sávhoz (0..1)
  sectionFrac() {
    return 1 - Math.max(0, this.sectionT) / SCORE.sectionLen;
  }

  breakdown() {
    return [
      ['Jobbra tartás', Math.round(this.parts.right), ''],
      ['Szabályos előzés', Math.round(this.parts.overtake), this.parts.overtakes + ' alkalom'],
      ['Gazdaságossági bónusz', Math.round(this.parts.bonus), this.bonusCount + ' szakasz'],
      ['Jobbról-előzés büntetés', -this.parts.penalty, ''],
      ['Baleseti levonás', -this.parts.crash, ''],
    ];
  }
}
