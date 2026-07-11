// public/js/auth-guard.js - 登录守卫：无 token / token 失效统一跳转登录页
;(function() {
  if (window.__authGuardLoaded) return;
  window.__authGuardLoaded = true;

  var LOGIN_URL = 'https://www.xlmould.work/';
  var REDIRECT_FLAG = '_authRedirecting';
  var TOAST_DELAY = 500;
  var MODE = String(window.__AUTH_GUARD_MODE || '').toLowerCase();

  function decodeJWT(token) {
    try {
      var parts = String(token || '').split('.');
      if (parts.length !== 3) return null;
      var payload = parts[1].replace(/-/g, '+').replace(/_/g, '/');
      while (payload.length % 4) payload += '=';
      return JSON.parse(atob(payload));
    } catch (e) {
      return null;
    }
  }

  function isJwtExpired(token) {
    if (!token) return true;
    var payload = decodeJWT(token);
    if (!payload || !payload.exp) return true;
    return payload.exp * 1000 <= Date.now();
  }

  function readJson(key) {
    try {
      var raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  function getAdminToken() {
    try {
      return localStorage.getItem('token') || localStorage.getItem('adminToken') || '';
    } catch (e) {
      return '';
    }
  }

  function getEmployeeToken() {
    try {
      return localStorage.getItem('employee_token') || '';
    } catch (e) {
      return '';
    }
  }

  function isAdminValid() {
    var token = getAdminToken();
    if (!token) return false;
    var session = readJson('adminSession');
    if (session && session.expiresAt) {
      return Date.now() <= Number(session.expiresAt);
    }
    return !isJwtExpired(token);
  }

  function isEmployeeValid() {
    var token = getEmployeeToken();
    if (!token) return false;
    var session = readJson('employeeSession');
    if (session && session.expiresAt) {
      return Date.now() <= Number(session.expiresAt);
    }
    return !isJwtExpired(token);
  }

  function clearAdminAuth() {
    try {
      localStorage.removeItem('token');
      localStorage.removeItem('adminToken');
      localStorage.removeItem('currentUser');
      localStorage.removeItem('user');
      localStorage.removeItem('adminSession');
    } catch (e) {}
  }

  function clearEmployeeAuth() {
    try {
      localStorage.removeItem('employee_token');
      localStorage.removeItem('employee_info');
      localStorage.removeItem('employeeSession');
      localStorage.removeItem('employeeModuleAccess');
      localStorage.removeItem('granular_permissions');
    } catch (e) {}
  }

  function clearAllAuth() {
    clearAdminAuth();
    clearEmployeeAuth();
  }

  function showExpiredToast() {
    if (!document.body) return;
    var toast = document.createElement('div');
    toast.innerHTML =
      '<span style="display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;border-radius:50%;' +
      'background:rgba(74,144,226,.14);border:1px solid rgba(74,144,226,.18);color:#4A90E2;font-size:13px;font-weight:800;flex:0 0 22px;">!</span>' +
      '<span style="display:inline-flex;align-items:center;justify-content:center;min-width:0;text-align:center;color:#1D2B5A;font-size:13px;line-height:1.35;font-weight:700;">' +
      '登录已失效，正在返回登录页' +
      '</span>';
    toast.style.cssText =
      'position:fixed;top:20px;left:50%;transform:translateX(-50%) translateY(-10px);z-index:99999;' +
      'display:inline-flex;align-items:center;justify-content:center;gap:10px;min-width:220px;max-width:min(92vw,320px);' +
      'padding:12px 15px;border-radius:18px;border:1px solid rgba(214,233,255,.92);' +
      'background:linear-gradient(135deg,rgba(255,255,255,.72),rgba(240,247,255,.62));' +
      'box-shadow:0 10px 28px rgba(74,144,226,.14),inset 0 1px 0 rgba(255,255,255,.72);' +
      'backdrop-filter:blur(18px) saturate(135%);-webkit-backdrop-filter:blur(18px) saturate(135%);' +
      'font-size:14px;opacity:0;transition:opacity .24s,transform .24s;' +
      'font-family:-apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif;pointer-events:none;';
    document.body.appendChild(toast);
    requestAnimationFrame(function() {
      toast.style.opacity = '1';
      toast.style.transform = 'translateX(-50%) translateY(0)';
    });
  }

  function redirectToLogin() {
    if (window.location.href === LOGIN_URL || window.location.origin + window.location.pathname === LOGIN_URL) {
      return;
    }
    window.location.replace(LOGIN_URL);
  }

  function handleExpired() {
    if (window[REDIRECT_FLAG]) return;
    window[REDIRECT_FLAG] = true;
    clearAllAuth();
    showExpiredToast();
    setTimeout(redirectToLogin, TOAST_DELAY);
  }

  function shouldGuard() {
    return MODE === 'admin' || MODE === 'employee' || MODE === 'either';
  }

  function hasRequiredSession() {
    if (MODE === 'admin') return isAdminValid();
    if (MODE === 'employee') return isEmployeeValid();
    if (MODE === 'either') return isAdminValid() || isEmployeeValid();
    return true;
  }

  var originalFetch = window.fetch;
  if (typeof originalFetch === 'function') {
    window.fetch = function(url, options) {
      return originalFetch(url, options).then(function(response) {
        if (shouldGuard() && response && response.status === 401) {
          handleExpired();
        }
        return response;
      });
    };
  }

  if (shouldGuard() && !hasRequiredSession()) {
    handleExpired();
  }
})();
