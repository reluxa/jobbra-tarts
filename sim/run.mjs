// ============================================================================
//  Futtató + riport.  Kontrollált, reprodukálható játékmag-tesztek.
//  Használat:  node sim/run.mjs [politika] [futtatás]
//      politika: keepRight | leftCamper | liberal
//      futtatás: hány véletlen maggal fusson (alapért. 30)
//    Példák:
//      node sim/run.mjs                      -> keepRight, 30 futtatás
//      node sim/run.mjs leftCamper 60        -> camper összehasonlítás
//
//  A cél: látni, hogy a "csak jobbra tartva lehet nyerni" alapelv működik-e,
//  mennyi a tartalék (játékélmény), hányszor kell sávot váltani (előzés),
//  és miért veszít valaki, ha balos sávban marad.
// ============================================================================
import { defaultConfig, runRace, mulberry32 } from './core.mjs';

const policy = process.argv[2] || 'keepRight';
const trials = Number(process.argv[3] || 30);

function fmt(x, d = 1) { return Number.isFinite(x) ? x.toFixed(d) : '—'; }

function report(cfg, seeds) {
  const results = [];
  let won = 0;
  const gateStats = [];
  let totShifts = 0, totNoSig = 0, totCut = 0;

  const laneFracs = [0, 0, 0];
  for (const seed of seeds) {
    const r = runRace(cfg, seed);
    results.push(r);
    if (r.won) won++;
    for (const g of r.gates) {
      if (!gateStats[g.gi]) gateStats[g.gi] = { passed: 0, clock: 0, avg: 0, shift: 0, req: g.req };
      if (g.passed) gateStats[g.gi].passed++;
      gateStats[g.gi].clock += Math.max(0, g.clock);
      gateStats[g.gi].avg += g.achievedAvg;
      gateStats[g.gi].shift += g.shifts;
      for (let i = 0; i < 3; i++) laneFracs[i] += g.laneFrac[i] ?? 0;
      totShifts += g.shifts; totNoSig += g.noSignal; totCut += g.cutIns;
    }
  }
  const n = seeds.length;
  const nGates = cfg.gates;

  return {
    n, won, results,
    winPct: won / n * 100,
    gates: gateStats,
    laneFracs: laneFracs.map((v) => v / (n * nGates)),
    totShifts: totShifts / (n * nGates),
    totNoSig: totNoSig / n,
    totCut: totCut / n,
  };
}

function dump(cfg, r) {
  const pad = '  ';
  console.log(`\n${'='.repeat(64)}`);
  console.log(`POLITIKA : ${cfg.policy.padEnd(10)}   nyerés ${fmt(r.winPct, 0)}%  (${r.won}/${r.n} futtatás)`);
  console.log(`${'='.repeat(64)}`);
  console.log(`LaneRate : külső ${cfg.laneRate[0]} / közép ${cfg.laneRate[1]} / belső ${cfg.laneRate[2]}`);
  console.log(`LaneCap  : külső ${fmt(cfg.laneCap[0]*3.6)} / közép ${fmt(cfg.laneCap[1]*3.6)} / belső ${fmt(cfg.laneCap[2]*3.6)} km/h   |   cruise ${fmt(cfg.cruise*3.6)} km/h`);
  console.log(`Kapu táv : ${cfg.gateDist} m   |   átlag-létra: ${cfg.reqStart} → +${cfg.reqStep}/kapu  (${cfg.gates} kapu)`);
  if (r.winPct === 0) {
    const fr = r.results[0];
    if (fr) console.log(`  Első bukás kapuja: ${fr.failedGate} (req ${fmt(fr.reqAtFail)} km/h) — ok: ${fr.gates[fr.failedGate] ? '' : ''}`);
  }
  console.log(`${'-'.repeat(64)}`);
  process.stdout.write(`  kapu   kért    nyert/    tartalék   elért átlag   sávváltás/futam\n`);
  process.stdout.write(`         átlag   (db)      (s)        (km/h)\n`);
  r.gates.forEach((g, i) => {
    if (!g) return;
    const avg = g.avg / (r.n || 1);
    const clock = g.clock / (r.n || 1);
    process.stdout.write(`  G${String(i).padEnd(2)}  ${String(fmt(g.req)).padStart(5)}   ${String(g.passed+'/'+r.n).padStart(6)}   ${String(fmt(clock)).padStart(6)}   ${String(fmt(avg)).padStart(9)}   ${fmt(g.shift / (r.n||1), 2)}\n`);
  });
  console.log(`${'-'.repeat(64)}`);
  console.log(`Sávban-töltött idő: külső ${fmt(r.laneFracs[0]*100,0)}% / közép ${fmt(r.laneFracs[1]*100,0)}% / belső ${fmt(r.laneFracs[2]*100,0)}%`);
  console.log(`Sávváltás/kapu: ${fmt(r.totShifts,2)}   |   index-nélküli ${fmt(r.totNoSig,2)}/futam   |   bevágás ${fmt(r.totCut,2)}/futam`);
}

const cfg = defaultConfig();
cfg.policy = policy;
const seeds = Array.from({ length: trials }, (_, i) => 1000 + i);

if (policy === 'compare') {
  const variants = [
    ['keepRight (visszatér jobbra)', 'keepRight', 0],
    ['középső-ben marad', 'leftCamper', 1],
    ['belső-ben marad', 'leftCamper', 2],
    ['liberal (húzódik balra)', 'liberal', 0],
  ];
  console.log('⚖️  STRATÉGIÁK ÖSSZEHASONLÍTÁSA  ("csak jobbra tartva lehet nyerni" teszt)\n');
  console.log(``);
  for (const [label, pol, pref] of variants) {
    const c2 = defaultConfig();
    c2.policy = pol; c2.preferLane = pref;
    const r = report(c2, seeds);
    const res = r.results[0];
    const fail = !r.won ? ` (bukott a ${res.failedGate}. kapun, req ${res.reqAtFail} km/h)` : '';
    const lf = r.laneFracs.map((v) => fmt(v * 100, 0)).join('% / ');
    console.log(`  ${label.padEnd(30)}  nyerés ${String(fmt(r.winPct, 0) + '%').padStart(5)}   sáv: külső/közép/belső = ${lf}%${fail}`);
  }
  console.log('\n  Belső/középső sávok jóval gyorsabban fogyasztják a kapu-órát,');
  console.log('  ezért az, aki nem tér vissza a külső (jobb) sávba, nem teljesíti az átlagot.');
  process.exit(0);
}

const r = report(cfg, seeds);
dump(cfg, r);
