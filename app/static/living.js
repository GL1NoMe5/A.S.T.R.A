/* Living interface: tactile feedback, magnetic actions, reveals and value pulses.
   Presentation only — never changes inputs, calculations or API calls. */
(() => {
  'use strict';
  const reduce = matchMedia('(prefers-reduced-motion: reduce)');
  const motionOn = () => !reduce.matches && !document.hidden && document.body.dataset.natureMode !== 'off';
  const root = document.documentElement;
  const emit = (name, detail) => document.dispatchEvent(new CustomEvent(name, { detail }));
  root.classList.add('living');

  /* Capped tactile ripple + calm themed burst on press. */
  const PRESSABLE = 'button,.atlas-action,.nav-item,.folio-jump';
  let activeRipples = 0;
  document.addEventListener('pointerdown', event => {
    const target = event.target.closest(PRESSABLE);
    if (!target || target.disabled || !motionOn()) return;
    if (activeRipples < 3) {
      const box = target.getBoundingClientRect(), size = Math.max(box.width, box.height) * 2.2;
      const ripple = document.createElement('span');
      ripple.className = 'living-ripple';
      ripple.setAttribute('aria-hidden', 'true');
      ripple.style.cssText = `width:${size}px;height:${size}px;left:${event.clientX - box.left - size / 2}px;top:${event.clientY - box.top - size / 2}px`;
      if (getComputedStyle(target).position === 'static') target.style.position = 'relative';
      target.classList.add('has-ripple');
      target.append(ripple);
      activeRipples++;
      setTimeout(() => { ripple.remove(); activeRipples = Math.max(0, activeRipples - 1); }, 680);
    }
    if (target.matches('.primary-button,.atlas-action-primary,#compare-plans,#export-result,#open-report')) {
      emit('astra:burst', { x: event.clientX, y: event.clientY, count: 6 });
    }
  }, { passive: true });

  /* Calculations and navigation stir the air gently. */
  document.getElementById('optimize-form')?.addEventListener('submit', () => {
    if (motionOn()) emit('astra:gust', { strength: 1.4, duration: 3.4 });
  });
  window.addEventListener('hashchange', () => {
    if (!motionOn()) return;
    emit('astra:gust', { strength: 0.9, duration: 2.0 });
    document.body.dataset.routeSwitch = 'true';
    setTimeout(() => { delete document.body.dataset.routeSwitch; }, 650);
  });

  /* Cached-rect magnetic pull on primary controls (zero layout reads during move). */
  let px = 0, py = 0, pending = 0, magnet = null, magnetBox = null;
  function releaseMagnet() {
    if (magnet) {
      magnet.style.removeProperty('--mag-x');
      magnet.style.removeProperty('--mag-y');
      magnet = null;
      magnetBox = null;
    }
  }
  function resetPointer() {
    if (pending) cancelAnimationFrame(pending);
    pending = 0;
    releaseMagnet();
  }
  document.addEventListener('pointermove', event => {
    if (event.pointerType === 'touch' || !motionOn()) return;
    const m = event.target.closest?.('.atlas-action,.primary-button,.folio-jump,.atlas-tool');
    if (m !== magnet) {
      releaseMagnet();
      if (m && !m.disabled) {
        magnet = m;
        magnetBox = m.getBoundingClientRect();
      }
    }
    if (!magnet || !magnetBox) return;
    px = event.clientX;
    py = event.clientY;
    if (!pending) pending = requestAnimationFrame(() => {
      pending = 0;
      if (!magnet || !magnetBox || !motionOn()) { resetPointer(); return; }
      const mx = ((px - magnetBox.left) / Math.max(1, magnetBox.width) - 0.5) * 8;
      const my = ((py - magnetBox.top) / Math.max(1, magnetBox.height) - 0.5) * 6;
      magnet.style.setProperty('--mag-x', `${mx.toFixed(2)}px`);
      magnet.style.setProperty('--mag-y', `${my.toFixed(2)}px`);
    });
  }, { passive: true });

  window.addEventListener('scroll', resetPointer, { passive: true });
  window.addEventListener('resize', resetPointer, { passive: true });
  document.addEventListener('pointerleave', resetPointer);
  document.addEventListener('visibilitychange', () => { if (!motionOn()) resetPointer(); });
  reduce.addEventListener('change', () => { if (!motionOn()) resetPointer(); });
  new MutationObserver(() => { if (!motionOn()) resetPointer(); }).observe(document.body, { attributes: true, attributeFilter: ['data-nature-mode'] });
  window.addEventListener('pagehide', resetPointer);

  /* Reveal surfaces as they enter view. */
  const REVEAL = '.atlas-section-label,#overview .kpi,.map-panel,.city-notes,.source-banner,.planning-panel,.planning-guide,.results-panel,.analysis-note,.compare-panel';
  const io = 'IntersectionObserver' in window ? new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (entry.isIntersecting) {
        entry.target.classList.add('is-in');
        io.unobserve(entry.target);
      }
    }
  }, { threshold: 0.06, rootMargin: '0px 0px -4% 0px' }) : null;
  document.querySelectorAll(REVEAL).forEach((el, i) => {
    el.style.setProperty('--reveal-delay', `${(el.matches('.kpi') ? [...el.parentNode.children].indexOf(el) : i % 3) * 75}ms`);
    el.classList.add('reveal');
    if (io) io.observe(el); else el.classList.add('is-in');
  });

  /* Pulse a value when the live stream changes it. */
  for (const id of ['kpi-pm', 'kpi-temp', 'kpi-aqi', 'kpi-sensors', 'kpi-hotspots', 'network-active', 'network-esi', 'network-wind']) {
    const el = document.getElementById(id);
    if (!el) continue;
    let last = el.textContent;
    new MutationObserver(() => {
      if (el.textContent === last) return;
      last = el.textContent;
      if (!motionOn()) return;
      const host = el.closest('.kpi,.network-stat') || el;
      host.classList.remove('is-updated');
      void host.offsetWidth;
      host.classList.add('is-updated');
    }).observe(el, { childList: true, characterData: true, subtree: true });
  }

  /* Sliding pill behind the active map metric. */
  const metric = document.querySelector('.metric-switch');
  function syncPill() {
    if (!metric) return;
    const active = metric.querySelector('button.active');
    if (!active) return;
    metric.style.setProperty('--pill-x', `${active.offsetLeft}px`);
    metric.style.setProperty('--pill-w', `${active.offsetWidth}px`);
    metric.style.setProperty('--pill-y', `${active.offsetTop}px`);
    metric.style.setProperty('--pill-h', `${active.offsetHeight}px`);
    if (!metric.classList.contains('has-pill')) metric.classList.add('has-pill');
  }
  if (metric) {
    new MutationObserver(syncPill).observe(metric, { attributes: true, subtree: true, attributeFilter: ['class'] });
    window.addEventListener('resize', syncPill, { passive: true });
    document.addEventListener('astra:languagechange', () => requestAnimationFrame(syncPill));
    window.addEventListener('hashchange', () => requestAnimationFrame(syncPill));
    requestAnimationFrame(syncPill);
  }

  /* Result appears with a calm celebratory burst. */
  const results = document.getElementById('results');
  if (results) new MutationObserver(() => {
    if (!results.hidden && motionOn()) {
      results.classList.remove('is-fresh');
      void results.offsetWidth;
      results.classList.add('is-fresh');
      const b = results.getBoundingClientRect();
      emit('astra:burst', { x: b.left + b.width * 0.5, y: Math.max(90, b.top + 40), count: 8 });
    }
  }).observe(results, { attributes: true, attributeFilter: ['hidden'] });
})();
