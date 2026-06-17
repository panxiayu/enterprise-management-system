// src/routes/auth.js - 完整的认证 API
const express = require('express');
const router = express.Router();
const db = require('../models/database');
const { generateToken, verifyToken, hashPassword, verifyPassword } = require('../utils/auth');
const Joi = require('joi');

function getShanghaiDateStamp(date = new Date()) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
  return formatter.format(date);
}

// ============ 验证 Schema ============

const adminLoginSchema = Joi.object({
  username: Joi.string().required().min(3).max(50),
  password: Joi.string().required().min(6).max(100)
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

  if (payload.role === 'admin') {
    const loginDay = String(payload.admin_login_day || '').trim();
    const today = getShanghaiDateStamp();
    if (!loginDay || loginDay !== today) {
      return res.status(401).json({
        code: -1,
        msg: '管理员会话已跨天失效，请重新登录',
        data: null
      });
    }
  }

  req.user = payload;
  next();
}

// ============ API 端点 ============

/**
 * POST /api/auth/login
 * 统一登录接口
 * - 管理员：{ username, password }
 * - 用户：{ nickname, openid, avatar? }
 */
router.post('/login', (req, res) => {
  try {
    const { username, password, nickname, openid, avatar } = req.body;

    // ============ 管理员登录 ============
    if (username && password) {
      // 验证输入
      const { error, value } = adminLoginSchema.validate({ username, password });
      if (error) {
        return res.status(400).json({
          code: -1,
          msg: error.details[0].message,
          data: null
        });
      }

      // 查找管理员用户（使用单引号括起字符串值）
      const user = db.prepare("SELECT * FROM users WHERE username = ? AND role = 'admin'").get(username);

      if (!user) {
        return res.status(401).json({
          code: -1,
          msg: '用户名或密码错误',
          data: null
        });
      }

      // 验证密码
      if (!verifyPassword(password, user.password)) {
        return res.status(401).json({
          code: -1,
          msg: '用户名或密码错误',
          data: null
        });
      }

      // 生成 token
      const token = generateToken({
        userId: user.id,
        username: user.username,
        role: user.role,
        type: 'admin',
        admin_login_day: getShanghaiDateStamp(),
        can_manage_voting: user.can_manage_voting || 0,
        can_manage_exam: user.can_manage_exam || 0,
        can_manage_meal: user.can_manage_meal || 0,
        can_manage_staff: user.can_manage_staff || 0,
        can_manage_task: user.can_manage_task || 0,
        can_manage_training: user.can_manage_training || 0,
        can_manage_6s: user.can_manage_6s || 0,
        can_manage_permission: user.can_manage_permission || 0,
        can_manage_file: user.can_manage_file || 0
      });

      // 返回用户信息（不包含密码）
      const { password: _, ...safeUser } = user;

      // 确保权限字段存在
      safeUser.can_manage_voting = user.can_manage_voting || 0;
      safeUser.can_manage_exam = user.can_manage_exam || 0;
      safeUser.can_manage_meal = user.can_manage_meal || 0;
      safeUser.can_manage_staff = user.can_manage_staff || 0;
      safeUser.can_manage_task = user.can_manage_task || 0;
      safeUser.can_manage_training = user.can_manage_training || 0;
      safeUser.can_manage_6s = user.can_manage_6s || 0;
      safeUser.can_manage_permission = user.can_manage_permission || 0;
      safeUser.can_manage_file = user.can_manage_file || 0;

      return res.json({
        code: 0,
        msg: '登录成功',
        data: {
          token,
          user: safeUser
        }
      });
    }

    // ============ 用户考试登录 ============
    if (nickname && openid) {
      // 检查用户是否在系统中（管理员预先添加）
      const user = db.prepare('SELECT * FROM users WHERE nickname = ? AND role IN ("student", "user")').get(nickname);

      if (!user) {
        return res.status(401).json({
          code: -1,
          msg: '名字不匹配，无法登入',
          data: null
        });
      }

      // 用户已存在，直接登录（更新 openid、avatar 等信息）
      try {
        db.prepare(
          'UPDATE users SET openid = ?, avatar = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
        ).run(openid, avatar || '', user.id);
      } catch (e) {
        // 忽略更新错误（如 openid 冲突）
      }

      // 生成 token
      const token = generateToken({
        userId: user.id,
        username: user.nickname,
        role: user.role
      });

      const { password: _, ...safeUser } = user;

      return res.json({
        code: 0,
        msg: '登录成功',
        data: {
          token,
          user: safeUser
        }
      });
    }

    // 参数不足
    return res.status(400).json({
      code: -1,
      msg: '请求参数错误：管理员需提供 username+password，用户需提供 nickname+openid',
      data: null
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

/**
 * GET /api/auth/me
 * 获取当前用户信息
 */
router.get('/me', authMiddleware, (req, res) => {
  try {
    const currentUserId = req.user.type === 'employee' ? req.user.id : req.user.userId;
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(currentUserId);

    if (!user) {
      return res.status(404).json({
        code: -1,
        msg: '用户不存在',
        data: null
      });
    }

    const { password: _, ...safeUser } = user;

    res.json({
      code: 0,
      msg: 'success',
      data: safeUser
    });
  } catch (err) {
    console.error('获取用户信息失败:', err);
    res.status(500).json({
      code: -1,
      msg: '服务器错误',
      data: null
    });
  }
});

/**
 * POST /api/auth/logout
 * 登出
 */
router.post('/logout', authMiddleware, (req, res) => {
  res.json({
    code: 0,
    msg: '登出成功',
    data: null
  });
});

/**
 * POST /api/auth/refresh
 * 刷新 token
 */
router.post('/refresh', authMiddleware, (req, res) => {
  try {
    const currentUserId = req.user.type === 'employee' ? req.user.id : req.user.userId;
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(currentUserId);

    if (!user) {
      return res.status(404).json({
        code: -1,
        msg: '用户不存在',
        data: null
      });
    }

    // 根据用户类型生成对应的 token
    const newToken = req.user.type === 'employee'
      ? generateToken({ id: user.id, type: 'employee', employee_id: user.employee_id, name: user.name })
      : generateToken({
          userId: user.id,
          username: user.username,
          role: user.role,
          type: 'admin',
          admin_login_day: getShanghaiDateStamp()
        });

    res.json({
      code: 0,
      msg: 'token 刷新成功',
      data: {
        token: newToken
      }
    });
  } catch (err) {
    console.error('刷新 token 失败:', err);
    res.status(500).json({
      code: -1,
      msg: '服务器错误',
      data: null
    });
  }
});

/**
 * PUT /api/auth/permissions
 * 更新当前用户的权限（管理员专用）
 */
router.put('/permissions', authMiddleware, (req, res) => {
  try {
    // 只有管理员可以修改权限
    if (req.user.role !== 'admin') {
      return res.status(403).json({
        code: -1,
        msg: '只有管理员可以修改权限',
        data: null
      });
    }

    const { can_manage_voting, can_manage_exam, can_manage_meal, can_manage_staff, can_manage_task } = req.body;

    // 验证参数
    const permissions = {
      can_manage_voting: can_manage_voting !== undefined ? (can_manage_voting ? 1 : 0) : undefined,
      can_manage_exam: can_manage_exam !== undefined ? (can_manage_exam ? 1 : 0) : undefined,
      can_manage_meal: can_manage_meal !== undefined ? (can_manage_meal ? 1 : 0) : undefined,
      can_manage_staff: can_manage_staff !== undefined ? (can_manage_staff ? 1 : 0) : undefined,
      can_manage_task: can_manage_task !== undefined ? (can_manage_task ? 1 : 0) : undefined
    };

    // 构建更新语句
    const updates = [];
    const params = [];
    for (const [key, value] of Object.entries(permissions)) {
      if (value !== undefined) {
        updates.push(`${key} = ?`);
        params.push(value);
      }
    }

    if (updates.length === 0) {
      return res.status(400).json({
        code: -1,
        msg: '没有提供要更新的权限',
        data: null
      });
    }

    params.push(req.user.userId);
    const updateSql = `UPDATE users SET ${updates.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`;

    db.prepare(updateSql).run(...params);

    // 获取更新后的用户
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.userId);
    const { password: _, ...safeUser } = user;

    res.json({
      code: 0,
      msg: '权限更新成功',
      data: safeUser
    });
  } catch (err) {
    console.error('更新权限失败:', err);
    res.status(500).json({
      code: -1,
      msg: '服务器错误',
      data: null
    });
  }
});

/**
 * GET /api/auth/lookup?employee_id=xxx
 * 根据工号查询员工姓名（无权限验证，用于登录页自动填充）
 */
router.get('/lookup', (req, res) => {
  try {
    const { employee_id } = req.query;
    if (!employee_id) {
      return res.json({ code: -1, msg: '工号不能为空', data: null });
    }
    const staff = db.prepare(
      "SELECT name FROM staff WHERE employee_id = ? AND status = 'active'"
    ).get(employee_id.trim());
    if (staff) {
      res.json({ code: 0, msg: 'ok', data: { name: staff.name } });
    } else {
      // 查学生名册
      const student = db.prepare(
        "SELECT name FROM student_roster WHERE employee_id = ?"
      ).get(employee_id.trim());
      res.json({ code: 0, msg: 'ok', data: { name: student?.name || null } });
    }
  } catch (err) {
    res.status(500).json({ code: -1, msg: '服务器错误', data: null });
  }
});

/**
 * GET /api/auth/search-staff?keyword=xxx
 * 搜索员工和学生（用于临时报餐等场景）
 */
router.get('/search-staff', authMiddleware, (req, res) => {
  try {
    const { keyword } = req.query;
    if (!keyword) {
      return res.json({ code: 0, msg: 'ok', data: [] });
    }
    const staffResults = db.prepare(`
      SELECT id, employee_id, name, department, position, '员工' as type
      FROM staff
      WHERE status = 'active' AND (name LIKE ? OR employee_id LIKE ?)
      LIMIT 20
    `).all(`%${keyword}%`, `%${keyword}%`);

    const studentResults = db.prepare(`
      SELECT id, employee_id, name, department, '实训生' as position, '学生' as type
      FROM student_roster
      WHERE name LIKE ? OR employee_id LIKE ?
      LIMIT 20
    `).all(`%${keyword}%`, `%${keyword}%`);

    const combined = [...staffResults, ...studentResults].slice(0, 30);
    res.json({ code: 0, msg: 'ok', data: combined });
  } catch (err) {
    res.status(500).json({ code: -1, msg: '服务器错误', data: null });
  }
});

/**
 * POST /api/auth/employee-login
 * 员工登录：工号 + 姓名验证
 */
router.post('/employee-login', (req, res) => {
  try {
    const { employee_id, name } = req.body;

    if (!employee_id || !name) {
      return res.status(400).json({ code: -1, msg: '工号和姓名不能为空', data: null });
    }

    const staff = db.prepare(
      "SELECT * FROM staff WHERE employee_id = ? AND name = ? AND status = 'active'"
    ).get(employee_id.trim(), name.trim());

    // 如果staff表找不到，查学生名册
    let isStudent = false;
    let staffData = staff;
    if (!staff) {
      const student = db.prepare(
        "SELECT * FROM student_roster WHERE employee_id = ? AND name = ?"
      ).get(employee_id.trim(), name.trim());
      if (student) {
        isStudent = true;
        // 直接使用学生ID，不转换
        staffData = {
          id: student.id,
          name: student.name,
          employee_id: student.employee_id,
          department: student.department || '',
          position: '实训生'
        };
      }
    }

    if (!staffData) {
      return res.status(401).json({ code: -1, msg: '工号或姓名不匹配，无登录权限', data: null });
    }

    const token = generateToken({ id: staffData.id, type: 'employee', employee_id: staffData.employee_id, name: staffData.name, s6_permission: staffData.s6_permission || 0 });

    res.json({
      code: 0,
      msg: '登录成功',
      data: {
        token,
        staff: {
          id: staffData.id,
          name: staffData.name,
          employee_id: staffData.employee_id,
          department: staffData.department,
          position: staffData.position,
          is_student: isStudent ? 1 : 0
        }
      }
    });
  } catch (err) {
    console.error('员工登录失败:', err);
    res.status(500).json({ code: -1, msg: '服务器错误', data: null });
  }
});

/**
 * GET /api/auth/module-access-info?module=admin-linked
 * 员工模块二次验证信息
 */
router.get('/module-access-info', authMiddleware, (req, res) => {
  try {
    if (req.user.type !== 'employee') {
      return res.status(400).json({ code: -1, msg: '仅员工支持模块二次验证', data: null });
    }

    const employeeId = String(req.user.employee_id || '').trim();
    const adminUser = employeeId
      ? db.prepare("SELECT id, username, nickname, status FROM users WHERE username = ? AND role = 'admin' LIMIT 1").get(employeeId)
      : null;

    return res.json({
      code: 0,
      msg: 'success',
      data: {
        module: String(req.query.module || ''),
        requires_password: !!adminUser,
        admin_username: adminUser?.username || '',
        admin_nickname: adminUser?.nickname || ''
      }
    });
  } catch (err) {
    console.error('获取模块二次验证信息失败:', err);
    res.status(500).json({ code: -1, msg: '服务器错误', data: null });
  }
});

/**
 * POST /api/auth/verify-module-password
 * 员工模块二次验证：使用同工号管理员密码
 */
router.post('/verify-module-password', authMiddleware, (req, res) => {
  try {
    if (req.user.type !== 'employee') {
      return res.status(400).json({ code: -1, msg: '仅员工支持模块二次验证', data: null });
    }

    const password = String(req.body?.password || '');
    const moduleName = String(req.body?.module || '').trim();

    if (!password) {
      return res.status(400).json({ code: -1, msg: '请输入密码', data: null });
    }

    if (!moduleName) {
      return res.status(400).json({ code: -1, msg: '缺少模块标识', data: null });
    }

    const employeeId = String(req.user.employee_id || '').trim();
    const adminUser = employeeId
      ? db.prepare("SELECT id, username, nickname, password, status FROM users WHERE username = ? AND role = 'admin' LIMIT 1").get(employeeId)
      : null;

    if (!adminUser) {
      return res.status(404).json({ code: -1, msg: '当前员工未绑定管理员账号', data: null });
    }

    if (adminUser.status && adminUser.status !== 'active') {
      return res.status(403).json({ code: -1, msg: '管理员账号已停用', data: null });
    }

    if (!adminUser.password || !verifyPassword(password, adminUser.password)) {
      return res.status(401).json({ code: -1, msg: '管理员密码错误', data: null });
    }

    return res.json({
      code: 0,
      msg: '验证成功',
      data: {
        module: moduleName,
        admin_username: adminUser.username,
        admin_nickname: adminUser.nickname || adminUser.username
      }
    });
  } catch (err) {
    console.error('模块二次验证失败:', err);
    res.status(500).json({ code: -1, msg: '服务器错误', data: null });
  }
});

module.exports = router;
