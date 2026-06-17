// src/utils/auth.js - 修复版本
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');

const JWT_SECRET = process.env.JWT_SECRET || 'exam-system-secret-key-change-in-production';
const SALT_ROUNDS = 10;

/**
 * 生成 JWT token
 */
function generateToken(payload) {
  return jwt.sign(payload, JWT_SECRET, {
    expiresIn: '7d',
    algorithm: 'HS256'
  });
}

/**
 * 验证 JWT token
 */
function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET, {
      algorithms: ['HS256']
    });
  } catch (err) {
    console.error('Token 验证失败:', err.message);
    return null;
  }
}

/**
 * 生成密码 hash
 */
function hashPassword(password) {
  return bcrypt.hashSync(password, SALT_ROUNDS);
}

/**
 * 验证密码
 */
function verifyPassword(password, hash) {
  return bcrypt.compareSync(password, hash);
}

module.exports = {
  generateToken,
  verifyToken,
  hashPassword,
  verifyPassword
};
