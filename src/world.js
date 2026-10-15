// A statikus világ: út (textúrával, eltolódó sáv-festéssel), útburkolati jelek,
// zöld terület, fák, korlát + a korlátok ütközési testjei.
//
// A világ hosszú, de véges; amikor a játékos a világ végét éri, a teljes világot
// (staticGroup + fizikai testek) visszatekerjük a wrap() módszerrel. A játékos
// és a forgalom ugyanazzal a value-val tolódik el (lásd main/traffic), így a
// kamera relációja változatlan — nincs látható ugrás.
import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { BARRIER_X, CAR, GROUND_Y, LANE_W, ROAD_HALF, SHOULDER, WORLD } from './constants.js';

const W_END = WORLD.start + WORLD.length;   // z = +12000
const W_CENTER = (WORLD.start + W_END) / 2; // 5000

export class World {
  constructor(scene, world) {
    this.scene = scene;
    this.world = world;
    this.roadTex = null;
    this.tileLen = WORLD.tile;
    this.staticBodies = [];

    // minden statikus látvány ebbe a csoportba kerül, hogy a tekercs egyetlen
    // position-változással vigye őket együtt
    this.staticGroup = new THREE.Group();
    this.scene.add(this.staticGroup);

    this.buildLights();
    this.buildGround();
    this.buildRoad();
    this.buildBarriers();
    this.buildScenery();
    this.buildGate();
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
      shape: new CANNON.Box(new CANNON.Vec3(600, 2, WORLD.length / 2)),
      position: new CANNON.Vec3(0, -2, W_CENTER),
    });
    this.world.addBody(groundBody);
    this.staticBodies.push(groundBody);

    // fű (nagy sík) — a staticGroupban, hogy a tekercs vigye
    const grass = new THREE.Mesh(
      new THREE.PlaneGeometry(600, WORLD.length),
      new THREE.MeshLambertMaterial({ color: 0x3e7d3a })
    );
    grass.rotation.x = -Math.PI / 2;
    grass.position.set(0, GROUND_Y - 0.05, W_CENTER);
    grass.receiveShadow = true;
    this.staticGroup.add(grass);
  }

  buildRoad() {
    // Aszfalt textúra: sötét alap + folyamatos szélső vonal, szaggatott sáv-elválasztás.
    const c = document.createElement('canvas');
    c.width = 256; c.height = 256;
    const g = c.getContext('2d');
    g.fillStyle = '#2e3238';
    g.fillRect(0, 0, 256, 256);

    const drawEdge = (x, dash) => {
      g.fillStyle = '#f2f2f2';
      if (dash) {
        g.fillRect(x - 2, 0, 4, 34);
      } else {
        g.fillRect(x - 3, 0, 6, 256);
      }
    };
    // szélső, folyamatos fehér vonalak a 3 sávos út két szélén
    drawEdge(4, false);
    drawEdge(252, false);
    // belső szaggatott vonalak az egyharmad / kétharmad pontokon (sávhatárok)
    drawEdge(256 / 3, true);
    drawEdge((256 * 2) / 3, true);
    // a középső sáv enyhén világosabb (koptató tónus)
    g.fillStyle = 'rgba(255,255,255,0.03)';
    g.fillRect(256 / 3, 0, 256 / 3 - 1, 256);

    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    const TILE = WORLD.tile;
    tex.repeat.set(1, WORLD.length / TILE);
    tex.magFilter = THREE.LinearFilter;
    tex.anisotropy = 4;
    this.roadTex = tex;

    const roadW = ROAD_HALF * 2;
    const road = new THREE.Mesh(
      new THREE.PlaneGeometry(roadW, WORLD.length, 1, 1),
      new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95, metalness: 0 })
    );
    road.rotation.x = -Math.PI / 2;
    road.position.set(0, GROUND_Y + 0.02, W_CENTER);
    road.receiveShadow = true;
    this.staticGroup.add(road);
    this.road = road;

    // leállósáv (szaggatott ferde vonalakkal) + keskeny zöld pászta
    for (const side of [-1, 1]) {
      const elbow = new THREE.Mesh(
        new THREE.PlaneGeometry(SHOULDER - 0.6, WORLD.length),
        new THREE.MeshLambertMaterial({ color: 0x39414b })
      );
      elbow.rotation.x = -Math.PI / 2;
      elbow.position.set(side * (ROAD_HALF + (SHOULDER - 0.6) / 2 + 0.3), GROUND_Y + 0.015, W_CENTER);
      elbow.receiveShadow = true;
      this.staticGroup.add(elbow);
    }
  }

  buildBarriers() {
    // Vizuális korlát + fizikai test a pálya két szélén, a teljes úthosszon.
    for (const side of [-1, 1]) {
      const barrier = new THREE.Mesh(
        new THREE.BoxGeometry(0.28, 0.85, WORLD.length),
        new THREE.MeshLambertMaterial({ color: 0xaeb6bd })
      );
      barrier.position.set(side * BARRIER_X, GROUND_Y + 0.43, W_CENTER);
      this.staticGroup.add(barrier);

      const body = new CANNON.Body({
        type: CANNON.Body.STATIC,
        shape: new CANNON.Box(new CANNON.Vec3(0.14, 2, WORLD.length / 2)),
        position: new CANNON.Vec3(side * BARRIER_X, 0, W_CENTER),
      });
      this.world.addBody(body);
      this.staticBodies.push(body);
    }
  }

  buildScenery() {
    // Piros-fehér útoszlopok a korlátnál + fák és táblák, instanced-mesh-el a
    // teljes úthosszon (ezért gyors és végtelenül tekeredik a wrap() után is).
    const postGeo = new THREE.BoxGeometry(0.18, 0.55, 0.18);
    const postMat = new THREE.MeshLambertMaterial({ color: 0xd04343 });
    const whiteMat = new THREE.MeshLambertMaterial({ color: 0xf2f2f2 });
    const treeGeo = new THREE.CylinderGeometry(0.28, 0.38, 1.6, 6);
    const leafGeo = new THREE.ConeGeometry(1.15, 2.6, 7);
    const trunkMat = new THREE.MeshLambertMaterial({ color: 0x6a4a2f });
    const leafMat = new THREE.MeshLambertMaterial({ color: 0x2f6b2f });
    const signGeo = new THREE.BoxGeometry(1.9, 0.75, 0.12);
    const signMat = new THREE.MeshLambertMaterial({ color: 0x1565c0 });
    const signPostGeo = new THREE.BoxGeometry(0.12, 2.6, 0.12);

    // (1) pontos számolás, majd (2) feltöltés UGYANANNYI (z,oldal) feltétellel
    let nPost = 0, nTree = 0, nSign = 0, nSignPost = 0;
    for (let z = WORLD.start; z < W_END; z += 14) {
      for (const side of [-1, 1]) {
        nPost += 2;
        if ((z * 7 + side * 4) % 5 < 2) nTree++;
        if ((z * 3 + side) % 11 === 0) { nSign++; nSignPost += 2; }
      }
    }

    const posts = new THREE.InstancedMesh(postGeo, postMat, nPost);
    const postsW = new THREE.InstancedMesh(postGeo, whiteMat, nPost);
    const trees = new THREE.InstancedMesh(treeGeo, trunkMat, nTree);
    const leaves = new THREE.InstancedMesh(leafGeo, leafMat, nTree);
    const signsPost = new THREE.InstancedMesh(signPostGeo, trunkMat, nSignPost);
    const signs = new THREE.InstancedMesh(signGeo, signMat, nSign);
    this.staticGroup.add(posts, postsW, trees, leaves, signsPost, signs);

    const TMP = new THREE.Object3D();
    const setInst = (mesh, i, x, y, z, ry = 0) => {
      TMP.position.set(x, y, z);
      TMP.rotation.set(0, ry, 0);
      TMP.scale.set(1, 1, 1);
      TMP.updateMatrix();
      mesh.setMatrixAt(i, TMP.matrix);
    };

    let iP = 0, iW = 0, iT = 0, iS = 0, iSP = 0;
    for (let z = WORLD.start; z < W_END; z += 14) {
      for (const side of [-1, 1]) {
        const px = side * (BARRIER_X + 0.5);
        setInst(posts, iP++, px, GROUND_Y + 0.28, z);
        setInst(postsW, iW++, px, GROUND_Y + 0.55, z);

        if ((z * 7 + side * 4) % 5 < 2) {
          const xOff = side * (BARRIER_X + 2.5 + (((z * 31) % 9) + 9) % 9);
          const zOff = z + ((z * 13) % 5);
          setInst(trees, iT, xOff, GROUND_Y + 0.8, zOff);
          setInst(leaves, iT++, xOff, GROUND_Y + 2.9, zOff, z);
        }
        if ((z * 3 + side) % 11 === 0) {
          const sx = side * (BARRIER_X + 1.9);
          setInst(signsPost, iSP++, sx, GROUND_Y + 1.3, z);
          setInst(signsPost, iSP++, sx, GROUND_Y + 1.3, z);
          setInst(signs, iS++, sx, GROUND_Y + 2.6, z + 0.2);
        }
      }
    }
    posts.instanceMatrix.needsUpdate = true;
    postsW.instanceMatrix.needsUpdate = true;
    trees.instanceMatrix.needsUpdate = true;
    leaves.instanceMatrix.needsUpdate = true;
    signsPost.instanceMatrix.needsUpdate = true;
    signs.instanceMatrix.needsUpdate = true;
  }

  // Nagy narancs-sárga kapu, amely átível a teljes autópálya fölött.
  // Külön a scene-ben (nem a staticGroup-ban), mert minden képkockában a
  // játékos elé igazítjuk: `player.z + (gateDist − gateAcc)`.  Így a kapu a
  // tekercseléskör is folyamatosan „elől” marad.
  buildGate() {
    this.gate = new THREE.Group();
    const amber = new THREE.MeshLambertMaterial({ color: 0xffa31a });
    const dark = new THREE.MeshLambertMaterial({ color: 0xe8720a });
    const yellow = new THREE.MeshLambertMaterial({ color: 0xffd145 });
    const white = new THREE.MeshLambertMaterial({ color: 0xf4f4f4 });
    const red = new THREE.MeshLambertMaterial({ color: 0xd84343 });

    const SPAN = 17;          // a kapu teljes szélessége (az út + shoulders fölött)
    const PX = SPAN / 2 - 0.35; // a két oszlop x-koordinátája
    const H = 5.8;            // az oszlop magassága

    // Oszlopok: narancs/fehér sapka-zebra-szakaszok (barrier-stílus)
    const segH = 1.0;
    const segGeo = new THREE.BoxGeometry(0.55, segH, 0.55);
    const segGeoZ = new THREE.BoxGeometry(0.62, segH, 0.62);
    for (const side of [-1, 1]) {
      for (let k = 0; k < 5; k++) {
        const amberSeg = k % 2 === 0;         // felül narancs, alul fehér váltakozik
        const g = amberSeg ? segGeo : segGeoZ;
        const m = amberSeg ? amber : white;
        const pillar = new THREE.Mesh(g, m);
        pillar.position.set(side * PX, H - segH / 2 - k * segH, 0);
        pillar.castShadow = true;
        this.gate.add(pillar);
      }
    }

    // Felső gerenda: narancs fő + sárga csík + piros visszakerülő („kapu” jelleg)
    const beam = new THREE.Mesh(new THREE.BoxGeometry(SPAN, 0.8, 0.7), dark);
    beam.position.set(0, H + 0.35, 0);
    beam.castShadow = true;
    this.gate.add(beam);

    const beamStrip = new THREE.Mesh(new THREE.BoxGeometry(SPAN, 0.28, 0.12), yellow);
    beamStrip.position.set(0, H + 0.35, -0.41);
    this.gate.add(beamStrip);

    // Halott tetejű boltív: ferde támaszok a gerenda és az oszlopok közt
    const strutGeo = new THREE.BoxGeometry(0.28, 0.28, 0.6);
    for (const side of [-1, 1]) {
      const strut = new THREE.Mesh(strutGeo, red);
      strut.position.set(side * (PX * 0.62), H + 0.8, 0);
      strut.rotation.z = side * -0.35;
      strut.castShadow = true;
      this.gate.add(strut);
      // kis narancs oromzat a tetejére
      const cap = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.3, 0.5), amber);
      cap.position.set(side * (PX - 0.4), H + 1.15, 0);
      this.gate.add(cap);
    }

    // Középen lógó tábla (kapu-felirat helye)
    const sign = new THREE.Mesh(new THREE.BoxGeometry(2.4, 1.3, 0.18), white);
    sign.position.set(0, H - 1.2, -0.5);
    sign.castShadow = true;
    this.gate.add(sign);
    const signB = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.16, 0.2), red);
    signB.position.set(0, H - 0.52, -0.44);
    signB.castShadow = true;
    this.gate.add(signB);

    this.gate.position.set(0, GROUND_Y, 0);
    this.scene.add(this.gate);
  }

  // A kapu középpontját `z`-re helyezi (a játékos elé, a következő kapu-pontra).
  positionGate(z) {
    this.gate.position.z = z;
  }

  // A textúra-eltolás adja a haladás érzetét (a sávfestés "fut" a játékos felé).
  update(distance) {
    if (this.roadTex) {
      const d = distance || 0;
      this.roadTex.offset.y = (-d / this.tileLen) % 1;
    }
  }

  // Visszatekerés: minden statikus testet és látványt `delta`-val tolunk −Z felé.
  // (a játékost és a forgalmat a main/traffic ugyanekkora delta-val tolja)
  wrap(delta) {
    this.staticGroup.position.z -= delta;
    for (const b of this.staticBodies) b.position.z -= delta;
  }
}
