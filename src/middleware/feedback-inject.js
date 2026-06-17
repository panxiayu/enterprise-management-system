// src/middleware/feedback-inject.js - 移动端页面注入悬浮按钮脚本，防止微信缓存
const path = require('path');

function feedbackInjectMiddleware(req, res, next) {
  // 拦截所有 HTML 页面请求（排除后台管理页面）
  if (!req.path.match(/^\/(mobile-|employee|index).*\.html$/) && req.path !== '/') {
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

      // 0. 在 <body> 标签后注入 auth-guard.js（token 过期检测 & fetch 401 拦截）
      const bodyTagRegex = /<body[^>]*>/i;
      if (bodyTagRegex.test(body)) {
        const authScript = `\n<script src="/js/auth-guard.js?v=${ts}"></script>\n`;
        body = body.replace(bodyTagRegex, (match) => match + authScript);
      }

      // 登录页和反馈列表页不注入悬浮按钮脚本
      if (!req.path.endsWith('index.html') && !req.path.endsWith('mobile-feedback-list.html')) {
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
