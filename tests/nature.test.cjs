'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const {
  resolveAtmosphere,
  computeParticleBudget,
  createBurstLimiter,
  createQualityGovernor
} = require('../app/static/nature.js');

test('Theme defaults select sunlight/wind, Lycoris/moon and snow while respecting off', () => {
  assert.equal(resolveAtmosphere('auto', 'forest', false), 'wind');
  assert.equal(resolveAtmosphere('auto', 'dark', false), 'lycoris');
  assert.equal(resolveAtmosphere('auto', 'christmas', false), 'snow');
  assert.equal(resolveAtmosphere('wind', 'dark', false), 'lycoris');
  assert.equal(resolveAtmosphere('off', 'christmas', false), 'off');
  assert.equal(resolveAtmosphere('auto', 'christmas', true), 'off');
  assert.equal(resolveAtmosphere('rain', 'forest', false), 'rain');
});

test('Particle budgets stay lightweight on desktop and mobile and scale down smoothly', () => {
  const desktopDark = computeParticleBudget('lycoris', 1440, 1);
  const mobileDark = computeParticleBudget('lycoris', 390, 1);
  assert.equal(desktopDark.lilies, 2);
  assert.equal(desktopDark.total, 10);
  assert.equal(mobileDark.lilies, 1);
  assert.equal(mobileDark.total, 5);
  assert.ok(computeParticleBudget('snow', 1440, 1).total <= 40);
  assert.ok(computeParticleBudget('snow', 390, 1).total <= 20);
  assert.ok(computeParticleBudget('snow', 1440, 0.6).total < computeParticleBudget('snow', 1440, 1).total);
});

test('Burst limiter enforces both cooldown and active particle cap', () => {
  const limiter = createBurstLimiter({ maxActive: 16, cooldownMs: 260, maxPerBurst: 7 });
  assert.equal(limiter.allow(1000, 0, 20), 7);
  assert.equal(limiter.allow(1100, 7, 20), 0); // within cooldown
  assert.equal(limiter.allow(1300, 12, 20), 4); // capped by remaining room
  assert.equal(limiter.allow(1600, 16, 20), 0); // at capacity
});

test('Quality governor applies hysteresis without rapid oscillation', () => {
  const gov = createQualityGovernor({ downThresholdMs: 3.4, upThresholdMs: 1.3, sustainDownSec: 1.5, sustainUpSec: 4, holdSec: 6 });
  assert.equal(gov.scale, 1);
  for (let i = 0; i < 40; i++) gov.sample(5.0, 0.05);
  assert.equal(gov.scale, 0.6);
  // During hold window, fast frames do not immediately flip back
  for (let i = 0; i < 40; i++) gov.sample(0.4, 0.05);
  assert.equal(gov.scale, 0.6);
  // After hold + sustained headroom, quality recovers
  for (let i = 0; i < 180; i++) gov.sample(0.4, 0.05);
  assert.equal(gov.scale, 1);
});

function browser({ theme = 'forest', saved = 'wind', reduced = false, width = 390 } = {}) {
  const docEvents = new Map(), winEvents = new Map(), nodes = new Map(), rafs = new Map();
  const storage = new Map([['astra:nature-mode', saved]]);
  let rafId = 0, now = 0, clearCalls = 0;
  const context = new Proxy({}, {
    get(target, key) {
      if (key === 'clearRect') return () => { clearCalls++; };
      if (key === 'createRadialGradient') return () => ({ addColorStop() {} });
      return target[key] || (() => {});
    },
    set(target, key, value) { target[key] = value; return true; }
  });
  function node(id) {
    return {
      id, dataset: {}, style: {}, hidden: false, disabled: false, value: saved, events: new Map(),
      setAttribute(name, value) { this[name] = value; },
      addEventListener(name, cb) { this.events.set(name, cb); },
      dispatchEvent(e) { this.events.get(e.type)?.(e); },
      getContext() { return context; },
      remove() { nodes.delete(this.id); }
    };
  }
  const select = node('nature-mode'); nodes.set(select.id, select);
  const media = { matches: reduced, addEventListener(name, cb) { this.change = cb; } };
  const body = { dataset: {}, prepend(n) { nodes.set(n.id, n); } };
  const document = {
    body, hidden: false, readyState: 'complete',
    documentElement: { clientWidth: width, dataset: { theme } },
    createElement() { return node(''); },
    getElementById(id) { return nodes.get(id); },
    addEventListener(name, cb) { docEvents.set(name, cb); }
  };
  const window = {
    innerWidth: width, innerHeight: 844, devicePixelRatio: 3,
    matchMedia() { return media; },
    addEventListener(name, cb) { winEvents.set(name, cb); }
  };
  vm.runInNewContext(fs.readFileSync(require.resolve('../app/static/nature.js'), 'utf8'), {
    document, window,
    localStorage: { getItem: k => storage.get(k), setItem: (k, v) => storage.set(k, v) },
    requestAnimationFrame(cb) { rafs.set(++rafId, cb); return rafId; },
    cancelAnimationFrame(id) { rafs.delete(id); },
    Date: { now: () => now },
    Math, Set, Number
  });
  return {
    document, window, media, nodes, storage, select, rafs,
    get clearCalls() { return clearCalls; },
    event(name, detail) { docEvents.get(name)?.(detail ? { detail } : undefined); },
    frame(ms = 40) { now += ms; const list = [...rafs.values()]; rafs.clear(); for (const cb of list) cb(now); }
  };
}

test('Browser runtime uses single background canvas, removes Santa, caps DPR and pauses invisible pages', () => {
  const b = browser({ theme: 'dark' });
  assert.equal(b.select.value, 'auto');
  assert.equal(b.document.body.dataset.natureMode, 'lycoris');
  assert.equal(b.nodes.get('nature-atmosphere').width, 585);
  assert.equal(b.nodes.get('nature-foreground'), undefined);
  assert.equal(b.nodes.get('holiday-flight'), undefined);

  b.frame();
  assert.equal(b.rafs.size, 1);

  b.document.hidden = true; b.event('visibilitychange');
  assert.equal(b.rafs.size, 0);

  b.document.hidden = false; b.event('visibilitychange');
  assert.equal(b.rafs.size, 1);

  b.media.matches = true; b.media.change();
  assert.equal(b.document.body.dataset.natureMode, 'off');
  assert.equal(b.rafs.size, 0);

  b.media.matches = false; b.media.change();
  assert.equal(b.document.body.dataset.natureMode, 'lycoris');

  b.select.value = 'off'; b.select.dispatchEvent({ type: 'change' });
  b.document.documentElement.dataset.theme = 'christmas'; b.event('astra:themechange');
  assert.equal(b.document.body.dataset.natureMode, 'off');
  assert.equal(b.storage.get('astra:nature-mode'), 'off');
});

test('High-refresh 240Hz RAF ticks throttle draw calls and rapid bursts stay capped', () => {
  const b = browser({ theme: 'christmas', saved: 'auto', width: 1440 });
  const beforeClears = b.clearCalls;
  // Simulate 240 frames at 240Hz (~4.16ms apart = 1 second total)
  for (let i = 0; i < 240; i++) b.frame(4.166);
  const drawnInOneSecond = b.clearCalls - beforeClears;
  assert.ok(drawnInOneSecond <= 55 && drawnInOneSecond >= 40, `expected ~48-51 draws/s, got ${drawnInOneSecond}`);

  // Rapid burst spam cannot exceed maxBursts
  for (let i = 0; i < 25; i++) {
    b.frame(40);
    b.event('astra:burst', { x: 200, y: 200, count: 30 });
  }
  const stats = b.window.__astraNatureStats();
  assert.ok(stats.bursts <= stats.maxBursts);
});
