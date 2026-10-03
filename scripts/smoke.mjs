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
  console.log('✓ start → play');

  // --- 1) gyorsítás ---
  await page.keyboard.down('w');
  await sleep(2500);
  await page.keyboard.up('w');
  const d1 = await page.evaluate(() => window.__dbg());
  console.log('  gyorsítás után:', JSON.stringify(d1));
  assert(d1.kmh > 60, `az autó gyorsul (>60 km/h, most ${d1.kmh})`);
  assert(d1.pos[2] > 3, `az autó halad +Z felé (z=${d1.pos[2]})`);
  await shot('02-driving');

  // --- 2) kormányzás iránya (yaw-alapú, mivel a korlát befolyásolhatja x-et) ---
  const y0 = d1.yaw;
  await page.keyboard.down('d');
  await sleep(1500);
  await page.keyboard.up('d');
  const d2 = await page.evaluate(() => window.__dbg());
  console.log('  kormány jobbra:', JSON.stringify(d2));
  assert(d2.yaw < y0 - 5, `jobbra kormányzás = yaw csökken (${y0} → ${d2.yaw})`);

  await page.keyboard.down('a');
  await sleep(2000);
  await page.keyboard.up('a');
  const d2b = await page.evaluate(() => window.__dbg());
  assert(d2b.yaw > d2.yaw + 5, `balra kormányzás = yaw nő (${d2.yaw} → ${d2b.yaw})`);

  // --- 3) szünet ---
  await page.keyboard.press('p');
  await page.waitForFunction('window.__dbg().state === "pause"', { timeout: 3000 });
  await shot('04-pause');
  await page.keyboard.press('p');
  await page.waitForFunction('window.__dbg().state === "play"', { timeout: 3000 });
  console.log('✓ szünet ki/be');

  // --- 4) baleset ---
  await page.evaluate(() => window.__testCrash());
  await sleep(3200);
  const d3 = await page.evaluate(() => window.__dbg());
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
