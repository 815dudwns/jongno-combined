// theme.js — 라이트/다크 테마 토글
(function () {
  const KEY = 'jongno_theme';
  const order = ['light', 'dark'];
  const labels = { light: '라이트', dark: '다크' };
  const mq = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
  let pref = localStorage.getItem(KEY) || ((mq && mq.matches) ? 'dark' : 'light');
  if (!order.includes(pref)) pref = (mq && mq.matches) ? 'dark' : 'light';

  function resolvedTheme() {
    return pref === 'dark' ? 'dark' : 'light';
  }

  function applyTheme() {
    document.documentElement.setAttribute('data-theme', resolvedTheme());
    document.querySelectorAll('[data-theme-toggle]').forEach(btn => {
      btn.textContent = labels[pref] || labels.light;
      btn.setAttribute('aria-label', '테마: ' + (labels[pref] || labels.light));
    });
    window.dispatchEvent(new CustomEvent('jongno:themechange', {
      detail: { pref: pref, theme: resolvedTheme() }
    }));
  }

  window.jongnoCycleTheme = function () {
    const idx = order.indexOf(pref);
    pref = order[(idx + 1) % order.length];
    localStorage.setItem(KEY, pref);
    applyTheme();

    // 네이버 지도 GL 스타일은 런타임 복귀가 불안정해서 지도 화면에서는 저장 후 재로드로 확실히 반영한다.
    if (document.getElementById('map')) {
      window.location.reload();
    }
  };

  if (mq && mq.addEventListener) {
    mq.addEventListener('change', function () { applyTheme(); });
  }
  document.addEventListener('DOMContentLoaded', applyTheme);
  applyTheme();
})();
