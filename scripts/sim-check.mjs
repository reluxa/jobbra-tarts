// Ellenőrzés JAJÁTSZÁS NÉLKÜL: állítások a sim-magon (a játék böngészőre
// írt kódrésze NÉLKÜL fut — ugyanaz a gépház, amit a Game használ).
//
//   node scripts/sim-check.mjs
//
// Minden sor ⚠/✘ szabálytalanságot jelez: exit kód = hibák száma.
import { SimEngine } from '../src/sim/engine.js';
import { TraceRecorder } from '../src/sim/trace.js';
import { agentByName, rightLaneAgent, messyAgent } from '../src/sim/agents.js';
import { makeRng } from '../src/sim/prng.js';
import { CAR, WORLD } from '../src/constants.js';

let fail = 0, pass = 0;
const ok = (c, msg) => { (c ? pass++ : fail++); console.log((c ? '✓' : '✘') + ' ' + msg); };

function runOnce(agent, seconds, seed = 42) {
  const e = new SimEngine();
  e.rng = makeRng(seed);
  e.seed = seed;
  e.reset();
  e.seedStartTraffic();
  const tr = new TraceRecorder(e);
  tr.run(agent, seconds);
  return { e, tr };
}

// --- 1) alap: jobbra tartó agent hosszú futása ---------------------------------
const { e, tr } = runOnce(rightLaneAgent, 360, 42);
const s = tr.summary();
console.log('--- jobbra tartás · 360 s / seed 42 :', JSON.stringify(s));

ok(s.crashes === 0, `a jobbra-tartó agent sosem balesetezik (${s.crashes}×)`);
ok(s.gates >= 2, `ellenőrizhető kapuartás: legalább 2 kapu (${s.gates})`);
ok(s.penalties === 0, `jobbra tartva sosem büntet (Jobbról-előzés: ${s.penalties}×)`);
ok(s.end === 'futás vége' || s.wraps >= 1, `hosszú futás végig-gurul (vége: ${s.end})`);
ok(tr.eventsByKind('laneChange').every((x) => x.led), 'minden sávváltása indexelt');

// --- 2) wrap-invariánsok ---------------------------------------------------------
console.log('--- wrap-invariánsok ---');
const wraps = tr.eventsByKind('wrap');
ok(wraps.length >= 1, `a 360 s-os futásban volt wrap (${wraps.length}×)`);
for (const w of wraps) {
  ok(w.distInvariant <= 0.001, `wrap δ=${w.delta}m: relatív helyzet-változás ≤ 0.001 (${w.distInvariant})`);
}
ok(e.player.z > WORLD.start && e.player.z < WORLD.wrapAt + 5,
  `a játékos z mindig a világon belül (z=${e.player.z.toFixed(0)})`);

// --- 3) állapot-törvények minden mintán ----------------------------------------------------------
console.log('--- állapot-törvények ---');
let nan = 0, over = 0, badLane = 0, carCount = 0;
for (const smp of tr.samples) {
  if (!Number.isFinite(smp.z) || !Number.isFinite(smp.kmh) || !Number.isFinite(smp.gateT) || !Number.isFinite(smp.score)) nan++;
  if (smp.kmh < 0 || smp.kmh > 200) over++;
  if (smp.lane < 0 || smp.lane > 2) badLane++;
  if (smp.cars > 12) carCount++;
}
ok(nan === 0, `nincs NaN a naplóban (${nan})`);
ok(over === 0, `a sebesség [0, 200] km/h közt marad (${over})`);
ok(badLane === 0, `a sáv mindig 0..2 (${badLane})`);
ok(carCount === 0, `a forgalom sosem haladja a maxCars-t (${carCount})`);

// --- 4) rendetlen vezetés = büntetés / idő-védelem ----------------------------------------------
console.log('--- rendetlen stressz ---');
const messy = runOnce(messyAgent, 300, 7);
const ms = messy.tr.summary();
ok(ms.penalties >= 1 || ms.end === 'timeout', `a rendetlen agent büntetést vagy időlejáratot hoz (penalties=${ms.penalties}, vége: ${ms.end})`);
ok(messy.tr.eventsByKind('laneChange').some((x) => !x.led), 'index nélküli váltás tényleg megtörtént');

// --- 5) determinisztikus baleset-szcenárió --------------------------------------------------------
console.log('--- baleset-szcenárió ---');
{
  const e2 = new SimEngine();
  e2.rng = makeRng(11);
  e2.seed = 11;
  e2.reset();
  e2.seedStartTraffic();
  const p = e2.player;
  p.x = 0;                 // középső sáv
  p.z += 3;
  p.speed = 36;
  p.fwdSpeed = 36;
  e2.cars = e2.cars.filter((c) => !(c.lane === 1 && c.z < p.z + 250));
  e2.addObstacle(0, p.z + 12, 1);   // álló akadály 12 m-rel elöl
  const tr2 = new TraceRecorder(e2);
  tr2.run(null, 15);
  ok(e2.crashCount >= 1 && e2.lives <= 2,
    `36 m/s + 12 m álló akadály ⇒ garantált baleset (crash=${e2.crashCount}, élet=${e2.lives})`);
  ok(tr2.eventsByKind('crash').length >= 1, 'a crash esemény is fel van jegyezve');
}

// --- 6) determinizmus: azonos seed = azonos futás --------------------------------------------------
console.log('--- determinizmus ---');
const a = runOnce(rightLaneAgent, 60, 4242);
const b = runOnce(rightLaneAgent, 60, 4242);
const key = (r) => JSON.stringify([r.tr.summary(), r.tr.events.length, r.tr.samples.length]);
ok(key(a) === key(b), `két azonos seed futás azonos (esemény=${a.tr.events.length}, minta=${a.tr.samples.length})`);
ok(a.e.scoring.score === b.e.scoring.score && a.e.crashCount === b.e.crashCount && a.e.scoring.gates === b.e.scoring.gates,
  `pontszám/baleset/kapuk azonosak (${a.e.scoring.score}/${b.e.scoring.score})`);

// --- 7) a Game által használt API felszín (paritás-őr) --------------------------------------------
console.log('--- használható API (a main.js ezt hívja) ---');
{
  const e2 = new SimEngine();
  ok(typeof e2.reset === 'function' && typeof e2.tick === 'function' &&
     typeof e2.playerChangeLane === 'function' && typeof e2.seedStartTraffic === 'function',
    'reset/tick/playerChangeLane/seedStartTraffic jelen vannak');
  ok(typeof e2.debug === 'function' && typeof e2.scoring.energyFrac === 'function',
    'debug + scoring API jelen van');
  ok(typeof e2.addObstacle === 'function' && typeof e2.removeObstacle === 'function',
    'teszt-obstacle API jelen van');
  const p2 = e2.player;
  ok(typeof p2.toggleSignal === 'function' && typeof p2.signalOn === 'function' &&
     typeof p2.laneIndex === 'function' && typeof p2.requestLaneChange === 'function',
    'SimPlayer API (signal/laneChange/laneIndex) jelen van');
}

console.log(`\n=== sim-check VÉGE: ${pass} ✓ · ${fail} ✘ ===`);
process.exit(fail > 0 ? 1 : 0);
