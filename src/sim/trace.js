// Esemény- és mintanapló egy szimulációs futásról: ezt nyomtatja ki az
// ellenőrző, és ebből rajzol a sim-view.html idővonal.
//
// FONTOS: az eseményekhez tartozó autó-adatokat (pl. az elhaladás pillanatában
// az autó pozíciója) a RÖGZÍTÉS PILLANATÁBAN kell lefényképezni — élő objektum
// referenciát tárolva a napló a futás VÉGÉN elavult értéket mutatna (a paritás-
// teszt ezért nem is egyezne a böngészőoldali azonnali pillanatképpel).
//
// Formátum (JSON):
//   { meta: {seed, dt, laps…}, events: [{t, kind, …}], samples: [{t, z, lane,
//     kmh, gateT, energy, cars, score}], ended: {ok, reason, stats} }

export class TraceRecorder {
  constructor(engine, { sampleEvery = 0.1 } = {}) {
    this.engine = engine;
    this.sampleEvery = sampleEvery;
    this.events = [];
    this.samples = [];
    this.lastSample = 0;
    engine.onEvent = (ev) => this.events.push(JSON.parse(JSON.stringify(ev)));
  }

  sample() {
    const s = this.engine.debug();
    this.samples.push({
      t: +this.engine.t.toFixed(3),
      z: +this.engine.player.z.toFixed(1),
      x: +this.engine.player.x.toFixed(2),
      lane: this.engine.player.laneIndex(),
      kmh: s.kmh,
      gateT: +this.engine.scoring.gateT.toFixed(2),
      energy: +this.engine.scoring.energyFrac().toFixed(3),
      gateFrac: +this.engine.scoring.gateFrac().toFixed(3),
      gates: s.gates,
      score: s.score,
      cars: s.cars,
    });
  }

  // Futtatás `seconds` szimulált másodpercig, adott agent politikával.
  run(agent, seconds) {
    const engine = this.engine;
    const dt = 1 / 60;
    const total = Math.round(seconds / dt);
    for (let i = 0; i < total; i++) {
      if (agent) agent.decide(engine);
      engine.tick(dt);
      while (engine.t - this.lastSample >= this.sampleEvery) {
        this.lastSample += this.sampleEvery;
        this.sample();
      }
      if (this.ended()) break;
    }
  }

  ended() {
    const evs = this.events;
    return evs.some((e) => e.kind === 'timeout' || e.kind === 'gameOver');
  }

  eventsByKind(kind) {
    return this.events.filter((e) => e.kind === kind);
  }

  summary() {
    const e = this.engine;
    return {
      t: +e.t.toFixed(1),
      dist: Math.round(e.dist),
      laps: Math.round(e.dist / 2400),
      gates: e.scoring.gates,
      score: Math.round(e.scoring.score),
      crashes: e.crashCount,
      lives: e.lives,
      wraps: this.eventsByKind('wrap').length,
      overtakes: this.eventsByKind('overtake').length,
      penalties: this.eventsByKind('penalty').length,
      end: this.events.filter((x) => x.kind === 'timeout' || x.kind === 'gameOver')[0]?.kind || 'futás vége',
    };
  }

  toJSON() {
    return {
      meta: { seed: this.engine.seed ?? null, dt: 1 / 60 },
      events: this.events,
      samples: this.samples,
      summary: this.summary(),
    };
  }

  // Emberi olvasható eseménynapló (a CLI-hez).
  readable() {
    const lines = [];
    for (const e of this.events) {
      switch (e.kind) {
        case 'start': lines.push(`t=${e.t.toFixed(1)}s  _____ INDULÁS _____`); break;
        case 'laneChange':
          lines.push(`t=${e.t.toFixed(1)}s  SÁVVÁLTÁS ${e.from}→${e.to} (dir=${e.dir}) ${e.led ? 'INDEXELVE +' + 12 : 'index NÉLKÜL -8/-3s'}`);
          break;
        case 'overtake': lines.push(`t=${e.t.toFixed(1)}s  +30 ELŐZÉS (balról, autó sáv=${e.car.lane})`); break;
        case 'penalty': lines.push(`t=${e.t.toFixed(1)}s  -15 JOBBRÓL-ELŐZÉS (te követted el?)`); break;
        case 'passed': lines.push(`t=${e.t.toFixed(1)}s  balról megelőztek (rendben)`); break;
        case 'laneBlocked': lines.push(`t=${e.t.toFixed(1)}s  SÁV FOGLALT (${e.to})`); break;
        case 'crash': lines.push(`t=${e.t.toFixed(1)}s  💥 BALESET (élet=${e.lives})`); break;
        case 'gate': lines.push(`t=${e.t.toFixed(1)}s  KAPU ✓ #${e.gates} (+${e.bonus} pont)`); break;
        case 'wrap': lines.push(`t=${e.t.toFixed(1)}s  WRAP δ=${e.delta}m (invariáns-eltérés=${e.distInvariant.toFixed(4)})`); break;
        case 'timeout': lines.push(`t=${e.t.toFixed(1)}s  IDŐ LEJÁRT — VÉGE`); break;
        case 'gameOver': lines.push(`t=${e.t.toFixed(1)}s  JÁTÉK VÉGE (${e.reason})`); break;
        default: lines.push(`t=${e.t.toFixed(1)}s  ${e.kind} ${JSON.stringify(e)}`);
      }
    }
    const s = this.summary();
    lines.push(`----- ÖSSZEFOGLALÓ -----`);
    lines.push(`t=${s.t}s · ${s.dist}m · ${s.gates} kapu · ${s.score} pont · ${s.crashes} baleset · ${s.wraps} wrap · vége: ${s.end}`);
    return lines.join('\n');
  }
}
