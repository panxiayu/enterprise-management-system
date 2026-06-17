// 全站桌面低分辨率模式：读取首页保存的状态并自动应用
(function initProjectorMode() {
  const STORAGE_KEY = 'projectorMode';

  function enabled() {
    return localStorage.getItem(STORAGE_KEY) === '1';
  }

  function apply() {
    if (!document.body) return;
    document.body.classList.toggle('projector-mode', enabled());
    document.body.setAttribute('data-projector-mode', enabled() ? 'on' : 'off');
  }

  window.toggleProjectorMode = function toggleProjectorMode(forceValue) {
    const nextValue = typeof forceValue === 'boolean' ? forceValue : !enabled();
    localStorage.setItem(STORAGE_KEY, nextValue ? '1' : '0');
    apply();
    return nextValue;
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', apply, { once: true });
  } else {
    apply();
  }
})();
