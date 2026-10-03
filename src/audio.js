// Minimális hangeffektek WebAudio-val. Minden try/catch-be csomagolva,
// hogy headless/audio nélküli környezetben se dőljön el.

export class AudioFX {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.engineOsc = null;
    this.muted = false;
  }

  // Autoplay-szabály: csak felhasználói gesztus után szabad elindítani.
  ensure() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
      return;
    }
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.5;
      this.master.connect(this.ctx.destination);
      this.startEngine();
    } catch { this.ctx = null; }
  }

  startEngine() {
    try {
      if (!this.ctx) return;
      const osc = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.value = 55;
      g.gain.value = 0.02;
      osc.connect(g).connect(this.master);
      osc.start();
      this.engineOsc = { osc, g };
    } catch { /* nem blokkolunk */ }
  }

  setEngine(speedRatio) {
    if (!this.engineOsc) return;
    try {
      const f = 45 + speedRatio * 130;
      this.engineOsc.osc.frequency.setTargetAtTime(f, this.ctx.currentTime, 0.08);
      this.engineOsc.g.gain.setTargetAtTime(0.015 + speedRatio * 0.03, this.ctx.currentTime, 0.1);
    } catch { /* */ }
  }

  toggleMute() {
    this.muted = !this.muted;
    if (this.master) this.master.gain.value = this.muted ? 0 : 0.5;
    return this.muted;
  }

  blip(freq, dur, type = 'sine', vol = 0.2, when = 0) {
    if (!this.ctx || this.muted) return;
    try {
      const t = this.ctx.currentTime + when;
      const o = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      o.type = type; o.frequency.value = freq;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(vol, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      o.connect(g).connect(this.master);
      o.start(t); o.stop(t + dur + 0.05);
    } catch { /* */ }
  }

  crash() {
    if (!this.ctx || this.muted) return;
    try {
      const t = this.ctx.currentTime;
      // ütközés: zaj + mély dörrenés
      const len = this.ctx.sampleRate * 0.35;
      const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      const g = this.ctx.createGain();
      g.gain.value = 0.55;
      const f = this.ctx.createBiquadFilter();
      f.type = 'lowpass'; f.frequency.setValueAtTime(1400, t);
      f.frequency.exponentialRampToValueAtTime(120, t + 0.3);
      src.connect(f).connect(g).connect(this.master);
      src.start(t);
      this.blip(70, 0.3, 'triangle', 0.4);
    } catch { /* */ }
  }

  bonus() {
    this.blip(660, 0.12, 'sine', 0.18);
    this.blip(990, 0.2, 'sine', 0.18, 0.09);
  }

  overtake() { this.blip(520, 0.1, 'triangle', 0.16); }

  penalty() { this.blip(220, 0.18, 'square', 0.12); }
}
