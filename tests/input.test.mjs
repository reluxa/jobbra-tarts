import test from 'node:test';
import assert from 'node:assert/strict';
import { installDomStubs } from './helpers/dom-stubs.js';
import { Input, keyAction } from '../src/input.js';

const { document, window, makeEl } = installDomStubs();

// ---- a tiszta leképezés ----
test('keyAction: sávváltás balra/jobbra, index q/e, space/nyilak prevent', () => {
  assert.deepEqual(keyAction('a', false), { bind: 'lane', dir: -1, prevent: false, repeat: false });
  assert.deepEqual(keyAction('ArrowLeft', false), { bind: 'lane', dir: -1, prevent: true, repeat: false });
  assert.deepEqual(keyAction('D', false), { bind: 'lane', dir: 1, prevent: false, repeat: false });
  assert.deepEqual(keyAction('arrowright', true), { bind: 'lane', dir: 1, prevent: true, repeat: true });
  assert.deepEqual(keyAction('q', false), { bind: 'signal', dir: -1, prevent: false, repeat: false });
  assert.deepEqual(keyAction('E', false), { bind: 'signal', dir: 1, prevent: false, repeat: false });
  assert.deepEqual(keyAction(' ', false), { bind: null, dir: 0, prevent: true, repeat: false });
  assert.deepEqual(keyAction('arrowup', false), { bind: null, dir: 0, prevent: true, repeat: false });
  assert.deepEqual(keyAction('arrowdown', false), { bind: null, dir: 0, prevent: true, repeat: false });
  assert.equal(keyAction('x', false), null, 'nem játszó gomb');
  assert.equal(keyAction('Enter', true), null);
  // a repeat csak a játszó gomboknál számít felül
  assert.ok(keyAction('a', true).repeat);
});

test('Input.keydown: dispatch + preventDefault + repeat-szűrés', () => {
  const input = new Input();
  const got = [];
  const ev = { key: 'a', repeat: false, preventDefault() { this.prevented = (this.prevented || 0) + 1; } };
  input.onLane = (dir) => got.push(['lane', dir]);
  input.onSignal = (dir) => got.push(['sig', dir]);
  input.onAnyKey = () => got.push(['any']);

  input.keydown(ev);
  assert.equal(ev.prevented, undefined, 'a nem nyíl gomb nem preventeli');
  assert.deepEqual(got, [['any'], ['lane', -1]]);

  // átlós nyíl: prevent is fut
  const ev2 = { key: 'ArrowLeft', repeat: false, preventDefault() { this.prevented = 1; } };
  got.length = 0;
  input.keydown(ev2);
  assert.equal(ev2.prevented, 1);
  assert.deepEqual(got, [['any'], ['lane', -1]]);

  // lenyomva tartás: nincs dupla dispatch (de a prevent megmarad)
  const ev3 = { key: 'ArrowLeft', repeat: true, preventDefault() { this.prevented = 1; } };
  got.length = 0;
  input.keydown(ev3);
  assert.equal(ev3.prevented, 1, 'a nyíl repeatkor is preventel (görgetés-gátlás)');
  assert.deepEqual(got, [['any']], 'a repeat nem spamel');

  // index-gombok
  got.length = 0;
  input.keydown({ key: 'e', repeat: false });
  assert.deepEqual(got, [['any'], ['sig', 1]]);

  // ismeretlen gomb
  got.length = 0;
  input.keydown({ key: 'x', repeat: false });
  assert.deepEqual(got, [['any']]);
});

test('Input: a touch-gombok pointerdown-nál dispatchelnek', () => {
  const tL = makeEl();
  const tR = makeEl();
  const tSigL = makeEl();
  const tSigR = makeEl();
  document.register({ tL, tR, tSigL, tSigR });
  const hits = { lane: [], sig: [] };
  const input = new Input(window);
  input.onLane = (d) => hits.lane.push(d);
  input.onSignal = (d) => hits.sig.push(d);
  tL.fire('pointerdown');
  tR.fire('pointerdown');
  tSigL.fire('pointerdown');
  tSigR.fire('pointerdown');
  assert.deepEqual(hits, { lane: [-1, 1], sig: [-1, 1] });
});

test('Input: a hiányzó touch-gomb nem dob', () => {
  assert.doesNotThrow(() => new Input(window));
});

test('Input: a folyamatos sávváltás eseményei a window-n keresztül jönnek', () => {
  const handlers = {};
  window.addEventListener = (type, cb) => { handlers[type] = cb; };
  const input = new Input(window);
  assert.equal(typeof handlers.keydown, 'function', 'a keydown a window-ra kötött');
  const got = [];
  input.onLane = (d) => got.push(d);
  handlers.keydown({ key: 'd', repeat: false });
  handlers.keydown({ key: 'a', repeat: false });
  assert.deepEqual(got, [1, -1]);
});
