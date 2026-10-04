// A játékos autó, boltozatos (arcade) hajtással, de a cannon-es fizikavilág
// kontaktrendszerével: az ütközést továbbra is a cannon oldja meg (események,
// kitolás, kinematikus akadályok), mi csak az erőhatást adjuk a kasztninak
// (gyorsulás/fék/kormányzás), így a játékérzés determinisztikus és hangolható.
//
// Látvány-rétegek:
//   layer 0 — világ (út, forgalom, korlát, felhők)
//   layer 1 — a saját autó KÜLSŐ váza (jobb látszik a visszapillantó tükörben,
//            a vezetőüléses kamerának nem — ő a kocsi belsejében ül)
//   layer 2 — a saját autó BELSEJE (műszerfal, kormány, belső tükör...)
// A kamera rétegeit a main.js forgatja aszerint, hogy belső vagy külső nézet kell.
import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { BARRIER_X, CAMERA, CAR, DRIVE, LANE_W, SIGNAL, laneCenterX } from './constants.js';

const MATH_ = Math;
const clamp = (v, a, b) => MATH_.max(a, MATH_.min(b, v));

export class Player {
  constructor(scene, world) {
    this.scene = scene;
    this.world = world;

    this.group = new THREE.Group();
    scene.add(this.group);

    // rétegelt látvány
    this.extGroup = new THREE.Group(); extGroupLayer(this.extGroup, 1);
    this.intGroup = new THREE.Group(); extGroupLayer(this.intGroup, 2);
    // a csoport origója a kasztni köz pontja (~0.62 m), a vizuál viszont a
    // talajköréhez képest van tervezve → a gyerek elemek lokálisan „földhöz írva”
    this.extGroup.position.y = this.intGroup.position.y = -CAR.restY;
    this.group.add(this.extGroup, this.intGroup);

    this.buildVisual();   // dobozos vészlátvány (model null, de elég)
    this.buildPhysics();
    // a Three.js rétegeket NEM örökli az objektumfák: az összes gyereket
    // külön-külön le kell állítani a megfelelő rétegre
    setGroupLayer(this.extGroup, 1);
    setGroupLayer(this.intGroup, 2);

    this.steer = 0;        // akt. befordítás (-1..1)
    this.speed = 0;        // hosszirányú sebesség (m/s, előre pozitív)
    this.fwdSpeed = 0;     // alias a HUD/pass-logika felé
    this.invincible = 0;

    // indexelés (KRESZ-értéke a pontozásnál)
    this.signal = 0;       // -1 balra / 0 ki / +1 jobbra
    this.signalT = 0;      // a jelzés óta eltelt idő
    this.blinkPhase = 0;

    this.quatTmp = new THREE.Quaternion();
    this.qCannon = new CANNON.Quaternion();
    this.fwd = new THREE.Vector3(0, 0, 1);
    this.speedVec = new CANNON.Vec3();

    this.camPos = new THREE.Vector3(0, CAMERA.height, 10);
    this.camLook = new THREE.Vector3(0, 0, 0);
    this.v3 = new THREE.Vector3();
  }

  // ---------- alépítmények ----------

  buildVisual() {
    this.wheelMeshes = [];

    // --- KÜLSŐ VÁZ (procedurális vészlátvány; később glTF-modellre cserélhető) ---
    const dark = (c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.35, metalness: 0.55 });
    const chassis = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.44, 4.1), dark(0xd73a2a));
    chassis.position.y = 0.5;
    chassis.castShadow = true;

    const glassMat = new THREE.MeshStandardMaterial({ color: 0x9fd8ff, roughness: 0.08, metalness: 0.7, transparent: true, opacity: 0.92 });
    const cabin = new THREE.Mesh(
      new THREE.BoxGeometry(1.5, 0.3, 1.7),
      new THREE.MeshStandardMaterial({ color: 0x181e26, roughness: 0.3, metalness: 0.4 })
    );
    cabin.position.set(0, 0.92, -0.35);
    cabin.castShadow = true;
    const windshield = new THREE.Mesh(new THREE.BoxGeometry(1.44, 0.34, 0.42), glassMat);
    windshield.position.set(0, 1.0, 0.85);
    windshield.rotation.x = 0.6;
    const roof = new THREE.Mesh(new THREE.BoxGeometry(1.42, 0.09, 1.05), dark(0xb02e1f));
    roof.position.set(0, 1.13, -0.15);

    const lightMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0x9fd8ff, emissiveIntensity: 2 });
    const brakeMat = new THREE.MeshStandardMaterial({ color: 0x550000, emissive: 0xff2222, emissiveIntensity: 1.2 });
    const frontL = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.08, 0.06), lightMat);
    frontL.position.set(-0.62, 0.66, 2.06);
    const frontR = frontL.clone(); frontR.position.x = 0.62;
    const rearL = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.08, 0.06), brakeMat);
    rearL.position.set(-0.62, 0.66, -2.06);
    const rearR = rearL.clone(); rearR.position.x = 0.62;
    this.extGroup.add(chassis, cabin, windshield, roof, frontL, frontR, rearL, rearR);

    // kerekek: csak látvány (görgés + kormányzás dőlés)
    const wheelGeo = new THREE.CylinderGeometry(0.36, 0.36, 0.26, 14);
    const wheelMat = new THREE.MeshStandardMaterial({ color: 0x15181c, roughness: 0.9 });
    for (let i = 0; i < 4; i++) {
      const holder = new THREE.Group();
      const tyre = new THREE.Mesh(wheelGeo, wheelMat);
      tyre.rotation.z = Math.PI / 2;
      tyre.castShadow = true;
      holder.add(tyre);
      const rim = new THREE.Mesh(
        new THREE.CylinderGeometry(0.2, 0.2, 0.28, 8),
        new THREE.MeshStandardMaterial({ color: 0x8f9aa3, roughness: 0.3, metalness: 0.7 })
      );
      rim.rotation.z = Math.PI / 2;
      holder.add(rim);
      holder.position.set(i % 2 === 0 ? -0.8 : 0.8, 0.35, i < 2 ? 1.35 : -1.35);
      this.extGroup.add(holder);
      this.wheelMeshes.push({ holder, tyre, spin: 0, steer: false });
    }
    this.wheelMeshes[0].steer = this.wheelMeshes[1].steer = true;

    // indexlámpák a külső vázon (a tükörben/előzéskor is látszanak)
    this.buildSignalLights();

    // --- BELSŐ TÉR (vezetőülési nézet) ---
    this.buildInterior();
  }

  buildSignalLights() {
    const lightMat = () => new THREE.MeshStandardMaterial({
      color: 0xffb300, emissive: 0xff9f00, emissiveIntensity: 0.05,
    });
    const make = (x, z, rotY) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.05, 0.06), lightMat());
      m.position.set(x, 0.66, z);
      if (rotY) m.rotation.y = rotY;
      return m;
    };
    // 1-1 elöl is, hátul is, mindkét oldalon (külön anyag: csak az aktív oldal világít)
    this.sigLights = [
      make(-0.94, 2.03), make(-0.94, -2.03),
      make(0.94, 2.03), make(0.94, -2.03),
    ];
    this.sigLights.forEach((m) => this.extGroup.add(m));

    // műszerfali nyilak (belső)
    const arrowMat = () => new THREE.MeshStandardMaterial({
      color: 0xffb300, emissive: 0xffa000, emissiveIntensity: 0.05,
    });
    this.sigDash = [];
    for (const [x, rot] of [[0.22, 0], [0.54, Math.PI]]) {
      const a = new THREE.Mesh(new THREE.ConeGeometry(0.045, 0.1, 3), arrowMat());
      a.position.set(x, 0.87, 0.5);
      a.rotation.z = rot;
      this.intGroup.add(a);
      this.sigDash.push(a);
    }
  }

  buildInterior() {
    const intMat = new THREE.MeshStandardMaterial({ color: 0x15181d, roughness: 0.55, metalness: 0.25 });
    const shineMat = new THREE.MeshStandardMaterial({ color: 0x0e1014, roughness: 0.25, metalness: 0.85 });

    // műszerfal
    const dash = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.16, 0.5), intMat);
    dash.position.set(0, 0.82, 0.52);
    dash.rotation.x = 0.12;
    this.intGroup.add(dash);

    // műszerklaszter (gyenge kékes fény)
    const cluster = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.1, 0.02), new THREE.MeshStandardMaterial({
      color: 0x0b1220, emissive: 0x2b6fd6, emissiveIntensity: 1.6,
    }));
    cluster.position.set(0.44, 0.83, 0.78);
    cluster.rotation.x = -0.2;
    this.intGroup.add(cluster);

    // A-oszlopok (bal+jobblejtő)
    const aPillar = (x, ry) => {
      const p = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.7, 0.07), intMat);
      p.position.set(x, 0.92, 0.85);
      p.rotation.z = ry;
      p.rotation.x = -0.25;
      this.intGroup.add(p);
    };
    aPillar(-0.55, -0.22); // bal
    aPillar(0.55, 0.22);   // jobb — a kormányhoz közel

    // kormány (oszlop > kerék tengely > kerék)
    this.steerCol = new THREE.Group();
    this.steerCol.position.set(0.38, 0.72, 0.44);
    this.steerCol.rotation.x = 0.5; // dőlés: a kerék teteje a szélVédő felé
    this.intGroup.add(this.steerCol);
    this.steerWheel = new THREE.Group();
    this.steerCol.add(this.steerWheel);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.022, 10, 22), shineMat);
    // a torus alapból +Z felé néz: a kormány két keze a vezető felé áll
    const hub = new THREE.Mesh(new THREE.SphereGeometry(0.045, 10, 8), darkMat(0x23272e));
    const spokes = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.28, 0.03), shineMat);
    this.steerWheel.add(rim, hub, spokes);
    this.wheelSpinV = 0;

    // belső visszapillantó tükör: a vezető feje fölé, a vezető felé dőlve.
    // A keret tömör doboz, ezért a tükörüveget a keret ELÉRE (a kamera felé)
    // tesszük, hogy ne takarja. (Méret a valós arányokhoz: a széleink a kamera
    // szemmagassága felett, a tetőkárpit vonalában lóg, így nem takarja az utat.)
    const mirrorFrame = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.11, 0.028), intMat);
    mirrorFrame.position.set(0.10, 1.16, 0.95);
    mirrorFrame.rotation.x = -0.32;
    this.intGroup.add(mirrorFrame);
    // a vezető felé kell néznie a felületnek (a plane alapból +Z-t néz,
    // a kamera -Z felől nézi) → a Y-ge 180°-kal elforgatjuk + DoubleSide
    // biztonsággal (a tükörben a kép tükörfordítottan látszik, ami valósághű).
    this.mirrorGlass = new THREE.Mesh(
      new THREE.PlaneGeometry(0.27, 0.08),
      new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide })
    );
    this.mirrorGlass.position.set(0.10, 1.16, 0.91); // a keret élénél a vezető felé
    this.mirrorGlass.rotation.y = Math.PI;
    this.mirrorGlass.rotation.x = -0.32;
    this.intGroup.add(this.mirrorGlass);

    // oldaltükrök (csak dísz)
    for (const x of [-0.78, 0.78]) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.06, 0.1), shineMat);
      m.position.set(x, 0.94, 0.1);
      m.rotation.y = x < 0 ? -0.6 : 0.6;
      this.intGroup.add(m);
    }

    // tetőkárpit sáv (a látómező tetején)
    const headliner = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.06, 0.8), intMat);
    headliner.position.set(0, 1.22, 0.4);
    this.intGroup.add(headliner);
  }

  setMirrorTexture(tex) {
    if (this.mirrorGlass) this.mirrorGlass.material.map = tex;
    if (this.mirrorGlass) this.mirrorGlass.material.needsUpdate = true;
  }

  // glTF-modell a vészlátvány helyére (a belső tér marad)
  setModel(model) {
    const keep = new Set(this.sigLights);
    for (let i = this.extGroup.children.length - 1; i >= 0; i--) {
      if (!keep.has(this.extGroup.children[i])) this.extGroup.remove(this.extGroup.children[i]);
    }
    this.wheelMeshes = []; // a procedurális kerekek eltűntek
    const wrapper = new THREE.Group();
    wrapper.add(model);
    wrapper.position.y = 0; // a modell alja már a talajon áll
    this.extGroup.add(wrapper);
    setGroupLayer(wrapper, 1);
  }

  buildPhysics() {
    this.chassis = new CANNON.Body({
      mass: CAR.mass,
      shape: new CANNON.Box(new CANNON.Vec3(CAR.half.x, CAR.half.y, CAR.half.z)),
      position: new CANNON.Vec3(laneCenterX(2), CAR.restY, 0),
    });
    this.chassis.linearDamping = 0;
    this.chassis.angularDamping = 0;
    this.world.addBody(this.chassis);
  }

  get pos() { return this.chassis.position; }

  laneIndex() {
    const lane = 1 - this.pos.x / LANE_W;
    return Math.max(0, Math.min(2, Math.round(lane)));
  }

  forwardWorld(out = this.fwd) {
    out.set(0, 0, 1).applyQuaternion(this.quatTmp.set(
      this.chassis.quaternion.x, this.chassis.quaternion.y,
      this.chassis.quaternion.z, this.chassis.quaternion.w
    ));
    return out;
  }
  yaw() { return Math.atan2(this.forwardWorld().x, this.forwardWorld().z); }

  rotateY(rad) {
    const y = this.yaw() + rad;
    this.qCannon.setFromAxisAngle(new CANNON.Vec3(0, 1, 0), y);
    this.chassis.quaternion.copy(this.qCannon);
    this.chassis.angularVelocity.setZero();
  }

  hardAlignYaw() {
    this.rotateY(0);
    this.chassis.velocity.set(0, 0, 0);
    this.speed = 0;
  }

  // ---------- index (KRESZ-irányjelző) ----------
  toggleSignal(dir) {
    this.signal = this.signal === dir ? 0 : dir;
    this.signalT = 0;
  }
  signalOn(dir) { return this.signal === dir && this.blinkPhase < 0.5; }
  signalAct() { return this.signal !== 0; }

  updateSignalViz(dt) {
    if (!this.signalAct()) { this.signalT = 0; return; }
    this.signalT += dt;
    this.blinkPhase = (this.blinkPhase + dt * SIGNAL.blinkHz) % 1;
    if (this.signalT >= SIGNAL.autoOff) { this.signal = 0; }

    const on = this.blinkPhase < 0.5 ? 2.2 : 0.05;
    // külső lámpák: csak az aktív oldal (bal = -X, jobb = +X)
    const leftW = this.signal === -1;
    for (const [i, m] of this.sigLights.entries()) {
      const isLeftSide = i < 2;
      m.material.emissiveIntensity = (isLeftSide === leftW) ? on : 0.05;
    }
    // műszerfali nyilak (0. index = bal nyíl)
    const dashOn = (m, active) => { m.material.emissiveIntensity = active ? on : 0.05; };
    if (this.sigDash) {
      dashOn(this.sigDash[0], this.signal === -1);
      dashOn(this.sigDash[1], this.signal === 1);
    }
  }

  // input: {throttle 0..1, brake 0..1, steer -1..1}
  step(input, dt) {
    let v = this.speed;
    const maxV = CAR.maxSpeed;
    const engineCap = this.invincible > 0 ? 0 : 1;

    const acc = input.throttle * DRIVE.accel * (1 - v / maxV) * engineCap;
    const dec = input.brake * DRIVE.brake;
    v += (acc - dec) * dt;
    v -= v * v * DRIVE.drag * dt;
    if (v < 0) v = 0;
    if (v > maxV) v = maxV;
    this.speed = v;

    const k = 1 - Math.exp(-dt * DRIVE.steerLerp);
    this.steer += (input.steer - this.steer) * k;
    const sr = Math.min(1, v / 25);
    this.rotateY(-this.steer * DRIVE.yawRate * (0.35 + 0.65 * sr) * dt);

    const fwd = this.forwardWorld();
    this.speedVec.set(fwd.x * v, 0, fwd.z * v);
    this.chassis.velocity.copy(this.speedVec);
    this.chassis.angularVelocity.setZero();
    this.chassis.force.setZero();
    this.chassis.torque.setZero();

    const restY = CAR.restY;
    this.chassis.position.y += (restY - this.chassis.position.y) * Math.min(1, 10 * dt);
    if (Math.abs(this.chassis.position.y - restY) < 0.003) this.chassis.position.y = restY;

    const limitX = BARRIER_X - 1.6;
    if (Math.abs(this.chassis.position.x) > limitX) {
      this.chassis.position.x = Math.sign(this.chassis.position.x) * limitX;
      this.speed *= 0.85;
    }

    // kormánykerék-forgatás (látvány)
    this.wheelSpinV = clamp(this.wheelSpinV + input.steer * dt * 7, -8, 8);

    this.fwdSpeed = v;
    this.syncVisual(dt);
    this.updateSignalViz(dt);
  }

  syncVisual(dt) {
    this.group.position.copy(this.pos);
    this.group.quaternion.set(
      this.chassis.quaternion.x, this.chassis.quaternion.y,
      this.chassis.quaternion.z, this.chassis.quaternion.w
    );
    const spin = (this.fwdSpeed / CAR.wheelRadius) * dt;
    for (const w of this.wheelMeshes) {
      w.spin -= spin;
      w.tyre.rotation.x = w.spin;
      if (w.steer) w.holder.rotation.y = -this.steer * 0.55;
    }
    if (this.steerWheel) this.steerWheel.rotation.z -= this.wheelSpinV * dt;
  }

  // kamera: 'cockpit' (játék) vagy 'chase' (címlap/játék vége)
  updateCamera(camera, dt, shakeOffset, mode = 'chase') {
    const p = this.group.position;
    const fwd = this.fwd;

    if (mode === 'cockpit') {
      const o = CAMERA.cockpit;
      // lokális offset (vezető oldala +X, azaz bal) a jármű yaw-jával forgatva.
      // a y A FÖLD feletti abszolút magasság (a kasztni középpjához MÉG hozzáadva
      // 0.62-vel magasabban ülnénk, mint a tető)
      // FONTOS: a pozíció NEM lerpelt (hard-glue) — a lerp sebesség-arányos
      // lemaradást okoz (117 km/h-nál ~4 m), azaz gyorsuláskor a kamera
      // „kicsúszna” az ülésből. Csak a TEKINTET simított (finom, nem okoz dudorodást).
      this.v3.set(o.x, o.y, o.z).applyAxisAngle(new THREE.Vector3(0, 1, 0), this.yaw());
      const desired = this.v3.set(p.x + this.v3.x, o.y, p.z + this.v3.z);
      camera.position.copy(desired);
      const look = this.v3.set(p.x + fwd.x * o.lookAhead, o.lookY, p.z + fwd.z * o.lookAhead);
      const k = 1 - Math.exp(-dt * 6);
      this.camLook.lerp(look, k);
      if (shakeOffset) camera.position.add(shakeOffset);
      camera.lookAt(this.camLook);
      return;
    }

    const desired = p.clone().addScaledVector(fwd, -CAMERA.dist);
    desired.y = p.y + CAMERA.height;
    const look = p.clone().addScaledVector(fwd, CAMERA.lookAhead);
    look.y += 1.1;
    const k = 1 - Math.exp(-dt * 6);
    this.camPos.lerp(desired, k);
    this.camLook.lerp(look, k);
    camera.position.copy(this.camPos);
    if (shakeOffset) camera.position.add(shakeOffset);
    camera.lookAt(this.camLook);
  }

  // a visszapillantó tükör kamerája: a szélvédő vonalából hátranézünk, így a
  // kép alján a saját karosszéria/létra látszik, felül pedig az utolérők.
  positionMirror(cam) {
    const p = this.group.position;
    const fwd = this.forwardWorld();
    const m = CAMERA.mirror;
    const cx = p.x + fwd.x * m.front;
    const cz = p.z + fwd.z * m.front;
    cam.position.set(cx, m.height, cz);
    cam.lookAt(cx - fwd.x * m.lookBack, m.lookY, cz - fwd.z * m.lookBack);
  }

  respawnAtLane(lane) {
    this.chassis.position.set(laneCenterX(lane), CAR.restY, this.pos.z);
    this.chassis.quaternion.set(0, 0, 0, 1);
    this.chassis.velocity.setZero();
    this.chassis.angularVelocity.setZero();
    this.steer = 0;
    this.speed = 0;
    this.fwdSpeed = 0;
    this.signal = 0;
    this.signalT = 0;
    this.group.position.copy(this.chassis.position);
    this.group.quaternion.identity();
  }

  slowDown(amount) { this.speed = Math.max(0, this.speed - amount); }
  nudgeYaw(rad) { this.rotateY(rad); }

  wheelDbg() {
    return this.wheelMeshes.map((w, i) => ({
      y: +w.holder.position.y.toFixed(2),
      steer: w.steer ? +this.steer.toFixed(2) : 0,
      spin: +w.spin.toFixed(2),
      idx: i,
    }));
  }

  free() { this.world.removeBody(this.chassis); }
}

function extGroupLayer(g, layer) {
  g.layers.set(layer);
}

function setGroupLayer(root, layer) {
  root.traverse((o) => o.layers.set(layer));
}

function darkMat(c) {
  return new THREE.MeshStandardMaterial({ color: c, roughness: 0.35, metalness: 0.55 });
}
