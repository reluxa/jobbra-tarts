// Fej nélküli szimuláció: „lejátssza” a játékot böngésző nélkül, és naplót
// nyomtat.  Használat:
//   node scripts/sim-run.mjs <agent> [mp] [seed]
//   node scripts/sim-run.mjs right 120 42 --json out.json
// Agentek: right | overtake | messy | signal
import { SimEngine } from '../src/sim/engine.js';
import { TraceRecorder } from '../src/sim/trace.js';
import { agentByName } from '../src/sim/agents.js';
import { makeRng } from '../src/sim/prng.js';
import { writeFileSync } from 'node:fs';

const name = process.argv[2] || 'right';
const seconds = Number(process.argv[3] || 120);
const seed = Number(process.argv[4] || 42);
const jsonOut = process.argv[5] === '--json' ? process.argv[6] : null;

const engine = new SimEngine();
engine.rng = makeRng(seed);
engine.seed = seed;
engine.reset();
engine.seedStartTraffic();
const trace = new TraceRecorder(engine);
trace.run(agentByName(name), seconds);

console.log(`--- ${name} agent · ${seconds}s · seed ${seed} ---`);
console.log(trace.readable());
if (jsonOut) {
  writeFileSync(jsonOut, JSON.stringify(trace.toJSON(), null, 1));
  console.log(`\n(idővonal JSON: ${jsonOut})`);
}
