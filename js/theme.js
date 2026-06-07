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
    applyAccent(window.jongnoCurrentAccent());  // 다크/라이트 전환 시 강조색도 그 모드에 맞게 재적용

    // 네이버 지도 GL 스타일은 런타임 복귀가 불안정해서 지도 화면에서는 저장 후 재로드로 확실히 반영한다.
    if (document.getElementById('map')) {
      window.location.reload();
    }
  };

  if (mq && mq.addEventListener) {
    mq.addEventListener('change', function () { applyTheme(); applyAccent(window.jongnoCurrentAccent()); });
  }
  document.addEventListener('DOMContentLoaded', applyTheme);
  applyTheme();

  // ── 테마색(강조색) — 모든 페이지 적용 ──────────────────────────
  // 값 순서: [name, [main, light, strong, deep, soft, glow]]  (design_handoff_clay/테마색옵션.html 기준)
  const ACCENT_KEY = 'jongno_accent';
  const ACCENT_VARS = ['--mint', '--mint-l', '--mint-strong', '--mint-deep', '--mint-soft', '--mint-glow'];
  const ACCENT_PALETTES = {
    sage:       ['세이지 민트', ['#a6dcc1', '#bbe8d0', '#3f8e6b', '#2c5e44', '#d6ecdf', 'rgba(70,224,163,.4)']],
    terracotta: ['테라코타',    ['#e0a48a', '#ecc3ad', '#b5613f', '#7d3d22', '#f2ddd0', 'rgba(214,120,80,.4)']],
    slate:      ['슬레이트 블루', ['#9fb3d4', '#c2cfe8', '#4f6b9b', '#2f4670', '#dde4f0', 'rgba(90,130,200,.4)']],
    teal:       ['틸',          ['#8fcfc8', '#aadbd3', '#2f8077', '#1c544d', '#d2eae6', 'rgba(45,160,150,.4)']],
    honey:      ['허니 골드',   ['#e6c67e', '#efd79a', '#a87b22', '#6f4f12', '#f4e8c8', 'rgba(220,180,80,.42)']],
    rose:       ['더스티 로즈', ['#d9a8b8', '#e8c2cf', '#a25068', '#6f2f43', '#f0dce2', 'rgba(200,110,140,.4)']],
    periwinkle: ['페리윙클',    ['#b0a6e0', '#c8bce8', '#6553a8', '#3f2f70', '#e2dcf2', 'rgba(150,120,210,.42)']],
    ink:        ['잉크 블랙',   ['#3a3833', '#4a473f', '#2c2a27', '#ffffff', '#dcd8d0', 'rgba(60,56,50,.3)']],
    charcoal:   ['차콜 그레이', ['#6b665c', '#7a7468', '#46423a', '#ffffff', '#ddd9d0', 'rgba(107,102,92,.32)']],
    greige:     ['웜 그레이지', ['#a39c8e', '#b3ad9f', '#615d54', '#34302a', '#e6e2d9', 'rgba(140,132,120,.32)']],
    stone:      ['스톤 그레이', ['#9a9aa0', '#aaaab0', '#56555c', '#ffffff', '#e1e0e3', 'rgba(120,120,128,.32)']],
  };

  function _hexToRgba(hex, a) {
    const h = String(hex).replace('#', '');
    if (h.length < 6) return hex;
    const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
    return `rgba(${r},${g},${b},${a})`;
  }
  function applyAccent(key) {
    const root = document.documentElement;
    const p = ACCENT_PALETTES[key];
    if (!key || key === 'sage' || !p) {
      // 기본(세이지) = 인라인 override 제거 → clay.css 기본값(라이트/다크) 사용
      ACCENT_VARS.forEach(v => root.style.removeProperty(v));
      root.style.removeProperty('--mint-ink');
      return;
    }
    const c = p[1];  // [main, light, strong, deep, soft, glow]
    const dark = (root.getAttribute('data-theme') === 'dark');
    root.style.setProperty('--mint', c[0]);
    root.style.setProperty('--mint-l', c[1]);
    root.style.setProperty('--mint-deep', c[3]);
    root.style.setProperty('--mint-glow', c[5]);
    if (dark) {
      // 테마색옵션 body.dark 방식: 강조 텍스트=main(밝은 색), 칩 배경=bg-deep(어두운)
      root.style.setProperty('--mint-strong', c[0]);
      root.style.setProperty('--mint-ink', c[0]);
      root.style.setProperty('--mint-soft', 'var(--bg-deep)');
    } else {
      root.style.setProperty('--mint-strong', c[2]);
      root.style.setProperty('--mint-ink', c[2]);
      root.style.setProperty('--mint-soft', c[4]);
    }
  }

  window.jongnoApplyAccent = function (key) {
    try { localStorage.setItem(ACCENT_KEY, key); } catch (e) {}
    applyAccent(key);
    window.dispatchEvent(new CustomEvent('jongno:accentchange', { detail: { key: key } }));
  };
  window.jongnoCurrentAccent = function () {
    try { return localStorage.getItem(ACCENT_KEY) || 'sage'; } catch (e) { return 'sage'; }
  };
  window.jongnoAccentPalettes = ACCENT_PALETTES;

  // 초기 복원 (FOUC 최소화 위해 즉시)
  applyAccent(window.jongnoCurrentAccent());
})();
