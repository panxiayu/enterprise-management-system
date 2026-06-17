// public/js/auth-guard.js - Token 过期自动检测 & fetch 401 拦截
;(function() {
  if (window.__authGuardLoaded) return;
  window.__authGuardLoaded = true;

  var STORAGE_KEY = 'employee_token';
  var INFO_KEY = 'employee_info';
  var REDIRECT_FLAG = '_authRedirecting';
  var TOAST_DELAY = 800;

  // ========== JWT 解码 ==========
  function decodeJWT(token) {
    try {
      var parts = token.split('.');
      if (parts.length !== 3) return null;
      // base64url → base64
      var payload = parts[1].replace(/-/g, '+').replace(/_/g, '/');
      // 补齐长度
      while (payload.length % 4) payload += '=';
      return JSON.parse(atob(payload));
    } catch (e) {
      return null;
    }
  }

  // ========== 检查 token 是否过期 ==========
  function isTokenExpired(token) {
    if (!token) return true;
    var payload = decodeJWT(token);
    if (!payload || !payload.exp) return true; // 损坏的 token 按过期处理
    return (payload.exp * 1000) < Date.now();
  }

  // ========== 是否在登录页 ==========
  function isLoginPage() {
    var p = window.location.pathname;
    return p === '/' || p === '/index.html' || p.endsWith('/index.html');
  }

  // ========== 清除认证信息 ==========
  function clearAuth() {
    try {
      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem(INFO_KEY);
      localStorage.removeItem('employeeSession');
      localStorage.removeItem('employeeModuleAccess');
    } catch (e) {}
  }

  // ========== 显示 toast ==========
  function showExpiredToast() {
    var toast = document.createElement('div');
    toast.textContent = '登录已过期，请重新登录';
    toast.style.cssText =
      'position:fixed;top:20px;left:50%;transform:translateX(-50%);z-index:99999;' +
      'background:#1D2B5A;color:#fff;padding:12px 24px;border-radius:22px;' +
      'font-size:15px;white-space:nowrap;opacity:0;transition:opacity 0.3s;' +
      'font-family:-apple-system,BlinkMacSystemFont,sans-serif;pointer-events:none;';
    document.body.appendChild(toast);
    requestAnimationFrame(function() {
      toast.style.opacity = '1';
    });
    // toast 在跳转后自然消失
  }

  // ========== 过期处理 ==========
  function handleExpired() {
    if (window[REDIRECT_FLAG]) return; // 防抖：已在进行中
    window[REDIRECT_FLAG] = true;

    if (!isLoginPage()) {
      showExpiredToast();
    }
    clearAuth();

    setTimeout(function() {
      if (!isLoginPage()) {
        window.location.replace('/index.html?expired=1');
      } else {
        window.location.replace('/index.html?expired=1');
      }
    }, isLoginPage() ? 0 : TOAST_DELAY);
  }

  // ========== fetch 拦截器 ==========
  var _originalFetch = window.fetch;
  window.fetch = function(url, options) {
    return _originalFetch(url, options).then(function(response) {
      // 401 表示 token 过期或无效
      if (response.status === 401) {
        handleExpired();
      }
      return response;
    });
  };

  // ========== 页面加载时检查 ==========
  function checkOnLoad() {
    var token = null;
    try {
      token = localStorage.getItem(STORAGE_KEY);
    } catch (e) {}

    if (!token) return; // 无 token，页面自己的逻辑会处理

    if (isTokenExpired(token)) {
      handleExpired();
    }
  }

  checkOnLoad();
})();
