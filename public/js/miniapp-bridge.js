(function () {
  if (window.MiniAppBridge) return;

  function detectMiniProgram() {
    var ua = window.navigator.userAgent || '';
    if (window.__wxjs_environment === 'miniprogram') return true;
    return /miniProgram/i.test(ua) || /miniprogram/i.test(ua);
  }

  function canPostToMiniApp() {
    return !!(window.wx && window.wx.miniProgram && typeof window.wx.miniProgram.postMessage === 'function');
  }

  function safeDispatch(name, detail) {
    try {
      window.dispatchEvent(new CustomEvent(name, { detail: detail || {} }));
    } catch (err) {}
  }

  function tryDecode(value) {
    try {
      return decodeURIComponent(value);
    } catch (err) {
      return value;
    }
  }

  function bootstrapSessionFromQuery() {
    try {
      var search = new URLSearchParams(window.location.search || '');
      var token = search.get('miniapp_token');
      var staffText = search.get('miniapp_staff');
      if (!token && !staffText) return;
      var payload = {};
      if (token) payload.token = tryDecode(token);
      if (staffText) {
        try {
          payload.staff = JSON.parse(tryDecode(staffText));
        } catch (err) {}
      }
      storeSession(payload);
      safeDispatch('miniapp:session-bootstrapped', payload);
    } catch (err) {}
  }

  function applyEnvironmentClasses() {
    var search = new URLSearchParams(window.location.search || '');
    var isMiniApp = detectMiniProgram() || search.get('miniapp') === '1';
    var root = document.documentElement;
    var body = document.body;
    if (!root || !body) return;

    root.classList.remove('env-miniapp', 'env-browser');
    body.classList.remove('env-miniapp', 'env-browser');

    if (isMiniApp) {
      root.classList.add('env-miniapp');
      body.classList.add('env-miniapp');
    } else {
      root.classList.add('env-browser');
      body.classList.add('env-browser');
    }

    var path = String(window.location.pathname || '/')
      .replace(/^\/+/, '')
      .replace(/\.html$/i, '')
      .replace(/[^a-zA-Z0-9_-]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '') || 'root';
    var pageClass = 'page-' + path.toLowerCase();
    var existing = Array.prototype.slice.call(body.classList).filter(function (item) {
      return item.indexOf('page-') === 0;
    });
    existing.forEach(function (item) {
      body.classList.remove(item);
      root.classList.remove(item);
    });
    body.classList.add(pageClass);
    root.classList.add(pageClass);
  }

  var refreshHandlers = [];

  function invokeRefresh(detail) {
    if (!refreshHandlers.length) {
      window.location.reload();
      return;
    }
    var handled = false;
    refreshHandlers.forEach(function (handler) {
      try {
        handled = handler(detail || {}) !== false || handled;
      } catch (err) {
        console.error('MiniAppBridge refresh handler error:', err);
      }
    });
    if (!handled) window.location.reload();
  }

  function normalizeMessage(raw) {
    if (!raw) return [];
    if (Array.isArray(raw)) return raw;
    if (Array.isArray(raw.data)) return raw.data;
    return [raw];
  }

  function storeSession(payload) {
    if (!payload || typeof payload !== 'object') return;
    if (payload.token) localStorage.setItem('employee_token', payload.token);
    if (payload.staff) localStorage.setItem('employee_info', JSON.stringify(payload.staff));
    if (payload.user) localStorage.setItem('user_info', JSON.stringify(payload.user));
  }

  function handleIncomingMessage(raw) {
    normalizeMessage(raw).forEach(function (message) {
      if (!message || typeof message !== 'object') return;
      var type = message.type || message.action || '';
      if (!type) return;

      if (type === 'miniapp-refresh' || type === 'refresh') {
        invokeRefresh(message.payload || {});
        return;
      }

      if (type === 'miniapp-set-session') {
        storeSession(message.payload || {});
        safeDispatch('miniapp:session-updated', message.payload || {});
        return;
      }

      if (type === 'miniapp-navigate' && message.payload && message.payload.url) {
        window.location.href = message.payload.url;
        return;
      }

      if (type === 'miniapp-ping') {
        bridge.postMessage('h5-pong', { href: window.location.href, title: document.title });
        return;
      }

      safeDispatch('miniapp:message', message);
    });
  }

  var bridge = {
    isMiniProgram: detectMiniProgram,
    canPostMessage: canPostToMiniApp,
    onRefresh: function (handler) {
      if (typeof handler === 'function') refreshHandlers.push(handler);
      return function () {
        refreshHandlers = refreshHandlers.filter(function (item) { return item !== handler; });
      };
    },
    requestRefresh: function (payload) {
      return bridge.postMessage('request-refresh', payload || {});
    },
    requestSubscription: function (templateKeys, extra) {
      return bridge.postMessage('request-subscription', {
        template_keys: Array.isArray(templateKeys) ? templateKeys : [],
        extra: extra || {},
        href: window.location.pathname + window.location.search
      });
    },
    syncNotificationSummary: async function (token) {
      try {
        var authToken = token || localStorage.getItem('employee_token') || localStorage.getItem('token') || '';
        if (!authToken) return null;
        var res = await fetch('/api/notifications/summary', {
          headers: { Authorization: 'Bearer ' + authToken }
        });
        var data = await res.json();
        if (data && data.code === 0) {
          bridge.postMessage('notification-summary', data.data || {});
          return data.data || {};
        }
      } catch (err) {
        console.warn('MiniAppBridge syncNotificationSummary failed:', err);
      }
      return null;
    },
    postMessage: function (type, payload) {
      var message = {
        type: type,
        payload: payload || {},
        href: window.location.pathname + window.location.search,
        title: document.title,
        ts: Date.now()
      };
      if (canPostToMiniApp()) {
        try {
          window.wx.miniProgram.postMessage({ data: message });
          return true;
        } catch (err) {
          console.warn('MiniAppBridge postMessage failed:', err);
        }
      }
      return false;
    },
    notifyReady: function (payload) {
      return bridge.postMessage('h5-ready', payload || {});
    },
    storeSession: storeSession,
    triggerRefresh: invokeRefresh
  };

  window.MiniAppBridge = bridge;
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', applyEnvironmentClasses, { once: true });
  } else {
    applyEnvironmentClasses();
  }
  bootstrapSessionFromQuery();
  window.addEventListener('message', function (event) {
    handleIncomingMessage(event.data);
  });
  document.addEventListener('WeixinJSBridgeReady', function () {
    applyEnvironmentClasses();
    bridge.notifyReady({ environment: 'WeixinJSBridgeReady' });
  });
  window.addEventListener('pageshow', function () {
    applyEnvironmentClasses();
    bridge.notifyReady({ environment: bridge.isMiniProgram() ? 'miniapp' : 'browser' });
  });
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) bridge.postMessage('h5-visible', {});
  });
})();
