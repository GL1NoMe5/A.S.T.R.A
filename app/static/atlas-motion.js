/* Local illustration motion. The scene never represents live weather or changes data. */
(() => {
  'use strict';
  const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
  function motionState({reduced, off, paused, hidden, visible}) {
    return reduced ? 'reduced' : off ? 'off' : paused ? 'paused' : hidden ? 'hidden' : !visible ? 'offscreen' : 'running';
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = {motionState};
  if (typeof document === 'undefined') return;

  function init() {
    const hero = document.querySelector('.atlas-hero');
    const canvas = document.getElementById('atlas-atmosphere');
    if (!hero || !canvas || hero.dataset.motionReady === 'true') return;
    const ctx = canvas.getContext('2d', {alpha: true});
    if (!ctx) { hero.dataset.scenePaused = 'true'; return; }
    hero.dataset.motionReady = 'true';
    canvas.setAttribute('aria-hidden', 'true');
    const breeze = document.getElementById('atlas-breeze');
    const pause = document.getElementById('atlas-pause');
    const mapLink = document.getElementById('atlas-map-link');
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    const disposers = [];
    let width = 1, height = 1, particles = [], raf = 0, previous = null;
    let elapsed = 0, gustRemaining = 0, wind = 0, manualPause = false, pageActive = true;
    let inView = true, targetX = 0, targetY = 0, x = 0, y = 0;
    let theme = document.documentElement.dataset.theme || 'forest';
    const random = (min, max) => min + Math.random() * (max - min);

    function on(target, event, callback, options) {
      target?.addEventListener(event, callback, options);
      disposers.push(() => target?.removeEventListener(event, callback, options));
    }
    function currentState() {
      return motionState({reduced: reduced.matches, off: document.body.dataset.natureMode === 'off',
        paused: manualPause, hidden: document.hidden || !pageActive, visible: inView});
    }
    function resetPointer() {
      targetX = targetY = x = y = 0;
      hero.style.setProperty('--atlas-x', '0px');
      hero.style.setProperty('--atlas-y', '0px');
    }
    function makeParticle(initial = false, index = 0) {
      const snow = theme === 'christmas';
      return {x: initial ? random(0, width) : random(-70, -12),
        y: initial ? random(0, height) : snow ? random(-50, -8) : random(height * .16, height * .83),
        size: snow ? random(.8, 2.6) : index % 5 ? random(.7, 1.8) : random(4, 7),
        depth: random(.35, 1), speed: random(6, 17), phase: random(0, Math.PI * 2),
        rotation: random(0, Math.PI * 2), leaf: !snow && index % 5 === 0, index};
    }
    function seed() {
      const count = width < 640 ? 24 : 46;
      particles = Array.from({length: count}, (_, i) => makeParticle(true, i));
    }
    function resize() {
      const box = hero.getBoundingClientRect();
      width = Math.max(1, box.width); height = Math.max(1, box.height);
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0); seed();
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
        hero.style.setProperty('--atlas-gust', '0');
        if (state === 'off' || state === 'reduced') ctx.clearRect(0, 0, width, height);
      } else if (!raf) {
        previous = null; raf = requestAnimationFrame(frame);
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
    function leaf(particle, night) {
      ctx.save(); ctx.translate(particle.x, particle.y); ctx.rotate(particle.rotation);
      ctx.scale(.45 + Math.abs(Math.sin(elapsed * .7 + particle.phase)) * .55, 1);
      ctx.fillStyle = night ? '#d9798d' : '#587b42';
      ctx.beginPath(); ctx.moveTo(0, -particle.size);
      ctx.bezierCurveTo(particle.size, -particle.size, particle.size * 1.2, particle.size * .4, 0, particle.size);
      ctx.bezierCurveTo(-particle.size * .7, particle.size * .6, -particle.size * .8, -particle.size * .6, 0, -particle.size);
      ctx.fill();
      ctx.strokeStyle = night ? '#f6b7a0' : '#d9dda1'; ctx.lineWidth = .5;
      ctx.beginPath(); ctx.moveTo(0, -particle.size * .65); ctx.lineTo(0, particle.size * .8); ctx.stroke();
      ctx.restore();
    }
    function drawParticles(dt) {
      const night = theme === 'dark', snow = theme === 'christmas';
      for (const p of particles) {
        const drift = (12 + wind * 64 + Math.sin(elapsed * .4 + p.phase) * 7) * p.depth;
        p.x += drift * dt;
        p.y += (snow ? p.speed + Math.sin(elapsed + p.phase) * 3 : Math.sin(elapsed * .65 + p.phase) * 5 + wind * 4) * dt;
        p.rotation += (Math.sin(elapsed + p.phase) * .3 + wind) * dt;
        if (p.x > width + 45 || p.y > height + 35 || p.y < -70) {
          Object.assign(p, makeParticle(false, p.index));
          if (snow) p.x = random(-40, width);
        }
        // Keep drifting detail quiet around the heading on the left.
        const textFade = .25 + .75 * clamp((p.x / width - .18) / .5, 0, 1);
        const flicker = .55 + .45 * Math.sin(elapsed * 1.3 + p.phase);
        ctx.globalAlpha = textFade * (p.leaf ? .62 : night ? flicker * .65 : snow ? .65 : .55);
        if (p.leaf) leaf(p, night);
        else {
          if (night) {
            const glow = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.size * 5);
            glow.addColorStop(0, '#e0eb95'); glow.addColorStop(.25, '#c7df7b80'); glow.addColorStop(1, '#c7df7b00');
            ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(p.x, p.y, p.size * 5, 0, Math.PI * 2); ctx.fill();
          }
          ctx.fillStyle = snow ? '#fffdf0' : night ? '#effab9' : '#fff3b3';
          ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2); ctx.fill();
        }
      }
      ctx.globalAlpha = 1;
    }
    function drawBirds() {
      if (theme !== 'forest' || width < 550) return;
      const cycle = elapsed % 38;
      if (cycle > 19) return;
      const progress = cycle / 19;
      for (let i = 0; i < 3; i++) {
        const bx = width * (1.05 - progress * .9) + i * 19;
        const by = height * (.24 + .035 * Math.sin(progress * 4)) + i * 7;
        const wing = 2 + Math.sin(elapsed * 5.8 + i * .7) * 2.5;
        ctx.globalAlpha = Math.sin(progress * Math.PI) * .42;
        ctx.strokeStyle = '#304d3d'; ctx.lineWidth = 1.2; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(bx - 5, by - wing); ctx.quadraticCurveTo(bx - 2, by - 2, bx, by);
        ctx.quadraticCurveTo(bx + 2, by - 2, bx + 5, by - wing); ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }
    function drawAir() {
      const strength = Math.max(0, wind - .13);
      if (strength < .01) return;
      ctx.strokeStyle = theme === 'forest' ? '#eff5d0' : '#c4dace';
      ctx.lineWidth = 1; ctx.globalAlpha = strength * .2;
      for (let i = 0; i < 3; i++) {
        const bx = (elapsed * (55 + i * 8) + i * width * .4) % (width * 1.4) - width * .2;
        const by = height * (.4 + i * .16);
        ctx.beginPath(); ctx.moveTo(bx, by);
        ctx.bezierCurveTo(bx + 50, by - 17, bx + 95, by + 14, bx + 160, by - 5); ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }
    function frame(now) {
      raf = 0;
      if (currentState() !== 'running') { sync(); return; }
      if (previous !== null && now - previous < 1000 / 30) { raf = requestAnimationFrame(frame); return; }
      const dt = previous === null ? 0 : clamp((now - previous) / 1000, 0, .08);
      previous = now; elapsed += dt;
      const wasGusting = gustRemaining > 0;
      gustRemaining = Math.max(0, gustRemaining - dt);
      const natural = Math.pow(Math.max(0, Math.sin(elapsed * .24)), 5) * .2;
      const targetWind = gustRemaining > 0 ? Math.sin(Math.min(1, gustRemaining / 1.5) * Math.PI / 2) : natural;
      wind += (targetWind - wind) * Math.min(1, dt * 3);
      x += (targetX - x) * Math.min(1, dt * 3); y += (targetY - y) * Math.min(1, dt * 3);
      hero.style.setProperty('--atlas-x', `${x.toFixed(2)}px`);
      hero.style.setProperty('--atlas-y', `${y.toFixed(2)}px`);
      hero.style.setProperty('--atlas-gust', wind.toFixed(3));
      hero.dataset.gusting = String(gustRemaining > 0);
      hero.dataset.gust = String(gustRemaining > 0);
      if (wasGusting && !gustRemaining) breeze?.setAttribute('aria-pressed', 'false');
      ctx.clearRect(0, 0, width, height);
      drawAir(); drawBirds(); drawParticles(dt);
      raf = requestAnimationFrame(frame);
    }

    on(hero, 'pointermove', event => {
      if (event.pointerType === 'touch' || currentState() !== 'running') return;
      const box = hero.getBoundingClientRect();
      targetX = clamp((event.clientX - box.left) / width - .5, -.5, .5) * 20;
      targetY = clamp((event.clientY - box.top) / height - .5, -.5, .5) * 12;
    }, {passive: true});
    on(hero, 'pointerleave', () => { targetX = targetY = 0; });
    on(breeze, 'click', () => {
      if (currentState() !== 'running') return;
      gustRemaining = 5; breeze.setAttribute('aria-pressed', 'true'); hero.dataset.gust = hero.dataset.gusting = 'true';
    });
    on(pause, 'click', () => { manualPause = !manualPause; sync(); });
    on(mapLink, 'click', () => {
      document.querySelector('.map-panel')?.scrollIntoView({behavior: reduced.matches ? 'instant' : 'smooth', block: 'start'});
    });
    on(reduced, 'change', sync);
    on(document, 'visibilitychange', sync);
    on(document, 'astra:themechange', themeChanged);
    on(window, 'pagehide', () => { pageActive = false; sync(); });
    on(window, 'pageshow', () => { pageActive = true; sync(); });
    const preferences = new MutationObserver(themeChanged);
    preferences.observe(document.body, {attributes: true, attributeFilter: ['data-nature-mode']});
    preferences.observe(document.documentElement, {attributes: true, attributeFilter: ['data-theme']});
    const size = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(resize) : null;
    if (size) size.observe(hero); else on(window, 'resize', resize, {passive: true});
    const visibility = typeof IntersectionObserver !== 'undefined' ? new IntersectionObserver(entries => {
      inView = entries[0].isIntersecting; sync();
    }, {threshold: .01}) : null;
    visibility?.observe(hero);
    // Explicit teardown supports a future client-side shell without leaked listeners.
    on(hero, 'astra:scene-destroy', () => {
      pageActive = false; sync(); preferences.disconnect(); size?.disconnect(); visibility?.disconnect();
      for (const dispose of disposers) dispose();
      delete hero.dataset.motionReady;
    });
    resize();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, {once: true});
  else init();
})();
