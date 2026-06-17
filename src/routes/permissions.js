// src/routes/permissions.js - 权限管理 API
const express = require('express');
const router = express.Router();
const db = require('../models/database');
const { verifyToken } = require('../utils/auth');
const Joi = require('joi');

// ============ 验证 Schema ============

const permissionSchema = Joi.object({
  name: Joi.string().required().max(100),
  key: Joi.string().required().max(100),
  description: Joi.string().allow('').max(500),
  type: Joi.string().valid('admin', 'user').default('user')
});

const updatePermissionSchema = Joi.object({
  name: Joi.string().max(100),
  key: Joi.string().max(100),
  description: Joi.string().allow('').max(500),
  type: Joi.string().valid('admin', 'user')
});

// ============ 中间件 ============

function authMiddleware(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '');

  if (!token) {
    return res.status(401).json({ code: -1, msg: '请先登录', data: null });
  }

  const payload = verifyToken(token);
  if (!payload) {
    return res.status(401).json({ code: -1, msg: 'token 无效或已过期', data: null });
  }

  // 验证是否为管理员
  const user = db.prepare('SELECT * FROM users WHERE id = ? AND role = \'admin\'').get(payload.userId);
  if (!user) {
    return res.status(403).json({ code: -1, msg: '需要管理员权限', data: null });
  }

  req.user = { ...payload, ...user };
  next();
}

function requirePermissionManager(req, res, next) {
  if (req.user?.username === 'admin' || Number(req.user?.can_manage_permission) === 1) {
    return next();
  }
  return res.status(403).json({ code: -1, msg: '需要权限管理能力', data: null });
}

// ============ 初始化表 ============

function initPermissionsTable() {
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS permissions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        key TEXT UNIQUE NOT NULL,
        description TEXT,
        type TEXT DEFAULT 'user',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
  } catch (err) {
    console.error('创建权限表失败:', err);
  }
}

initPermissionsTable();

// ============ API 端点 ============

/**
 * GET /api/admin/permissions
 * 获取所有权限
 */
router.get('/', authMiddleware, requirePermissionManager, (req, res) => {
  try {
    const permissions = db.prepare('SELECT * FROM permissions ORDER BY type, id').all();

    res.json({
      code: 0,
      msg: 'success',
      data: permissions
    });
  } catch (err) {
    console.error('获取权限列表失败:', err);
    res.status(500).json({ code: -1, msg: '服务器错误', data: null });
  }
});

/**
 * POST /api/admin/permissions
 * 添加权限
 */
router.post('/', authMiddleware, requirePermissionManager, (req, res) => {
  try {
    const { error, value } = permissionSchema.validate(req.body);
    if (error) {
      return res.status(400).json({ code: -1, msg: error.details[0].message, data: null });
    }

    const { name, key, description, type } = value;

    // 检查 key 是否已存在
    const existing = db.prepare('SELECT id FROM permissions WHERE key = ?').get(key);
    if (existing) {
      return res.status(400).json({ code: -1, msg: '权限标识已存在', data: null });
    }

    const result = db.prepare(`
      INSERT INTO permissions (name, key, description, type)
      VALUES (?, ?, ?, ?)
    `).run(name, key, description || '', type);

    const newPermission = db.prepare('SELECT * FROM permissions WHERE id = ?').get(result.lastInsertRowid);

    res.json({
      code: 0,
      msg: '权限添加成功',
      data: newPermission
    });
  } catch (err) {
    console.error('添加权限失败:', err);
    res.status(500).json({ code: -1, msg: '服务器错误', data: null });
  }
});

/**
 * PUT /api/admin/permissions/:id
 * 更新权限
 */
router.put('/:id', authMiddleware, requirePermissionManager, (req, res) => {
  try {
    const permId = parseInt(req.params.id);

    if (!permId) {
      return res.status(400).json({ code: -1, msg: '无效的权限 ID', data: null });
    }

    const { error, value } = updatePermissionSchema.validate(req.body);
    if (error) {
      return res.status(400).json({ code: -1, msg: error.details[0].message, data: null });
    }

    // 检查权限是否存在
    const existing = db.prepare('SELECT * FROM permissions WHERE id = ?').get(permId);
    if (!existing) {
      return res.status(404).json({ code: -1, msg: '权限不存在', data: null });
    }

    // 如果修改了 key，检查是否与其他权限冲突
    if (value.key && value.key !== existing.key) {
      const conflict = db.prepare('SELECT id FROM permissions WHERE key = ? AND id != ?').get(value.key, permId);
      if (conflict) {
        return res.status(400).json({ code: -1, msg: '权限标识已存在', data: null });
      }
    }

    // 构建更新语句
    const updates = [];
    const params = [];
    for (const [k, v] of Object.entries(value)) {
      if (v !== undefined) {
        updates.push(`${k} = ?`);
        params.push(v);
      }
    }

    if (updates.length === 0) {
      return res.status(400).json({ code: -1, msg: '没有提供要更新的内容', data: null });
    }

    params.push(permId);
    const updateSql = `UPDATE permissions SET ${updates.join(', ')} WHERE id = ?`;

    db.prepare(updateSql).run(...params);

    const updatedPermission = db.prepare('SELECT * FROM permissions WHERE id = ?').get(permId);

    res.json({
      code: 0,
      msg: '权限更新成功',
      data: updatedPermission
    });
  } catch (err) {
    console.error('更新权限失败:', err);
    res.status(500).json({ code: -1, msg: '服务器错误', data: null });
  }
});

/**
 * DELETE /api/admin/permissions/:id
 * 删除权限
 */
router.delete('/:id', authMiddleware, requirePermissionManager, (req, res) => {
  try {
    const permId = parseInt(req.params.id);

    if (!permId) {
      return res.status(400).json({ code: -1, msg: '无效的权限 ID', data: null });
    }

    // 检查权限是否存在
    const existing = db.prepare('SELECT * FROM permissions WHERE id = ?').get(permId);
    if (!existing) {
      return res.status(404).json({ code: -1, msg: '权限不存在', data: null });
    }

    db.prepare('DELETE FROM permissions WHERE id = ?').run(permId);

    res.json({
      code: 0,
      msg: '权限删除成功',
      data: { id: permId }
    });
  } catch (err) {
    console.error('删除权限失败:', err);
    res.status(500).json({ code: -1, msg: '服务器错误', data: null });
  }
});

module.exports = router;
