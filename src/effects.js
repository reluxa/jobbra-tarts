// Vizuális effektek: képernyő-rázkódás, villanás, részecskék, 3D-be vetített feliratok.
import * as THREE from 'three';

export class Effects {
  constructor(scene, camera, labelRoot) {
    this.scene = scene;
    this.camera = camera;
    this.labelRoot = labelRoot;

    // rázkódás
    this.shakeT = 0;
    this.shakeDur = 0;
    this.shakeMag = 0;

    // részecskék (röpködő szilánkok balesetkor)
    this.N = 128;
    this.pos = new Float32Array(this.N * 3);
    this.vel = [];
    this.life = new Float32Array(this.N);
    this.maxLife = new Float32Array(this.N);
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.mat = new THREE.PointsMaterial({ color: 0xffb74d, size: 0.22, sizeAttenuation: true });
    this.points = new THREE.Points(this.geo, this.mat);
    this.points.frustumCulled = false;
    this.points.visible = false;
    for (let i = 0; i < this.N; i++) {
      this.vel.push(new THREE.Vector3());
      this.life[i] = 0;
    }
    scene.add(this.points);
  }

  shake(mag, dur = 0.5) {
    this.shakeMag = mag;
    this.shakeDur = dur;
    this.shakeT = dur;
  }

  // Véletlen eltolás a kamerának
  getShakeOffset(out) {
    if (this.shakeT <= 0) { out.setScalar(0); return out; }
    const t = this.shakeT / this.shakeDur;
    const m = this.shakeMag * t;
    out.set((Math.random() - 0.5) * m, (Math.random() - 0.5) * m * 0.7, (Math.random() - 0.5) * m * 0.4);
    return out;
  }

  tickShake(dt) {
    if (this.shakeT > 0) this.shakeT = Math.max(0, this.shakeT - dt);
  }

  burst(pos, n = 24, color = 0xffb74d) {
    this.mat.color.setHex(color);
    this.points.visible = true;
    let used = 0;
    for (let i = 0; i < this.N && used < n; i++) {
      if (this.life[i] > 0) continue;
      const a = Math.random() * Math.PI * 2;
      const up = 2 + Math.random() * 3;
      this.pos[i * 3] = pos.x + (Math.random() - 0.5) * 0.4;
      this.pos[i * 3 + 1] = pos.y + 0.4 + Math.random() * 0.6;
      this.pos[i * 3 + 2] = pos.z + (Math.random() - 0.5) * 0.4;
      this.vel[i].set(Math.cos(a) * (2 + Math.random() * 4), up, Math.sin(a) * (2 + Math.random() * 4));
      this.maxLife[i] = this.life[i] = 0.6 + Math.random() * 0.5;
      used++;
    }
  }

  updateParticles(dt) {
    let any = false;
    for (let i = 0; i < this.N; i++) {
      if (this.life[i] > 0) {
        this.life[i] -= dt;
        this.vel[i].y -= 9.8 * 0.55 * dt;
        this.vel[i].multiplyScalar(1 - 1.2 * dt);
        this.pos[i * 3] += this.vel[i].x * dt;
        this.pos[i * 3 + 1] += this.vel[i].y * dt;
        this.pos[i * 3 + 2] += this.vel[i].z * dt;
        if (this.life[i] <= 0) this.pos[i * 3 + 1] = -100;
        any = true;
      }
    }
    this.points.visible = any;
    this.geo.attributes.position.needsUpdate = true;
    this.mat.opacity = 1;
  }

  // Felirat a 3D világ pozíciójára vetítve (DOM a canvas felett).
  popup(text, color, worldPos) {
    const el = document.createElement('div');
    el.className = 'pop3d';
    el.style.color = color;
    el.textContent = text;
    this.labelRoot.appendChild(el);

    // canvas-koordináta -> képernyő
    const v = new THREE.Vector3().copy(worldPos).project(this.camera);
    if (v.z > 1) { el.remove(); return; }
    const x = (v.x * 0.5 + 0.5) * window.innerWidth;
    const y = (-v.y * 0.5 + 0.5) * window.innerHeight;
    el.style.left = x + 'px';
    el.style.top = y + 'px';

    requestAnimationFrame(() => { el.style.opacity = 0; });
    setTimeout(() => el.remove(), 900);
  }
}
