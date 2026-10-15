// Vezetési politikák az ellenőrző futtatásokhoz. Mindegyik `decide(engine)`-t
// ad: minden fixed-lépés előtt eldönti, mit csináljon a játékos (sávváltás,
// index). Így a szcenáriók emberi játék nélkül, DETERMINISZTIKUSAN lefutnak
// (a döntések csak a motor állapotától függenek, rng-t nem használnak).

// Mindig a jobb külső sávban tartózkodik; ha valamiért feljebb került,
// jobbra indexelve visszatér. Lassú jármű előtt NEM előzi át jobbról
// (az büntetés) — bal sávra indexelve megelőzi, majd visszatér, de csak
// akkor, ha a megelőzött autó már legalább 25 m-rel mögötte jár (különben
// a visszatérés „jobbról előzésnek” számítana).
export const rightLaneAgent = {
  decide(engine) {
    const p = engine.player;
    if (p.laneChange) return;
    const lane = p.laneIndex();
    const slowAhead = (l, dist) => {
      const a = engine.aheadInLane(l, p.z, dist);
      return a && a.speed < p.cruise - 4;
    };
    // visszatérés jobbra CSAK akkor, ha az aktuális/balabb sávokban nincs
    // a közelünkben hátulról autó (a jobbra-sorolás különben „jobbról
    // előzés” büntetést vonna maga után az ott hátul lévő járműveknél)
    const closeBehindLeft = () =>
      engine.cars.some((c) => !c.ghost && c.lane <= lane && p.z - c.z < 15 && p.z - c.z > 0);
    // saját sávban lassú elöl, vagy közvetlenül balra-sávban lassú, amit
    // jobbról kellene megelőznünk → balra kell mozdulni (előzéshez)
    const ownSlow = slowAhead(lane, 60);
    const wouldPassRight = lane === 2 && slowAhead(1, 40);
    if (ownSlow || wouldPassRight) {
      if (lane > 0) {
        p.signal = -1; p.signalT = 0;   // friss index a váltáshoz (a várakozás alatt lehet, hogy lejárt)
        engine.playerChangeLane(-1);
      }
      return;
    }
    if (lane !== 2 && !closeBehindLeft()) {
      p.signal = 1; p.signalT = 0;
      engine.playerChangeLane(1);
    }
  },
};

// A saját sávjában lassabb járművet BALRÓL, indexelve megelőzi a középsőln,
// ott is lassú elöl → a bal sávba, majd szabad út esetén vissza jobbra.
export const overtakeAgent = {
  decide(engine) {
    const p = engine.player;
    if (p.laneChange) return;
    const lane = p.laneIndex();
    const ahead = engine.aheadInLane(lane, p.z, 60);
    const slowAhead = ahead && ahead.speed < p.cruise - 4;
    if (slowAhead && lane > 0) {
      p.toggleSignal(-1);
      engine.playerChangeLane(-1);
    } else if (!slowAhead && lane !== 2) {
      p.toggleSignal(1);
      engine.playerChangeLane(1);
    }
  },
};

// Rendetlen: index nélkül, ide-oda kószál és a belső sávban is megmarad —
// büntetések + gyorsuló kapu-óra a célja. Determinisztikus mintázat: t-től
// függő rendszertelen irányváltások.
export const messyAgent = {
  decide(engine) {
    const p = engine.player;
    if (p.laneChange) return;
    // 3.2 mp-enként megpróbál másik sávba menni, index nélkül
    const phase = Math.floor(engine.t / 3.2);
    if (Math.abs(engine.t - phase * 3.2) > 0.02) return;
    const dir = (phase % 3 === 0) ? -1 : ((phase % 3 === 1) ? 1 : -1);
    engine.playerChangeLane(dir);
  },
};

// „Csak indexelve váltok” — a jelzés-bónusz és az auto-off ellenőrzése.
export const signalAgent = {
  decide(engine) {
    const p = engine.player;
    if (p.laneChange) return;
    // 9 mp-enként: balra (indexelve), majd vissza jobbra
    const phase = Math.floor(engine.t / 9);
    if (Math.abs(engine.t - phase * 9) > 0.02) return;
    const dir = phase % 2 === 0 ? -1 : 1;
    p.toggleSignal(dir);
    engine.playerChangeLane(dir);
  },
};

// Rögzített bemenet-strém: [[t, irány],…]; irány: ±1 sávváltás, ±2 index,
// 0 = semmi. A sávváltás előtt 0.4s-sel index is be van ágyazva a stream-be,
// ha a készítő úgy adja meg.
export function recordedAgent(steps) {
  const queue = steps
    .map(([tt, dir]) => ({ tt, dir }))
    .sort((a, b) => a.tt - b.tt);
  return {
    decide(engine) {
      while (queue.length && engine.t >= queue[0].tt - 1e-9) {
        const { dir } = queue.shift();
        if (dir === 0) continue;
        if (Math.abs(dir) === 2) engine.player.toggleSignal(Math.sign(dir));
        else engine.playerChangeLane(Math.sign(dir));
      }
    },
  };
}

export function agentByName(name) {
  switch (name) {
    case 'right': return rightLaneAgent;
    case 'overtake': return overtakeAgent;
    case 'messy': return messyAgent;
    case 'signal': return signalAgent;
    default: throw new Error('ismeretlen agent: ' + name);
  }
}
