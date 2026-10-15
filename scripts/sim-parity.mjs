// Paritás-teszt: UGYANAZT az engine-t futtatjuk a böngészőben (a Vite-szerelt
// src/sim-en) és headless Node-ban — azonos seed + agent mellett az esemény-
// lista és a végállapot bitre azonos kell legyen.  Ez igazolja, hogy a
// böngészősen játszott játék és a „játszás nélküli” ellenőrzés ugyanazt
// a szimulációt jelenti.
//
//   node scripts/sim-parity.mjs   (a vite dev szerverre épít, 14753-ös portot használ)
import { spawn } from 'node:child_process';
import http from 'node:http';
import puppeteer from 'puppeteer-core';
import { SimEngine } from '../src/sim/engine.js';
import { TraceRecorder } from '../src/sim/trace.js';
import { rightLaneAgent } from '../src/sim/agents.js';
import { makeRng } from '../src/sim/prng.js';

const PORT = 14753;
const CHROME = process.env.CHROME_BIN || '/usr/bin/chromium-browser';
const SEED = 42, SECONDS = 120;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let fail = 0, pass = 0;
const ok = (c, msg) => { (c ? pass++ : fail++); console.log((c ? '✓' : '✘') + ' ' + msg); };

function httpGet(url, ms = 3000) {
  return new Promise((resolve) => {
    const req = http.get(url, { timeout: ms }, (res) => { resolve(res.statusCode); res.resume(); });
    req.on('timeout', () => req.destroy());
    req.on('error', () => resolve(null));
  });
}
async function waitForServer(port, ms = 30000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const code = await httpGet(`http://127.0.0.1:${port}/`);
    if (code && code < 500) return;
    await sleep(200);
  }
  throw new Error('vite nem indult');
}

// ---- headless oldal ---------------------------------------------------------
const engine = new SimEngine();
engine.rng = makeRng(SEED);
engine.seed = SEED;
const tr = new TraceRecorder(engine);   // a 'start' eseményt is rögzítjük
engine.reset();
engine.seedStartTraffic();
tr.run(rightLaneAgent, SECONDS);
const headEvents = tr.events.map((e) => JSON.parse(JSON.stringify(e)));
const headSum = {
  score: +engine.scoring.score.toFixed(6),
  gates: engine.scoring.gates,
  crashCount: engine.crashCount,
  lives: engine.lives,
  z: +engine.player.z.toFixed(3),
  dist: +engine.dist.toFixed(3),
};

// ---- böngésző oldal ---------------------------------------------------------
const vite = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], { stdio: 'ignore', detached: true });
let browser;
try {
  await waitForServer(PORT);
  browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--enable-unsafe-swiftshader', '--mute-audio'],
  });
  const page = await browser.newPage();
  const pageErrs = [];
  page.on('pageerror', (e) => pageErrs.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') pageErrs.push(m.text()); });
  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction('window.__ready === true', { timeout: 30000 });

  const browResult = await page.evaluate(async ({ SEED, SECONDS }) => {
    const { rightLaneAgent } = await import('/src/sim/agents.js');
    const g = window.__game;
    const e = g.engine;
    const events = [];
    e.onEvent = (ev) => events.push(JSON.parse(JSON.stringify(ev)));
    window.__seed(SEED);
    window.__start();          // reset + seedStartTraffic, ugyanúgy mint a headless futás előtt
    g.togglePause();           // ⏸ a játék saját kereke ne tickeljen közben — csak a mienk
    const dt = 1 / 60;
    const total = Math.round(SECONDS / dt);
    for (let i = 0; i < total; i++) {
      rightLaneAgent.decide(e);
      e.tick(dt);
    }
    return {
      events,
      sum: {
        score: +e.scoring.score.toFixed(6),
        gates: e.scoring.gates,
        crashCount: e.crashCount,
        lives: e.lives,
        z: +e.player.z.toFixed(3),
        dist: +e.dist.toFixed(3),
      },
    };
  }, { SEED, SECONDS });
  ok(pageErrs.length === 0, `nincs böngésző-hiba (${pageErrs.length})`);

  // ---- összehasonlítás ------------------------------------------------------
  console.log('headless:', JSON.stringify(headSum));
  console.log('böngésző :', JSON.stringify(browResult.sum));
  ok(JSON.stringify(browResult.sum) === JSON.stringify(headSum),
    `a végállapot azonos (pontszám/kapuk/baleset/élet/z/dist)`);
  const browKinds = {};
  for (const x of browResult.events) browKinds[x.kind] = (browKinds[x.kind] || 0) + 1;
  console.log('böngésző esemény-kiosztás:', JSON.stringify(browKinds));
  ok(browResult.events.length === headEvents.length,
    `ugyanannyi esemény (headless ${headEvents.length} vs böngésző ${browResult.events.length})`);
  const same = JSON.stringify(browResult.events) === JSON.stringify(headEvents);
  ok(same, 'az esemény-lista bitre azonos (időzítés, sorrend, tartalom)');
  if (!same) {
    for (let i = 0; i < headEvents.length; i++) {
      if (JSON.stringify(browResult.events[i]) !== JSON.stringify(headEvents[i])) {
        console.log('  első eltérés #' + i + ':');
        console.log('  headless:', JSON.stringify(headEvents[i]));
        console.log('  böngésző :', JSON.stringify(browResult.events[i]));
        break;
      }
    }
  }
} catch (err) {
  console.error('★ PARITÁS HIBÁJA:', err);
  fail++;
} finally {
  if (browser) await browser.close().catch(() => {});
  try { process.kill(-vite.pid, 'SIGTERM'); } catch { vite.kill('SIGTERM'); }
  console.log(`\n=== sim-parity VÉGE: ${pass} ✓ · ${fail} ✘ ===`);
  process.exitCode = fail > 0 ? 1 : 0;
}
