// src/routes/auth.js - 修复版本
const express = require('express');
const router = express.Router();
const db = require('../models/database');
const { generateToken, verifyToken, hashPassword, verifyPassword } = require('../utils/auth');
const rateLimit = require('express-rate-limit');
const Joi = require('joi');

// 速率限制：登录尝试
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 分钟
  max: 5, // 最多 5 次尝试
  message: '登录尝试过多，请稍后再试',
  standardHeaders: true,
  legacyHeaders: false
});

// 输入验证 schema
const loginSchema = Joi.object({
  openid: Joi.string().required().messages({
    'string.empty': 'openid 不能为空',
    'any.required': '缺少 openid'
  }),
  nickname: Joi.string().optional(),
  avatar: Joi.string().optional()
});

const adminLoginSchema = Joi.object({
  username: Joi.string().required().messages({
    'string.empty': '用户名不能为空',
    'any.required': '缺少用户名'
  }),
  password: Joi.string().required().messages({
    'string.empty': '密码不能为空',
    'any.required': '缺少密码'
  })
});

// POST /api/auth/login
// 接收微信 openid，返回 token
router.post('/login', loginLimiter, (req, res) => {
  try {
    // 验证输入
    const { error, value } = loginSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        code: -1,
        msg: error.details[0].message,
        data: null
      });
    }

    const { openid, nickname, avatar } = value;

    // 查找或创建用户
    let user = db.prepare('SELECT * FROM users WHERE openid = ?').get(openid);

    if (!user) {
      // 自动注册新用户
      db.prepare(
        `INSERT INTO users (openid, nickname, avatar, role) 
         VALUES (?, ?, ?, 'student')`
      ).run(openid, nickname || '微信用户', avatar || '');
      
      // 重新查询用户
      user = db.prepare('SELECT * FROM users WHERE openid = ?').get(openid);
      
      if (!user) {
        throw new Error('用户创建失败');
      }
    }

    // 生成 token
    const token = generateToken({
      userId: user.id,
      openid: user.openid,
      role: user.role
    });

    // 不返回密码相关字段
    const { password, ...safeUser } = user;

    res.json({
      code: 0,
      msg: '登录成功',
      data: {
        token,
        user: safeUser
      }
    });
  } catch (err) {
    console.error('登录失败:', err);
    res.status(500).json({
      code: -1,
      msg: '服务器错误',
      data: null
    });
  }
});

// GET /api/auth/me
// 验证 token 并返回用户信息
router.get('/me', (req, res) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');

    if (!token) {
      return res.status(401).json({
        code: -1,
        msg: '未提供 token',
        data: null
      });
    }

    const payload = verifyToken(token);
    if (!payload) {
      return res.status(401).json({
        code: -1,
        msg: 'token 无效或已过期',
        data: null
      });
    }

    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(payload.userId);
    if (!user) {
      return res.status(404).json({
        code: -1,
        msg: '用户不存在',
        data: null
      });
    }

    const { password, ...safeUser } = user;
    res.json({
      code: 0,
      msg: 'success',
      data: safeUser
    });
  } catch (err) {
    console.error('验证失败:', err);
    res.status(500).json({
      code: -1,
      msg: '服务器错误',
      data: null
    });
  }
});

// POST /api/auth/admin-login
// 管理员登录（用户名密码）
router.post('/admin-login', loginLimiter, (req, res) => {
  try {
    // 验证输入
    const { error, value } = adminLoginSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        code: -1,
        msg: error.details[0].message,
        data: null
      });
    }

    const { username, password } = value;

    // 查找管理员用户
    const user = db.prepare(
      'SELECT * FROM users WHERE username = ? AND role = ?'
    ).get(username, 'admin');

    if (!user) {
      return res.status(401).json({
        code: -1,
        msg: '管理员用户不存在',
        data: null
      });
    }

    // 验证密码（使用 bcrypt）
    if (!user.password || !verifyPassword(password, user.password)) {
      return res.status(401).json({
        code: -1,
        msg: '密码错误',
        data: null
      });
    }

    // 生成 token
    const token = generateToken({
      userId: user.id,
      openid: user.openid || '',
      role: user.role
    });

    res.json({
      code: 0,
      msg: '管理员登录成功',
      data: {
        token,
        user: {
          id: user.id,
          username: user.username,
          nickname: user.nickname,
          role: user.role
        }
      }
    });
  } catch (err) {
    console.error('管理员登录失败:', err);
    res.status(500).json({
      code: -1,
      msg: '服务器错误',
      data: null
    });
  }
});

module.exports = router;
