// Pontrendszer: kapu-közötti időköltségvetés + jobbra tartás + indexelés + baleset.
//
// A játék kapuk közt halad.  Minden kapunak „időköltségvetés” jut a kért
// átlagsebességből:  idő = táv / kértÁtlag.  A kapu-óra a következő kapuig fogy,
// és a LANE szerint OSZTOTT ütemben (laneRateByLane): a külső (jobb) sáv a
// leglassabb ütésű (nyerő), a belső (bal) sáv 1.8-szor gyorsabban apasztja.
// Így „csak jobbra tartva lehet nyerni”: aki belső/középső sávban kóborol,
// kifolyik az ideje.  Az időköltségvetést a kért átlag zárja a nehézséggel nő.
//
// A büntetések (index nélküli váltás, bevágás) szintén az órát apasztják, hogy
// látható legyen a hatásuk (az időbar pirosra ad, miközben a HUD mutatja a %-ot).
import { SCORE, SIGNAL, laneRateByLane, reqAvg, PEN } from './constants.js';

export class Scoring {
  constructor() {
    this.init();
  }

  init() {
    this.score = 0;
    this.parts = {
      right: 0, overtake: 0, overtakes: 0, gate: 0,
      penalty: 0, crash: 0,
      signal: 0, signalsOK: 0, noSignal: 0, noSignalCount: 0,
    };
    this.gates = 0;          // hány kapun mentünk át
    this.gateAcc = 0;        // megtett távolság a következő kapu felé (m)
    this.timedOut = false;   // lejárt-e a kapu-idő (játék vége)
    this.req = reqAvg(0);    // kért átlag km/h · az aktuális kapunál
    this.gateAvail = SCORE.gateDist / (this.req / 3.6); // időköltségvetés (s)
    this.gateT = this.gateAvail;
  }

  // Kötelező per-lépés hívás.
  // lane (0=belső/balkanyar, 1=közép, 2=külső/jobb) — megadja a fogyási ütemet.
  update(dt, lane) {
    // pont-flavor: maradj jobbra (külső sáv: +; belső: −) — a HUD pontszáma
    const pts = SCORE.lanePerSec[lane] * dt;
    this.score += pts;
    if (pts > 0) this.parts.right += pts;

    // KAPU-ÓRA sáv-függő fogyása (a lényeg: jobbra maradva fogy a leglassabban)
    this.gateT -= laneRateByLane[lane] * dt;
    if (this.gateT <= 0 && !this.timedOut) {
      this.gateT = 0;
      this.timedOut = true;
    }
  }

  // A játékos megtett `dist` métert a következő kapu felé.
  advance(dist) {
    this.gateAcc += dist;
    if (this.gateAcc >= SCORE.gateDist) {
      this.gateAcc -= SCORE.gateDist;
      this.gates++;
      const bonus = SCORE.gateBonus + Math.min(this.gates, 10) * 2; // növekvő kapu-bónusz
      this.score += bonus;
      this.parts.gate += bonus;
      // új kapu: a kért átlag emelkedik, ebből friss időköltségvetés
      this.req = reqAvg(this.gates);
      this.gateAvail = SCORE.gateDist / (this.req / 3.6);
      this.gateT = this.gateAvail; // újratölt — sikerült elézni a kaput
    }
  }

  // A kapu felé haladás aránya (0..1) — HUD sáv.
  gateFrac() {
    return Math.max(0, Math.min(1, this.gateAcc / SCORE.gateDist));
  }

  // A kapu-idő aránya (0..1) — az „élet” mérő.  FIGYELEM: az aktualis költségvetéshez.
  energyFrac() {
    return Math.max(0, Math.min(1, this.gateT / this.gateAvail));
  }

  // A jelenlegi kért átlagsebesség (km/h) — HUD kijelzés.
  reqAvg() { return this.req; }

  overtake() {
    this.score += SCORE.overtake;
    this.parts.overtake += SCORE.overtake;
    this.parts.overtakes++;
  }

  // Bevágás / jobbról-előzés.  Az órát csak akkor apasztjuk, ha a JÁTÉKOS az elkövető
  // (withTime = true): a bevágás látható időbüntetése. Ha valaki más húz ki jobbról
  // a játékos mellé (withTime = false), az csak pontlevonás + figyelmeztetés.
  penalty(withTime = true) {
    this.score -= SCORE.rightPassPenalty;
    this.parts.penalty += SCORE.rightPassPenalty;
    if (withTime) {
      this.gateT -= PEN.cutIn;
      if (this.gateT <= 0 && !this.timedOut) { this.gateT = 0; this.timedOut = true; }
    }
  }

  crash() {
    this.score -= SCORE.crash;
    this.parts.crash += SCORE.crash;
  }

  signalChange(proper) {
    if (proper) {
      this.score += SIGNAL.points;
      this.parts.signal += SIGNAL.points;
      this.parts.signalsOK++;
    } else {
      this.score -= SIGNAL.noSignalPenalty;
      this.parts.noSignal += SIGNAL.noSignalPenalty;
      this.parts.noSignalCount++;
      // LÁTHATÓ időbüntetés: az index nélküli váltás apasztja a kapu-órát
      this.gateT -= PEN.noSignal;
      if (this.gateT <= 0 && !this.timedOut) { this.gateT = 0; this.timedOut = true; }
    }
  }

  breakdown() {
    return [
      ['Jobbra tartás', Math.round(this.parts.right), ''],
      ['Szabályos előzés', Math.round(this.parts.overtake), this.parts.overtakes + ' alkalom'],
      ['Kapu bónusz', Math.round(this.parts.gate), this.gates + ' kapu'],
      ['Indexelt sávváltás', Math.round(this.parts.signal), this.parts.signalsOK + ' alkalom'],
      ['Index nélküli sávváltás', -this.parts.noSignal, this.parts.noSignalCount + ' alkalom'],
      ['Belső sáv (indokolatlan) tartás', 0, 'az óra gyorsult'],
      ['Bevágás/jobbról-előzés büntetés', -this.parts.penalty, 'idő is ment le'],
      ['Baleseti levonás', -this.parts.crash, ''],
    ];
  }
}
