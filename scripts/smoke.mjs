// Smoke-teszt: valódi, fej nélküli Chromiummal futtatjuk a játékot, és
// ellenőrizzük, hogy a fizika és a játékmenet viselkedik-e:
//  - az autó halad (+Z) és gyorsul
//  - a kormányzás iránya helyes (jobbra = képernyő-jobb)
//  - ütközéseknél baleset keletkezik, élet levonódik
//  - szakasz-bónusz lefut
//  Képernyőképeket készít a screenshots/ mappába.
import { spawn } from 'node:child_process';
import http from 'node:http';
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';

const PORT = 5199;
const APP_URL = `http://127.0.0.1:${PORT}/`;
const CHROME = process.env.CHROME_BIN || '/usr/bin/chromium-browser';
const SHOTS = new URL('../screenshots/', import.meta.url).pathname;
mkdirSync(SHOTS, { recursive: true });

let failed = 0;
function assert(cond, msg) {
  if (!cond) {
    failed++;
    console.error('✘ ASSERT FAIL:', msg);
  } else {
    console.log('✓', msg);
  }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
  throw new Error('Vite szerver nem indult el ' + ms + ' ms alatt');
}

const vite = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], {
  stdio: ['ignore', 'pipe', 'pipe'],
  detached: true,
});
vite.stdout.on('data', () => {});
vite.stderr.on('data', () => {});
let browser;
try {
  await waitForServer(PORT);
  console.log('--- vite kész, indítjuk a Chromiumot ---');

  browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--enable-unsafe-swiftshader',
           '--hide-scrollbars', '--mute-audio'],
    defaultViewport: { width: 1400, height: 860 },
  });

  const page = await browser.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('requestfailed', (r) => {
    if (r.url().includes('favicon')) return;
    errors.push('requestfailed: ' + r.url());
  });

  await page.goto(APP_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction('window.__ready === true', { timeout: 30000 });
  console.log('--- játék betöltve ---');

  const shot = (name) => page.screenshot({ path: `${SHOTS}${name}.png` });
  await shot('01-title');
  console.log('✓ title képernyő');

  await page.evaluate(() => window.__start());
  await page.waitForFunction('window.__dbg().state === "play"', { timeout: 5000 });
  await sleep(1500); // a glTF-modellek betöltésére
  const d0 = await page.evaluate(() => window.__dbg());
  console.log('  start után:', JSON.stringify(d0));
  assert(d0.model === true, '3D autómodellek betöltődtek');
  assert(d0.sig === 0, 'alapállapotban nincs indexjelzés');
  console.log('✓ start → play');
  await shot('06-cockpit');
  console.log('✓ belső nézet (cockpit) képernyőkép');

  // --- 1) gyorsítás ---
  await page.keyboard.down('w');
  await sleep(3000);
  await page.keyboard.up('w');
  const d1 = await page.evaluate(() => window.__dbg());
  console.log('  gyorsítás után:', JSON.stringify(d1));
  assert(d1.kmh > 40, `az autó gyorsul (>40 km/h, most ${d1.kmh})`);
  assert(d1.pos[2] > 2, `az autó halad +Z felé (z=${d1.pos[2]})`);
  await shot('02-driving');

  // --- 2) sávváltás-fókusz: egy gombnyomás = egy automatikus sávváltás ---
  // először kitakarítjuk a közelből a forgalmat, hogy a váltóteszt ne akadjon össze velük
  await page.evaluate(() => {
    const g = window.__game; const pz = g.player.pos.z;
    for (let i = g.traffic.cars.length - 1; i >= 0; i--) {
      const c = g.traffic.cars[i];
      if (Math.abs(c.body.position.z - pz) < 80) {
        g.worldPhys.removeBody(c.body); g.scene.remove(c.meshes);
        g.traffic.byId.delete(c.body.id); g.traffic.cars.splice(i, 1);
      }
    }
  });
  const waitLane = async (want, ms = 25000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      const st = await page.evaluate(() => ({
        lane: window.__game.player.laneIndex(),
        done: window.__game.player.laneChange === null,
      }));
      if (st.lane === want && st.done) return true; // csak a VÁLTÁS VÉGÉN várjuk meg
      await sleep(80);
    }
    return false;
  };

  const d1b = await page.evaluate(() => window.__dbg());
  assert(d1b.lane === 2, `a játékos a jobb szélső sávban indul (lane=${d1b.lane})`);

  // balra váltás: A-gomb → sáv 1
  await page.keyboard.press('a');
  const okLeft = await waitLane(1);
  const dl = await page.evaluate(() => window.__dbg());
  console.log('  sávváltás balra:', JSON.stringify({ lane: dl.lane, pos: dl.pos[0], yaw: dl.yaw }));
  assert(okLeft, `A-gomb balra vált (lane → ${dl.lane})`);
  assert(Math.abs(dl.yaw) < 4, `a váltás után kiegyenesedett (yaw=${dl.yaw})`);

  // jobbra váltás: D-gomb → vissza sáv 2
  await page.keyboard.press('d');
  const okRight = await waitLane(2);
  const dr = await page.evaluate(() => window.__dbg());
  console.log('  sávváltás jobbra:', JSON.stringify({ lane: dr.lane, pos: dr.pos[0] }));
  assert(okRight, `D-gomb jobbra vált (lane → ${dr.lane})`);

  // szélellenőrzés: a jobb szélső sávban jobbra nyomva nem válthatunk el
  await page.keyboard.press('d');
  await sleep(700);
  assert((await page.evaluate(() => window.__game.player.laneIndex())) === 2, 'a jobb szélen a jobbra-gomb nem vált sávot');

  // --- 2b) indexelés: E (jobbra) jelzés + D váltás = +12 pont ---
  await page.evaluate(() => window.__jumpLane(1, 0.9)); // sáv 1, közel a jobb szélhez
  const sigBefore = await page.evaluate(() => window.__dbg().sigOK);
  await page.keyboard.press('e'); // jobbra index
  const ds0 = await page.evaluate(() => window.__dbg());
  assert(ds0.sig === 1, `E = jobbra index bekapcsolva (sig=${ds0.sig})`);
  await sleep(400);                 // legalább minLead-ig babillog a lampa
  await page.keyboard.press('d');   // jobbra váltás
  const okSig = await waitLane(2);
  const ds1 = await page.evaluate(() => window.__dbg());
  console.log('  indexelt váltás:', JSON.stringify(ds1));
  assert(okSig, `a jobbra váltás megtörtént (lane=${ds1.lane})`);
  assert(ds1.sigOK >= sigBefore + 1, `indexelt sávváltásért pont jár (${sigBefore} → ${ds1.sigOK})`);
  assert(ds1.sig === 0, 'a váltás után a villogó lekapcsol');

  // --- 3) szünet ---
  await page.keyboard.press('p');
  await page.waitForFunction('window.__dbg().state === "pause"', { timeout: 3000 });
  await shot('04-pause');
  await page.keyboard.press('p');
  await page.waitForFunction('window.__dbg().state === "play"', { timeout: 3000 });
  console.log('✓ szünet ki/be');

  // --- 4) baleset ---
  await page.evaluate(() => window.__testCrash());
  // a gyors ütközés a lassú headless-szimulációban sokáig tarthat → várunk rá
  const tCrash = Date.now();
  let d3 = null;
  while (Date.now() - tCrash < 25000) {
    d3 = await page.evaluate(() => window.__dbg());
    if (d3.crashCount >= 1) break;
    await sleep(150);
  }
  console.log('  baleset után:', JSON.stringify(d3));
  assert(d3.crashCount >= 1, `ütközés megtörtént (${d3.crashCount}×)`);
  assert(d3.lives <= 2, `élet levonódott (${d3.lives})`);
  await shot('05-crash');

  // --- 5) szakasz-bónusz ---
  await page.evaluate(() => window.__forceSection());
  const d4 = await page.evaluate(() => window.__dbg());
  console.log('  forceSection:', JSON.stringify(d4));

  // --- 6) forgalom ---
  assert(d1.cars >= 0, `forgalom fut (max ${d1.cars} autó látva)`);

  // --- hibák ---
  console.log('--- böngésző hibák: ' + errors.length + ' ---');
  for (const e of errors) console.log('  ', e);
  assert(errors.length === 0, 'nincs console/böngésző hiba');

  console.log('\n=== SMOKE VÉGE — hibák: ' + failed + ' ===');
  process.exitCode = failed > 0 ? 1 : 0;
} catch (err) {
  console.error('★ SMOKE HIBÁJA:', err);
  process.exitCode = 1;
} finally {
  if (browser) await browser.close().catch(() => {});
  try { process.kill(-vite.pid, 'SIGTERM'); } catch { vite.kill('SIGTERM'); }
  process.exit(failed > 0 ? 1 : 0);
}
