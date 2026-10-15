// Forgalom LÁTVÁNYA: az engine (src/sim/engine.js) tartja a forgalom logikáját,
// ez a nézet csak felépíti és szinkronizálja a mesh-eket az engine-cars alapján.
import * as THREE from 'three';
import { MODELS } from './constants.js';

const CAR_COLORS = [0x3d7fd6, 0xcfd6dd, 0x6fbf73, 0xd98a45, 0xa056c8, 0xe5e04c, 0x4fb6b6, 0xdf4c4c];
const TRUCK_COLORS = [0x2f7ac6, 0xcf5444, 0x3f8f5f, 0xd69a2e];

export class TrafficView {
  constructor(scene) {
    this.scene = scene;
    this.models = null;     // { sedans: [Group], truck: Group } — glTF betöltés után
    this.views = new Map(); // car uid -> THREE.Group
  }

  setModels(models) { this.models = models; }

  // Az engine-cars tömbhöz igazítja a látványt (létrehoz/töröl/szinkronizál).
  sync(cars) {
    const seen = new Set();
    for (const c of cars) {
      seen.add(c.uid);
      let v = this.views.get(c.uid);
      if (!v) {
        v = this.buildVisual(c.lane, c.truck, c.len, c.speed);
        this.views.set(c.uid, v);
      }
      v.position.set(c.x, 0.6, c.z);
    }
    for (const [uid, v] of this.views) {
      if (!seen.has(uid)) {
        this.scene.remove(v);
        this.views.delete(uid);
      }
    }
  }

  clear() {
    for (const v of this.views.values()) this.scene.remove(v);
    this.views.clear();
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
}
