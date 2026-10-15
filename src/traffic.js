// Forgalom: kinematikus (nem fizikáztatott) robusztus testek, amiket mi
// mozgatunk a sávokban. Az ütközést a cannon mégis kezeli: a kinematikus test
// tolja a dinamikus játékost, érintkezési eseményt ad — nem kell kézzel raycastelni.
import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { LANE_W, MODELS, TRAFFIC, laneCenterX } from './constants.js';

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
    this.models = null;     // { sedans: [Group], truck: Group } — glTF betöltés után
  }

  setModels(models) { this.models = models; }

  spawn(playerZ, difficulty = 0, near = 0, forcedLane = -1) {
    if (this.cars.length >= TRAFFIC.maxCars) return;
    const lane = forcedLane >= 0 ? forcedLane : this.pickLane();
    const truck = lane === 2 && Math.random() < TRAFFIC.truckChance;
    const speed = this.pickSpeed(lane, truck);
    const z = near > 0
      ? playerZ + near + Math.random() * 45
      : playerZ + TRAFFIC.spawnNear + Math.random() * TRAFFIC.spawnSpan + difficulty * 15;

    // a „közel” szemecek azonnal létrejönnek, sáv-védelem nélkül
    if (near > 0) {
      const speed2 = this.pickSpeed(lane, truck);
      this.createEntry(lane, truck, speed2, z);
      return;
    }

    // ne spawnoljunk szembe a játékossal ugyanabban a sávban túl közel
    for (const c of this.cars) {
      if (c.lane === lane && Math.abs(c.body.position.z - z) < TRAFFIC.minGap) return;
    }

    this.createEntry(lane, truck, speed, z);
  }

  // hátulról érkező gyors autó (a visszapillantó tükör számára): a bal sávban
  // közelít, majd szabályosan (balról) előz minket.
  spawnBehind(player) {
    if (this.cars.length >= TRAFFIC.maxCars) return;
    const lane = 0;
    const speed = TRAFFIC.behindSpeed[0] + Math.random() * (TRAFFIC.behindSpeed[1] - TRAFFIC.behindSpeed[0]);
    const z = player.pos.z - (TRAFFIC.behindStart + Math.random() * TRAFFIC.behindSpan);
    this.createEntry(lane, false, speed, z);
  }

  // A legközelebbi jármű elöl (magasabb z) az adott sávban — a radar-tempomathoz.
  // (ghost-t kihagyjuk; maxDist felett nem érdekel.)  Visszaadja {speed, gap} vagy null.
  aheadInLane(lane, z, maxDist = 140) {
    let best = null, bestDist = Infinity;
    for (const c of this.cars) {
      if (c.ghost || c.lane !== lane) continue;
      const d = c.body.position.z - z;
      if (d > 2 && d < bestDist && d < maxDist) { bestDist = d; best = c; }
    }
    return best ? { speed: best.speed, gap: bestDist } : null;
  }

  createEntry(lane, truck, speed, z) {
    const len = truck ? MODELS.truckLen : MODELS.carLen;
    const body = new CANNON.Body({
      type: CANNON.Body.KINEMATIC,
      shape: new CANNON.Box(new CANNON.Vec3(0.95, 0.5, len / 2)),
      position: new CANNON.Vec3(laneCenterX(lane), 0.6, z),
    });
    this.world.addBody(body);

    const meshes = this.buildVisual(lane, truck, len, speed);
    const entry = {
      body, meshes, lane, speed, truck, len, passed: false, ghost: false,
      baseSpeed: speed,   // saját utazósebessége (a fékezés után ide tér vissza)
      changeLane: null,   // cél-sáv egy folyamatban lévő NPC sávváltásnál (null = nincs)
      aiT: Math.random() * 2,   // NPC mérlegelési óra (staggered indításhoz)
      returnLane: undefined, returnT: undefined,  // előzés utáni visszatérés jobbra
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

    if (this.models) {
      // glTF-modell (klón, megosztott geometria/anyag) — a talajon áll
      const model = truck
        ? this.models.truck.clone()
        : this.models.sedans[Math.floor(Math.random() * this.models.sedans.length)].clone();
      model.position.y = -0.6; // a test középpjától a talajra
      g.add(model);
    } else {
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
    }
    // hátsó lámpa (két piros csík) — minket követő kb. autók hátulját látjuk
    const tail = new THREE.Mesh(
      new THREE.BoxGeometry(1.55, 0.1, 0.08),
      new THREE.MeshStandardMaterial({ color: 0x660000, emissive: 0xff2222, emissiveIntensity: 1.6 })
    );
    tail.position.set(0, 0.55, -len / 2);
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
      c.body.position.z += c.speed * dt;
      // folyamatban lévő NPC sávváltás: az x-cél felé gurulunk
      if (c.changeLane != null) this.advanceLaneChange(c, dt);
      this.syncMesh(c);
      if (c.ghost) continue;
      byLane[c.lane].push(c);
    }
    for (const laneArr of byLane) {
      laneArr.sort((a, b) => a.body.position.z - b.body.position.z); // faroktól az orráig
      for (let i = 1; i < laneArr.length; i++) {
        const rear = laneArr[i - 1], front = laneArr[i];
        if (front.body.position.z - rear.body.position.z < (front.len + rear.len) / 2 + 16) {
          rear.speed = front.speed;
        }
      }
    }

    // NPC-követés: a sávban elöl haladó LASSABB jármű mögött lassítunk
    // (NPC vagy akár a JÁTÉKOS — különben hátulról beléjük megy).
    for (const c of this.cars) {
      if (c.ghost) continue;
      let braked = false;
      const f = this.frontInLane(c, player);
      if (f) {
        const fspeed = f.isPlayer ? player.fwdSpeed : f.o.speed;
        const closing = c.speed - fspeed;
        if (closing > 0.5) {
          // min. kívánt követési térköz a sebességkülönbség függvényében
          const safe = 4 + closing * 0.85;
          if (f.gap < safe + 16) {
            const k = 1 - (f.gap / (safe + 16));
            const brake = Math.max(2, closing * 2.2 * (0.3 + 0.7 * k));
            c.speed = Math.max(fspeed, c.speed - brake * dt);
            braked = true;
          }
        } else if (f.gap < 3) {
          c.speed = fspeed; // már majdnem rajta — fixen lassít
          braked = true;
        }
      }
      // ha szabad az út, térj vissza a saját tempódra (enyhe gyorsítás/lassítás)
      if (!braked) {
        const d = Math.min(1.2 * dt, Math.abs(c.baseSpeed - c.speed));
        if (c.speed < c.baseSpeed) c.speed += d;
        else if (c.speed > c.baseSpeed) c.speed -= d;
      }
    }

    // NPC-előzés: balra ha lassú van előtt, majd vissza jobbra (akár a játékos)
    this.npcAI(dt, player);

    // haladási események: átment-e mögénk
    const pz = player.pos.z;
    for (const c of this.cars) {
      if (c.ghost) continue;
      if (!c.passed && c.body.position.z > pz) {
        c.passed = true;
        this.evalPass(c, player);
      }
    }

    // törlés (lemaradt): csak azok távolodnak a játékostól, akik NÁLA
    // LASSABBAK a hátsó térben — a gyorsabb hátulról közelítők útban maradnak
    // (ők a visszapillantó tükör forgalma!), amíg el nem haladnak.
    // Az ELÖL messzire kerülők (z > pz + 240) szintén törlődnek: nélkülük a
    // gyors hátulról érkezők örökre elöl maradnának és betelítenék az autó-
    // limitet, az út pedig telítődne (a cél-sáv folyamatosan „foglalt” lenne).
    for (let i = this.cars.length - 1; i >= 0; i--) {
      const c = this.cars[i];
      if (c.ghost) continue;
      if ((c.body.position.z < pz - 40 && c.speed <= player.fwdSpeed + 1) ||
          c.body.position.z > pz + 240) {
        this.world.removeBody(c.body);
        this.scene.remove(c.meshes);
        this.byId.delete(c.body.id);
        this.cars.splice(i, 1);
      }
    }

    // spawnolás (nehézség növeli a sűrűséget; néha hátulról jön a gyors)
    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0) {
      if (Math.random() < TRAFFIC.behindChance) this.spawnBehind(player);
      else this.spawn(player.pos.z, difficulty);
      const base = Math.max(TRAFFIC.spawnMin, TRAFFIC.spawnBase - this.time * 0.014);
      this.spawnTimer = base * (0.7 + Math.random() * 0.6);
    }
  }

  // A látvány-mesh követi a fizikai testet (különben láthatatlan volna az autó).
  syncMesh(c) {
    c.meshes.position.set(c.body.position.x, c.body.position.y, c.body.position.z);
  }

  // NPC sávváltás folyamata: x gurul a cél-sáv közepére, majd fixáljuk a sávot.
  advanceLaneChange(c, dt) {
    const tx = laneCenterX(c.changeLane);
    const diff = tx - c.body.position.x;
    const step = Math.max(-6 * dt, Math.min(6 * dt, diff));
    c.body.position.x += step;
    if (Math.abs(tx - c.body.position.x) < 0.02) {
      c.body.position.x = tx;
      c.lane = c.changeLane;
      c.changeLane = null;
    }
  }

  // A legközelebbi jármű elöl ugyanabban a sávban (NPC vagy a játékos)
  frontInLane(c, player) {
    let best = null, bd = Infinity, len = 2;
    for (const o of this.cars) {
      if (o === c || o.ghost || o.lane !== c.lane) continue;
      const d = o.body.position.z - c.body.position.z;
      if (d > 0 && d < bd) { bd = d; best = o; len = o.len; }
    }
    if (player && c.lane === player.laneIndex()) {
      const d = player.pos.z - c.body.position.z;
      if (d > 0 && d < bd) { bd = d; best = { player: true }; len = 4.3; }
    }
    return best ? { o: best, isPlayer: best.player === true, gap: bd, len } : null;
  }

  // Van-e lassabb jármű közvetlenül elöl ugyanabban a sávban (NPC vagy játékos)?
  blockingCar(c, player) {
    let best = null, bd = Infinity;
    for (const o of this.cars) {
      if (o === c || o.ghost || o.lane !== c.lane) continue;
      const d = o.body.position.z - c.body.position.z;
      if (d > 0 && d < bd && o.speed < c.speed - 4) { bd = d; best = o; }
    }
    if (player && c.lane === player.laneIndex()) {
      const d = player.pos.z - c.body.position.z;
      if (d > 0 && d < bd && player.fwdSpeed < c.speed - 4) { bd = d; best = { player: true }; }
    }
    return best ? { o: best, isPlayer: best.player === true, gap: bd } : null;
  }

  // Üres-e a cél-sáv a kellő „ablakban” egy NPC sávváltáshoz?
  // (a JÁTÉKOS-t is figyelembe vesszük — különben belethernk egy NPC-k bevághat)
  // FONTOS: a FIZIKAI x-pozíciót nézzük, nem a c.lane attribútumot: az NPC
  // sávváltás közben (advanceLaneChange) az x már a cél felé gurul, de a lane
  // csak megérkezéskor frissül — lane-alapú döntés hamis blokkoló/bevágás lenne.
  laneClear(c, toLane, player) {
    const cx = laneCenterX(toLane);
    const near = (x) => Math.abs(x - cx) < 2.3; // ~félautó+félautó+ráhagyás
    for (const o of this.cars) {
      if (o === c || o.ghost) continue;
      const d = o.body.position.z - c.body.position.z;
      if (Math.abs(d) < 46 && near(o.body.position.x)) return false; // ~23 m elöl + 23 m mögött
    }
    if (player && Math.abs(player.pos.z - c.body.position.z) < 46 && near(player.pos.x)) return false;
    return true;
  }

  // A JÁTÉKOS cél-sávváltásához: van-e szabad hely a cél-sávban?
  //  −changeBehind mögötte … +changeAhead előtte (konfigurálva a constants-ban).
  //  A FIZIKAI x-pozíciót nézzük (lásd laneClear kommentjét), nem a c.lane-t.
  canChangeTo(to, z) {
    const cx = laneCenterX(to);
    for (const o of this.cars) {
      if (o.ghost) continue;
      const d = o.body.position.z - z; // elöl pozitív
      if (d > -TRAFFIC.changeBehind && d < TRAFFIC.changeAhead &&
          Math.abs(o.body.position.x - cx) < 2.3) return false;
    }
    return true;
  }

  // NPC-előzés AI: balra ha lassú van előtt (NPC vagy játékos), majd vissza jobbra.
  npcAI(dt, player) {
    for (const c of this.cars) {
      if (c.ghost) continue;
      c.aiT -= dt;
      if (c.changeLane !== null) continue;
      if (c.aiT > 0) continue;
      c.aiT = 1.2 + Math.random() * 1.8;

      const L = c.lane, blk = this.blockingCar(c, player);

      // (1) Előzés balra, ha lassú van előttünk és balra szabad.
      if (blk && L < 2 && this.laneClear(c, L + 1, player)) {
        this.startLaneChange(c, L + 1);
        c.returnLane = L;
        c.returnT = 5 + Math.random() * 5;
        continue;
      }

      // (2) Visszatérés jobbra a lassú egy állandó tempónál.
      if (L > 0 && c.returnLane !== undefined) {
        if (c.returnT !== undefined) c.returnT -= dt;
        if (c.returnT <= 0 && !blk && this.laneClear(c, L - 1, player)) {
          this.startLaneChange(c, L - 1);
          c.returnLane = undefined;
          c.returnT = undefined;
        }
      }
    }
  }

  startLaneChange(c, to) {
    c.changeLane = to;
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
        // a másik autó szabályosan, balról megelőzött minket — semmi büntetés
        msg('Balról előztek (rendben)', '#9ad0ff');
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
      this.byId.delete(c.body.id);
    }
    this.cars.length = 0;
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
    red.position.x = body.position.x;
    red.position.z = body.position.z;
    red.castShadow = true;
    this.scene.add(red);

    const entry = { body, meshes: red, lane, speed, truck: false, len, passed: true, ghost: true, baseSpeed: speed, changeLane: null, aiT: 0 };
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

  // Világ-visszatekerés: minden járműtestet −Z felé tolunk delta-val.
  wrap(delta) {
    for (const c of this.cars) {
      c.body.position.z -= delta;
      this.syncMesh(c);
    }
  }
}
