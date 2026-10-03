// Forgalom: kinematikus (nem fizikáztatott) robusztus testek, amiket mi
// mozgatunk a sávokban. Az ütközést a cannon mégis kezeli: a kinematikus test
// tolja a dinamikus játékost, érintkezési eseményt ad — nem kell kézzel raycastelni.
import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { LANE_W, TRAFFIC, laneCenterX } from './constants.js';

const CAR_COLORS = [0x3d7fd6, 0xcfd6dd, 0x6fbf73, 0xd98a45, 0xa056c8, 0xe5e04c, 0x4fb6b6, 0xdf4c4c];
const TRUCK_COLORS = [0x2f7ac6, 0xcf5444, 0x3f8f5f, 0xd69a2e];

export class Traffic {
  constructor(scene, world) {
    this.scene = scene;
    this.world = world;
    this.cars = [];
    this.byId = new Map();
    this.spawnTimer = 1.5;
    this.time = 0;
    this.onOvertake = null; // (car) => void
    this.onPenalty = null;  // (car, msgSelf) => void
  }

  spawn(playerZ, difficulty = 0) {
    if (this.cars.length >= TRAFFIC.maxCars) return;
    const lane = this.pickLane();
    const truck = lane === 2 && Math.random() < TRAFFIC.truckChance;
    const speed = this.pickSpeed(lane, truck);
    const z = playerZ + 145 + Math.random() * 110 + difficulty * 10;

    // ne spawnoljunk szembe a játékossal ugyanabban a sávban túl közel
    for (const c of this.cars) {
      if (c.lane === lane && Math.abs(c.body.position.z - z) < 70) return;
    }

    const len = truck ? 6.0 : 2.1;
    const body = new CANNON.Body({
      type: CANNON.Body.KINEMATIC,
      shape: new CANNON.Box(new CANNON.Vec3(0.95, 0.5, len / 2)),
      position: new CANNON.Vec3(laneCenterX(lane), 0.6, z),
    });
    this.world.addBody(body);

    const meshes = this.buildVisual(lane, truck, len, speed);
    const entry = {
      body, meshes, lane, speed, truck, len, passed: false, ghost: false,
    };
    this.cars.push(entry);
    this.byId.set(body.id, entry);
  }

  pickLane() {
    const r = Math.random();
    let acc = 0;
    for (let i = 0; i < 3; i++) {
      acc += TRAFFIC.waits[i];
      if (r < acc) return i;
    }
    return 2;
  }

  pickSpeed(lane, truck) {
    if (truck) return TRAFFIC.truckSpeed[0] + Math.random() * (TRAFFIC.truckSpeed[1] - TRAFFIC.truckSpeed[0]);
    const [lo, hi] = TRAFFIC.speedByLane[lane];
    return lo + Math.random() * (hi - lo);
  }

  buildVisual(lane, truck, len, speed) {
    const g = new THREE.Group();
    const col = truck ? TRUCK_COLORS[Math.floor(Math.random() * TRUCK_COLORS.length)]
                      : CAR_COLORS[Math.floor(Math.random() * CAR_COLORS.length)];
    const mat = new THREE.MeshStandardMaterial({ color: col, roughness: 0.45, metalness: 0.35 });

    if (truck) {
      const cab = new THREE.Mesh(new THREE.BoxGeometry(1.9, 1.3, 1.4), mat);
      cab.position.set(0, 1.2, len / 2 - 0.7);
      cab.castShadow = true;
      const trailer = new THREE.Mesh(
        new THREE.BoxGeometry(1.95, 1.6, len - 1.6),
        new THREE.MeshStandardMaterial({ color: 0xe8ecef, roughness: 0.6 })
      );
      trailer.position.set(0, 1.35, -0.2);
      trailer.castShadow = true;
      g.add(cab, trailer);
    } else {
      const car = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.55, len), mat);
      car.position.y = 0.55;
      car.castShadow = true;
      const top = new THREE.Mesh(
        new THREE.BoxGeometry(1.5, 0.4, len * 0.55),
        new THREE.MeshStandardMaterial({ color: 0x1a222c, roughness: 0.3 })
      );
      top.position.set(0, 1.0, -0.1);
      top.castShadow = true;
      g.add(car, top);
    }
    // hátsó lámpa (két piros csík) — minket követő kb. autók hátulját látjuk
    const tail = new THREE.Mesh(
      new THREE.BoxGeometry(1.7, 0.1, 0.08),
      new THREE.MeshStandardMaterial({ color: 0x660000, emissive: 0xff2222, emissiveIntensity: 1.6 })
    );
    tail.position.set(0, 0.62, -len / 2);
    g.add(tail);

    this.scene.add(g);
    return g;
  }

  // difficulty: 0..1
  update(dt, player, difficulty) {
    this.time += dt;

    // konvoj-összetapadás: azonos sávban a hátsó átveszi az elöl haladó tempóját
    const byLane = [[], [], []];
    for (const c of this.cars) {
      if (c.ghost) { c.body.position.z += c.speed * dt; continue; }
      c.body.position.z += c.speed * dt;
      byLane[c.lane].push(c);
    }
    for (const laneArr of byLane) {
      laneArr.sort((a, b) => a.body.position.z - b.body.position.z); // faroktól az orráig
      for (let i = 1; i < laneArr.length; i++) {
        const rear = laneArr[i - 1], front = laneArr[i];
        if (front.body.position.z - rear.body.position.z < (front.len + rear.len) / 2 + 7) {
          rear.speed = front.speed;
        }
      }
    }

    // haladási események: átment-e mögénk
    const pz = player.pos.z;
    for (const c of this.cars) {
      if (c.ghost) continue;
      if (!c.passed && c.body.position.z > pz) {
        c.passed = true;
        this.evalPass(c, player);
      }
    }

    // törlés (lemaradt)
    for (let i = this.cars.length - 1; i >= 0; i--) {
      const c = this.cars[i];
      if (c.ghost) continue;
      if (c.body.position.z < pz - 40) {
        this.world.removeBody(c.body);
        this.scene.remove(c.meshes);
        this.byId.delete(c.body.id);
        this.cars.splice(i, 1);
      }
    }

    // spawnolás (nehézség növeli a sűrűséget)
    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0) {
      this.spawn(player.pos.z, difficulty);
      const base = Math.max(TRAFFIC.spawnMin, TRAFFIC.spawnBase - this.time * 0.014);
      this.spawnTimer = base * (0.7 + Math.random() * 0.6);
    }
  }

  // A KRESZ-szabályokból eredő pontozás az elhaladás pillanatában.
  evalPass(car, player) {
    if (player.invincible > 0.7) return; // baleset utáni bénultság: ne osztogassunk pontot

    const pL = player.laneIndex();
    const cL = car.lane;
    const pV = player.fwdSpeed;
    const cV = car.speed;
    const msg = (t, col) => this.spawnPopup3D(t, col, car);

    if (pL === cL) return; // (ütközés nélkül nem fordulhat elő)

    if (pL < cL) {
      // a játékos balra van az autótól
      if (pV >= cV) {
        this.onOvertake && this.onOvertake(car);
        msg('+30 ÉLŐZÉS', '#7dffa0');
      } else {
        this.onPenalty && this.onPenalty(car, false);
        msg('Jobbról előztek! -15', '#ff8a80');
      }
    } else {
      // a játékos jobbra van az autótól
      if (pV > cV) {
        this.onPenalty && this.onPenalty(car, true);
        msg('Jobbról előztél! -15', '#ff8a80');
      }
      // különben az autó szabályosan balról előz — semmi
    }
  }

  spawnPopup3D(text, color, car) {
    if (this.onPopup3D) this.onPopup3D(text, color, car.body.position);
  }

  clear() {
    for (const c of this.cars) {
      this.world.removeBody(c.body);
      this.scene.remove(c.meshes);
    }
    this.cars = [];
    this.byId.clear();
    this.spawnTimer = 1.0;
    this.time = 0;
  }

  // Teszt-obstacle: a játékos sávjába állított, garantált ütközést adó autó.
  addObstacle(speed, z, lane = 2) {
    const len = 2.1;
    const body = new CANNON.Body({
      type: CANNON.Body.KINEMATIC,
      shape: new CANNON.Box(new CANNON.Vec3(0.95, 0.5, len / 2)),
      position: new CANNON.Vec3(laneCenterX(lane), 0.6, z),
    });
    this.world.addBody(body);
    const red = new THREE.Mesh(
      new THREE.BoxGeometry(1.9, 1.1, 2.1),
      new THREE.MeshStandardMaterial({ color: 0xff1744, emissive: 0x880000, emissiveIntensity: 0.6 })
    );
    red.position.y = 0.75;
    red.castShadow = true;
    this.scene.add(red);

    const entry = { body, meshes: red, lane, speed, truck: false, len, passed: true, ghost: true };
    this.cars.push(entry);
    this.byId.set(body.id, entry);
    return entry;
  }

  removeObstacle(entry) {
    const i = this.cars.indexOf(entry);
    if (i >= 0) this.cars.splice(i, 1);
    this.world.removeBody(entry.body);
    this.scene.remove(entry.meshes);
    this.byId.delete(entry.body.id);
  }
}
