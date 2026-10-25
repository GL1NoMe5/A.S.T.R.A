/* Local illustration motion. The scene never represents live weather, covers text, or changes data. */
(() => {
  'use strict';
  const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
  function motionState({ reduced, off, paused, hidden, visible }) {
    return reduced ? 'reduced' : off ? 'off' : paused ? 'paused' : hidden ? 'hidden' : !visible ? 'offscreen' : 'running';
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = { motionState };
  if (typeof document === 'undefined') return;

  function init() {
    const hero = document.querySelector('.atlas-hero');
    const canvas = document.getElementById('atlas-atmosphere');
    if (!hero || !canvas || hero.dataset.motionReady === 'true') return;
    const ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) { hero.dataset.scenePaused = 'true'; return; }
    hero.dataset.motionReady = 'true';
    canvas.setAttribute('aria-hidden', 'true');

    const breeze = document.getElementById('atlas-breeze');
    const pause = document.getElementById('atlas-pause');
    const mapLink = document.getElementById('atlas-map-link');
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    const disposers = [];

    let width = 1, height = 1, heroLeft = 0, heroTop = 0;
    let particles = [], glows = [], heroBursts = [], raf = 0, previous = null;
    let elapsed = 0, gustRemaining = 0, wind = 0, manualPause = false, pageActive = true;
    let inView = true, targetX = 0, targetY = 0, x = 0, y = 0, appliedX = 0, appliedY = 0;
    let lastBurstAt = -1e9;
    let theme = document.documentElement.dataset.theme || 'forest';
    const random = (min, max) => min + Math.random() * (max - min);
    const TAU = Math.PI * 2;

    function on(target, event, callback, options) {
      target?.addEventListener(event, callback, options);
      disposers.push(() => target?.removeEventListener(event, callback, options));
    }
    function currentState() {
      return motionState({
        reduced: reduced.matches,
        off: document.body.dataset.natureMode === 'off',
        paused: manualPause,
        hidden: document.hidden || !pageActive,
        visible: inView
      });
    }
    function resetPointer() {
      targetX = targetY = x = y = appliedX = appliedY = 0;
      hero.style.setProperty('--atlas-x', '0px');
      hero.style.setProperty('--atlas-y', '0px');
    }

    function spawnX(initial) {
      const mobile = width <= 540;
      if (mobile) return initial ? random(10, width - 10) : random(-30, width * 0.65);
      // Spawn in the right-hand illustrated vista so the left heading column stays clear
      return initial ? random(width * 0.38, width * 0.98) : random(width * 0.33, width * 0.44);
    }
    function spawnY(initial, snow) {
      const mobile = width <= 540;
      if (mobile) return initial ? random(height * 0.52, height * 0.96) : random(height * 0.50, height * 0.88);
      if (snow) return initial ? random(0, height) : random(-28, -6);
      return initial ? random(height * 0.14, height * 0.86) : random(height * 0.16, height * 0.84);
    }

    function makeParticle(initial = false, index = 0) {
      const mobile = width < 640;
      const night = theme === 'dark', snow = theme === 'christmas';
      let kind = 'mote', size = random(1.2, 2.2);
      if (snow) {
        kind = index % 4 === 0 ? 'crystal' : 'flake';
        size = kind === 'crystal' ? random(9, 13) : random(4, 8);
      } else if (night) {
        const lilySlots = mobile ? 1 : 2;
        if (index < lilySlots) {
          kind = 'lily';
          size = mobile ? 48 : (index === 0 ? 68 : 56);
        } else if (index < (mobile ? 5 : 9)) {
          kind = 'petal';
          size = random(15, 21);
        } else {
          kind = 'firefly';
          size = random(14, 20);
        }
      } else {
        if (index < (mobile ? 3 : 5)) {
          kind = 'leaf';
          size = random(12, 18);
        } else {
          kind = 'mote';
          size = random(1.3, 2.4);
        }
      }
      return {
        x: snow && !initial && width > 540 ? random(width * 0.36, width) : spawnX(initial),
        y: spawnY(initial, snow),
        size,
        depth: kind === 'lily' ? random(0.76, 0.98) : random(0.42, 0.98),
        speed: random(10, 22),
        phase: random(0, TAU),
        rotation: kind === 'lily' ? random(-0.35, 0.35) : random(0, TAU),
        spin: kind === 'lily' ? random(-0.22, 0.22) : random(-0.9, 0.9),
        flip: random(1.4, 2.8),
        kind,
        index
      };
    }

    function seed() {
      const mobile = width < 640;
      const count = mobile ? 8 : 14;
      particles = Array.from({ length: count }, (_, i) => makeParticle(true, i));
      heroBursts = [];
      glows = Array.from({ length: mobile ? 2 : 4 }, (_, i) => ({
        x: random(width * 0.45, width * 0.96),
        y: random(height * 0.15, height * 0.9),
        r: random(24, 52),
        sp: random(0.4, 0.85),
        ph: random(0, TAU),
        v: i % 5
      }));
    }

    function resize() {
      const box = hero.getBoundingClientRect();
      width = Math.max(1, box.width);
      height = Math.max(1, box.height);
      heroLeft = box.left;
      heroTop = box.top;
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      seed();
      inView = box.bottom > 0 && box.top < window.innerHeight && box.width > 0 && box.height > 0;
      sync();
    }

    function sync() {
      const state = currentState(), active = state === 'running';
      hero.dataset.motionState = state;
      hero.dataset.motionRunning = String(active);
      hero.dataset.scenePaused = String(!active);
      hero.dataset.gust = String(active && gustRemaining > 0);
      pause?.setAttribute('aria-pressed', String(manualPause));
      breeze?.setAttribute('aria-pressed', String(active && gustRemaining > 0));
      if (breeze) breeze.disabled = !active;
      if (pause) pause.disabled = state === 'reduced' || state === 'off';
      if (!active) {
        if (raf) cancelAnimationFrame(raf);
        raf = 0; previous = null; resetPointer();
        if (state === 'off' || state === 'reduced') ctx.clearRect(0, 0, width, height);
      } else if (!raf) {
        previous = null;
        raf = requestAnimationFrame(frame);
      }
    }

    function themeChanged() {
      const next = document.documentElement.dataset.theme || 'forest';
      if (theme !== next) {
        theme = next; elapsed = 0; gustRemaining = 0; wind = 0; seed();
        ctx.clearRect(0, 0, width, height);
      }
      sync();
    }

    function textZoneMask(px, py) {
      if (width <= 540) return clamp((py / height - 0.50) / 0.12, 0, 1);
      return clamp((px / width - 0.39) / 0.13, 0, 1);
    }

    function drawSpriteOrFallback(p, sprites) {
      const s = p.size;
      if (sprites) {
        if (p.kind === 'lily') {
          const img = sprites.lycoris[p.index % sprites.lycoris.length];
          ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rotation);
          ctx.drawImage(img, -s * 0.5, -s * 0.5, s, s);
          ctx.restore();
          return;
        }
        if (p.kind === 'petal') {
          const img = sprites.tepals[p.index % sprites.tepals.length];
          const flip = Math.cos(elapsed * p.flip + p.phase);
          ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rotation);
          ctx.scale(1, Math.max(0.24, Math.abs(flip)));
          ctx.drawImage(img, -s * 0.5, -s * 0.5, s, s);
          ctx.restore();
          return;
        }
        if (p.kind === 'leaf') {
          const pair = sprites.leaves[p.index % sprites.leaves.length];
          const flip = Math.cos(elapsed * p.flip + p.phase);
          ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rotation);
          ctx.scale(Math.max(0.2, Math.abs(flip)), 1);
          ctx.drawImage(flip < 0 ? pair[1] : pair[0], -s * 0.5, -s * 0.5, s, s);
          ctx.restore();
          return;
        }
        if (p.kind === 'crystal') {
          ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rotation);
          ctx.drawImage(sprites.crystalLight, -s * 0.5, -s * 0.5, s, s);
          ctx.restore();
          return;
        }
        if (p.kind === 'flake') {
          ctx.drawImage(sprites.flakeLight, p.x - s * 0.5, p.y - s * 0.5, s, s);
          return;
        }
        if (p.kind === 'firefly') {
          ctx.drawImage(sprites.firefly, p.x - s * 0.5, p.y - s * 0.5, s, s);
          return;
        }
      }
      ctx.fillStyle = theme === 'christmas' ? '#fffdf0' : theme === 'dark' ? '#f2444e' : '#fff3b3';
      ctx.beginPath();
      ctx.arc(p.x, p.y, Math.max(1.2, Math.min(3, s * 0.3)), 0, TAU);
      ctx.fill();
    }

    function drawParticles(dt, sprites) {
      const snow = theme === 'christmas';
      for (let i = 0; i < particles.length; i++) {
        const p = particles[i];
        const heavy = p.kind === 'lily' ? 0.68 : 1;
        const drift = (14 + wind * 68 + Math.sin(elapsed * 0.45 + p.phase) * 7) * p.depth * heavy;
        p.x += drift * dt;
        p.y += (snow
          ? p.speed + Math.sin(elapsed + p.phase) * 3
          : Math.sin(elapsed * 0.72 + p.phase) * (p.kind === 'lily' ? 6 : 8) + wind * 3.5) * dt;
        p.rotation += (p.spin * 0.35 + wind * (p.kind === 'lily' ? 0.25 : 0.7)) * dt;

        if (p.x > width + 55 || p.y > height + 40 || p.y < -60) {
          Object.assign(p, makeParticle(false, p.index));
        }

        const fade = textZoneMask(p.x, p.y);
        if (fade <= 0.01) continue;
        const edgeIn = width > 540 ? clamp((p.x - width * 0.34) / (width * 0.08), 0, 1) : 1;
        const flicker = p.kind === 'firefly' || p.kind === 'mote'
          ? 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(elapsed * 1.5 + p.phase))
          : 1;
        const base = p.kind === 'lily' ? 0.92 : p.kind === 'petal' ? 0.86 : p.kind === 'leaf' ? 0.76 : 0.72;
        ctx.globalAlpha = fade * edgeIn * flicker * base;
        drawSpriteOrFallback(p, sprites);
      }
      ctx.globalAlpha = 1;
    }

    function drawHeroBursts(dt, sprites) {
      if (!heroBursts.length) return;
      let write = 0;
      for (let i = 0; i < heroBursts.length; i++) {
        const b = heroBursts[i];
        b.life -= dt * 0.95;
        if (b.life <= 0) continue;
        heroBursts[write++] = b;
        b.vx *= Math.exp(-dt * 2.4);
        b.vy = b.vy * Math.exp(-dt * 1.8) + 125 * dt;
        b.x += (b.vx + wind * 48) * dt;
        b.y += b.vy * dt;
        b.rotation += b.spin * dt;
        const fade = textZoneMask(b.x, b.y);
        if (fade <= 0.02) continue;
        ctx.globalAlpha = clamp(b.life * 1.15, 0, 0.92) * fade;
        drawSpriteOrFallback(b, sprites);
      }
      heroBursts.length = write;
      ctx.globalAlpha = 1;
    }

    function drawGlows(dt, sprites) {
      if (theme === 'forest' || !sprites) return;
      for (let i = 0; i < glows.length; i++) {
        const g = glows[i];
        g.y -= (6 + wind * 10) * dt;
        if (g.y < -g.r) { g.y = height + g.r; g.x = random(width * 0.45, width * 0.96); }
        const fade = textZoneMask(g.x, g.y);
        if (fade <= 0.02) continue;
        const a = (0.1 + 0.06 * Math.sin(elapsed * g.sp + g.ph)) * (theme === 'dark' ? 0.65 : 1) * fade;
        ctx.globalAlpha = a;
        ctx.drawImage(sprites.bokeh[g.v], g.x - g.r, g.y - g.r, g.r * 2, g.r * 2);
      }
      ctx.globalAlpha = 1;
    }

    function drawBirds() {
      if (theme !== 'forest' || width < 550) return;
      const cycle = elapsed % 38;
      if (cycle > 19) return;
      const progress = cycle / 19;
      ctx.strokeStyle = '#304d3d';
      ctx.lineWidth = 1.2;
      ctx.lineCap = 'round';
      for (let i = 0; i < 3; i++) {
        const bx = width * (1.02 - progress * 0.62) + i * 18;
        const by = height * (0.24 + 0.03 * Math.sin(progress * 4)) + i * 7;
        const fade = textZoneMask(bx, by);
        if (fade <= 0.02) continue;
        const wing = 2 + Math.sin(elapsed * 5.6 + i * 0.7) * 2.4;
        ctx.globalAlpha = Math.sin(progress * Math.PI) * 0.4 * fade;
        ctx.beginPath();
        ctx.moveTo(bx - 5, by - wing); ctx.quadraticCurveTo(bx - 2, by - 2, bx, by);
        ctx.quadraticCurveTo(bx + 2, by - 2, bx + 5, by - wing); ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }

    function drawAir() {
      const strength = Math.max(0, wind - 0.14);
      if (strength < 0.02) return;
      ctx.strokeStyle = theme === 'forest' ? '#eff5d0' : theme === 'dark' ? '#f0a6ab' : '#c4dace';
      ctx.lineWidth = 1;
      for (let i = 0; i < 2; i++) {
        const bx = width * 0.4 + ((elapsed * (58 + i * 10) + i * width * 0.28) % (width * 0.65));
        const by = height * (0.38 + i * 0.22);
        const fade = textZoneMask(bx, by);
        if (fade <= 0.02) continue;
        ctx.globalAlpha = strength * 0.18 * fade;
        ctx.beginPath();
        ctx.moveTo(bx, by);
        ctx.bezierCurveTo(bx + 44, by - 14, bx + 86, by + 11, bx + 140, by - 4);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }

    function frame(now) {
      raf = 0;
      if (currentState() !== 'running') { sync(); return; }
      const minInterval = width < 640 ? 1000 / 31 : 1000 / 46;
      if (previous !== null && now - previous < minInterval) { raf = requestAnimationFrame(frame); return; }
      const dt = previous === null ? 0 : clamp((now - previous) / 1000, 0, 0.08);
      previous = now;
      elapsed += dt;

      const wasGusting = gustRemaining > 0;
      gustRemaining = Math.max(0, gustRemaining - dt);
      const natural = Math.pow(Math.max(0, Math.sin(elapsed * 0.24)), 5) * 0.2;
      const targetWind = gustRemaining > 0 ? Math.sin(Math.min(1, gustRemaining / 1.5) * Math.PI / 2) : natural;
      wind += (targetWind - wind) * Math.min(1, dt * 3);

      x += (targetX - x) * Math.min(1, dt * 3.2);
      y += (targetY - y) * Math.min(1, dt * 3.2);
      if (Math.abs(x - appliedX) > 0.08 || Math.abs(y - appliedY) > 0.08) {
        appliedX = x; appliedY = y;
        hero.style.setProperty('--atlas-x', `${x.toFixed(2)}px`);
        hero.style.setProperty('--atlas-y', `${y.toFixed(2)}px`);
      }

      const isGusting = gustRemaining > 0;
      if (wasGusting !== isGusting) {
        hero.dataset.gusting = String(isGusting);
        hero.dataset.gust = String(isGusting);
        if (!isGusting) breeze?.setAttribute('aria-pressed', 'false');
      }

      const sprites = window.AstraNatureSprites || null;
      ctx.clearRect(0, 0, width, height);
      drawGlows(dt, sprites);
      drawAir();
      drawBirds();
      drawParticles(dt, sprites);
      drawHeroBursts(dt, sprites);
      raf = requestAnimationFrame(frame);
    }

    if (typeof window !== 'undefined') {
      window.__astraAtlasStats = () => ({
        state: currentState(),
        particles: particles.length,
        lilies: particles.filter(p => p.kind === 'lily').length,
        glows: glows.length,
        bursts: heroBursts.length,
        running: Boolean(raf)
      });
    }

    on(hero, 'pointerenter', () => {
      const box = hero.getBoundingClientRect();
      heroLeft = box.left; heroTop = box.top;
    }, { passive: true });
    on(hero, 'pointermove', event => {
      if (event.pointerType === 'touch' || currentState() !== 'running') return;
      targetX = clamp((event.clientX - heroLeft) / width - 0.5, -0.5, 0.5) * 18;
      targetY = clamp((event.clientY - heroTop) / height - 0.5, -0.5, 0.5) * 10;
    }, { passive: true });
    on(hero, 'pointerleave', () => { targetX = targetY = 0; });
    on(breeze, 'click', () => {
      if (currentState() !== 'running') return;
      gustRemaining = 5;
      breeze.setAttribute('aria-pressed', 'true');
      hero.dataset.gust = hero.dataset.gusting = 'true';
      if (typeof CustomEvent !== 'undefined') {
        document.dispatchEvent?.(new CustomEvent('astra:gust', { detail: { strength: 1.5, duration: 4.0 } }));
      }
    });
    on(hero, 'pointerdown', event => {
      if (currentState() !== 'running' || event.target?.closest?.('a,button,select,input')) return;
      gustRemaining = Math.max(gustRemaining, 1.4);
      hero.dataset.gust = hero.dataset.gusting = 'true';
      const nowMs = Date.now();
      if (nowMs - lastBurstAt >= 260 && heroBursts.length < 10) {
        lastBurstAt = nowMs;
        const box = hero.getBoundingClientRect();
        const lx = event.clientX - box.left, ly = event.clientY - box.top;
        const room = Math.min(6, 10 - heroBursts.length);
        for (let i = 0; i < room; i++) {
          const a = random(0, TAU), sp = random(55, 145);
          const kind = theme === 'christmas' ? (i % 3 ? 'flake' : 'crystal') : theme === 'dark' ? (i === 0 ? 'lily' : 'petal') : 'leaf';
          heroBursts.push({
            kind, index: i,
            x: lx, y: ly,
            vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 65,
            life: 1,
            size: kind === 'lily' ? 36 : kind === 'petal' ? 15 : kind === 'leaf' ? 14 : 9,
            rotation: random(0, TAU), spin: random(-3.5, 3.5), flip: 2.4, phase: random(0, TAU)
          });
        }
      }
      if (typeof CustomEvent !== 'undefined') {
        document.dispatchEvent?.(new CustomEvent('astra:gust', { detail: { strength: 0.95, duration: 1.6 } }));
      }
    });
    on(pause, 'click', () => { manualPause = !manualPause; sync(); });
    on(mapLink, 'click', () => {
      document.querySelector('.map-panel')?.scrollIntoView({ behavior: reduced.matches ? 'instant' : 'smooth', block: 'start' });
    });
    on(reduced, 'change', sync);
    on(document, 'visibilitychange', sync);
    on(document, 'astra:themechange', themeChanged);
    on(window, 'pagehide', () => { pageActive = false; sync(); });
    on(window, 'pageshow', () => { pageActive = true; sync(); });

    const preferences = new MutationObserver(themeChanged);
    preferences.observe(document.body, { attributes: true, attributeFilter: ['data-nature-mode'] });
    preferences.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    const size = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(resize) : null;
    if (size) size.observe(hero); else on(window, 'resize', resize, { passive: true });
    const visibility = typeof IntersectionObserver !== 'undefined' ? new IntersectionObserver(entries => {
      inView = entries[0].isIntersecting; sync();
    }, { threshold: 0.01 }) : null;
    visibility?.observe(hero);

    on(hero, 'astra:scene-destroy', () => {
      pageActive = false; sync(); preferences.disconnect(); size?.disconnect(); visibility?.disconnect();
      for (const dispose of disposers) dispose();
      delete hero.dataset.motionReady;
    });
    resize();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
