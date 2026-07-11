// src/middleware/feedback-inject.js - 移动端页面注入悬浮按钮脚本，防止微信缓存
const path = require('path');

function getAuthGuardMode(reqPath) {
  const pathname = reqPath || '';
  const adminOnlyPages = new Set([
    '/dashboard.html',
    '/exam.html',
    '/exam-print.html',
    '/exam-print-batch.html',
    '/feedback-list.html',
    '/file-manager.html',
    '/learning-materials-detail.html',
    '/meal-create.html',
    '/meal-list.html',
    '/meal-statistics.html',
    '/message-center.html',
    '/permission-list.html',
    '/settings.html',
    '/staff-detail.html',
    '/staff-list.html',
    '/voting-detail.html',
    '/voting-list.html'
  ]);

  const employeeOnlyPages = new Set([
    '/employee.html',
    '/employee-module-auth.html',
    '/exam-doing.html',
    '/exam-list.html',
    '/result.html',
    '/mobile-6s-add.html',
    '/mobile-6s-detail.html',
    '/mobile-6s-list.html',
    '/mobile-6s-tasks.html',
    '/mobile-exam-detail.html',
    '/mobile-exam-doing.html',
    '/mobile-exam-list.html',
    '/mobile-feedback-list.html',
    '/mobile-learning-materials-detail.html',
    '/mobile-learning-materials-list.html',
    '/mobile-meal-list.html',
    '/mobile-my-tasks.html',
    '/mobile-notifications.html',
    '/mobile-result.html',
    '/mobile-training-list.html',
    '/mobile-voting-list.html',
    '/mobile-workwear-inventory-count.html',
    '/mobile-workwear-query.html'
  ]);

  const eitherPages = new Set([
    '/6s-case-viewer.html',
    '/6s-list.html',
    '/6s-report.html',
    '/personal-todo.html',
    '/task-detail.html',
    '/workwear-management-preview.html'
  ]);

  if (pathname === '/' || pathname === '/index.html' || pathname === '/admin/login.html') {
    return 'none';
  }
  if (adminOnlyPages.has(pathname)) {
    return 'admin';
  }
  if (employeeOnlyPages.has(pathname)) {
    return 'employee';
  }
  if (eitherPages.has(pathname)) {
    return 'either';
  }
  return 'none';
}

function feedbackInjectMiddleware(req, res, next) {
  const isHtmlRequest = req.path === '/' || req.path.endsWith('.html');
  if (!isHtmlRequest) {
    return next();
  }

  const originalWrite = res.write.bind(res);
  const originalEnd = res.end.bind(res);
  let chunks = [];

  res.write = function(chunk, ...args) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  };

  res.end = function(chunk, ...args) {
    if (chunk) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }

    let body = Buffer.concat(chunks).toString('utf8');

    if (body.includes('</body>')) {
      // 生成时间戳 (YYYYMMDDHHmmss格式，更易读)
      const now = new Date();
      const ts = now.getFullYear() +
        String(now.getMonth() + 1).padStart(2, '0') +
        String(now.getDate()).padStart(2, '0') +
        String(now.getHours()).padStart(2, '0') +
        String(now.getMinutes()).padStart(2, '0') +
        String(now.getSeconds()).padStart(2, '0');

      // 0. 页面守卫与小程序环境脚本注入
      const authGuardMode = getAuthGuardMode(req.path);
      const headTagRegex = /<head[^>]*>/i;
      const shouldInjectMiniappAssets = req.path === '/' || /^\/(mobile-|employee)/.test(req.path);
      if (shouldInjectMiniappAssets && headTagRegex.test(body) && !body.includes('/css/miniapp-overrides.css')) {
        const envStyle = `\n<link rel="stylesheet" href="/css/miniapp-overrides.css?v=${ts}">\n`;
        body = body.replace(headTagRegex, (match) => match + envStyle);
      }

      const bodyTagRegex = /<body[^>]*>/i;
      if (bodyTagRegex.test(body)) {
        const bootScripts = [];
        if (authGuardMode !== 'none') {
          bootScripts.push(`\n<script>window.__AUTH_GUARD_MODE=${JSON.stringify(authGuardMode)};</script>`);
        }
        if (authGuardMode !== 'none' && !body.includes('/js/auth-guard.js')) {
          bootScripts.push(`\n<script src="/js/auth-guard.js?v=${ts}"></script>`);
        }
        if (shouldInjectMiniappAssets && !body.includes('/js/miniapp-bridge.js')) {
          bootScripts.push(`\n<script src="/js/miniapp-bridge.js?v=${ts}"></script>`);
        }
        if (bootScripts.length) {
          body = body.replace(bodyTagRegex, (match) => match + bootScripts.join('') + '\n');
        }
      }

      const shouldInjectFeedbackButton = req.path === '/' || /^\/(mobile-|employee|index).*\.html$/.test(req.path);
      // 登录页和反馈列表页不注入悬浮按钮脚本
      if (shouldInjectFeedbackButton && !req.path.endsWith('index.html') && !req.path.endsWith('mobile-feedback-list.html')) {
        // 1. 注入带时间戳的脚本
        const injectScript = `\n<script src="/js/mobile-feedback.js?v=${ts}"></script>\n`;
        body = body.replace('</body>', injectScript + '</body>');
      }

      // 2. 防止微信缓存：给页面内的所有相对路径链接加上时间戳
      body = body.replace(/href="([^"]*\.html)"/g, (match, url) => {
        if (url.startsWith('#')) return match;
        if (url.startsWith('http://') || url.startsWith('https://')) return match;
        if (url.includes('wxsns') || url.includes('wx.') || url.includes('weixin')) return match;
        if (url.includes('?v=')) return match;
        return `href="${url}?v=${ts}"`;
      });
    }

    const modifiedBuffer = Buffer.from(body, 'utf8');

    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.setHeader('Content-Length', modifiedBuffer.length);

    originalWrite(modifiedBuffer);
    originalEnd();
  };

  next();
}

// 专门处理 employee.html 的重定向（确保带时间戳）
function employeeRedirectMiddleware(req, res, next) {
  if (req.path === '/employee.html' && !req.query.v) {
    const ts = Date.now();
    return res.redirect(`/employee.html?v=${ts}`);
  }
  next();
}

module.exports = { feedbackInjectMiddleware, employeeRedirectMiddleware };
