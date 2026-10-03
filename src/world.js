// A statikus világ: út (textúrával, eltolódó sáv-festéssel), útburkolati jelek,
// zöld terület, fák, korlát + a korlátok ütközési testjei.
import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { BARRIER_X, CAR, GROUND_Y, LANE_W, ROAD_HALF, SHOULDER } from './constants.js';

export class World {
  constructor(scene, world) {
    this.scene = scene;
    this.world = world;
    this.roadTex = null;

    this.buildLights();
    this.buildGround();
    this.buildRoad();
    this.buildBarriers();
    this.buildScenery();
  }

  buildLights() {
    this.hemi = new THREE.HemisphereLight(0xcfe8ff, 0x3c5a3c, 1.15);
    this.scene.add(this.hemi);

    this.sun = new THREE.DirectionalLight(0xffffff, 2.6);
    this.sun.position.set(30, 60, 15);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.camera.near = 5;
    this.sun.shadow.camera.far = 120;
    const s = 28;
    this.sun.shadow.camera.left = -s;
    this.sun.shadow.camera.right = s;
    this.sun.shadow.camera.top = s;
    this.sun.shadow.camera.bottom = -s;
    this.scene.add(this.sun);
    // árnyék-kamera a játékost kövesse
    this.shadowTarget = new THREE.Object3D();
    this.scene.add(this.shadowTarget);
  }

  buildGround() {
    // Hatalmas statikus doboz a talajnak: a cannon-es Plane-nek NINCS raycast-ja,
    // pedig a RaycastVehicle kerekei raycasttel tapogatják le a felszínt.
    const groundBody = new CANNON.Body({
      type: CANNON.Body.STATIC,
      shape: new CANNON.Box(new CANNON.Vec3(600, 2, 4000)),
      position: new CANNON.Vec3(0, -2, 0),
    });
    this.world.addBody(groundBody);

    // fű (nagy sík)
    const grass = new THREE.Mesh(
      new THREE.PlaneGeometry(600, 6000),
      new THREE.MeshLambertMaterial({ color: 0x3e7d3a })
    );
    grass.rotation.x = -Math.PI / 2;
    grass.position.y = GROUND_Y - 0.05;
    grass.receiveShadow = true;
    this.scene.add(grass);
  }

  buildRoad() {
    // Aszfalt textúra: sötét alap + folyamatos szélső vonal, szaggatott sáv-elválasztás.
    const c = document.createElement('canvas');
    c.width = 256; c.height = 256;
    const g = c.getContext('2d');
    g.fillStyle = '#2e3238';
    g.fillRect(0, 0, 256, 256);

    // út szélesség a textúrában (3 sáv + 2 szél)
    const roadFrac = 0.82;
    const x0 = (256 * (1 - roadFrac)) / 2;

    const drawEdge = (x, dash) => {
      g.fillStyle = '#f2f2f2';
      if (dash) {
        g.fillRect(x - 2, 0, 4, 34);
      } else {
        g.fillRect(x - 3, 0, 6, 256);
      }
    };
    // szélső, folyamatos fehér vonalak
    drawEdge(x0 + 6, false);
    drawEdge(256 - x0 - 6, false);
    // belső szaggatott vonalak (2 db)
    drawEdge(256 / 2 - 26, true);
    drawEdge(256 / 2 + 26, true);
    // sávok közti "kopott" tónusváltás
    g.fillStyle = 'rgba(255,255,255,0.03)';
    g.fillRect(256 / 2 - 26, 0, 52, 256);

    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    // Egy minta = 12 m út (dash 4 m + hézag 8 m), az út hossza 6000 m.
    const ROAD_LEN = 6000;
    const TILE = 12;
    tex.repeat.set(1, ROAD_LEN / TILE);
    tex.magFilter = THREE.LinearFilter;
    tex.anisotropy = 4;
    this.roadTex = tex;
    this.tileLen = TILE;

    const roadW = ROAD_HALF * 2;
    const road = new THREE.Mesh(
      new THREE.PlaneGeometry(roadW, ROAD_LEN, 1, 1),
      new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95, metalness: 0 })
    );
    road.rotation.x = -Math.PI / 2;
    road.position.set(0, GROUND_Y + 0.02, 0);
    road.translateZ(0);
    road.receiveShadow = true;
    this.scene.add(road);
    this.road = road;

    // leállósáv (szaggatott ferde vonalakkal) + keskeny zöld pászta
    for (const side of [-1, 1]) {
      const elbow = new THREE.Mesh(
        new THREE.PlaneGeometry(SHOULDER - 0.6, 1),
        new THREE.MeshLambertMaterial({ color: 0x39414b })
      );
      elbow.rotation.x = -Math.PI / 2;
      elbow.position.set(side * (ROAD_HALF + (SHOULDER - 0.6) / 2 + 0.3), GROUND_Y + 0.015, 0);
      elbow.receiveShadow = true;
      this.scene.add(elbow);
    }
  }

  buildBarriers() {
    // Vizuális korlát + fizikai test (hosszú, vékony doboz) a pálya két szélén.
    for (const side of [-1, 1]) {
      const barrier = new THREE.Mesh(
        new THREE.BoxGeometry(0.28, 0.85, 6000),
        new THREE.MeshLambertMaterial({ color: 0xaeb6bd, metalness: 0.6 })
      );
      barrier.position.set(side * BARRIER_X, GROUND_Y + 0.43, 0);
      this.scene.add(barrier);

      const body = new CANNON.Body({
        type: CANNON.Body.STATIC,
        shape: new CANNON.Box(new CANNON.Vec3(0.14, 2, 3000)),
        position: new CANNON.Vec3(side * BARRIER_X, 0, 0),
      });
      this.world.addBody(body);
    }
  }

  buildScenery() {
    // Piros-fehér útoszlopok a korlátnál + fák és táblák a pihenősávokban.
    const postGeo = new THREE.BoxGeometry(0.18, 0.55, 0.18);
    const postMat = new THREE.MeshLambertMaterial({ color: 0xd04343 });
    const whiteMat = new THREE.MeshLambertMaterial({ color: 0xf2f2f2 });
    const posts = []; // [mesh, whiteMesh]

    const treeGeo = new THREE.CylinderGeometry(0.28, 0.38, 1.6, 6);
    const leafGeo = new THREE.ConeGeometry(1.15, 2.6, 7);
    const trunkMat = new THREE.MeshLambertMaterial({ color: 0x6a4a2f });
    const leafMat = new THREE.MeshLambertMaterial({ color: 0x2f6b2f });
    const trees = [];

    const signGeo = new THREE.BoxGeometry(1.9, 0.75, 0.12);
    const signMat = new THREE.MeshLambertMaterial({ color: 0x1565c0 });

    for (let z = -300; z < 200; z += 14) {
      for (const side of [-1, 1]) {
        // oszlop + fehér szakasz
        const p = new THREE.Mesh(postGeo, postMat);
        p.position.set(side * (BARRIER_X + 0.5), GROUND_Y + 0.28, z);
        const wp = new THREE.Mesh(postGeo, whiteMat);
        wp.position.set(side * (BARRIER_X + 0.5), GROUND_Y + 0.55, z);
        this.scene.add(p, wp);
        posts.push(p, wp);

        // fák kívül (véletlen oldaltolással/távolsággal)
        if ((z * 7 + side * 4) % 5 < 2) {
          const trunk = new THREE.Mesh(treeGeo, trunkMat);
          const leaf = new THREE.Mesh(leafGeo, leafMat);
          const xOff = side * (BARRIER_X + 2.5 + ((z * 31) % 9));
          const zOff = z + ((z * 13) % 5);
          trunk.position.set(xOff, GROUND_Y + 0.8, zOff);
          leaf.position.set(xOff, GROUND_Y + 1.6 + 1.3, zOff);
          leaf.rotation.y = z; // változatosság
          trunk.castShadow = true;
          this.scene.add(trunk, leaf);
          trees.push(trunk, leaf);
        }
        // néha útjelző tábla
        if ((z * 3 + side) % 11 === 0) {
          const post = new THREE.Mesh(new THREE.BoxGeometry(0.12, 2.6, 0.12), trunkMat);
          const sign = new THREE.Mesh(signGeo, signMat);
          post.position.set(side * (BARRIER_X + 1.9), GROUND_Y + 1.3, z);
          sign.position.set(side * (BARRIER_X + 1.9), GROUND_Y + 2.6, z + 0.2);
          this.scene.add(post, sign);
        }
      }
    }
  }

  // A textúra-eltolás adja a haladás érzetét (a sávfestés "fut" a játékos felé).
  update(distance) {
    if (this.roadTex) {
      const d = distance || 0;
      this.roadTex.offset.y = (-d / this.tileLen) % 1;
    }
  }
}
