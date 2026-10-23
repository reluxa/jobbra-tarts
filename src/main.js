// Fő játékvezérlő: NÉZET a sim-mag (src/sim/engine.js) fölé. A játékmenet
// logikája (sebesség, sávváltás, radar, forgalom, pontozás, ütközés, wrap)
// a magban van — ez a fájl a render-loopot, a kamerákat, a HUD-ot, a
// hangokat/effekteket és az állapotgépet tartja, az eseményekből építve.
import * as THREE from 'three';
import { CAMERA, PEN, PHYS_FIXED, SCORE, SIGNAL, TRAFFIC, laneCenterX } from './constants.js';
import { carveTransparent, carvePockets, wallCeiling } from './mask.js';
import { World } from './world.js';
import { Player } from './player.js';
import { TrafficView } from './traffic.js';
import { Effects } from './effects.js';
import { HUD } from './hud.js';
import { Input } from './input.js';
import { AudioFX } from './audio.js';
import { loadCarModels } from './models.js';
import { SimEngine } from './sim/engine.js';
import { makeRng } from './sim/prng.js';

// Érintőképernyős irányítás? A tippek és a HUD hint-sora is ehhez igazodik
// (mobilon értelmetlen a billentyűzetet leírni).
const TOUCH = ('ontouchstart' in window) || (navigator.maxTouchPoints || 0) > 0;

const TIPS = [
  'A jobb szélső sáv a haladási sávod — ott lassabban fogy a kapu-időd, ezért CSAK jobbra tartva lehet nyerni.',
  TOUCH ? 'Sávváltás: ◀ balra, ▶ jobbra — a játék elvégzi a váltást.'
    : 'Sávváltás:  A  vagy  ←  balra,  D  vagy  →  jobbra — a játék elvégzi a váltást.',
  'Kapuk közt haladsz: a kapu-idő („kell ≈ … km/h”) minden kapunál fogy — érj oda, mielőtt lejár.',
  'A belső (bal) sávban az óra 1.8-szor gyorsabban zabálja az idődet — csak rövid elözésre menj oda.',
  'Előzni csak balról szabad: ki balra, előzés, majd VISSZA jobbra (különben elfolyik az időd).',
  'Jobbról előztek? Túl balfelé kószálsz — térj vissza jobbra!',
  TOUCH ? 'Indexelj (❮ / ❯) a sávváltás előtt: +12 pont, jelzés nélkül −8 PONT és −3s kapu-idő!'
    : 'Indexelj (Q/E) a sávváltás előtt: +12 pont, jelzés nélkül −8 PONT és −3s kapu-idő!',
  'Visszapillantó tükör: nézd, ki közelít hátulról a bal sávban!',
  'Kamion a jobb sávban? Dönts: előzd meg balról, vagy maradj mögötte.',
  'Egyre nehezebb: gyorsul az autó, sűrűsödik a forgalom és nő a kért átlag (km/h).',
];
const TIP_DELAY = 4.5;

// Érintőképernyős irányítás? A HUD hint-sora is ehhez igazodik (mobilon
// értelmetlen a billentyűzetet leírni).
const HINT_KEYS = TOUCH
  ? '◀ ▶ sávváltás • ❮ ❯ index'
  : 'A/D sávváltás • Q/E index • P szünet • M hang';

const $ = (id) => document.getElementById(id);

export class Game {
  constructor() {
    this.gid = (window.__gameCount = (window.__gameCount || 0) + 1);
    this.state = 'start';
    this.acc = 0;
    this.tipT = 1.0;
    this.tipIdx = 0;
    this.prevLane = 2;
    this.timeoutDone = false;
    this.prevBlinkOn = false;
    this.playerHasModel = false;

    // EGYETLEN játéklogika — a tesztelés (scripts/sim-*) is ezt futtatja
    this.engine = new SimEngine();
    this.engine.onEvent = (ev) => this.handleSimEvent(ev);
    this.scoring = this.engine.scoring;

    this.initRenderer();
    this.initModules();
    this.initEvents();
    this.renderVersion();

    // teszt-/fejlesztői belépési pontok
    window.__dbg = () => this.debug();
    window.__start = () => this.start();
    window.__testCrash = () => this.testCrash();
    window.__forceSection = () => this.scoring.advance(SCORE.gateDist); // teszt: egy kapu ugrás
    window.__seed = (n) => { this.engine.rng = makeRng(n); this.engine.seed = n; };
    window.__jumpLane = (lane, edge = 0) => {
      if (this.state !== 'play') return;
      const p = this.engine.player;
      const pz = p.z;
      // determinisztikus teszt: a teleport helyéről kitakarítjuk a forgalmat
      this.engine.cars = this.engine.cars.filter((c) => Math.abs(c.z - pz) >= 25);
      p.x = laneCenterX(lane) + edge;
      p.z = pz;
      p.yaw = 0;
      p.laneChange = null;
      p.signal = 0;
      p.speed = 14;   // indulósebesség: a teszt ne a gyorsítástól függjön
      p.fwdSpeed = 14;
      this.prevLane = lane;
    };
    window.__ready = true;
    window.__game = this; // fejlesztői hozzáférís a belső állapothoz
    window.__THREE = THREE;

    this.startLoop();
  }

  initRenderer() {
    this.canvas = document.createElement('canvas');
    $('game').appendChild(this.canvas);
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true });
    // Kis képernyőn (mobil) mérsékelt pixelratió: a telefon GPU-ja így bírja a
    // 60 képkockát, az élesség-különbség a nagy DPR-ű paneleken is csekély.
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.renderer.setPixelRatio(Math.min(innerWidth, innerHeight) < 500 ? Math.min(1.75, dpr) : dpr);
    this.renderer.setSize(window.innerWidth, window.innerHeight, false);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.1;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x9ec9e8);
    this.scene.fog = new THREE.Fog(0x9ec9e8, 80, 700);

    this.camera = new THREE.PerspectiveCamera(CAMERA.fov, window.innerWidth / window.innerHeight, 0.1, 500);

    // visszapillantó tükör: külön kis céltextúra + hátsó kamera
    this.mirrorRT = new THREE.WebGLRenderTarget(CAMERA.mirrorSize.w, CAMERA.mirrorSize.h, {
      minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: true,
    });
    this.mirrorCam = new THREE.PerspectiveCamera(CAMERA.mirror.fov, CAMERA.mirrorSize.w / CAMERA.mirrorSize.h, 0.2, 400);
    this.mirrorCam.layers.set(0);
    this.mirrorCam.layers.enable(1); // a saját autó váza látszódjon a tükörben
  }

  initModules() {
    this.world = new World(this.scene);
    this.player = new Player(this.scene);
    this.traffic = new TrafficView(this.scene);
    this.hud = new HUD();
    this.input = new Input();
    this.audio = new AudioFX();
    this.effects = new Effects(this.scene, this.camera, $('labels'));
    this.shakeTmp = new THREE.Vector3();

    this.player.setMirrorTexture(this.mirrorRT.texture);
    this.input.onSignal = (d) => { if (this.state === 'play') this.engine.player.toggleSignal(d); };
    this.input.onLane = (d) => this.onLaneInput(d);

    // glTF-modellek (bármikor véletlen: a dobozos vészlátvány is elég)
    loadCarModels().then((models) => {
      this.player.setModel(models.player);
      this.traffic.setModels(models);
      this.playerHasModel = true;
    }).catch((err) => {
      window.__modelErr = String((err && err.stack) || err);
      console.warn('Modellbetöltés nem sikerült (marad a vészlátvány):', err);
    });

    $('hud').classList.remove('hidden');
    this.hud.updateScore(0);
    this.hud.updateSpeed(0);
    this.hud.updateEnergy(100, 0);
    this.hud.updateGate(0, 0);
    this.setupCockpitOverlay();
  }

  // A sim-mag eseményeiből hang/effekt/HUD — a JÁTÉKLOGIKA a magban van.
  handleSimEvent(ev) {
    const p3 = () => new THREE.Vector3(ev.car ? ev.car.x : this.engine.player.x, 0.6, ev.car ? ev.car.z : this.engine.player.z);
    switch (ev.kind) {
      case 'overtake':
        this.audio.overtake();
        this.effects.popup(ev.text, ev.color, p3());
        break;
      case 'passed':
        this.effects.popup(ev.text, ev.color, p3());
        break;
      case 'penalty':
        this.audio.penalty();
        this.effects.popup(ev.text, ev.color, p3());
        if (ev.selfDidIt) {
          // a kapu-időből való levonás látható legyen a KAPU-IDŐ panelen
          this.hud.timeHit(PEN.cutIn);
          // és nagy, képernyő-középponti figyelmeztetés is (SÁV FOGLALT-stílus)
          this.warnBig('JOBBRÓL ELŐZTÉL! −' + PEN.cutIn + ' s', '#ff8a80', true);
        } else {
          this.pushTip('Jobbról előztek — húzódj jobbra!');
        }
        break;
      case 'gate':
        this.audio.bonus();
        this.effects.popup(`+${ev.bonus} KAPU ✓ (${ev.gates}.)`, '#ffd54a', p3());
        break;
      case 'laneChange':
        // az index-bónusz / index-nélküli-büntetés a scoring-ban elvégezve
        if (ev.led) {
          this.audio.bonus();
          this.effects.popup(`+${SIGNAL.points} INDEX ✓`, '#ffd54a', p3());
        } else {
          this.audio.penalty();
          this.effects.popup(`−${SIGNAL.noSignalPenalty} Index nélkül váltasz sávot!`, '#ff8a80', p3());
        }
        break;
      case 'crash': {
        this.audio.crash();
        this.effects.shake(1.3, 0.65);
        this.hud.flash();
        const mid = new THREE.Vector3(this.engine.player.x, 0.6, (this.engine.player.z + ev.car.z) / 2);
        this.effects.burst(mid, 30, 0xff7043);
        this.effects.popup('-150 BALESET', '#ff8a80', mid);
        if (this.engine.lives <= 0) this.gameOver();
        break;
      }
      case 'wrap':
        console.log(`[wrap] δ=${ev.delta} pz=${ev.pz.toFixed(1)} cars=${ev.cars} rel-eltérés=${ev.distInvariant.toFixed(4)}`);
        break;
      case 'timeout':
        this.gameOver({ title: 'KIFUTOTTÁL A KAPU-IDŐBŐL', sub: 'Nem értél a következő kapuhoz időre.' });
        break;
      case 'gameOver':
        break; // a crash eseménynél már kezeljük
    }
  }

  onLaneInput(d) {
    if (this.state !== 'play') {
      console.log(`[sávváltás] NINCS VÁLTÁS: a játék nem "play" állapotban van (állapot: ${this.state})`);
      return;
    }
    const p = this.engine.player;
    const from = p.laneIndex();
    const to = Math.max(0, Math.min(2, from + d));
    const res = this.engine.playerChangeLane(d);
    if (res === 'ok') {
      console.log(`[sávváltás] VÁLTÁS indítva: (irány: ${d}) ${from} → ${to}, x=${p.x.toFixed(2)}`);
      return;
    }
    if (res === 'busy') {
      console.log(`[sávváltás] NINCS VÁLTÁS: még folyamatban van az előző (irány: ${d})`);
      return;
    }
    if (res === 'edge') {
      console.log(`[sávváltás] NINCS VÁLTÁS: már a szélső sávban vagy (irány: ${d}, sáv: ${from}, x: ${p.x.toFixed(2)})`);
      return;
    }
    // res === 'blocked': a cél-sáv foglalt — ne guruljunk bele, jelezzük
    const cx = laneCenterX(to);
    let nearest = null;
    const blockers = this.engine.cars
      .filter((c) => !c.ghost &&
        (c.z - p.z) > -TRAFFIC.changeBehind && (c.z - p.z) < TRAFFIC.changeAhead &&
        Math.abs(c.x - cx) < 2.3)
      .map((c, i) => {
        const dz = c.z - p.z;                  // + előtt / − mögött
        const dx = c.x - cx;                   // oldalirány a cél-sáv közepétől
        const dist = Math.hypot(dz, dx);       // valós (egyenes) távolság
        const gap = dz - 2.05 - c.len / 2;     // orr→hátsó lökhárító hézag
        if (!nearest || Math.abs(dz) < Math.abs(nearest.dz)) nearest = { dz, dist };
        return `#${i + 1} lane=${c.lane}${c.changeLane != null ? '→' + c.changeLane : ''} seb=${c.speed.toFixed(2)}m/s ⇒ TÁV=${dist.toFixed(2)}m (δz=${dz.toFixed(2)}m ${dz < 0 ? 'MÖGÖTTED' : 'ELŐLED'}, δx(cél-sáv közepe)=${dx.toFixed(2)}m${dz > 0 ? `, orr−farok hézag=${gap.toFixed(2)}m` : ''})`;
      })
      .join(' | ');
    const sum = nearest
      ? ` Legközelebbi blokkoló: ${nearest.dist.toFixed(2)} m (δz=${nearest.dz.toFixed(2)} m)` : '';
    console.log(`[sávváltás] NINCS VÁLTÁS: a cél-sáv foglalt (irány: ${d}, játékos sáv: ${from}, x=${p.x.toFixed(2)}, cél-sáv: ${to}) — blokkoló: ${blockers || '?'}${sum}`);
    this.warnBig('SÁV FOGLALT!', '#ffd54a');
  }

  // 2D „belső tér” overlay (réteg 3): a cockpit-fotó a vásznon.  A fotón a
  // szélvédő-kivágás tele van egy stúdiófallal — azt a betöltéskor átlátszóra
  // maszkoljuk (carveTransparent), így a szélvédőn át a 3D világ látszik; a
  // többit (műszerfal, kormány, A-oszlopok) a fotó fedi.
  setupCockpitOverlay() {
    this.cockpitOverlayReady = false;
    this.cockpitOverlayCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    // KÜLÖN jelenet az overlay-nek: nincs background-ja, így a második render
    // NEM festi újra az eget a világ fölé (a fő jelenet background-ja a
    // szélvédőn át kilátszó eget adná, de a második menetben nem szabad
    // törölni/festeni — csak a fotót kell rátenni a világra).
    this.cockpitOverlayScene = new THREE.Scene();
    const mat = new THREE.MeshBasicMaterial({
      transparent: true, depthTest: false, depthWrite: false, side: THREE.DoubleSide,
    });
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
    plane.renderOrder = 999;
    this.cockpitOverlayScene.add(plane);

    // Az élő visszapillantó-tükör kép a fotó „üres” tükörüvege helyére kerül:
    // egy képernyőhöz rögzített quad az overlay-jelenetben (a fotó fölött
    // rajzolunk, a tükör lyukjában, így a hátsó nézet látszik a keretben).
    this.mirrorQuadMat = new THREE.MeshBasicMaterial({
      depthTest: false, depthWrite: false, toneMapped: false,
    });
    const mirrorQuad = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.mirrorQuadMat);
    mirrorQuad.renderOrder = 998; // a fotó (999) alá, de a világ fölé
    this.cockpitOverlayScene.add(mirrorQuad);
    this.mirrorQuad = mirrorQuad;

    const img = new Image();
    img.onload = () => {
      try {
        const cv = document.createElement('canvas');
        const W = img.naturalWidth, H = img.naturalHeight;
        cv.width = W; cv.height = H;
        const ctx = cv.getContext('2d');
        ctx.drawImage(img, 0, 0);
        // a tükör (a fotó bal-job felső fele) helyének megkeresése és kimaszkolása
        const idata = ctx.getImageData(0, 0, W, H);
        const d = idata.data;
        let mx0 = W, mx1 = 0, my0 = H, my1 = 0;
        for (let y = 0; y < H * 0.3; y++) {
          for (let x = W * 0.5; x < W; x++) {
            const j = (y * W + x) * 4;
            if (d[j + 3] > 128 && (d[j] + d[j + 1] + d[j + 2]) / 3 < 110) {
              if (x < mx0) mx0 = x; if (x > mx1) mx1 = x;
              if (y < my0) my0 = y; if (y > my1) my1 = y;
            }
          }
        }

        // A fotó szélvédőjén át a 3D világnak kell látszania, de a fotóban a
        // "táj" egy stúdiófal — és a fal alsó részét a softbox fénye-árnyéka
        // sávokra vágja. Először a fő falat szívjuk ki (alacsonyabb
        // fényküszöbbel, hogy a sötétebb sávokon is átjárjon), majd célzott
        // magokkal (carvePockets) a maszk alatt maradt zsebeket is
        // (a zsebeket sötét sávok zárják — a kormányt, műszerfalat nem éri).
        // A wallCeiling oszloponként megmondja, hol végződik a fal: a 
        // világos-szürke műszerfal-teteje a fényküszöbökön átesne, de a 
        // maszk alá — a beltér fölé — így nem érhet.
        const ceil = wallCeiling(d, W, H);
        const carved = carveTransparent(
          d, W, H,
          [
            [W * 0.45, H * 0.2], [W * 0.2, H * 0.24], [W * 0.75, H * 0.2],
            [W * 0.95, H * 0.2], [W * 0.04, H * 0.35], // az utolsó: bal oldali ablak
          ],
          { minBright: 95, maxSat: 60, yMax: ceil }
        );
        const carved2 = carvePockets(
          d, W, H,
          [
            [W * 0.45, H * 0.53], [W * 0.35, H * 0.55], [W * 0.62, H * 0.54],
            [W * 0.8, H * 0.55],
          ],
          { minBright: 90, yMin: H * 0.45, yMax: ceil }
        );
        if (carved + carved2 < 25000)
          console.warn('Cockpit-overlay: a szélvédő-maszk alig talált falat', carved, carved2);

        if (mx1 - mx0 > 60 && my1 - my0 > 20) {
          const ix = 16, iy = 10; // a keret kihagyása
          const gx0 = mx0 + ix, gx1 = mx1 - ix, gy0 = my0 + iy, gy1 = my1 - iy;
          for (let y = gy0; y < H * 0.3 && y < gy1; y++) {
            for (let x = gx0; x < gx1; x++) d[(y * W + x) * 4 + 3] = 0;
          }
          this.mirrorQuad.position.set(
            2 * ((gx0 + gx1) / 2 / W) - 1,   // NDC-közép X
            1 - (gy0 + gy1) / H,             // NDC-közép Y (fotó-frakcióból)
            0
          );
          this.mirrorQuad.scale.set(2 * (gx1 - gx0) / W, 2 * (gy1 - gy0) / H, 1);
          // a tükrös textúrát a setMirrorTexture már előkészítette (UV-flip)
          this.mirrorQuadMat.map = this.mirrorRT.texture;
          this.mirrorQuadMat.needsUpdate = true;
        }

        ctx.putImageData(idata, 0, 0);
        const tex = new THREE.CanvasTexture(cv);
        tex.colorSpace = THREE.SRGBColorSpace;
        mat.map = tex;
        mat.needsUpdate = true;
        this.cockpitOverlayReady = true;
      } catch (e) {
        console.warn('Cockpit-overlay hiba:', e && e.message, (e && e.stack || '').split('\n')[1]);
      }
    };
    img.src = 'cockpit.png';
  }

  // Kezdőképernyő verziójel: v<utolsó commit rövid hash> · <a commit ideje>.
  // Az adatot a vite.config.mjs (__BUILD_INFO__) injektálja a gitből.
  renderVersion() {
    const el = $('verBox');
    if (!el) return;
    const { short, stamp } = (typeof __BUILD_INFO__ !== 'undefined' && __BUILD_INFO__) || {};
    if (!short) {
      el.textContent = 'fejlesztői build (nincs commit-adat)';
      return;
    }
    let t;
    try { t = new Date(stamp).toLocaleString('hu-HU', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }); }
    catch { t = ''; }
    el.textContent = t ? `v${short} · utolsó commit: ${t}` : `v${short}`;
  }

  initEvents() {
    this.input.onAnyKey = () => this.audio.ensure();
    $('startBtn').addEventListener('click', () => { this.audio.ensure(); this.start(); });
    $('restartBtn').addEventListener('click', () => { this.audio.ensure(); this.start(); });

    window.addEventListener('resize', () => {
      this.renderer.setSize(window.innerWidth, window.innerHeight, false);
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
    });

    window.addEventListener('keydown', (e) => {
      const k = e.key.toLowerCase();
      if (k === 'p') this.togglePause();
      if (k === 'm') this.audio.toggleMute();
      if ((k === 'enter' || k === ' ') && this.state === 'start') this.start();
      if (k === 'r') {
        if (this.state === 'over') this.start();
        else if (this.state === 'play') this.restart();
      }
    });
  }

  start() {
    this.engine.reset();
    this.engine.seedStartTraffic();
    this.traffic.clear();
    this.player.syncFrom(this.engine.player, 0);
    this.prevLane = 2;
    this.timeoutDone = false;
    this.prevBlinkOn = false;
    this.tipT = 1.0;
    this.tipIdx = 0;
    this.setState('play');
    this.hud.updateScore(0);
    this.hud.updateEnergy(100, 0, this.scoring.gateT);
    this.hud.updateGate(0, 0);
    this.hud.updateSpeed(0);
  }

  restart() { this.start(); }

  togglePause() {
    if (this.state === 'play') this.setState('pause');
    else if (this.state === 'pause') this.setState('play');
  }

  setState(s) {
    this.state = s;
    $('startOverlay').classList.toggle('hidden', s !== 'start');
    $('pauseOverlay').classList.toggle('hidden', s !== 'pause');
    $('overOverlay').classList.toggle('hidden', s !== 'over');
  }

  gameOver(reason) {
    if (this.state === 'over') return;
    this.hud.showBestIfNew(this.scoring.score);
    $('overTitle').textContent = (reason && reason.title) || 'BALESET VÉGE';
    $('overSub').textContent = (reason && reason.sub) || 'Kifogytál az életekből';
    $('overBest').textContent = 'Legjobb: ' + this.hud.best.toLocaleString('hu-HU');
    const rows = this.scoring.breakdown().concat([['ÖSSZESEN', this.scoring.score, '']]);
    $('breakTable').innerHTML = rows.map(([label, val, extra]) => `
      <tr class="${label === 'ÖSSZESEN' ? 'total' : ''}">
        <td>${label}${extra ? ' <small style="opacity:.6">(' + extra + ')</small>' : ''}</td>
        <td>${val.toLocaleString('hu-HU')}</td>
      </tr>`).join('');
    this.setState('over');
  }

  // Teszt-segéd: tiszta állapotba rakja az autót, majd bokszot állít elé.
  testCrash() {
    if (this.state !== 'play') return;
    const p = this.engine.player;
    p.x = laneCenterX(1);
    p.yaw = 0;
    p.laneChange = null;
    p.signal = 0;
    p.speed = 36;   // utazósebesség-közeli: a radar-tempomat nem tud megállítani időben
    p.fwdSpeed = 36;
    p.z += 3;
    // determinisztikus ütközés: takarítsuk ki a sávot (a radar különben egy
    // NPC mögött megállna, és sosem érnénk a teszt-bokszhoz)
    this.engine.cars = this.engine.cars.filter((c) => !(c.lane === 1 && c.z < p.z + 250));
    const entry = this.engine.addObstacle(p.fwdSpeed - 10, p.z + 12, 1);
    setTimeout(() => this.engine.removeObstacle(entry), 1800);
  }

  pushTip(text) {
    this.hud.setHint(text + '<small>' + HINT_KEYS + '</small>');
    setTimeout(() => { this.tipT = TIP_DELAY; }, 3200);
  }

  // Nagy figyelmeztetés: képernyő-középponti, animált felirat.  A SÁV FOGLALT
  // és a jobbról-előzés büntetése is ezt használja — a szín a feliraté.
  // small: a hosszabb feliratokhoz kisebb betű (ne lógjon ki a széleken).
  warnBig(text, color, small = false) {
    const el = $('laneWarn');
    el.textContent = text;
    el.style.color = color;
    el.style.fontSize = small ? 'clamp(28px, 5vw, 76px)' : '';
    el.classList.remove('warn');
    void el.offsetWidth; // reflow → az animáció mindig újra indul
    el.classList.add('warn');
  }

  renderTip() {
    const tip = TIPS[this.tipIdx % TIPS.length];
    this.hud.setHint(tip + '<small><b>Jobbra tartás:</b> ' + HINT_KEYS + '</small>');
  }

  tutorial(dt) {
    if (this.state !== 'play') return;
    if (this.tipT > 14) return;
    this.tipT += dt;
    if (this.tipT >= TIP_DELAY) {
      this.tipT = 0;
      this.tipIdx++;
      this.renderTip();
    }
    if (this.tipT >= 13.8) this.hud.setHint('');
  }

  fixed(t) {
    // EGYETLEN lépés a logikára; a nézet mindent a mag-állapotból vesz
    this.engine.tick(PHYS_FIXED);

    // látvány-szinkron
    this.player.syncFrom(this.engine.player, t);
    this.traffic.sync(this.engine.cars);
    this.world.update(this.engine.dist);
    this.world.positionGate(this.engine.player.z + (SCORE.gateDist - this.engine.scoring.gateAcc));

    // irányjelző kattanás a villogási fázisra
    const blinkOn = this.engine.player.signalOn();
    if (blinkOn && !this.prevBlinkOn) this.audio.blink();
    this.prevBlinkOn = blinkOn;
    this.hud.updateSignal(this.engine.player.signal);

    this.effects.tickShake(t);
    this.effects.updateParticles(t);
    // árnyékkamera kövesse a játékost (különben az árnyék a startnál reked)
    this.world.shadowTarget.position.set(this.engine.player.x, 0, this.engine.player.z);
    this.world.shadowTarget.updateMatrixWorld();
    this.tutorial(t);

    const kmh = Math.abs(this.engine.player.fwdSpeed) * 3.6;
    this.hud.updateScore(this.scoring.score);
    this.hud.updateSpeed(kmh);
    this.hud.updateEnergy(this.scoring.energyFrac() * 100, this.scoring.gateFrac(), this.scoring.gateT);
    this.hud.updateLaneRate(this.engine.drainRate(this.engine.player.laneIndex()));
    this.hud.updateGate(this.scoring.gates, this.engine.difficulty(), this.scoring.reqAvg());
  }

  debug() {
    const e = this.engine.debug();
    return { gid: this.gid, gc: window.__gameCount,
      state: this.state,
      ...e,
      vel: [0, 0, 0],
      av: [0],
      wheels: this.player.wheelDbg(this.engine.player),
      model: this.playerHasModel,
    };
  }

  startLoop() {
    let last = performance.now();
    const loop = (now) => {
      requestAnimationFrame(loop);
      const rdt = Math.min(0.05, (now - last) / 1000);
      last = now;

      if (this.state === 'play') {
        this.acc += rdt;
        let n = 0;
        while (this.acc >= PHYS_FIXED && n < 5) {
          this.fixed(PHYS_FIXED);
          this.acc -= PHYS_FIXED;
          n++;
        }
        if (n === 5) this.acc = 0;
      }

      // a render mindig fut (kezdőképernyő mögött is látszik a világ)
      this.effects.getShakeOffset(this.shakeTmp);
      const cockpit = this.state === 'play';
      if (cockpit) {
        // visszapillantó tükör: a hátsó nézet külön render a mirrorRT-ba,
        // az overlay-quad mutatja a fotó tükörüvege helyén
        this.player.positionMirror(this.mirrorCam);
        this.mirrorCam.updateMatrixWorld();
        this.renderer.setRenderTarget(this.mirrorRT);
        this.renderer.autoClear = true;
        this.renderer.render(this.scene, this.mirrorCam);
        this.renderer.setRenderTarget(null);
        // belső nézet: a világ (0) + a cockpit-fotó overlay (a fotó fedi a
        // műszerfalat; a szélvédő kimaszkolt része átengedi a 3D világot).
        this.camera.layers.set(0);
      } else {
        this.camera.layers.set(0);
        this.camera.layers.enable(1); // külső nézet: út + a saját autó váza
      }
      this.player.updateCamera(this.camera, rdt, this.shakeTmp, cockpit ? 'cockpit' : 'chase');
      this.camera.updateMatrixWorld();

      if (cockpit && this.cockpitOverlayReady) {
        // 1. külön render a világra (háttér törlés átírja a bg színhez),
        // 2. a fotó-overlay a tetejére (depthTest kikapcs → mindig elöl,
        //    a kimaszkolt szélvédő átlátszó → ott kilátszik a világ).
        this.renderer.autoClear = true;
        this.renderer.render(this.scene, this.camera);
        this.renderer.autoClear = false;
        this.renderer.render(this.cockpitOverlayScene, this.cockpitOverlayCam);
        this.renderer.autoClear = true;
      } else {
        this.renderer.render(this.scene, this.camera);
      }
    };
    requestAnimationFrame(loop);
  }
}

new Game();
