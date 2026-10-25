/* Persistent presentation preferences. They never change calculation inputs. */
(() => {
  'use strict';
  const THEMES = new Set(['forest', 'dark', 'christmas']);
  const KEY = 'astra:theme';
  const read = key => { try { return localStorage.getItem(key); } catch (_) { return null; } };
  let theme = THEMES.has(read(KEY)) ? read(KEY) : 'forest';
  document.documentElement.dataset.theme = theme;
  function init() {
    const header = document.querySelector('.header-meta');
    if (!header || document.getElementById('theme-mode')) return;
    const control = document.createElement('label');
    control.className = 'theme-control'; control.id = 'theme-control';
    const caption = document.createElement('span'); caption.dataset.i18n = 'theme.label'; caption.textContent = 'Тема';
    const select = document.createElement('select'); select.id = 'theme-mode';
    select.setAttribute('aria-label', 'Тема'); select.setAttribute('data-i18n-aria-label', 'theme.label');
    for (const [value, name] of [['forest','Основная'],['dark','Тёмная'],['christmas','Рождественская']]) {
      const option = document.createElement('option'); option.value = value;
      option.dataset.i18n = `theme.${value}`; option.textContent = name; select.append(option);
    }
    control.append(caption, select); header.append(control);
    if (window.AstraI18n) window.AstraI18n.apply(control);
    const garland = document.createElement('div'); garland.className = 'holiday-lights'; garland.setAttribute('aria-hidden','true');
    for (let i = 0; i < 18; i++) { const light = document.createElement('i'); light.style.setProperty('--n', i); garland.append(light); }
    document.querySelector('main')?.prepend(garland);
    function apply(next, fromUser = false) {
      theme = THEMES.has(next) ? next : 'forest';
      document.documentElement.dataset.theme = theme; select.value = theme;
      document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'forest' ? '#e6eddf' : theme === 'dark' ? '#101c1b' : '#162f2b');
      try { localStorage.setItem(KEY, theme); } catch (_) {}
      const atmosphere = document.getElementById('nature-mode');
      if (fromUser && atmosphere && !atmosphere.disabled && atmosphere.value !== 'off') {
        atmosphere.value = 'auto'; atmosphere.dispatchEvent(new Event('change'));
      }
      document.dispatchEvent(new CustomEvent('astra:themechange', {detail:{theme}}));
    }
    select.addEventListener('change', () => {
      const go = () => apply(select.value, true);
      const still = matchMedia('(prefers-reduced-motion: reduce)').matches || document.body.dataset.natureMode === 'off';
      if (!document.startViewTransition || still) { go(); return; }
      // The new theme spreads from the selector like a change of light over the landscape.
      const box = select.getBoundingClientRect();
      document.documentElement.style.setProperty('--vt-x', `${box.left + box.width / 2}px`);
      document.documentElement.style.setProperty('--vt-y', `${box.top + box.height / 2}px`);
      document.startViewTransition(go);
    });
    apply(theme);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, {once:true}); else init();
})();
