// src/middleware/auth.js - 公共中间件
const { verifyToken } = require('../utils/auth');

// 验证 token 中间件
function authMiddleware(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) {
    return res.status(401).json({ code: -1, msg: '请先登录', data: null });
  }
  const payload = verifyToken(token);
  if (!payload) {
    return res.status(401).json({ code: -1, msg: 'token 无效或已过期', data: null });
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
