/* A small visual response to pointer movement; data and controls are unaffected. */
(() => {
  'use strict';
  const reduce = matchMedia('(prefers-reduced-motion: reduce)');
  let active = null, frame = 0, x = 0, y = 0;
  function clear() {
    if (frame) cancelAnimationFrame(frame); frame = 0;
    if (active) { active.style.removeProperty('--tilt-x'); active.style.removeProperty('--tilt-y'); active.style.removeProperty('--scene-x'); active.style.removeProperty('--scene-y'); }
    active = null;
  }
  document.addEventListener('pointermove', event => {
    if (reduce.matches || event.pointerType === 'touch' || document.hidden) return;
    const target = event.target.closest('.saved-card,.kpi,.overview-heading');
    if (target !== active) { clear(); active = target; }
    if (!active) return;
    x = event.clientX; y = event.clientY;
    if (!frame) frame = requestAnimationFrame(() => {
      frame = 0; if (!active) return;
      const box = active.getBoundingClientRect(), dx = (x - box.left) / box.width - .5, dy = (y - box.top) / box.height - .5;
      active.style.setProperty('--tilt-x', `${-dy * 2}deg`); active.style.setProperty('--tilt-y', `${dx * 2}deg`);
      active.style.setProperty('--scene-x', `${dx * 10}px`); active.style.setProperty('--scene-y', `${dy * 7}px`);
    });
  }, {passive:true});
  document.addEventListener('pointerleave', clear); document.addEventListener('visibilitychange', clear);
  window.addEventListener('pagehide', clear); reduce.addEventListener('change', clear);
})();
