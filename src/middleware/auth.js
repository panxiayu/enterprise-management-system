// src/middleware/auth.js - 公共中间件
const { verifyToken } = require('../utils/auth');

function getShanghaiDateStamp(date = new Date()) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
  return formatter.format(date);
}

// 验证 token 中间件
function authMiddleware(req, res, next) {
  // 支持 header 或 query 参数传递 token
  const token = req.headers.authorization?.replace('Bearer ', '') || req.query.token;
  if (!token) {
    return res.status(401).json({ code: -1, msg: '请先登录', data: null });
  }
  const payload = verifyToken(token);
  if (!payload) {
    return res.status(401).json({ code: -1, msg: 'token 无效或已过期', data: null });
  }
  if (payload.role === 'admin') {
    const loginDay = String(payload.admin_login_day || '').trim();
    const today = getShanghaiDateStamp();
    if (!loginDay || loginDay !== today) {
      return res.status(401).json({ code: -1, msg: '管理员会话已跨天失效，请重新登录', data: null });
    }
  }
  req.user = payload;
  next();
}

// 管理员权限验证中间件
function adminMiddleware(req, res, next) {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ code: -1, msg: '需要管理员权限', data: null });
  }
  next();
}

module.exports = {
  authMiddleware,
  adminMiddleware
};
