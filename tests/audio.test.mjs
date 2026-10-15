import test from 'node:test';
import assert from 'node:assert/strict';
import { installDomStubs } from './helpers/dom-stubs.js';
import { AudioFX } from '../src/audio.js';

const { window, Audio } = installDomStubs();

// egy minimális WebAudio-graph mock, ami a használt metódusokat rögzíti
function fakeCtx() {
  const calls = { createOscillator: 0, createGain: 0, createBufferSource: 0, resume: 0 };
  const gain = () => ({
    gain: {
      value: 0,
      setValueAtTime() {}, linearRampToValueAtTime() {},
      exponentialRampToValueAtTime() {},
    },
    connect() { return this; },
  });
  const ctx = {
    calls,
    state: 'running',
    currentTime: 0,
    sampleRate: 44100,
    destination: {},
    createGain() { calls.createGain++; return gain(); },
    createOscillator() {
      calls.createOscillator++;
      return { type: '', frequency: { value: 0 }, connect() { return this; }, start() {}, stop() {} };
    },
    createBuffer(channels, len) {
      return { getChannelData: () => new Float32Array(len), length: len, numberOfChannels: channels };
    },
    createBufferSource() {
      calls.createBufferSource++;
      return { buffer: null, connect() { return this; }, start() {} };
    },
    createBiquadFilter() {
      return { type: '', frequency: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() { return this; } };
    },
    resume() { calls.resume++; return Promise.resolve(); },
  };
  return ctx;
}

test('ensure: nincs AudioContext → nyugodtan null marad', () => {
  window.AudioContext = undefined;
  window.webkitAudioContext = undefined;
  const a = new AudioFX();
  a.ensure();
  assert.equal(a.ctx, null);
  assert.equal(a.master, null);
});

test('ensure: felépíti a graph-ot, elindítja a zenét; a második hívás már a resume-ra ügyel', () => {
  const ctx = fakeCtx();
  window.AudioContext = function () { return ctx; };
  const a = new AudioFX();
  a.ensure();
  assert.ok(a.ctx, 'a context létrejön');
  assert.equal(a.master.gain.value, 0.5);
  assert.ok(a.musicEl instanceof Audio, 'a zenei elem audio');
  assert.equal(a.musicEl.loop, true);
  assert.equal(a.musicEl.volume, 0.3);
  assert.equal(a.musicEl.src, '/music/bgm.mp3');
  // második ensure: suspended → resume; running → semmi
  ctx.state = 'suspended';
  a.ensure();
  assert.equal(ctx.calls.resume, 1, 'a suspendált ctx resumel');
  ctx.state = 'running';
  a.ensure();
  assert.equal(ctx.calls.resume, 1);
});

test('toggleMute: lenémítja a mastert és a zenét, visszaváltható', () => {
  const ctx = fakeCtx();
  window.AudioContext = function () { return ctx; };
  window.Audio = class { play() { return Promise.resolve(); } };
  const a = new AudioFX();
  a.ensure();
  assert.equal(a.toggleMute(), true);
  assert.equal(a.master.gain.value, 0);
  assert.equal(a.musicEl.volume, 0);
  assert.equal(a.toggleMute(), false);
  assert.equal(a.master.gain.value, 0.5);
  assert.equal(a.musicEl.volume, 0.3);
});

test('blip/bonus/overtake/penalty/blink: hang-graph-hívások némán és élesen', () => {
  const ctx = fakeCtx();
  window.AudioContext = function () { return ctx; };
  const a = new AudioFX();
  a.ensure();
  const osc0 = ctx.calls.createOscillator;
  a.blip(440, 0.1);
  assert.ok(ctx.calls.createOscillator > osc0, 'osszcillátor szól');
  a.bonus();
  a.overtake();
  a.penalty();
  a.blink();
  assert.ok(ctx.calls.createOscillator >= osc0 + 6, 'minden effekt az összc-ikon keresztül megy');
  // némítva: a graph érintetlen marad
  a.toggleMute();
  const after = ctx.calls.createOscillator;
  a.blip(440, 0.1);
  a.crash();
  a.bonus();
  assert.equal(ctx.calls.createOscillator, after, 'némán nem szól semmi');
});

test('crash: zaj-buffer + lowpass + mély dörrenés', () => {
  const ctx = fakeCtx();
  window.AudioContext = function () { return ctx; };
  const orig = Math.random;
  Math.random = () => 0.5;
  try {
    const a = new AudioFX();
    a.ensure();
    const src0 = ctx.calls.createBufferSource;
    a.crash();
    assert.ok(ctx.calls.createBufferSource > src0, 'a zaj-szórás bufferhez kötött');
  } finally {
    Math.random = orig;
  }
});

test('setEngine: (kihúzott motor —) nem hibázik semmilyen bemenetre', () => {
  const a = new AudioFX();
  a.setEngine(0);
  a.setEngine(1);
  a.setEngine(NaN);
});

test('startMusic: hibás Audio esetén csendben elmarad', () => {
  window.Audio = undefined;
  const a = new AudioFX();
  assert.doesNotThrow(() => { a.startMusic(); a.ensure(); });
});
