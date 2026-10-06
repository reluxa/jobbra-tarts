// Fő játékvezérlő: render-loop, fizikai rögzített lépés, állapotgép, ütközés-kezelés.
import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { CAMERA, DRIVE, PHYS_FIXED, SCORE, SIGNAL, WORLD } from './constants.js';
import { laneCenterX } from './constants.js';
import { World } from './world.js';
import { Player } from './player.js';
import { Traffic } from './traffic.js';
import { Effects } from './effects.js';
import { Scoring } from './scoring.js';
import { HUD } from './hud.js';
import { Input } from './input.js';
import { AudioFX } from './audio.js';
import { loadCarModels } from './models.js';

const TIPS = [
  'A jobb szélső sáv a haladási sávod — ott lassabban fogy a kapu-időd, ezért CSAK jobbra tartva lehet nyerni.',
  'Sávváltás:  A  vagy  ←  balra,  D  vagy  →  jobbra — a játék elvégzi a váltást.',
  'Kapuk közt haladsz: a kapu-idő („kell ≈ … km/h”) minden kapunál fogy — érj oda, mielőtt lejár.',
  'A belső (bal) sávban az óra 1.8-szor gyorsabban zabálja az idődet — csak rövid elözésre menj oda.',
  'Előzni csak balról szabad: ki balra, előzés, majd VISSZA jobbra (különben elfolyik az időd).',
  'Jobbról előztek? Túl balfelé kószálsz — térj vissza jobbra!',
  'Indexelj (Q/E) a sávváltás előtt: +12 pont, jelzés nélkül −8 PONT és −3s kapu-idő!',
  'Visszapillantó tükör: nézd, ki közelít hátulról a bal sávban!',
  'Kamion a jobb sávban? Dönts: előzd meg balról, vagy maradj mögötte.',
  'Egyre nehezebb: gyorsul az autó, sűrűsödik a forgalom és nő a kért átlag (km/h).',
];
const TIP_DELAY = 4.5;

const $ = (id) => document.getElementById(id);

function makePhysics() {
  // Nincs gravitáció: a jármű sebességét mi vezéreljük, a cannon csak a
  // kontakteseményeket és a kitolást végzi (kinematikus forgalom, korlát).
  const world = new CANNON.World({ gravity: new CANNON.Vec3(0, 0, 0) });
  world.allowSleep = false;
  world.solver.iterations = 10;
  world.defaultContactMaterial.friction = 0.4;
  return world;
}

export class Game {
  constructor() {
    this.state = 'start';
    this.lives = 3;
    this.dist = 0;
    this.acc = 0;
    this.gasA = 0;
    this.brakeA = 0;
    this.tipT = 1.0;
    this.tipIdx = 0;
    this.crashCount = 0;
    this.prevLane = 2;
    this.timeoutDone = false;
    this.prevBlinkOn = false;
    this.playerHasModel = false;

    this.worldPhys = makePhysics();
    this.initRenderer();
    this.initModules();
    this.initEvents();

    // teszt-/fejlesztői belépési pontok
    window.__dbg = () => this.debug();
    window.__start = () => this.start();
    window.__testCrash = () => this.testCrash();
    window.__forceSection = () => this.scoring.advance(SCORE.gateDist); // teszt: egy kapu ugrás
    window.__jumpLane = (lane, edge = 0) => {
      if (this.state !== 'play') return;
      // determinisztikus teszt: a teleport helyéről kitakarítjuk a forgalmat,
      // különben egy kinematikus autó löki a dinamikus játékost (flakiség).
      const pz = this.player.pos.z;
      for (let i = this.traffic.cars.length - 1; i >= 0; i--) {
        const c = this.traffic.cars[i];
        if (Math.abs(c.body.position.z - pz) < 25) {
          this.worldPhys.removeBody(c.body);
          this.scene.remove(c.meshes);
          this.traffic.byId.delete(c.body.id);
          this.traffic.cars.splice(i, 1);
        }
      }
      this.player.respawnAtLane(lane);
      if (edge) this.player.chassis.position.x = laneCenterX(lane) + edge;
      this.player.speed = 14;   // indulósebesség: a teszt ne a gyorsítástól függjön
      this.player.fwdSpeed = 14;
      this.prevLane = lane;
    };
    window.__rayTest = (fromX, fromY, toY) => {
      const w = this.worldPhys;
      const from = new CANNON.Vec3(fromX, fromY, 0);
      const to = new CANNON.Vec3(fromX, toY, 0);
      const res = new CANNON.RaycastResult();
      const hit = w.rayTest(from, to, res);
      return { hit, hasHit: res.hasHit, dist: res.hasHit ? +res.distance.toFixed(3) : null, body: res.hasHit ? res.body ? res.body.type : 'null' : 'none', gx: res.hasHit ? res.hitPointWorld.x : null, gy: res.hasHit ? +res.hitPointWorld.y.toFixed(3) : null };
    };
    window.__ready = true;
    window.__game = this; // fejlesztői hozzáférís a belső állapothoz
    window.__THREE = THREE; // fejlesztői hozzáférís a három.js-hez a próbákhoz

    this.startLoop();
  }

  initRenderer() {
    this.canvas = document.createElement('canvas');
    $('game').appendChild(this.canvas);
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.renderer.setSize(window.innerWidth, window.innerHeight, false);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.1;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x9ec9e8);
    this.scene.fog = new THREE.Fog(0x9ec9e8, 60, 300);

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
    this.world = new World(this.scene, this.worldPhys);
    this.player = new Player(this.scene, this.worldPhys);
    this.traffic = new Traffic(this.scene, this.worldPhys);
    this.scoring = new Scoring();
    this.hud = new HUD();
    this.input = new Input();
    this.audio = new AudioFX();
    this.effects = new Effects(this.scene, this.camera, $('labels'));
    this.shakeTmp = new THREE.Vector3();

    this.player.setMirrorTexture(this.mirrorRT.texture);
    this.input.onSignal = (d) => { if (this.state === 'play') this.player.toggleSignal(d); };
    this.input.onLane = (d) => { if (this.state === 'play') this.player.requestLaneChange(d); };

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
    this.hud.updateLives(3);
    this.hud.updateGate(0, 0);
  }

  initEvents() {
    this.worldPhys.addEventListener('beginContact', (e) => this.onContact(e));

    this.traffic.onOvertake = () => {
      this.scoring.overtake();
      this.audio.overtake();
    };
    this.traffic.onPenalty = (car, selfDidIt) => {
      this.scoring.penalty(selfDidIt); // csak a játékos bevágása apasztja az időt
      this.audio.penalty();
      if (!selfDidIt) this.pushTip('Jobbról előztek — húzódj jobbra!');
    };
    this.traffic.onPopup3D = (text, color, pos) => this.effects.popup(text, color, pos);
    this.scoring.onGate = (bonus, gates) => {
      this.audio.bonus();
      this.effects.popup(`+${bonus} KAPU ✓ (${gates}.)`, '#ffd54a', this.player.pos);
    };

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
      if (k === 'k' && this.state === 'play') this.testCrash();
    });
  }

  start() {
    this.lives = 3;
    this.dist = 0;
    this.gasA = this.brakeA = 0;
    this.crashCount = 0;
    this.timeoutDone = false;
    this.scoring.init();
    this.player.invincible = 0;
    this.traffic.clear();
    // azonnali forgalom: az első másodpercekben is legyen mit kerülgetni
    // azonnali forgalom: az első másodpercekben is legyen mit kerülgetni
    // (a közeli szemecek a bal/középső sávba kerülnek, a játékos sávja tiszta)
    this.traffic.spawn(this.player.pos.z, 0, 25, 1);
    this.traffic.spawn(this.player.pos.z, 0, 55, 0);
    this.traffic.spawn(this.player.pos.z, 0, 90, 1);
    this.traffic.spawn(this.player.pos.z, 0, 140, 2);
    this.traffic.spawnBehind(this.player); // gyors előlkanyarodó a tükörbe
    this.player.respawnAtLane(2);
    this.prevLane = 2;
    this.tipT = 1.0;
    this.tipIdx = 0;
    this.setState('play');
    this.hud.updateLives(3);
    this.hud.updateScore(0);
    this.hud.updateEnergy(100, 0);
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

  onContact(e) {
    if (this.state !== 'play') return;
    const p = this.player.chassis;
    let other = null;
    if (e.bodyA.id === p.id) other = e.bodyB;
    else if (e.bodyB.id === p.id) other = e.bodyA;
    else return;

    const entry = this.traffic.byId.get(other.id);
    if (!entry) return;

    const approach = Math.max(0, this.player.fwdSpeed - entry.speed);
    if (approach < 6) return; // enyhe súrlódás nem baleset

    this.crashWith(entry, approach);
  }

  crashWith(entry, approach) {
    if (this.player.invincible > 0 || this.state !== 'play') return;
    this.lives--;
    this.crashCount++;
    this.scoring.crash();
    this.hud.updateLives(this.lives);
    this.audio.crash();
    this.effects.shake(1.3, 0.65);
    this.hud.flash();

    const p = this.player;
    p.slowDown(approach * 0.85);       // ütközés-lelassulás
    p.nudgeYaw((Math.random() - 0.5) * 0.9); // hirtelen kormány-ütés

    const mid = new THREE.Vector3()
      .addVectors(p.group.position, new THREE.Vector3(entry.body.position.x, entry.body.position.y, entry.body.position.z))
      .multiplyScalar(0.5);
    this.effects.burst(mid, 30, 0xff7043);
    this.effects.popup('-150 BALESET', '#ff8a80', mid);

    p.invincible = 2.5;
    if (this.lives <= 0) this.gameOver();
  }

  // Teszt-segéd: tiszta állapotba rakja az autót, majd bokszot állít elé.
  testCrash() {
    if (this.state !== 'play') return;
    const p = this.player;
    p.respawnAtLane(1);
    p.speed = 18;
    p.chassis.position.z += 3;
    // determinisztikus ütközés: takarítsuk ki a sávot (a radar különben egy
    // NPC mögött megállna, és sosem érnénk a teszt-bokszhoz)
    for (let i = this.traffic.cars.length - 1; i >= 0; i--) {
      const c = this.traffic.cars[i];
      if (c.ghost) continue;
      if (c.lane === p.laneIndex() && c.body.position.z < p.pos.z + 250) {
        this.traffic.removeObstacle(c);
      }
    }
    const entry = this.traffic.addObstacle(p.fwdSpeed - 10, p.pos.z + 12, p.laneIndex());
    setTimeout(() => this.traffic.removeObstacle(entry), 1800);
  }

  pushTip(text) {
    this.hud.setHint(text + '<small>A/D sávváltás • Q/E index • P szünet • M hang</small>');
    setTimeout(() => { this.tipT = TIP_DELAY; }, 3200);
  }

  renderTip() {
    const tip = TIPS[this.tipIdx % TIPS.length];
    this.hud.setHint(tip + '<small><b>Jobbra tartás:</b> A/D sávváltás • Q/E index • P szünet • M hang</small>');
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
    // Sávváltás-fókusz: nincs kézi gáz/fék/kormányzás. A játék automatikusan
    // halad (utazósebesség) és elvégzi a kért sávváltásokat. A balra/jobbra
    // gomb az onLane-kiváltás útján indítja a váltást a Playerben.
    this.player.step(t);
    // a kerekes jármű ütközési/erő egyenleteit a világ-léptetés oldja meg
    this.worldPhys.step(t);
    // a világ-léptetés a kasztnit tovább mozgathatta (testeintegráló + kontaktok),
    // ezért a vizuálist a LÉPÉS UTÁN szinkronizáljuk — így a csoport (és a ráépülő
    // kokpit-kamera) sosem marad le egy lépésnyit sem a testről. dt=0: a kerekek
    // forgása ne duplázódjon (azt a step() már megtette).
    this.player.syncVisual(0);
    if (this.player.invincible > 0) this.player.invincible -= t;

    const fwd = Math.max(0, this.player.fwdSpeed);
    this.dist += fwd * t;
    const difficulty = Math.min(1, this.dist / 2400);
    // a játék nehézsége nő: gyorsul a haladás + sűrűsödik a forgalom
    this.player.cruise = DRIVE.cruise + (DRIVE.cruiseMax - DRIVE.cruise) * difficulty;

    this.traffic.update(t, this.player, difficulty);
    // kapu-alapú pontozás: sáv-bónusz/levonás + kapu-idő epedése + kapu-ugrás
    const lane = this.player.laneIndex();
    this.scoring.update(t, lane);
    this.scoring.advance(fwd * t);
    // a kapu-látvány a következő kapu-pont fölött áll (a játékos elé)
    this.world.positionGate(this.player.pos.z + (SCORE.gateDist - this.scoring.gateAcc));
    // ha lejárt a kapu-idő a következő kapu előtt — vége
    if (this.scoring.timedOut && !this.timeoutDone) {
      this.timeoutDone = true;
      this.gameOver({ title: 'KIFUTOTTÁL A KAPU-IDŐBŐL', sub: 'Nem értél a következő kapuhoz időre.' });
      return;
    }

    // ---- sávváltás + indexelés (KRESZ) ----
    // radar-tempomat: az azonos sávban elöl haladó jármű tempója (lassú előtt lassulunk)
    const ahead = this.traffic.aheadInLane(lane, this.player.pos.z);
    this.player.setRadar(ahead ? ahead.gap : Infinity, ahead ? ahead.speed : 600);

    if (lane !== this.prevLane) {
      const dir = Math.sign(lane - this.prevLane);
      const p = this.player;
      // akkor jár a bónusz, ha UGYANEBBA az irányba aktiváltuk az indexet
      // legalább minLead-tel korábban (és az még él)
      const led = p.signal === dir && p.signalT >= SIGNAL.minLead && p.signalT <= SIGNAL.autoOff;
      this.scoring.signalChange(led);
      if (led) {
        this.audio.bonus();
        this.effects.popup(`+${SIGNAL.points} INDEX ✓`, '#ffd54a', p.pos);
        p.signal = 0; // a váltás után lekapcsoljuk a villogót
      } else {
        this.audio.penalty();
        this.effects.popup(`−${SIGNAL.noSignalPenalty} Index nélkül váltasz sávot!`, '#ff8a80', p.pos);
      }
    }
    this.prevLane = lane;

    // irányjelző kattanás a villogási fázisra
    const blinkOn = this.player.signalAct() && this.player.blinkPhase < 0.5;
    if (blinkOn && !this.prevBlinkOn) this.audio.blink();
    this.prevBlinkOn = blinkOn;
    this.hud.updateSignal(this.player.signal);

    this.effects.tickShake(t);
    this.effects.updateParticles(t);
    this.world.update(this.dist);
    // világ-„végtelenítés": a világ STATIKUS [start,end]; ha a játékos a far
    // felé ér, őt a wrapTo-ba teleportáljuk vissza (a világ nem tolódik, így
    // előtte mindig teljes út van — ez újrafinalizál); a forgalmat frissen
    // rendeljük a becsapásnál.
    if (this.player.pos.z > WORLD.wrapAt) {
      const snapZ = this.player.pos.z - WORLD.wrapTo;
      const delta = Math.round(snapZ / WORLD.tile) * WORLD.tile;
      this.player.wrapZ(delta);
      this.traffic.clear();
    }
    // árnyékkamera kövesse a játékost (különben az árnyék a startnál reked)
    this.world.shadowTarget.position.copy(this.player.pos);
    this.world.shadowTarget.updateMatrixWorld();
    this.tutorial(t);
    this.audio.setEngine(Math.min(1, fwd / 40));

    const kmh = fwd * 3.6;
    this.hud.updateScore(this.scoring.score);
    this.hud.updateSpeed(Math.abs(this.player.fwdSpeed) * 3.6);
    this.hud.updateEnergy(this.scoring.energyFrac() * 100, this.scoring.gateFrac());
    this.hud.updateGate(this.scoring.gates, difficulty, this.scoring.reqAvg());
  }

  debug() {
    return {
      state: this.state, lives: this.lives, cars: this.traffic.cars.length,
      score: Math.round(this.scoring.score), gates: this.scoring.gates,
      gateT: +this.scoring.gateT.toFixed(1),
      kmh: Math.round(Math.abs(this.player.fwdSpeed) * 3.6),
      pos: [+this.player.pos.x.toFixed(2), +this.player.pos.y.toFixed(2), +this.player.pos.z.toFixed(2)],
      yaw: +(this.player.yaw() * 180 / Math.PI).toFixed(1),
      vel: [+this.player.chassis.velocity.x.toFixed(2), +this.player.chassis.velocity.y.toFixed(2), +this.player.chassis.velocity.z.toFixed(2)],
      av: [+this.player.chassis.angularVelocity.y.toFixed(2)],
      wheels: this.player.wheelDbg(),
      dist: Math.round(this.dist), crashCount: this.crashCount,
      sig: this.player.signal,
      lane: this.player.laneIndex(),
      radar: this.player.radarOn ? +this.player.radarGap.toFixed(1) : 0,
      sigOK: this.scoring.parts.signalsOK,
      sigNo: this.scoring.parts.noSignalCount,
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
        // belső nézet: út + belsőtér (a saját karosszéria elrejtődik,
        // mert a belső elemek a modell héjába esnének — a tükröt a tükör-kamera
        // különben is láttatja)
        this.camera.layers.set(0);
        this.camera.layers.enable(2);
      } else {
        this.camera.layers.set(0);
        this.camera.layers.enable(1); // külső nézet: út + a saját autó váza
      }
      this.player.updateCamera(this.camera, rdt, this.shakeTmp, cockpit ? 'cockpit' : 'chase');
      this.camera.updateMatrixWorld();

      // visszapillantó tükör (csak vezetés közben kell): a tükör-kamera egy
      // kis céltextúrába rajzolja a hátsó nézetet, amelyet a belső tükörüveg mutat.
      if (cockpit) {
        this.renderer.shadowMap.enabled = false;
        this.renderer.setRenderTarget(this.mirrorRT);
        this.player.positionMirror(this.mirrorCam);
        this.renderer.render(this.scene, this.mirrorCam);
        this.renderer.setRenderTarget(null);
        this.renderer.shadowMap.enabled = true;
      }
      this.renderer.render(this.scene, this.camera);
    };
    requestAnimationFrame(loop);
  }
}

new Game();
