/* Presentation only: pointer depth, range feedback and an illustrative grove. */
(() => {
  'use strict';
  const reduce = matchMedia('(prefers-reduced-motion: reduce)');
  const enabled = () => !reduce.matches && !document.hidden && document.body.dataset.natureMode !== 'off';
  let active = null, activeBox = null, frame = 0, x = 0, y = 0;
  function clear() {
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    if (active) {
      active.style.removeProperty('--tilt-x');
      active.style.removeProperty('--tilt-y');
      active.style.removeProperty('--scene-x');
      active.style.removeProperty('--scene-y');
    }
    active = null;
    activeBox = null;
  }
  document.addEventListener('pointermove', event => {
    if (!enabled() || event.pointerType === 'touch') return;
    const target = event.target.closest('.saved-card,.kpi,.folio-heading');
    if (target !== active) {
      clear();
      active = target;
      if (active) activeBox = active.getBoundingClientRect();
    }
    if (!active || !activeBox) return;
    x = event.clientX;
    y = event.clientY;
    if (!frame) frame = requestAnimationFrame(() => {
      frame = 0;
      if (!active || !activeBox) return;
      const dx = (x - activeBox.left) / Math.max(1, activeBox.width) - 0.5;
      const dy = (y - activeBox.top) / Math.max(1, activeBox.height) - 0.5;
      active.style.setProperty('--tilt-x', `${(-dy * 1.8).toFixed(2)}deg`);
      active.style.setProperty('--tilt-y', `${(dx * 1.8).toFixed(2)}deg`);
      active.style.setProperty('--scene-x', `${(dx * 9).toFixed(2)}px`);
      active.style.setProperty('--scene-y', `${(dy * 6).toFixed(2)}px`);
    });
  }, { passive: true });
  window.addEventListener('scroll', clear, { passive: true });
  window.addEventListener('resize', clear, { passive: true });
  function syncMotion() {
    document.body.dataset.uiMotion = enabled() ? 'on' : 'off';
    if (!enabled()) clear();
  }
  document.addEventListener('pointerleave', clear);
  document.addEventListener('visibilitychange', syncMotion);
  window.addEventListener('pagehide', clear);
  reduce.addEventListener('change', syncMotion);
  new MutationObserver(syncMotion).observe(document.body, { attributes: true, attributeFilter: ['data-nature-mode'] });
  syncMotion();

  function updateGrove() {
    const grove = document.querySelector('.grove-preview');
    const trees = document.getElementById('trees'), horizon = document.getElementById('horizon');
    if (!grove || !trees || !horizon) return;
    for (const range of [trees, horizon]) {
      const fraction = Math.max(0, Math.min(1, (Number(range.value) - Number(range.min)) / (Number(range.max) - Number(range.min))));
      range.style.setProperty('--range-fill', `${fraction * 100}%`);
    }
    const years = Math.max(1, Math.min(30, Number(horizon.value)));
    grove.style.setProperty('--grove-growth', String(0.5 + years / 60));
    grove.dataset.species = document.getElementById('species').value;
    const count = Math.max(3, Math.min(9, Math.round(3 + Number(trees.value) / 10000 * 6)));
    grove.querySelectorAll('.grove-tree').forEach((tree, index) => { tree.dataset.dormant = String(index >= count); });
  }
  document.getElementById('optimize-form')?.addEventListener('input', updateGrove);
  document.getElementById('optimize-form')?.addEventListener('change', updateGrove);
  const outputs = new MutationObserver(updateGrove);
  for (const id of ['trees-output', 'horizon-output']) {
    const output = document.getElementById(id);
    if (output) outputs.observe(output, { childList: true, subtree: true, characterData: true });
  }
  document.querySelectorAll('[data-scroll-target]').forEach(button => {
    button.addEventListener('click', () => {
      document.querySelector(button.dataset.scrollTarget)?.scrollIntoView({ behavior: enabled() ? 'smooth' : 'instant', block: 'start' });
    });
  });
  updateGrove();
})();
