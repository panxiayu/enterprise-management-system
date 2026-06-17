// src/routes/admin.js - 管理员管理 API
const express = require('express');
const router = express.Router();
const db = require('../models/database');
const { verifyToken, hashPassword } = require('../utils/auth');
const Joi = require('joi');

// ============ 验证 Schema ============

const addAdminSchema = Joi.object({
  username: Joi.string().required().min(3).max(50),
  password: Joi.string().required().min(6).max(100),
  nickname: Joi.string(),
  can_manage_voting: Joi.number().integer().min(0).max(1),
  can_manage_exam: Joi.number().integer().min(0).max(1),
  can_manage_meal: Joi.number().integer().min(0).max(1),
  can_manage_staff: Joi.number().integer().min(0).max(1),
  can_manage_task: Joi.number().integer().min(0).max(1),
  can_manage_file: Joi.number().integer().min(0).max(1),
  can_manage_training: Joi.number().integer().min(0).max(1),
  can_manage_6s: Joi.number().integer().min(0).max(1),
  can_manage_permission: Joi.number().integer().min(0).max(1),
  can_manage_feedback: Joi.number().integer().min(0).max(1)
});

const updateAdminSchema = Joi.object({
  can_manage_voting: Joi.number().integer().min(0).max(1),
  can_manage_exam: Joi.number().integer().min(0).max(1),
  can_manage_meal: Joi.number().integer().min(0).max(1),
  can_manage_staff: Joi.number().integer().min(0).max(1),
  can_manage_task: Joi.number().integer().min(0).max(1),
  can_manage_file: Joi.number().integer().min(0).max(1),
  can_manage_training: Joi.number().integer().min(0).max(1),
  can_manage_6s: Joi.number().integer().min(0).max(1),
  can_manage_permission: Joi.number().integer().min(0).max(1),
  can_manage_feedback: Joi.number().integer().min(0).max(1)
});

// ============ 中间件 ============

function authMiddleware(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  
  if (!token) {
    return res.status(401).json({
      code: -1,
      msg: '请先登录',
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

  // 验证是否为管理员
  const user = db.prepare('SELECT * FROM users WHERE id = ? AND role = \'admin\'').get(payload.userId);
  if (!user) {
    return res.status(403).json({
      code: -1,
      msg: '需要管理员权限',
      data: null
    });
  }

  req.user = { ...payload, ...user };
  next();
}

function requirePermissionManager(req, res, next) {
  if (req.user?.username === 'admin' || Number(req.user?.can_manage_permission) === 1) {
    return next();
  }
  return res.status(403).json({
    code: -1,
    msg: '需要权限管理能力',
    data: null
  });
}

// ============ API 端点 ============

/**
 * POST /api/admin/log
 * 记录权限管理操作日志
 */
router.post('/log', authMiddleware, requirePermissionManager, (req, res) => {
  try {
    const { tab, action, status } = req.body;
    if (!tab || !action) {
      return res.status(400).json({ code: -1, msg: '参数不完整', data: null });
    }

    db.prepare(`
      INSERT INTO permission_action_logs (user_id, username, tab, action, status)
      VALUES (?, ?, ?, ?, ?)
    `).run(req.user.userId, req.user.username, tab, action, status || 'success');

    res.json({ code: 0, msg: 'success', data: null });
  } catch (err) {
    console.error('记录日志失败:', err);
    res.status(500).json({ code: -1, msg: '服务器错误', data: null });
  }
});

/**
 * GET /api/admin/logs
 * 获取权限管理操作日志
 * Query: tab=管理员&user_id=1
 */
router.get('/logs', authMiddleware, requirePermissionManager, (req, res) => {
  try {
    const { tab, user_id } = req.query;
    let sql = `SELECT id, username, tab, action, status, created_at FROM permission_action_logs WHERE 1=1`;
    const params = [];

    if (tab) {
      sql += ` AND tab = ?`;
      params.push(tab);
    }
    if (user_id) {
      sql += ` AND user_id = ?`;
      params.push(parseInt(user_id));
    }

    sql += ` ORDER BY created_at DESC LIMIT 100`;

    const logs = db.prepare(sql).all(...params);

    res.json({ code: 0, msg: 'success', data: logs });
  } catch (err) {
    console.error('获取日志失败:', err);
    res.status(500).json({ code: -1, msg: '服务器错误', data: null });
  }
});

/**
 * GET /api/admin/list
 * 获取管理员列表
 */
router.get('/list', authMiddleware, requirePermissionManager, (req, res) => {
  try {
    const admins = db.prepare(`
      SELECT id, username, email, nickname, role, status,
             can_manage_voting, can_manage_exam, can_manage_meal,
             can_manage_staff, can_manage_task, can_manage_file,
             can_manage_training, can_manage_6s, can_manage_permission,
             can_manage_feedback, staff_id,
             created_at, updated_at
      FROM users
      WHERE role = 'admin'
      ORDER BY created_at DESC
    `).all();

    res.json({
      code: 0,
      msg: 'success',
      data: admins
    });
  } catch (err) {
    console.error('获取管理员列表失败:', err);
    res.status(500).json({
      code: -1,
      msg: '服务器错误',
      data: null
    });
  }
});

/**
 * POST /api/admin/add
 * 添加管理员
 */
router.post('/add', authMiddleware, requirePermissionManager, (req, res) => {
  try {
    const { error, value } = addAdminSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        code: -1,
        msg: error.details[0].message,
        data: null
      });
    }

    const { username, password, nickname,
      can_manage_voting = 0,
      can_manage_exam = 0,
      can_manage_meal = 0,
      can_manage_staff = 0,
      can_manage_task = 0,
      can_manage_file = 0,
      can_manage_training = 0,
      can_manage_6s = 0,
      can_manage_permission = 0,
      can_manage_feedback = 0
    } = value;

    // 检查用户名是否已存在
    const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
    if (existing) {
      return res.status(400).json({
        code: -1,
        msg: '用户名已存在',
        data: null
      });
    }

    // 加密密码
    const hashedPassword = hashPassword(password);

    const matchedStaff = db.prepare('SELECT id FROM staff WHERE employee_id = ? LIMIT 1').get(username);

    // 插入管理员
    const result = db.prepare(`
      INSERT INTO users (username, password, nickname, role, status,
                        can_manage_voting, can_manage_exam, can_manage_meal,
                        can_manage_staff, can_manage_task, can_manage_file,
                        can_manage_training, can_manage_6s, can_manage_permission,
                        can_manage_feedback, staff_id)
      VALUES (?, ?, ?, 'admin', 'active', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(username, hashedPassword, nickname || username,
      can_manage_voting, can_manage_exam, can_manage_meal,
      can_manage_staff, can_manage_task, can_manage_file,
      can_manage_training, can_manage_6s, can_manage_permission,
      can_manage_feedback, matchedStaff?.id || null);

    // 获取新创建的管理员
    const newAdmin = db.prepare(`
      SELECT id, username, nickname, role, status,
             can_manage_voting, can_manage_exam, can_manage_meal,
             can_manage_staff, can_manage_task, can_manage_file,
             can_manage_training, can_manage_6s, can_manage_permission,
             can_manage_feedback, staff_id, created_at
      FROM users WHERE id = ?
    `).get(result.lastInsertRowid);

    res.json({
      code: 0,
      msg: '管理员添加成功',
      data: newAdmin
    });
  } catch (err) {
    console.error('添加管理员失败:', err);
    res.status(500).json({
      code: -1,
      msg: '服务器错误',
      data: null
    });
  }
});

/**
 * PUT /api/admin/:id/update
 * 更新管理员权限
 */
router.put('/:id/update', authMiddleware, requirePermissionManager, (req, res) => {
  try {
    const adminId = parseInt(req.params.id);
    
    if (!adminId) {
      return res.status(400).json({
        code: -1,
        msg: '无效的用户 ID',
        data: null
      });
    }

    // 验证参数
    const { error, value } = updateAdminSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        code: -1,
        msg: error.details[0].message,
        data: null
      });
    }

    // 检查目标用户是否为管理员
    const target = db.prepare("SELECT * FROM users WHERE id = ? AND role = 'admin'").get(adminId);
    if (!target) {
      return res.status(404).json({
        code: -1,
        msg: '管理员不存在',
        data: null
      });
    }

    // 构建更新语句
    const updates = [];
    const params = [];
    for (const [key, val] of Object.entries(value)) {
      updates.push(`${key} = ?`);
      params.push(val);
    }

    if (updates.length === 0) {
      return res.status(400).json({
        code: -1,
        msg: '没有提供要更新的权限',
        data: null
      });
    }

    params.push(adminId);
    const updateSql = `UPDATE users SET ${updates.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`;

    db.prepare(updateSql).run(...params);

    // 获取更新后的管理员
    const updatedAdmin = db.prepare(`
      SELECT id, username, email, nickname, role, status,
             can_manage_voting, can_manage_exam, can_manage_meal,
             can_manage_staff, can_manage_task, can_manage_file,
             can_manage_training, can_manage_6s, can_manage_permission,
             can_manage_feedback, staff_id, updated_at
      FROM users WHERE id = ?
    `).get(adminId);

    res.json({
      code: 0,
      msg: '管理员权限更新成功',
      data: updatedAdmin
    });
  } catch (err) {
    console.error('更新管理员权限失败:', err);
    res.status(500).json({
      code: -1,
      msg: '服务器错误',
      data: null
    });
  }
});

/**
 * DELETE /api/admin/:id
 * 删除管理员
 */
router.delete('/:id', authMiddleware, requirePermissionManager, (req, res) => {
  try {
    const adminId = parseInt(req.params.id);
    
    if (!adminId) {
      return res.status(400).json({
        code: -1,
        msg: '无效的用户 ID',
        data: null
      });
    }

    // 不能删除自己
    if (adminId === req.user.userId) {
      return res.status(400).json({
        code: -1,
        msg: '不能删除自己',
        data: null
      });
    }

    // 检查目标用户是否为管理员
    const target = db.prepare("SELECT * FROM users WHERE id = ? AND role = 'admin'").get(adminId);
    if (!target) {
      return res.status(404).json({
        code: -1,
        msg: '管理员不存在',
        data: null
      });
    }

    // 检查是否为最后一个管理员
    const adminCount = db.prepare("SELECT COUNT(*) as count FROM users WHERE role = 'admin'").get().count;
    if (adminCount <= 1) {
      return res.status(400).json({
        code: -1,
        msg: '不能删除最后一个管理员',
        data: null
      });
    }

    // 删除管理员
    db.prepare('DELETE FROM users WHERE id = ?').run(adminId);

    res.json({
      code: 0,
      msg: '管理员删除成功',
      data: { id: adminId }
    });
  } catch (err) {
    console.error('删除管理员失败:', err);
    res.status(500).json({
      code: -1,
      msg: '服务器错误',
      data: null
    });
  }
});

module.exports = router;
