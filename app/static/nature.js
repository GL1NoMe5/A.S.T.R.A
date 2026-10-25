/* Living atmosphere: single-layer decorative sky behind the interface.
   Never represents measured weather, never covers text, and never intercepts pointer input. */
(() => {
  'use strict';
  const MODES = new Set(['auto', 'wind', 'sun', 'rain', 'snow', 'off']);
  const STORAGE_KEY = 'astra:nature-mode';
  const TAU = Math.PI * 2;
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const random = (lo, hi) => lo + Math.random() * (hi - lo);
  const pick = list => list[Math.floor(Math.random() * list.length)];
  const linGrad = (c, x0, y0, x1, y1) => {
    const g = c.createLinearGradient?.(x0, y0, x1, y1);
    return g && typeof g.addColorStop === 'function' ? g : c.createRadialGradient(x0, y0, 0, x1, y1, 1);
  };

  const resolveAtmosphere = (preferred, theme, reduced) =>
    reduced || preferred === 'off'
      ? 'off'
      : preferred === 'auto'
        ? theme === 'christmas' ? 'snow' : theme === 'dark' ? 'lycoris' : 'wind'
        : preferred === 'wind' && theme === 'dark'
          ? 'lycoris'
          : preferred;

  function computeParticleBudget(mode, width, qualityScale = 1) {
    const mobile = width < 640;
    const q = clamp(qualityScale, 0.5, 1);
    const scaleCount = (n, minVal = 1) => Math.max(minVal, Math.round(n * q));
    switch (mode) {
      case 'wind': return { total: scaleCount(mobile ? 5 : 10, 3), lilies: 0 };
      case 'lycoris': {
        const lilies = mobile ? 1 : (q < 0.8 ? 1 : 2);
        const petals = scaleCount(mobile ? 4 : 8, 3);
        return { total: lilies + petals, lilies };
      }
      case 'snow': return { total: scaleCount(mobile ? 18 : 38, 10), lilies: 0 };
      case 'rain': return { total: scaleCount(mobile ? 14 : 28, 8), lilies: 0 };
      case 'sun': return { total: scaleCount(mobile ? 5 : 10, 3), lilies: 0 };
      default: return { total: 0, lilies: 0 };
    }
  }

  function createBurstLimiter({ maxActive = 16, cooldownMs = 260, maxPerBurst = 7 } = {}) {
    let lastAt = -1e9;
    return {
      maxActive,
      allow(nowMs, currentActive, requested = maxPerBurst) {
        if (nowMs - lastAt < cooldownMs) return 0;
        const room = Math.max(0, maxActive - currentActive);
        if (room <= 0) return 0;
        lastAt = nowMs;
        return Math.min(room, Math.max(1, Math.min(requested, maxPerBurst)));
      },
      reset() { lastAt = -1e9; }
    };
  }

  function createQualityGovernor({
    downThresholdMs = 3.4,
    upThresholdMs = 1.3,
    sustainDownSec = 1.5,
    sustainUpSec = 4.0,
    holdSec = 6.0
  } = {}) {
    let scale = 1, ema = 0.8, overSec = 0, underSec = 0, hold = 0;
    return {
      get scale() { return scale; },
      reset() { scale = 1; ema = 0.8; overSec = 0; underSec = 0; hold = 0; },
      sample(drawMs, dt) {
        if (!Number.isFinite(drawMs) || !Number.isFinite(dt) || dt <= 0) return false;
        ema += (drawMs - ema) * 0.12;
        if (hold > 0) hold = Math.max(0, hold - dt);
        if (ema > downThresholdMs) { overSec += dt; underSec = 0; }
        else if (ema < upThresholdMs) { underSec += dt; overSec = 0; }
        else { overSec = Math.max(0, overSec - dt * 0.5); underSec = Math.max(0, underSec - dt * 0.5); }
        if (hold <= 0 && scale > 0.6 && overSec >= sustainDownSec) {
          scale = 0.6; overSec = 0; hold = holdSec; return true;
        }
        if (hold <= 0 && scale < 1 && underSec >= sustainUpSec) {
          scale = 1; underSec = 0; hold = holdSec; return true;
        }
        return false;
      }
    };
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { resolveAtmosphere, computeParticleBudget, createBurstLimiter, createQualityGovernor };
  }
  if (typeof document === 'undefined') return;

  const LEAVES = [
    ['#5f8f4b', '#a6c985'], ['#77a253', '#bcd890'], ['#a3ad4c', '#d8dc92'],
    ['#c9963c', '#ecc77f'], ['#3f7048', '#86b582'], ['#b8743a', '#e3ad73']
  ];
  const CRATERS = [[-.32, -.22, .2], [.28, .12, .15], [-.08, .44, .12], [.24, -.46, .1], [.5, -.05, .07], [-.48, .2, .08]];
  const BOKEH = [[255, 204, 120], [236, 98, 82], [160, 214, 150], [255, 236, 210], [255, 176, 96]];

  /* ---------- Pre-rendered botanical & atmospheric sprite bank ---------- */
  function drawRuffledTepal(c, len, width, curl, flip, shade) {
    c.save();
    c.scale(flip, 1);
    const g = linGrad(c, 0, 0, curl * len * 0.65, -len);
    if (shade === 'back') {
      g.addColorStop(0, '#5e0510'); g.addColorStop(0.55, '#a50f20'); g.addColorStop(1, '#cf2231');
    } else if (shade === 'mid') {
      g.addColorStop(0, '#850a18'); g.addColorStop(0.5, '#d91a2a'); g.addColorStop(1, '#f43d45');
    } else {
      g.addColorStop(0, '#9e0f20'); g.addColorStop(0.45, '#ec2434'); g.addColorStop(1, '#ff666b');
    }
    c.fillStyle = g;
    c.beginPath();
    c.moveTo(-width * 0.15, 0);
    c.bezierCurveTo(-width * 1.15, -len * 0.24, width * 0.45, -len * 0.48, curl * len * 0.34, -len * 0.74);
    c.bezierCurveTo(curl * len * 0.56, -len * 0.96, curl * len * 0.98, -len * 0.98, curl * len * 1.02, -len * 0.66);
    c.quadraticCurveTo(curl * len * 0.92, -len * 0.54, curl * len * 0.78, -len * 0.68);
    c.bezierCurveTo(curl * len * 0.64, -len * 0.80, width * 1.25, -len * 0.48, width * 0.28, 0);
    c.closePath();
    c.fill();
    if (shade !== 'back') {
      c.strokeStyle = shade === 'front' ? 'rgba(255,162,160,0.68)' : 'rgba(255,118,122,0.38)';
      c.lineWidth = 0.65;
      c.beginPath();
      c.moveTo(0, -len * 0.06);
      c.bezierCurveTo(-width * 0.45, -len * 0.28, curl * len * 0.26, -len * 0.64, curl * len * 0.86, -len * 0.82);
      c.stroke();
    }
    c.restore();
  }

  function drawLycorisFloret(c, ox, oy, dirAngle, scale, seed) {
    c.save();
    c.translate(ox, oy);
    c.rotate(dirAngle);
    c.scale(scale, scale);

    const tg = linGrad(c, 0, 4.5, 0, -2);
    tg.addColorStop(0, '#6b8238'); tg.addColorStop(1, '#a41827');
    c.strokeStyle = tg; c.lineWidth = 1.85; c.lineCap = 'round';
    c.beginPath(); c.moveTo(0, 4.5); c.lineTo(0, -1.4); c.stroke();

    for (const ts of [
      { rot: -2.18, len: 16.8, w: 3.1, curl: 0.76, flip: -1, shade: 'back' },
      { rot:  2.14, len: 16.4, w: 3.1, curl: 0.74, flip:  1, shade: 'back' },
      { rot: -1.36, len: 18.4, w: 3.4, curl: 0.84, flip: -1, shade: 'mid' },
      { rot:  1.30, len: 18.0, w: 3.4, curl: 0.82, flip:  1, shade: 'mid' }
    ]) {
      c.save(); c.rotate(ts.rot); drawRuffledTepal(c, ts.len, ts.w, ts.curl, ts.flip, ts.shade); c.restore();
    }

    const gravitySwoop = Math.sin(dirAngle);
    const spreads = [-0.48, -0.22, 0.03, 0.27, 0.50, -0.08];
    for (let idx = 0; idx < spreads.length; idx++) {
      const sp = spreads[idx], isStyle = idx === 5;
      const len = isStyle ? 44 : 35 + ((idx * 5 + seed) % 4) * 2.4;
      const cp1x = Math.sin(sp) * len * 0.35 + gravitySwoop * 5;
      const cp1y = -Math.cos(sp) * len * 0.32 + Math.abs(gravitySwoop) * 5;
      const cp2x = Math.sin(sp * 1.08) * len * 0.78 + gravitySwoop * 3;
      const cp2y = -Math.cos(sp * 1.08) * len * 0.68 + Math.abs(gravitySwoop) * 6;
      const hookUp = -gravitySwoop * 13 + (sp < 0 ? -2.5 : 2.5);
      const endX = Math.sin(sp * 0.96) * len * 0.94 + hookUp * 0.65;
      const endY = -Math.cos(sp * 0.96) * len * 0.95 - Math.abs(gravitySwoop) * 9;

      const fg = linGrad(c, 0, -1, endX, endY);
      fg.addColorStop(0, '#b31222'); fg.addColorStop(0.5, '#ee2938');
      fg.addColorStop(0.88, '#ff6464'); fg.addColorStop(1, isStyle ? '#ff9ea0' : '#ff8c7a');
      c.strokeStyle = fg; c.lineWidth = isStyle ? 0.68 : 0.85; c.lineCap = 'round';
      c.beginPath(); c.moveTo(sp * 1.5, -1.2); c.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, endX, endY); c.stroke();

      if (!isStyle) {
        const tanAngle = Math.atan2(endY - cp2y, endX - cp2x) + 1.15;
        c.save(); c.translate(endX, endY); c.rotate(tanAngle);
        c.fillStyle = '#e5b25c';
        c.beginPath(); c.ellipse(0, 0, 1.05, 0.42, 0, 0, TAU); c.fill();
        c.restore();
      }
    }

    for (const ts of [
      { rot: -0.58, len: 17.2, w: 3.3, curl: 0.90, flip: -1, shade: 'front' },
      { rot:  0.54, len: 16.8, w: 3.3, curl: 0.88, flip:  1, shade: 'front' }
    ]) {
      c.save(); c.rotate(ts.rot); drawRuffledTepal(c, ts.len, ts.w, ts.curl, ts.flip, ts.shade); c.restore();
    }
    c.restore();
  }

  function makeOffscreen(size) {
    const el = document.createElement('canvas');
    el.width = size; el.height = size;
    const c = el.getContext?.('2d');
    if (!c || typeof c.save !== 'function' || typeof c.beginPath !== 'function') return null;
    return [el, c];
  }

  function createSpriteBank() {
    const probe = makeOffscreen(8);
    if (!probe) return null;

    const makeLycoris = (variant, sizePx = 192) => {
      const [off, c] = makeOffscreen(sizePx);
      const scale = sizePx / 138;
      c.save(); c.translate(sizePx * 0.5, sizePx * 0.58); c.scale(scale, scale);
      const aura = c.createRadialGradient(0, -10, 2, 0, -10, 52);
      aura.addColorStop(0, 'rgba(235,34,50,0.18)'); aura.addColorStop(0.55, 'rgba(205,22,40,0.06)'); aura.addColorStop(1, 'rgba(180,16,32,0)');
      c.fillStyle = aura; c.beginPath(); c.arc(0, -10, 52, 0, TAU); c.fill();

      const hubX = 0, hubY = 11;
      const sg = linGrad(c, hubX, hubY, -9, 54);
      sg.addColorStop(0, '#6c803a'); sg.addColorStop(0.55, '#4a6230'); sg.addColorStop(1, 'rgba(44,68,34,0.12)');
      c.strokeStyle = sg; c.lineWidth = 2.2; c.lineCap = 'round';
      c.beginPath(); c.moveTo(hubX, hubY); c.bezierCurveTo(2.5, 24, -2, 38, variant === 0 ? -8 : -14, 53); c.stroke();

      c.fillStyle = '#7e6346';
      for (const side of [-1, 1]) {
        c.beginPath(); c.moveTo(hubX, hubY + 1);
        c.quadraticCurveTo(hubX + side * 5.6, hubY - 1.5, hubX + side * 8.2, hubY - 5.8);
        c.quadraticCurveTo(hubX + side * 2.8, hubY - 1.8, hubX, hubY - 0.5);
        c.closePath(); c.fill();
      }

      const florets = variant === 0
        ? [
            { ox: -15.5, oy:  2.0, ang: -1.68, sc: 0.90, seed: 1 },
            { ox:  15.2, oy:  2.4, ang:  1.64, sc: 0.90, seed: 2 },
            { ox:  -6.8, oy: -5.8, ang: -0.58, sc: 0.98, seed: 3 },
            { ox:   7.2, oy: -5.4, ang:  0.54, sc: 0.98, seed: 4 }
          ]
        : [
            { ox: -13.0, oy:  1.5, ang: -1.35, sc: 0.92, seed: 2 },
            { ox:  13.5, oy:  1.2, ang:  1.42, sc: 0.92, seed: 4 },
            { ox:   0.4, oy: -6.5, ang:  0.05, sc: 1.02, seed: 1 }
          ];

      c.strokeStyle = '#6f853c'; c.lineWidth = 1.4;
      for (const f of florets) {
        c.beginPath(); c.moveTo(hubX, hubY);
        c.quadraticCurveTo(hubX + f.ox * 0.42, hubY + (f.oy - hubY) * 0.32, f.ox, f.oy);
        c.stroke();
      }
      for (const f of florets) drawLycorisFloret(c, f.ox, f.oy, f.ang, f.sc, f.seed);
      c.restore();
      return off;
    };

    const makeTepal = (variant, sizePx = 64) => {
      const [off, c] = makeOffscreen(sizePx);
      const s = sizePx / 32;
      c.save(); c.translate(sizePx * 0.5, sizePx * 0.52); c.scale(s, s);
      const g = linGrad(c, -12, 4, 12, -5);
      g.addColorStop(0, '#8f0b1b'); g.addColorStop(0.5, '#e82232'); g.addColorStop(1, '#ff686c');
      c.fillStyle = g; c.beginPath();
      if (variant === 0) {
        c.moveTo(-12.5, 3.2); c.bezierCurveTo(-6, -3.6, 2.5, -4.4, 9.8, -1.2);
        c.quadraticCurveTo(13.2, 0.8, 10.6, 4.6); c.quadraticCurveTo(9.2, 5.2, 8.8, 2.6);
        c.bezierCurveTo(6.2, -0.8, -3.5, -0.4, -12.5, 3.2);
      } else if (variant === 1) {
        c.moveTo(-12, 1.8); c.bezierCurveTo(-5, -4.8, 3.5, 1.8, 11.8, -3.2);
        c.quadraticCurveTo(13.2, -3.8, 11.6, -0.4); c.bezierCurveTo(3.2, 4.8, -4.5, -1.2, -12, 1.8);
      } else {
        c.moveTo(-11, 4.2); c.bezierCurveTo(-5.5, -4.8, 5.5, -5.0, 11.4, 2.4);
        c.quadraticCurveTo(11.8, 4.4, 9.6, 3.2); c.bezierCurveTo(4.5, -1.6, -4.2, -1.2, -11, 4.2);
      }
      c.closePath(); c.fill();
      c.strokeStyle = 'rgba(255,166,166,0.6)'; c.lineWidth = 0.6;
      c.beginPath(); c.moveTo(-9.5, 1.6); c.quadraticCurveTo(0, -2.4, 8.8, 0.4); c.stroke();
      c.restore();
      return off;
    };

    const makeLeaf = (tone, sizePx = 56) => {
      const [off, c] = makeOffscreen(sizePx);
      const s = 18;
      c.save(); c.translate(sizePx * 0.5, sizePx * 0.48);
      c.fillStyle = tone;
      c.beginPath(); c.moveTo(0, -s); c.bezierCurveTo(s * 0.92, -s * 0.52, s * 0.76, s * 0.62, 0, s);
      c.bezierCurveTo(-s * 0.76, s * 0.62, -s * 0.92, -s * 0.52, 0, -s); c.fill();
      c.fillStyle = 'rgba(18,40,20,0.14)';
      c.beginPath(); c.moveTo(0, -s); c.bezierCurveTo(s * 0.92, -s * 0.52, s * 0.76, s * 0.62, 0, s); c.closePath(); c.fill();
      c.strokeStyle = 'rgba(255,252,220,0.45)'; c.lineWidth = 1.1;
      c.beginPath(); c.moveTo(0, -s * 0.85); c.quadraticCurveTo(s * 0.08, 0, 0, s * 1.28); c.stroke();
      c.lineWidth = 0.65; c.beginPath();
      for (let i = -2; i <= 2; i++) {
        const y = i * s * 0.3;
        c.moveTo(0, y); c.lineTo(s * 0.44, y - s * 0.25);
        c.moveTo(0, y); c.lineTo(-s * 0.44, y - s * 0.25);
      }
      c.stroke(); c.restore();
      return off;
    };

    const makeSoftDot = (rgbaStops, sizePx = 40) => {
      const [off, c] = makeOffscreen(sizePx);
      const r = sizePx * 0.5;
      const g = c.createRadialGradient(r, r, 0, r, r, r);
      for (const [stop, col] of rgbaStops) g.addColorStop(stop, col);
      c.fillStyle = g; c.beginPath(); c.arc(r, r, r, 0, TAU); c.fill();
      return off;
    };

    const makeCrystal = (rgb, sizePx = 48) => {
      const [off, c] = makeOffscreen(sizePx);
      const r = sizePx * 0.38;
      c.save(); c.translate(sizePx * 0.5, sizePx * 0.5);
      const g = c.createRadialGradient(0, 0, 0, 0, 0, sizePx * 0.48);
      g.addColorStop(0, `rgba(${rgb},0.35)`); g.addColorStop(1, `rgba(${rgb},0)`);
      c.fillStyle = g; c.beginPath(); c.arc(0, 0, sizePx * 0.48, 0, TAU); c.fill();
      c.strokeStyle = `rgba(${rgb},0.92)`; c.lineWidth = 1.45; c.lineCap = 'round';
      c.beginPath();
      for (let i = 0; i < 6; i++) {
        c.rotate(Math.PI / 3);
        c.moveTo(0, 0); c.lineTo(0, -r);
        c.moveTo(0, -r * 0.5); c.lineTo(r * 0.3, -r * 0.74);
        c.moveTo(0, -r * 0.5); c.lineTo(-r * 0.3, -r * 0.74);
        c.moveTo(0, -r * 0.78); c.lineTo(r * 0.16, -r * 0.92);
        c.moveTo(0, -r * 0.78); c.lineTo(-r * 0.16, -r * 0.92);
      }
      c.stroke(); c.restore();
      return off;
    };

    const makeSeed = (dark, sizePx = 44) => {
      const [off, c] = makeOffscreen(sizePx);
      const r = 12;
      c.save(); c.translate(sizePx * 0.5, sizePx * 0.42);
      c.strokeStyle = dark ? 'rgba(235,230,200,0.62)' : 'rgba(145,122,74,0.58)';
      c.lineWidth = 0.85; c.beginPath();
      c.moveTo(0, 0); c.lineTo(0, r * 1.45);
      for (let i = 0; i < 9; i++) {
        const a = -Math.PI / 2 + (i - 4) * 0.31;
        c.moveTo(0, 0); c.lineTo(Math.cos(a) * r, Math.sin(a) * r);
      }
      c.stroke();
      c.fillStyle = dark ? 'rgba(235,220,170,0.85)' : 'rgba(138,106,56,0.78)';
      c.beginPath(); c.ellipse(0, r * 1.55, 1.2, 2.4, 0, 0, TAU); c.fill();
      c.restore();
      return off;
    };

    const makeSun = (sizePx = 320) => {
      const [off, c] = makeOffscreen(sizePx);
      const cx = sizePx * 0.5, cy = sizePx * 0.5, r = 22;
      let g = c.createRadialGradient(cx, cy, 0, cx, cy, sizePx * 0.49);
      g.addColorStop(0, 'rgba(255,236,168,0.46)'); g.addColorStop(0.28, 'rgba(255,228,148,0.18)'); g.addColorStop(1, 'rgba(255,240,190,0)');
      c.fillStyle = g; c.beginPath(); c.arc(cx, cy, sizePx * 0.49, 0, TAU); c.fill();
      c.save(); c.translate(cx, cy);
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * TAU, len = sizePx * 0.47, w = 0.042;
        const rg = linGrad(c, 0, 0, Math.cos(a) * len, Math.sin(a) * len);
        rg.addColorStop(0, 'rgba(255,222,132,0.22)'); rg.addColorStop(1, 'rgba(255,222,132,0)');
        c.fillStyle = rg; c.beginPath(); c.moveTo(0, 0);
        c.lineTo(Math.cos(a - w) * len, Math.sin(a - w) * len);
        c.lineTo(Math.cos(a + w) * len, Math.sin(a + w) * len);
        c.closePath(); c.fill();
      }
      c.restore();
      g = c.createRadialGradient(cx, cy, r * 0.15, cx, cy, r * 1.45);
      g.addColorStop(0, '#fffff8');
      g.addColorStop(0.48, 'rgba(255,244,196,0.94)');
      g.addColorStop(0.78, 'rgba(255,224,136,0.42)');
      g.addColorStop(1, 'rgba(255,216,120,0)');
      c.fillStyle = g; c.beginPath(); c.arc(cx, cy, r * 1.45, 0, TAU); c.fill();
      return off;
    };

    const makeMoon = (sizePx = 260) => {
      const [off, c] = makeOffscreen(sizePx);
      const cx = sizePx * 0.5, cy = sizePx * 0.5, r = 20;
      let g = c.createRadialGradient(cx, cy, r * 0.75, cx, cy, sizePx * 0.48);
      g.addColorStop(0, 'rgba(214,228,255,0.26)'); g.addColorStop(0.36, 'rgba(168,192,236,0.08)'); g.addColorStop(1, 'rgba(150,175,220,0)');
      c.fillStyle = g; c.beginPath(); c.arc(cx, cy, sizePx * 0.48, 0, TAU); c.fill();
      g = c.createRadialGradient(cx - r * 0.35, cy - r * 0.35, r * 0.1, cx, cy, r);
      g.addColorStop(0, '#fffef6'); g.addColorStop(0.72, '#ede9d6'); g.addColorStop(1, '#c8c6b2');
      c.fillStyle = g; c.beginPath(); c.arc(cx, cy, r, 0, TAU); c.fill();
      c.save(); c.beginPath(); c.arc(cx, cy, r, 0, TAU); c.clip();
      for (const [a, b, s] of CRATERS) {
        const cg = c.createRadialGradient(cx + a * r, cy + b * r, 0, cx + a * r, cy + b * r, s * r);
        cg.addColorStop(0, 'rgba(148,146,124,0.14)'); cg.addColorStop(1, 'rgba(148,146,124,0.28)');
        c.fillStyle = cg; c.beginPath(); c.arc(cx + a * r, cy + b * r, s * r, 0, TAU); c.fill();
      }
      g = linGrad(c, cx - r, cy, cx + r, cy);
      g.addColorStop(0, 'rgba(14,24,44,0)'); g.addColorStop(0.65, 'rgba(14,24,44,0)'); g.addColorStop(1, 'rgba(14,24,44,0.34)');
      c.fillStyle = g; c.fillRect(cx - r, cy - r, r * 2, r * 2);
      c.restore();
      return off;
    };

    const bank = {
      lycoris: [makeLycoris(0), makeLycoris(1)],
      tepals: [makeTepal(0), makeTepal(1), makeTepal(2)],
      leaves: LEAVES.map(([front, back]) => [makeLeaf(front), makeLeaf(back)]),
      flakeLight: makeSoftDot([[0, 'rgba(250,252,255,0.95)'], [0.45, 'rgba(250,252,255,0.52)'], [1, 'rgba(250,252,255,0)']]),
      flakeDay: makeSoftDot([[0, 'rgba(120,150,168,0.92)'], [0.45, 'rgba(120,150,168,0.48)'], [1, 'rgba(120,150,168,0)']]),
      crystalLight: makeCrystal('248,252,255'),
      crystalDay: makeCrystal('112,146,166'),
      seedLight: makeSeed(true),
      seedDay: makeSeed(false),
      firefly: makeSoftDot([[0, 'rgba(255,240,160,0.95)'], [0.32, 'rgba(218,242,124,0.45)'], [1, 'rgba(218,242,124,0)']], 36),
      spark: makeSoftDot([[0, 'rgba(255,242,195,1)'], [0.35, 'rgba(255,205,112,0.58)'], [1, 'rgba(255,190,90,0)']], 32),
      lens: makeSoftDot([[0, 'rgba(255,228,154,0.45)'], [0.65, 'rgba(255,228,154,0.16)'], [1, 'rgba(255,228,154,0)']], 48),
      bokeh: BOKEH.map(([r, g, b]) => makeSoftDot([[0, `rgba(${r},${g},${b},0.35)`], [0.78, `rgba(${r},${g},${b},0.62)`], [1, `rgba(${r},${g},${b},0)`]], 84)),
      sun: makeSun(),
      moon: makeMoon()
    };
    if (typeof window !== 'undefined') window.AstraNatureSprites = bank;
    return bank;
  }

  function initNature() {
    if (document.getElementById('nature-atmosphere')) return;
    const select = document.getElementById('nature-mode');
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const root = document.documentElement;
    const nowClock = typeof performance !== 'undefined' && typeof performance.now === 'function'
      ? () => performance.now()
      : () => Date.now();

    const canvas = document.createElement('canvas');
    canvas.id = 'nature-atmosphere';
    canvas.className = 'nature-canvas';
    canvas.setAttribute('aria-hidden', 'true');
    canvas.setAttribute('tabindex', '-1');
    document.body.prepend(canvas);

    const ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) {
      canvas.remove();
      if (select) { select.value = 'off'; select.disabled = true; }
      return;
    }

    const sprites = createSpriteBank();
    const burstLimiter = createBurstLimiter({ maxActive: 16, cooldownMs: 260, maxPerBurst: 7 });
    const governor = createQualityGovernor();
    const lowPowerHw = (window.navigator?.hardwareConcurrency || 8) <= 4;

    let preferredMode = 'auto';
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (MODES.has(stored)) preferredMode = stored;
      if (localStorage.getItem('astra:atmosphere-version') !== '2') {
        if (preferredMode !== 'off') preferredMode = 'auto';
        localStorage.setItem(STORAGE_KEY, preferredMode);
        localStorage.setItem('astra:atmosphere-version', '2');
      }
    } catch (_) {}

    let theme = root.dataset.theme || 'forest';
    let mode = 'off', W = 1, H = 1;
    let particles = [], bursts = [], streaks = [], twinkles = [], bokeh = [], flies = [], ripples = [];
    let starfield = null;
    let frameId = 0, prev = null, t = 0, pageActive = true;
    let px = -9999, py = -9999, lastPX = null, pointerWind = 0, windNow = 0.16;
    let gust = 0, gustPeak = 0, gustLeft = 0, nextGust = random(5, 9), gustAttr = false;

    function minFrameIntervalMs() {
      return (W < 640 || lowPowerHw) ? 1000 / 31 : 1000 / 51;
    }

    function buildStarfield() {
      const pair = makeOffscreen(8);
      if (!pair) { starfield = null; return; }
      const sf = document.createElement('canvas');
      sf.width = Math.max(1, Math.round(W));
      sf.height = Math.max(1, Math.round(H * 0.72));
      const sc = sf.getContext('2d');
      const count = W < 640 ? 34 : 72;
      for (let i = 0; i < count; i++) {
        const sx = random(0, sf.width), sy = Math.pow(Math.random(), 1.5) * sf.height;
        const sr = random(0.45, 1.35), al = random(0.22, 0.72);
        sc.fillStyle = `rgba(228,236,255,${al.toFixed(2)})`;
        sc.beginPath(); sc.arc(sx, sy, sr, 0, TAU); sc.fill();
      }
      starfield = sf;
    }

    function makeParticle(initial, index = 0, forceKind = null) {
      const depth = random(0.45, 1.0);
      const p = {
        z: depth,
        phase: random(0, TAU),
        rot: random(0, TAU),
        spin: random(-1.05, 1.05),
        flip: random(1.4, 3.0),
        kind: 'leaf',
        variant: index % 6,
        size: 10,
        x: initial ? random(-40, W + 20) : random(-140, -24),
        y: initial ? random(88, H) : random(76, H * 0.88)
      };
      switch (mode) {
        case 'wind':
          p.kind = 'leaf';
          p.size = 12 + depth * 10;
          p.variant = index % LEAVES.length;
          break;
        case 'lycoris':
          p.kind = forceKind || (index === 0 ? 'lily' : 'petal');
          if (p.kind === 'lily') {
            // Sprite includes aura padding; 54-68px box renders a crisp ~28-36px botanical umbel
            p.size = W < 640 ? random(44, 52) : random(54, 68);
            p.variant = index % 2;
            p.spin = random(-0.28, 0.28);
            p.z = random(0.76, 0.98);
          } else {
            p.size = W < 640 ? random(13, 17) : random(15, 21);
            p.variant = index % 3;
          }
          break;
        case 'snow':
          p.kind = index % 5 === 0 ? 'crystal' : 'flake';
          p.size = p.kind === 'crystal' ? random(9, 14) : random(4, 9);
          p.x = initial ? random(-20, W + 20) : random(-60, W);
          p.y = initial ? random(-H * 0.08, H) : random(-32, -8);
          break;
        case 'rain':
          p.kind = 'drop';
          p.size = random(12, 24);
          p.x = random(-30, W + 60);
          p.y = initial ? random(-H, H) : random(-70, -16);
          break;
        case 'sun':
          p.kind = 'seed';
          p.size = random(11, 17);
          p.x = random(0, W);
          p.y = initial ? random(90, H) : H + random(8, 45);
          break;
      }
      return p;
    }

    function seedParticles() {
      const budget = computeParticleBudget(mode, W, governor.scale);
      particles = Array.from({ length: budget.total }, (_, i) =>
        makeParticle(true, i, mode === 'lycoris' ? (i < budget.lilies ? 'lily' : 'petal') : null)
      );
      bursts = []; streaks = []; ripples = [];
      twinkles = Array.from({ length: W < 640 ? 4 : 8 }, () => ({
        x: random(20, W - 20), y: random(14, H * 0.55), r: random(0.9, 1.6), ph: random(0, TAU), sp: random(0.8, 1.8)
      }));
      bokeh = Array.from({ length: W < 640 ? 4 : 6 }, (_, i) => ({
        x: random(0, W), y: random(60, H), r: random(34, 68), v: i % BOKEH.length,
        ph: random(0, TAU), sp: random(0.35, 0.75), vx: random(-3, 3), vy: random(-5, -1.5)
      }));
      flies = Array.from({ length: W < 640 ? 2 : 4 }, () => ({
        x: random(0, W), y: random(H * 0.35, H), ph: random(0, TAU), sp: random(0.45, 0.9)
      }));
      if (mode === 'lycoris' || mode === 'snow') buildStarfield();
    }

    function resize() {
      W = Math.max(1, document.documentElement.clientWidth || window.innerWidth);
      H = Math.max(1, window.innerHeight);
      const ratio = Math.min(window.devicePixelRatio || 1, 1.5);
      canvas.width = Math.round(W * ratio);
      canvas.height = Math.round(H * ratio);
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      seedParticles();
    }

    /* ---------- wind (state-driven DOM flag, zero per-frame style recalc) ---------- */
    function setGustDom(active) {
      if (gustAttr === active) return;
      gustAttr = active;
      document.body.dataset.gust = active ? 'true' : 'false';
    }
    function triggerGust(strength = 1.15, duration = 3.0) {
      gustPeak = Math.max(gustPeak * (gustLeft > 0 ? 1 : 0), strength);
      gustLeft = Math.max(gustLeft, duration);
      nextGust = random(10, 18);
      setGustDom(true);
    }
    function updateWind(dt) {
      nextGust -= dt;
      if (nextGust <= 0) triggerGust(random(0.6, 1.05), random(2.2, 3.6));
      if (gustLeft > 0) gustLeft = Math.max(0, gustLeft - dt);
      const target = gustLeft > 0 ? gustPeak : 0;
      gust += (target - gust) * Math.min(1, dt * (target > gust ? 1.6 : 0.65));
      pointerWind *= Math.exp(-dt * 2.0);
      windNow = 0.16 + gust + pointerWind;
      setGustDom(gust > 0.22);
      if ((mode === 'wind' || mode === 'lycoris' || mode === 'sun') && streaks.length < 3 && Math.random() < gust * dt * 2.4) {
        streaks.push({
          x: random(-220, W * 0.5), y: random(Math.max(100, H * 0.14), H * 0.9),
          len: random(130, 250), life: 0, dur: random(0.9, 1.5), amp: random(4, 11), sp: random(300, 480), ph: random(0, TAU)
        });
      }
    }

    /* ---------- physics (strictly in seconds, FPS-independent) ---------- */
    function stepParticle(p, dt, idx) {
      const dx = p.x - px, dy = p.y - py, distSq = dx * dx + dy * dy;
      if (distSq < 19600 && distSq > 0.2) {
        const d = Math.sqrt(distSq), f = (1 - d / 140) * 105 * dt;
        p.x += (dx / d) * f; p.y += (dy / d) * f; p.rot += f * 0.016;
      }
      const w = windNow, k = p.kind;
      if (k === 'flake' || k === 'crystal') {
        p.x += (Math.sin(t * 0.6 + p.phase) * 15 + w * 78) * p.z * dt;
        p.y += (24 + p.size * 2.4 - gust * 4) * p.z * dt;
        p.rot += p.spin * 0.45 * dt;
        if (p.y > H + 18 || p.x > W + 45) Object.assign(p, makeParticle(false, idx));
      } else if (k === 'drop') {
        p.x += (-24 + w * 62) * dt;
        p.y += (470 + p.size * 6) * p.z * dt;
        if (p.y > H + 12) {
          if (ripples.length < 5) ripples.push({ x: clamp(p.x, 0, W), y: H - random(6, 28), age: 0 });
          Object.assign(p, makeParticle(false, idx));
        }
      } else if (k === 'seed') {
        p.x += (Math.sin(t * 0.45 + p.phase) * 11 + w * 64) * p.z * dt;
        p.y -= (9 + Math.cos(t * 0.7 + p.phase) * 6 + gust * 12) * p.z * dt;
        p.rot = Math.sin(t * 0.85 + p.phase) * 0.45;
        if (p.y < -28 || p.x > W + 36) Object.assign(p, makeParticle(false, idx));
      } else {
        const lift = Math.sin(t * 1.15 + p.phase);
        const heavy = k === 'lily' ? 0.72 : 1;
        p.x += ((15 + w * 185) * p.z * heavy + Math.sin(t * 0.75 + p.phase) * 10) * dt;
        p.y += ((k === 'lily' ? 12 : 10) * p.z + lift * 12 - gust * 26 * Math.max(0, lift)) * dt;
        p.rot += p.spin * (0.28 + w * 1.25) * (k === 'lily' ? 0.55 : 1) * dt;
        if (p.x > W + 85 || p.y > H + 70 || p.y < -90) {
          Object.assign(p, makeParticle(false, idx, k));
        }
      }
    }

    /* ---------- fast sprite blitting ---------- */
    function drawParticle(p) {
      if (!sprites) return;
      const dark = theme !== 'forest';
      const s = p.size;
      switch (p.kind) {
        case 'lily': {
          const img = sprites.lycoris[p.variant % sprites.lycoris.length];
          ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot);
          ctx.drawImage(img, -s * 0.5, -s * 0.5, s, s);
          ctx.restore();
          break;
        }
        case 'petal': {
          const img = sprites.tepals[p.variant % sprites.tepals.length];
          const flip = Math.cos(t * p.flip + p.phase);
          ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot);
          ctx.scale(1, Math.max(0.24, Math.abs(flip)));
          ctx.drawImage(img, -s * 0.5, -s * 0.5, s, s);
          ctx.restore();
          break;
        }
        case 'leaf': {
          const pair = sprites.leaves[p.variant % sprites.leaves.length];
          const flip = Math.cos(t * p.flip + p.phase);
          ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot);
          ctx.scale(Math.max(0.18, Math.abs(flip)), 1);
          ctx.drawImage(flip < 0 ? pair[1] : pair[0], -s * 0.5, -s * 0.5, s, s);
          ctx.restore();
          break;
        }
        case 'flake': {
          const img = dark ? sprites.flakeLight : sprites.flakeDay;
          ctx.drawImage(img, p.x - s * 0.5, p.y - s * 0.5, s, s);
          break;
        }
        case 'crystal': {
          const img = dark ? sprites.crystalLight : sprites.crystalDay;
          ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot);
          ctx.drawImage(img, -s * 0.5, -s * 0.5, s, s);
          ctx.restore();
          break;
        }
        case 'seed': {
          const img = dark ? sprites.seedLight : sprites.seedDay;
          ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot);
          ctx.drawImage(img, -s * 0.5, -s * 0.5, s, s);
          ctx.restore();
          break;
        }
        case 'drop': {
          ctx.strokeStyle = dark ? 'rgba(190,225,230,0.42)' : 'rgba(70,110,110,0.3)';
          ctx.lineWidth = 1;
          ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - 2 + windNow * 3, p.y + s); ctx.stroke();
          break;
        }
        case 'spark': {
          ctx.drawImage(sprites.spark, p.x - s * 0.5, p.y - s * 0.5, s, s);
          break;
        }
      }
    }

    /* ---------- sky layers ---------- */
    function celestialPoint() {
      return [W - Math.min(118, Math.max(58, W * 0.075)), W < 640 ? 142 : 94];
    }
    function drawSun() {
      if (!sprites) return;
      const [x, y] = celestialPoint();
      const box = W < 640 ? 220 : 320;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(t * 0.018);
      ctx.drawImage(sprites.sun, -box * 0.5, -box * 0.5, box, box);
      ctx.restore();
      if (px > -999 && governor.scale > 0.7) {
        for (const [k, rr, al] of [[0.32, 26, 0.24], [0.64, 16, 0.28], [0.92, 42, 0.16]]) {
          const fx = x + (px - x) * k, fy = y + (py - y) * k;
          ctx.globalAlpha = al;
          ctx.drawImage(sprites.lens, fx - rr, fy - rr, rr * 2, rr * 2);
        }
        ctx.globalAlpha = 1;
      }
    }
    function drawMoon() {
      if (!sprites) return;
      const [x, y] = celestialPoint();
      const box = W < 640 ? 190 : 270;
      ctx.drawImage(sprites.moon, x - box * 0.5, y - box * 0.5, box, box);
    }
    function drawStars() {
      if (starfield) ctx.drawImage(starfield, 0, 0);
      for (const s of twinkles) {
        const a = 0.25 + 0.6 * (0.5 + 0.5 * Math.sin(t * s.sp + s.ph));
        ctx.fillStyle = `rgba(236,242,255,${a.toFixed(2)})`;
        ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, TAU); ctx.fill();
      }
    }
    function drawFireflies(dt) {
      if (!sprites) return;
      for (const f of flies) {
        f.x += (Math.cos(t * f.sp + f.ph) * 15 + windNow * 24) * dt;
        f.y += Math.sin(t * f.sp * 1.2 + f.ph) * 11 * dt;
        if (f.x > W + 20) f.x = -20; else if (f.x < -20) f.x = W + 20;
        const a = Math.max(0, Math.sin(t * 1.5 + f.ph)) * 0.78;
        if (a > 0.03) {
          ctx.globalAlpha = a;
          ctx.drawImage(sprites.firefly, f.x - 10, f.y - 10, 20, 20);
        }
      }
      ctx.globalAlpha = 1;
    }
    function drawBokeh(dt) {
      if (!sprites) return;
      for (const b of bokeh) {
        b.x += (b.vx + windNow * 7) * dt;
        b.y += b.vy * dt;
        if (b.y < -b.r) { b.y = H + b.r; b.x = random(0, W); }
        if (b.x > W + b.r) b.x = -b.r;
        ctx.globalAlpha = 0.14 + 0.08 * Math.sin(t * b.sp + b.ph);
        ctx.drawImage(sprites.bokeh[b.v], b.x - b.r, b.y - b.r, b.r * 2, b.r * 2);
      }
      ctx.globalAlpha = 1;
    }
    function drawStreaks(dt) {
      if (!streaks.length) return;
      const rgb = theme === 'forest' ? '74,116,72' : theme === 'dark' ? '226,145,150' : '225,234,218';
      let write = 0;
      for (let i = 0; i < streaks.length; i++) {
        const s = streaks[i];
        s.life += dt;
        if (s.life >= s.dur) continue;
        streaks[write++] = s;
        s.x += s.sp * dt;
        const alpha = Math.sin((s.life / s.dur) * Math.PI) * (theme === 'forest' ? 0.24 : 0.16);
        ctx.strokeStyle = `rgba(${rgb},${alpha.toFixed(3)})`;
        ctx.lineWidth = 1;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(s.x, s.y);
        ctx.bezierCurveTo(
          s.x + s.len * 0.35, s.y - s.amp,
          s.x + s.len * 0.7, s.y + s.amp * 0.85,
          s.x + s.len, s.y - s.amp * 0.25
        );
        ctx.stroke();
      }
      streaks.length = write;
    }
    function drawRipples(dt) {
      let write = 0;
      for (let i = 0; i < ripples.length; i++) {
        const p = ripples[i];
        p.age += dt;
        if (p.age >= 1.1) continue;
        ripples[write++] = p;
        const r = 2 + p.age * 15;
        ctx.strokeStyle = `rgba(115,154,148,${(0.15 * (1 - p.age / 1.1)).toFixed(3)})`;
        ctx.lineWidth = 0.7;
        ctx.beginPath(); ctx.ellipse(p.x, p.y, r, r * 0.24, 0, 0, TAU); ctx.stroke();
      }
      ripples.length = write;
    }
    function drawSky(dt) {
      if (mode === 'wind') { if (theme === 'forest') drawSun(); drawStreaks(dt); }
      else if (mode === 'sun') { if (theme === 'forest') drawSun(); else drawMoon(); drawStreaks(dt); }
      else if (mode === 'lycoris') { drawStars(); drawMoon(); drawFireflies(dt); drawStreaks(dt); }
      else if (mode === 'snow') { if (theme !== 'forest') { drawStars(); drawBokeh(dt); } }
      else if (mode === 'rain') drawRipples(dt);
    }

    /* ---------- rate-limited & capped bursts ---------- */
    function burst(x, y, count = 6) {
      if (mode === 'off') return;
      const allowed = burstLimiter.allow(nowClock(), bursts.length, count);
      if (allowed <= 0) return;
      for (let i = 0; i < allowed; i++) {
        const a = random(0, TAU), sp = random(75, 220);
        const kind = mode === 'wind' ? 'leaf'
          : mode === 'lycoris' ? (i === 0 && allowed >= 5 ? 'lily' : 'petal')
          : mode === 'snow' ? (i % 3 ? 'flake' : 'crystal')
          : mode === 'sun' ? 'seed' : 'spark';
        bursts.push({
          kind,
          variant: i % 6,
          x, y,
          vx: Math.cos(a) * sp,
          vy: Math.sin(a) * sp - 95,
          life: 1,
          decay: random(0.75, 1.15),
          size: kind === 'lily' ? 34 : kind === 'petal' ? random(12, 16) : kind === 'leaf' ? random(12, 17) : kind === 'seed' ? 13 : kind === 'crystal' ? 11 : 8,
          rot: random(0, TAU),
          spin: random(-4.5, 4.5),
          flip: random(2.5, 5.5),
          phase: random(0, TAU)
        });
      }
    }
    function drawBursts(dt) {
      let write = 0;
      for (let i = 0; i < bursts.length; i++) {
        const b = bursts[i];
        b.life -= dt * b.decay;
        if (b.life <= 0) continue;
        bursts[write++] = b;
        b.vx *= Math.exp(-dt * 2.4);
        b.vy = b.vy * Math.exp(-dt * 1.7) + (b.kind === 'seed' ? -48 : 165) * dt;
        b.x += (b.vx + windNow * 55) * dt;
        b.y += b.vy * dt;
        b.rot += b.spin * dt;
        const headerSafe = clamp((b.y - 68) / 36, 0.15, 1);
        ctx.globalAlpha = clamp(b.life * 1.2, 0, 0.9) * headerSafe;
        drawParticle(b);
      }
      bursts.length = write;
      ctx.globalAlpha = 1;
    }

    /* ---------- loop ---------- */
    function updateTitle() {
      if (!select) return;
      const tr = window.AstraI18n?.t;
      select.title = reducedMotion.matches
        ? (tr ? tr('nature.reducedMotion') : 'Анимации отключены настройкой уменьшения движения в системе.')
        : (tr ? tr('nature.description') : 'Декоративный фон по теме; не фактическая погода.');
      select.setAttribute('aria-description', tr ? tr('nature.description') : 'Декоративный фон по теме; не фактическая погода.');
    }
    function stop() {
      if (frameId) cancelAnimationFrame(frameId);
      frameId = 0; prev = null;
      setGustDom(false);
    }
    function canAnimate() { return mode !== 'off' && !document.hidden && pageActive; }

    function frame(time) {
      frameId = 0;
      if (!canAnimate()) return;
      if (prev !== null && time - prev < minFrameIntervalMs()) {
        frameId = requestAnimationFrame(frame);
        return;
      }
      const drawStart = nowClock();
      const realDt = prev === null ? 0 : Math.max(0, (time - prev) / 1000);
      const dt = Math.min(realDt, 0.06);
      prev = time;
      t += dt;

      updateWind(dt);
      ctx.clearRect(0, 0, W, H);
      drawSky(dt);

      for (let i = 0; i < particles.length; i++) {
        const p = particles[i];
        stepParticle(p, dt, i);
        // Keep transparent topbar text crisp and undisturbed
        const topSafe = clamp((p.y - 64) / 42, 0.12, 1);
        const baseAlpha = p.kind === 'lily' ? 0.86 : p.kind === 'petal' ? 0.82 : p.kind === 'leaf' ? 0.76 : 0.84;
        ctx.globalAlpha = baseAlpha * (0.45 + 0.55 * p.z) * topSafe;
        drawParticle(p);
      }
      ctx.globalAlpha = 1;
      drawBursts(dt);

      const drawMs = nowClock() - drawStart;
      if (governor.sample(drawMs, dt)) {
        const budget = computeParticleBudget(mode, W, governor.scale);
        if (particles.length > budget.total) particles.length = budget.total;
        else while (particles.length < budget.total) particles.push(makeParticle(true, particles.length));
      }

      frameId = requestAnimationFrame(frame);
    }

    function start() {
      if (!frameId && canAnimate()) {
        prev = null;
        frameId = requestAnimationFrame(frame);
      }
    }

    function applyMode() {
      stop();
      governor.reset();
      burstLimiter.reset();
      mode = resolveAtmosphere(preferredMode, theme, reducedMotion.matches);
      canvas.hidden = mode === 'off';
      document.body.dataset.natureMode = mode;
      document.body.dataset.naturePreference = preferredMode;
      if (select) {
        select.value = reducedMotion.matches ? 'off' : preferredMode;
        select.disabled = reducedMotion.matches;
        updateTitle();
      }
      ctx.clearRect(0, 0, W, H);
      seedParticles();
      start();
    }

    if (typeof window !== 'undefined') {
      window.__astraNatureStats = () => ({
        mode,
        theme,
        particles: particles.length,
        lilies: particles.filter(p => p.kind === 'lily').length,
        bursts: bursts.length,
        maxBursts: burstLimiter.maxActive,
        qualityScale: governor.scale,
        targetFps: Math.round(1000 / minFrameIntervalMs()),
        running: Boolean(frameId)
      });
    }

    select?.addEventListener('change', () => {
      preferredMode = MODES.has(select.value) ? select.value : 'off';
      try { localStorage.setItem(STORAGE_KEY, preferredMode); } catch (_) {}
      applyMode();
    });
    window.addEventListener('pointermove', e => {
      if (!canAnimate() || e.pointerType === 'touch') return;
      if (lastPX !== null) pointerWind = clamp(pointerWind + (e.clientX - lastPX) * 0.003, -0.4, 0.7);
      px = e.clientX; py = e.clientY; lastPX = e.clientX;
    }, { passive: true });
    document.addEventListener('pointerleave', () => { px = py = -9999; lastPX = null; }, { passive: true });
    document.addEventListener('astra:gust', e => { if (canAnimate()) triggerGust(e.detail?.strength || 1.25, e.detail?.duration || 3.2); });
    document.addEventListener('astra:burst', e => { if (canAnimate() && e.detail) burst(e.detail.x, e.detail.y, e.detail.count); });
    window.addEventListener('resize', resize, { passive: true });
    document.addEventListener('visibilitychange', () => { if (document.hidden) stop(); else start(); });
    window.addEventListener('pagehide', () => { pageActive = false; stop(); });
    window.addEventListener('pageshow', () => { pageActive = true; start(); });
    document.addEventListener('astra:themechange', () => {
      const next = root.dataset.theme || 'forest';
      theme = next;
      applyMode();
    });
    document.addEventListener('astra:languagechange', updateTitle);
    reducedMotion.addEventListener('change', () => applyMode());
    resize();
    applyMode();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initNature, { once: true });
  else initNature();
})();
