// A játékos autó LÁTVÁNYA: a logikát a sim-mag (src/sim/engine.js) adja, ez a
// nézet építi fel a kocsit (külső váz, műszerfal, kormány), tartja a kamerákat
// (vezetőülés + visszapillantó-tükör) és szinkronizálja a látványt a sim-állapotból.
//
// Látvány-rétegek:
//   layer 0 — világ (út, forgalom, korlát, felhők)
//   layer 1 — a saját autó KÜLSŐ váza (jobb látszik a visszapillantó tükörben,
//            a vezetőüléses kamerának nem — ő a kocsi belsejében ül)
//   layer 2 — a saját autó BELSEJE (műszerfal, kormány, belső tükör...)
// A kamera rétegeit a main.js forgatja aszerint, hogy belső vagy külső nézet kell.
import * as THREE from 'three';
import { CAMERA, CAR } from './constants.js';

export class Player {
  constructor(scene) {
    this.scene = scene;

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
    // a Three.js rétegeket NEM örökli az objektumfák: az összes gyereket
    // külön-külön le kell állítani a megfelelő rétegre
    setGroupLayer(this.extGroup, 1);
    setGroupLayer(this.intGroup, 2);

    this.camPos = new THREE.Vector3(0, CAMERA.height, 10);
    this.camLook = new THREE.Vector3(0, 0, 0);
    this.v3 = new THREE.Vector3();
    this.fwd = new THREE.Vector3(0, 0, 1);
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

    // műszerfali index-nyilak (valósághű, a műszerfalon világító LED-nyilak)
    const arrowMatF = () => new THREE.MeshStandardMaterial({
      color: 0x6b4a12, emissive: 0xff9a00, emissiveIntensity: 0.02, roughness: 0.4, metalness: 0.1 });
    // LED-nyíl: a vezető felé néz; a nyíl a megfelelő irányba mutat.
    // +X = a képernyő balja (vezetői nézet, +Z előre).
    const makeDashArrow = (left, x, y, z) => {
      const shape = new THREE.Shape();
      const w = 0.05, h = 0.036;
      shape.moveTo(-w, h); shape.lineTo(w, 0); shape.lineTo(-w, -h); shape.closePath();
      const m = new THREE.Mesh(new THREE.ShapeGeometry(shape), arrowMatF());
      if (left) m.rotation.x = Math.PI; else m.rotation.y = Math.PI;  // bal: hegy +X balra; jobb: hegy −X jobbra
      m.position.set(x, y, z);
      this.intGroup.add(m);
      return m;
    };
    this.sigDash = [
      makeDashArrow(true, 0.6, 0.8, 0.88),   // ◀ bal indicator a bal oldalon
      makeDashArrow(false, 0.34, 0.8, 0.88), // ▶ jobb indicator a jobb oldalon
    ];
  }

  buildInterior() {
    // --- anyagok (világosabbak, hogy a kabin ne legyen fekete) ---
    const plastic = new THREE.MeshStandardMaterial({ color: 0x3a4048, roughness: 0.55, metalness: 0.2 });
    const darkPlastic = new THREE.MeshStandardMaterial({ color: 0x20242a, roughness: 0.7, metalness: 0.15 });
    const leather = new THREE.MeshStandardMaterial({ color: 0x363b42, roughness: 0.85, metalness: 0.05 });
    const cloth = new THREE.MeshStandardMaterial({ color: 0x4a4f57, roughness: 1.0, metalness: 0 });
    const trim = new THREE.MeshStandardMaterial({ color: 0x5a616c, roughness: 0.3, metalness: 0.75 });
    const gloss = new THREE.MeshStandardMaterial({ color: 0x2a2f37, roughness: 0.12, metalness: 0.95 });
    const buttonM = new THREE.MeshStandardMaterial({ color: 0x6b747f, roughness: 0.4, metalness: 0.55 });
    const screenM = new THREE.MeshStandardMaterial({ color: 0x0a1620, emissive: 0x22a7e0, emissiveIntensity: 1.5, roughness: 0.2 });

    // kabin megvilágítása (kicsi pontfény a tetőnél, hogy a belső ne legyen sötét)
    const cabin = new THREE.PointLight(0xd7e4ff, 0.7, 5);
    cabin.position.set(0, 1.02, 0.6);
    this.intGroup.add(cabin);

    // --- MŰSZERFAL: alsó váz + felső „look-over” perem ---
    const dashBody = new THREE.Mesh(new THREE.BoxGeometry(1.52, 0.22, 0.5), plastic);
    dashBody.position.set(0, 0.56, 1.0);
    dashBody.rotation.x = 0.06;
    this.intGroup.add(dashBody);
    const dashCowl = new THREE.Mesh(new THREE.BoxGeometry(1.52, 0.07, 0.5), leather);
    dashCowl.position.set(0, 0.7, 1.06);
    dashCowl.rotation.x = -0.28;
    this.intGroup.add(dashCowl);
    const dashLip = new THREE.Mesh(new THREE.BoxGeometry(1.52, 0.05, 0.08), darkPlastic);
    dashLip.position.set(0, 0.66, 1.12);
    this.intGroup.add(dashLip);

    // --- MŰSZERKLASZTER: binnacle + két óra (kormány mögött) ---
    const bin = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.14, 0.34), plastic);
    bin.position.set(0.5, 0.7, 1.0);
    bin.rotation.x = -0.06;
    this.intGroup.add(bin);
    const dialMat = new THREE.MeshStandardMaterial({ color: 0x0b0e14, roughness: 0.35, metalness: 0.2 });
    const needleMat = new THREE.MeshStandardMaterial({
      color: 0xe04343, emissive: 0x991515, emissiveIntensity: 0.7, roughness: 0.4 });
    const tick = new THREE.MeshBasicMaterial({ color: 0xe3e8ee });
    const R = 0.055; // kicsi óraméret: ne takarja az utat
    const gauge = (x) => {
      const g = new THREE.Group();
      g.position.set(x, 0.72, 0.84);
      g.rotation.y = Math.PI;   // front (−Z) a vezető felé
      g.rotation.x = -0.06;
      const plate = new THREE.Mesh(new THREE.CircleGeometry(R, 28), dialMat);
      plate.position.z = -0.012;
      g.add(plate);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(R, 0.005, 8, 28), trim);
      ring.position.z = -0.017;
      g.add(ring);
      for (let i = 0; i < 7; i++) {
        const t = new THREE.Mesh(new THREE.BoxGeometry(0.0025, 0.022, 0.003), tick);
        const a = (i / 6) * 1.4 - 0.7;
        t.position.set(Math.sin(a) * R * 0.72, Math.cos(a) * R * 0.72, -0.017);
        t.rotation.z = a;
        g.add(t);
      }
      const need = new THREE.Mesh(new THREE.BoxGeometry(0.005, 0.036, 0.004), needleMat);
      need.position.set(R * 0.42, R * 0.45, -0.017);
      need.rotation.z = -0.5;
      g.add(need);
      this.intGroup.add(g);
    };
    gauge(0.42);
    gauge(0.53);

    // --- SZELLŐZŐROSTÉLYOK a műszerfalon (vízszintes lécekkel) ---
    const vent = (x, ry) => {
      const g = new THREE.Group();
      g.position.set(x, 0.74, 1.12);
      g.rotation.y = ry || 0;
      g.add(new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.075, 0.05), darkPlastic));
      for (let i = -1; i <= 1; i++) {
        const sl = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.014, 0.03), trim);
        sl.position.set(0, i * 0.018, 0.03);
        g.add(sl);
      }
      this.intGroup.add(g);
    };
    vent(-0.85, -0.1);
    vent(-0.45, -0.02);
    vent(0.15, 0.1);
    // középső infotainment-kijelző a műszerfal közepén
    const centerScreen = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.09, 0.03), screenM);
    centerScreen.position.set(-0.14, 0.76, 1.05);
    centerScreen.rotation.x = -0.3;
    this.intGroup.add(centerScreen);

    // --- KÖZÉPKONZOL + RÁDIÓ + infotainment képernyő (jobb oldalt) ---
    const console = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.4, 0.5), leather);
    console.position.set(-0.42, 0.56, 1.0);
    console.rotation.x = 0.05;
    this.intGroup.add(console);

    const radio = new THREE.Group();
    radio.add(new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.24, 0.1), gloss));
    const rs = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.09, 0.02), screenM);
    rs.position.set(0, 0.055, -0.052);
    radio.add(rs);
    for (let i = -2; i <= 2; i++) {
      const b = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.05, 0.02), buttonM);
      b.position.set(i * 0.058, -0.06, -0.052);
      radio.add(b);
    }
    for (const sx of [-0.13, 0.13]) {
      const k = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.024, 0.03, 14), buttonM);
      k.rotation.x = Math.PI / 2;
      k.position.set(sx, -0.115, -0.053);
      radio.add(k);
    }
    radio.position.set(-0.3, 0.68, 1.06);
    radio.rotation.y = Math.PI;   // front a vezető felé
    this.intGroup.add(radio);

    const infoScreen = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.15, 0.03), screenM);
    infoScreen.position.set(-0.3, 0.8, 1.0);
    infoScreen.rotation.x = -0.5;
    infoScreen.rotation.y = 0.4;
    this.intGroup.add(infoScreen);

    // --- AJTÓKÁRPITOK (bal vezető + jobb utas) ---
    const door = (x) => {
      const card = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.52, 0.8), plastic);
      card.position.set(x, 0.74, 0.7);
      card.rotation.y = x < 0 ? 0.12 : -0.12;
      this.intGroup.add(card);
      const armrest = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.06, 0.5), leather);
      armrest.position.set(x, 0.66, 0.68);
      this.intGroup.add(armrest);
      const handle = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.03, 0.26), trim);
      handle.position.set(x, 0.86, 0.68);
      this.intGroup.add(handle);
      const cup = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.14, 0.16), gloss);
      cup.position.set(x, 0.82, 0.58);
      this.intGroup.add(cup);
      const sill = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.05, 0.9), darkPlastic);
      sill.position.set(x - 0.04, 0.58, 0.7);
      this.intGroup.add(sill);
    };
    door(0.82);
    door(-0.82);

    // --- KORMÁNY (oszlopburkolat + vastag perem, 3 küllő, középbetét) ---
    this.steerCol = new THREE.Group();
    this.steerCol.position.set(0.38, 0.7, 0.46);
    this.steerCol.rotation.x = 0.5;
    this.intGroup.add(this.steerCol);
    const shroud = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.13, 0.3), plastic);
    shroud.position.set(0, 0.02, 0.14);
    this.steerCol.add(shroud);

    // Indexkapcsoló (indexemelő): a kormányoszlop bal oldalán, a vezető felé
    // álló kis kar — irányjelzéskor állíthatóan megmozdul.
    this.sigStalk = new THREE.Group();
    this.sigStalk.position.set(-0.07, -0.03, 0.2);
    const lever = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.013, 0.18, 10), trim);
    lever.rotation.x = Math.PI / 2;          // +Z felé nyúlik, a vezető felé
    lever.position.z = 0.09;
    this.sigStalk.add(lever);
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.016, 10, 8), buttonM);
    knob.position.z = 0.17;
    this.sigStalk.add(knob);
    this.steerCol.add(this.sigStalk);

    this.steerWheel = new THREE.Group();
    this.steerWheel.position.set(0, 0, 0.02);
    this.steerCol.add(this.steerWheel);
    const rimMat = new THREE.MeshStandardMaterial({ color: 0x20242b, roughness: 0.6, metalness: 0.35 });
    this.steerWheel.add(new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.026, 12, 32), rimMat));
    for (let i = 0; i < 3; i++) {
      const holder = new THREE.Group();
      holder.rotation.z = i * (Math.PI * 2 / 3);
      const sp = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.09, 0.03), trim);
      sp.position.y = 0.075;
      holder.add(sp);
      this.steerWheel.add(holder);
    }
    const pad = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.03), gloss);
    this.steerWheel.add(pad);
    this.wheelSpinV = 0;

    // --- TETŐKÁRPIT + napfényfüggönyök + kupola-lámpa ---
    const headliner = new THREE.Mesh(new THREE.BoxGeometry(1.55, 0.05, 0.9), cloth);
    headliner.position.set(0, 1.22, 0.55);
    this.intGroup.add(headliner);
    const dome = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.04, 0.2), new THREE.MeshStandardMaterial({
      color: 0x2a2f37, emissive: 0x27333d, emissiveIntensity: 0.6, roughness: 0.5 }));
    dome.position.set(0, 1.19, 0.72);
    this.intGroup.add(dome);
    for (const x of [-0.5, 0.5]) {
      const v = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.05, 0.6), cloth);
      v.position.set(x, 1.14, 0.45);
      v.rotation.x = -0.3;
      this.intGroup.add(v);
    }

    // --- BELSŐ VISSZAPILLANTÓ TÜKÖR (keret + üveg) a vezető feje fölött ---
    const mirrorFrame = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.11, 0.028), gloss);
    mirrorFrame.position.set(0.10, 1.14, 0.98);
    mirrorFrame.rotation.x = -0.32;
    this.intGroup.add(mirrorFrame);
    this.mirrorGlass = new THREE.Mesh(
      new THREE.PlaneGeometry(0.27, 0.08),
      new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide })
    );
    this.mirrorGlass.position.set(0.10, 1.14, 0.94);
    this.mirrorGlass.rotation.y = Math.PI;
    this.mirrorGlass.rotation.x = -0.32;
    this.intGroup.add(this.mirrorGlass);

    // --- A-OSZLOPOK (bal + jobb) ---
    const aPillar = (x, ry) => {
      const p = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.72, 0.08), cloth);
      p.position.set(x, 0.92, 0.9);
      p.rotation.z = ry;
      p.rotation.x = -0.25;
      this.intGroup.add(p);
    };
    aPillar(-0.55, -0.22);
    aPillar(0.55, 0.22);
  }

  setMirrorTexture(tex) {
    if (!this.mirrorGlass) return;
    // Optikai logika: a tükör-kamera a szélvédő vonalából HÁTRANÉZ.
    // A hátrafelé mutató render-kamera képe a bal-jobb oldalt MEGFORDÍTJA az
    // élethű tükörképhez képest (amikor hátranézel, a bal oldal jobbra kerül a
    // nyers képen). Ezért EGYSZERI horizontális flip kell az UV-ban (repeat.x=-1),
    // hogy a tükör helyesen (bal balra, jobb jobbra) mutasson. A tükörüveg
    // meshje a vezető felé áll (rotation.y=PI = előlap nézet), így nem ad
    // saját flipet, a korrekt flipet a UV-fordítás biztosítja.
    tex.center.set(0, 0);
    tex.offset.x = 1;
    tex.repeat.set(-1, 1);
    tex.wrapS = 1001; // RepeatWrapping
    tex.needsUpdate = true;
    this.mirrorGlass.material.map = tex;
    this.mirrorGlass.material.needsUpdate = true;
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

  // ---------- vizuális szinkron a sim-állapotból (nincs játéklogika) ----------

  // A jármű haladási iránya (a csoport yaw-jából), kamera/tükör célzásához.
  forwardWorld(out = this.fwd) {
    const y = this.group.rotation.y;
    out.set(Math.sin(y), 0, Math.cos(y));
    return out;
  }

  syncFrom(sim, dt) {
    this.group.position.set(sim.x, sim.y, sim.z);
    this.group.rotation.set(0, sim.yaw, 0);

    const spin = (sim.fwdSpeed / CAR.wheelRadius) * dt;
    for (const w of this.wheelMeshes) {
      w.spin -= spin;
      w.tyre.rotation.x = w.spin;
      if (w.steer) w.holder.rotation.y = -sim.steer * 0.55;
    }
    // a kormány a befordítási irányba fordul a sávváltáskor, majd visszaáll
    if (this.steerWheel) {
      const target = sim.steer * 0.85;
      const k = 1 - Math.exp(-dt * 10);
      this.steerWheel.rotation.z += (target - this.steerWheel.rotation.z) * k;
    }
    this.updateSignalViz(sim, dt);
  }

  // Index-lámpák, műszerfali nyilak és az indexemelő a sim-signal szerint.
  updateSignalViz(sim, dt) {
    const sig = sim.signal;
    const blinkOn = sim.signalOn();
    if (!sig) {
      for (const m of this.sigLights) m.material.emissiveIntensity = 0.05;
      if (this.sigDash) { this.sigDash[0].material.emissiveIntensity = 0.02; this.sigDash[1].material.emissiveIntensity = 0.02; }
      if (this.sigStalk) this.sigStalk.rotation.x = 0;
      return;
    }
    const on = blinkOn ? 2.2 : 0.05;
    const leftW = sig === -1;
    // külső lámpák: csak az aktív oldal (bal = -X, jobb = +X)
    for (const [i, m] of this.sigLights.entries()) {
      const isLeftSide = i < 2;
      m.material.emissiveIntensity = (isLeftSide === leftW) ? on : 0.05;
    }
    // műszerfali index-nyilak (0. index = bal nyíl)
    if (this.sigDash) {
      this.sigDash[0].material.emissiveIntensity = (sig === -1) ? on : 0.02;
      this.sigDash[1].material.emissiveIntensity = (sig === 1) ? on : 0.02;
    }
    // indexemelő: balra = le, jobbra = fel (a karon)
    if (this.sigStalk) {
      const target = sig === -1 ? -0.45 : 0.45;
      const k = 1 - Math.exp(-dt * 16);
      this.sigStalk.rotation.x += (target - this.sigStalk.rotation.x) * k;
    }
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
      this.v3.set(o.x, o.y, o.z).applyAxisAngle(new THREE.Vector3(0, 1, 0), this.group.rotation.y);
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

  // fejlesztési segéd: a kerék-látvány állapota
  wheelDbg(sim) {
    const steer = sim ? sim.steer : 0;
    return this.wheelMeshes.map((w, i) => ({
      y: +w.holder.position.y.toFixed(2),
      steer: w.steer ? +steer.toFixed(2) : 0,
      spin: +w.spin.toFixed(2),
      idx: i,
    }));
  }
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
