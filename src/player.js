// A játékos autó, boltozatos (arcade) hajtással, de a cannon-es fizikavilág
// kontaktrendszerével: az ütközést továbbra is a cannon oldja meg (események,
// kitolás, kinematikus akadályok), mi csak az erőhatást adjuk a kasztninak
// (gyorsulás/fék/kormányzás), így a játékérzés determinisztikus és hangolható.
import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { BARRIER_X, CAMERA, CAR, DRIVE, LANE_W, laneCenterX } from './constants.js';

export class Player {
  constructor(scene, world) {
    this.scene = scene;
    this.world = world;

    this.group = new THREE.Group();
    scene.add(this.group);

    this.buildVisual();
    this.buildPhysics();

    this.steer = 0;        // akt. befordítás (-1..1)
    this.speed = 0;        // hosszirányú sebesség (m/s, előre pozitív)
    this.fwdSpeed = 0;     // alias a HUD/pass-logika felé
    this.invincible = 0;

    this.quatTmp = new THREE.Quaternion();
    this.qCannon = new CANNON.Quaternion();
    this.fwd = new THREE.Vector3(0, 0, 1);
    this.speedVec = new CANNON.Vec3();

    this.camPos = new THREE.Vector3(0, CAMERA.height, 10);
    this.camLook = new THREE.Vector3(0, 0, 0);
  }

  buildVisual() {
    const dark = (c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.35, metalness: 0.55 });

    const chassis = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.44, 4.1), dark(0xd73a2a));
    chassis.position.y = 0.5;
    chassis.castShadow = true;

    // utaster-kabrió sziluett: orrszélvédő + tető + hátsó ablak
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
    const rearWin = new THREE.Mesh(new THREE.BoxGeometry(1.44, 0.3, 0.4), glassMat);
    rearWin.position.set(0, 1.02, -0.95);
    rearWin.rotation.x = -0.55;
    const roof = new THREE.Mesh(
      new THREE.BoxGeometry(1.42, 0.09, 1.05),
      dark(0xb02e1f)
    );
    roof.position.set(0, 1.13, -0.15);

    const lightMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0x9fd8ff, emissiveIntensity: 2 });
    const brakeMat = new THREE.MeshStandardMaterial({ color: 0x550000, emissive: 0xff2222, emissiveIntensity: 1.2 });
    const frontL = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.08, 0.06), lightMat);
    frontL.position.set(-0.62, 0.66, 2.06);
    const frontR = frontL.clone(); frontR.position.x = 0.62;
    const rearL = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.08, 0.06), brakeMat);
    rearL.position.set(-0.62, 0.66, -2.06);
    const rearR = rearL.clone(); rearR.position.x = 0.62;

    this.group.add(chassis, cabin, windshield, rearWin, roof, frontL, frontR, rearL, rearR);

    // kerekek: csak látvány (görgés + kormányzás dőlés)
    this.wheelMeshes = [];
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
      // kerékhelyzet: az első kerekek kormányoznak (zárójelben)
      // kerékhelyzet a kasztnihoz képest (a csoport adja a világló x-et)
      holder.position.set(i % 2 === 0 ? -0.8 : 0.8, 0.35, i < 2 ? 1.35 : -1.35);
      this.group.add(holder);
      this.wheelMeshes.push({ holder, tyre, spin: 0, steer: false });
    }
    // első/hátsó jelölés
    this.wheelMeshes[0].steer = this.wheelMeshes[1].steer = true;
  }

  buildPhysics() {
    // dinamikus kasztni (mass>0 kell a kontakteseményekhez)
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
  upWorld() {
    const v = new THREE.Vector3(0, 1, 0);
    v.applyQuaternion(this.quatTmp.set(
      this.chassis.quaternion.x, this.chassis.quaternion.y,
      this.chassis.quaternion.z, this.chassis.quaternion.w
    ));
    return v;
  }
  yaw() { return Math.atan2(this.forwardWorld().x, this.forwardWorld().z); }

  rotateY(rad) {
    const y = this.yaw() + rad;
    this.qCannon.setFromAxisAngle(new CANNON.Vec3(0, 1, 0), y);
    this.chassis.quaternion.copy(this.qCannon);
    this.chassis.angularVelocity.setZero();
  }

  hardAlignYaw() {
    // billenés visszafogása: csak a fejirányt hagyjuk meg
    this.rotateY(0);
    this.chassis.velocity.set(0, 0, 0);
    this.speed = 0;
  }

  // input: {throttle 0..1, brake 0..1, steer -1..1}
  step(input, dt) {
    let v = this.speed;
    const maxV = CAR.maxSpeed;
    const engineCap = this.invincible > 0 ? 0 : 1;

    // teljesítménygörbe: határértéke maxV
    const acc = input.throttle * DRIVE.accel * (1 - v / maxV) * engineCap;
    const dec = input.brake * DRIVE.brake;
    v += (acc - dec) * dt;
    v -= v * v * DRIVE.drag * dt; // légellenállás
    if (v < 0) v = 0;
    if (v > maxV) v = maxV;
    this.speed = v;

    // kormányzás (sebességérzékeny)
    const k = 1 - Math.exp(-dt * DRIVE.steerLerp);
    this.steer += (input.steer - this.steer) * k;
    const sr = Math.min(1, v / 25);
    // +1 kormány = „jobbra” = −X felé fordulás (a −Z irányú haladásnál)
    this.rotateY(-this.steer * DRIVE.yawRate * (0.35 + 0.65 * sr) * dt);

    const fwd = this.forwardWorld();
    // a sebességet mi adjuk meg (kasztnira), a cannon csak integrálja (+ kontaktok)
    this.speedVec.set(fwd.x * v, 0, fwd.z * v);
    this.chassis.velocity.copy(this.speedVec);
    this.chassis.angularVelocity.setZero();
    this.chassis.force.setZero();
    this.chassis.torque.setZero();

    // magasság + korlát
    const restY = CAR.restY;
    this.chassis.position.y += (restY - this.chassis.position.y) * Math.min(1, 10 * dt);
    if (Math.abs(this.chassis.position.y - restY) < 0.003) this.chassis.position.y = restY;

    const limitX = BARRIER_X - 1.6;
    if (Math.abs(this.chassis.position.x) > limitX) {
      this.chassis.position.x = Math.sign(this.chassis.position.x) * limitX;
      this.speed *= 0.85;
    }

    this.fwdSpeed = v;
    this.syncVisual(dt);
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
  }

  updateCamera(camera, dt, shakeOffset) {
    const fwd = this.fwd.clone();
    const p = this.group.position;

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

  respawnAtLane(lane) {
    this.chassis.position.set(laneCenterX(lane), CAR.restY, this.pos.z);
    this.chassis.quaternion.set(0, 0, 0, 1);
    this.chassis.velocity.setZero();
    this.chassis.angularVelocity.setZero();
    this.steer = 0;
    this.speed = 0;
    this.fwdSpeed = 0;
    this.group.position.copy(this.chassis.position);
    this.group.quaternion.identity();
  }

  slowDown(amount) {
    this.speed = Math.max(0, this.speed - amount);
  }
  nudgeYaw(rad) {
    this.rotateY(rad);
  }

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
