// Fő játékvezérlő: render-loop, fizikai rögzített lépés, állapotgép, ütközés-kezelés.
import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { CAMERA, PHYS_FIXED } from './constants.js';
import { World } from './world.js';
import { Player } from './player.js';
import { Traffic } from './traffic.js';
import { Effects } from './effects.js';
import { Scoring } from './scoring.js';
import { HUD } from './hud.js';
import { Input } from './input.js';
import { AudioFX } from './audio.js';

const TIPS = [
  'A jobb szélső sáv a haladási sávod — ott haladva pontot kapsz.',
  'Előzni csak balról szabad: ki balra, előzés, vissza jobbra.',
  'Jobbról előztek? Túl balfelé kószálsz — húzódj jobbra!',
  'Minél simábban bánsz a gázzal/fékkel, annál több a 10 mp-es bónusz.',
  'Kamion a jobb sávban? Időben fékezz, vagy előzd meg szabályosan.',
  'Szorozd a bónuszt: egymás után több jó szakasz = nagyobb szorzó.',
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

    this.worldPhys = makePhysics();
    this.initRenderer();
    this.initModules();
    this.initEvents();

    // teszt-/fejlesztői belépési pontok
    window.__dbg = () => this.debug();
    window.__start = () => this.start();
    window.__testCrash = () => this.testCrash();
    window.__forceSection = () => this.scoring.settleSection();
    window.__rayTest = (fromX, fromY, toY) => {
      const w = this.worldPhys;
      const from = new CANNON.Vec3(fromX, fromY, 0);
      const to = new CANNON.Vec3(fromX, toY, 0);
      const res = new CANNON.RaycastResult();
      const hit = w.rayTest(from, to, res);
      return { hit, hasHit: res.hasHit, dist: res.hasHit ? +res.distance.toFixed(3) : null, body: res.hasHit ? res.body ? res.body.type : 'null' : 'none', gx: res.hasHit ? res.hitPointWorld.x : null, gy: res.hasHit ? +res.hitPointWorld.y.toFixed(3) : null };
    };
    window.__ready = true;

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
    this.scene.fog = new THREE.Fog(0x9ec9e8, 45, 175);

    this.camera = new THREE.PerspectiveCamera(CAMERA.fov, window.innerWidth / window.innerHeight, 0.1, 500);
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

    $('hud').classList.remove('hidden');
    this.hud.updateScore(0);
    this.hud.updateSpeed(0);
    this.hud.updateEco(100, 0);
    this.hud.updateLives(3);
    this.hud.updateMult(1, 0);
  }

  initEvents() {
    this.worldPhys.addEventListener('beginContact', (e) => this.onContact(e));

    this.traffic.onOvertake = () => {
      this.scoring.overtake();
      this.audio.overtake();
    };
    this.traffic.onPenalty = (car, selfDidIt) => {
      this.scoring.penalty();
      this.audio.penalty();
      if (!selfDidIt) this.pushTip('Jobbról előztek — húzódj jobbra!');
    };
    this.traffic.onPopup3D = (text, color, pos) => this.effects.popup(text, color, pos);
    this.scoring.onSection = (bonus, avg, mult, streak) => {
      this.audio.bonus();
      this.effects.popup(
        `+${bonus} ✦ BÓNUSZ ×${mult.toFixed(1).replace('.', ',')}`,
        '#ffd54a', this.player.pos
      );
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
    this.scoring.init();
    this.player.invincible = 0;
    this.traffic.clear();
    this.player.respawnAtLane(2);
    this.tipT = 1.0;
    this.tipIdx = 0;
    this.setState('play');
    this.hud.updateLives(3);
    this.hud.updateScore(0);
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

  gameOver() {
    this.hud.showBestIfNew(this.scoring.score);
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
    const entry = this.traffic.addObstacle(p.fwdSpeed - 10, p.pos.z + 12, p.laneIndex());
    setTimeout(() => this.traffic.removeObstacle(entry), 1800);
  }

  pushTip(text) {
    this.hud.setHint(text + '<small>W/S gáz-fék • A/D kormány • P szünet • M hang</small>');
    setTimeout(() => { this.tipT = TIP_DELAY; }, 3200);
  }

  renderTip() {
    const tip = TIPS[this.tipIdx % TIPS.length];
    this.hud.setHint(tip + '<small><b>Jobbra tartás:</b> W/S gáz-fék • A/D kormány • P szünet • M hang</small>');
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
    const inp = this.input;
    // analóg gáz/fék — a finom adagolás a gazdaságosság kulcsa
    if (inp.gas) this.gasA = Math.min(1, this.gasA + t * 2.0);
    else this.gasA = Math.max(0, this.gasA - t * 6);
    if (inp.brake) this.brakeA = Math.min(1, this.brakeA + t * 2.5);
    else this.brakeA = Math.max(0, this.brakeA - t * 6);

    this.player.step({ throttle: this.gasA, brake: this.brakeA, steer: inp.steer }, t, this.effects, this.audio);
    // a kerekes jármű ütközési/erő egyenleteit a világ-léptetés oldja meg
    this.worldPhys.step(t);
    if (this.player.invincible > 0) this.player.invincible -= t;

    const fwd = Math.max(0, this.player.fwdSpeed);
    this.dist += fwd * t;
    const difficulty = Math.min(1, this.dist / 2400);

    this.traffic.update(t, this.player, difficulty);
    this.scoring.update(t, this.player.laneIndex(), fwd, this.gasA, this.brakeA);

    this.effects.tickShake(t);
    this.effects.updateParticles(t);
    this.world.update(this.dist);
    this.tutorial(t);
    this.audio.setEngine(Math.min(1, fwd / 40));

    const kmh = fwd * 3.6;
    this.hud.updateScore(this.scoring.score);
    this.hud.updateSpeed(Math.abs(this.player.fwdSpeed) * 3.6);
    this.hud.updateEco(this.scoring.eco, this.scoring.sectionFrac());
    this.hud.updateMult(this.scoring.mult, this.scoring.streak);
  }

  debug() {
    return {
      state: this.state, lives: this.lives, cars: this.traffic.cars.length,
      score: Math.round(this.scoring.score), eco: +this.scoring.eco.toFixed(1),
      mult: +this.scoring.mult.toFixed(2), streak: this.scoring.streak,
      kmh: Math.round(Math.abs(this.player.fwdSpeed) * 3.6),
      pos: [+this.player.pos.x.toFixed(2), +this.player.pos.y.toFixed(2), +this.player.pos.z.toFixed(2)],
      yaw: +(this.player.yaw() * 180 / Math.PI).toFixed(1),
      vel: [+this.player.chassis.velocity.x.toFixed(2), +this.player.chassis.velocity.y.toFixed(2), +this.player.chassis.velocity.z.toFixed(2)],
      av: [+this.player.chassis.angularVelocity.y.toFixed(2)],
      wheels: this.player.wheelDbg(),
      dist: Math.round(this.dist), crashCount: this.crashCount,
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
      this.player.updateCamera(this.camera, rdt, this.shakeTmp);
      this.camera.updateMatrixWorld();
      this.renderer.render(this.scene, this.camera);
    };
    requestAnimationFrame(loop);
  }
}

new Game();
