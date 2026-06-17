// src/routes/feedback.js - 问题反馈 API
const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const db = require('../models/database');
const { authMiddleware, adminMiddleware } = require('../middleware/auth');

// 截图存储目录
const UPLOAD_DIR = path.join(__dirname, '../../uploads/feedback');
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `feedback-${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, allowed.includes(ext));
  }
});

// POST /api/feedback/upload-image - 员工上传反馈图片(单张)
router.post('/upload-image', authMiddleware, upload.single('image'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ code: -1, msg: '未收到文件', data: null });
    }
    const url = '/uploads/feedback/' + req.file.filename;
    res.json({ code: 0, msg: '上传成功', data: { url } });
  } catch (err) {
    console.error('上传反馈图片失败:', err);
    res.status(500).json({ code: -1, msg: '上传失败', data: null });
  }
});

// POST /api/feedback - 员工提交反馈
router.post('/', authMiddleware, (req, res) => {
  try {
    const { description, category, page_url, page_name, images } = req.body;
    if ((!description || !description.trim()) && (!images || !images.length)) {
      return res.status(400).json({ code: -1, msg: '请填写问题描述或上传图片', data: null });
    }

    const staffId = req.user.type === 'employee' ? req.user.id : null;
    const staffName = req.user.type === 'employee' ? req.user.name : (req.user.username || '');
    const employeeId = req.user.type === 'employee' ? req.user.employee_id : '';

    // images: 字符串数组(URL 列表) → JSON 存到 screenshots 字段
    const screenshots = Array.isArray(images) ? JSON.stringify(images) : '[]';

    const result = db.prepare(`
      INSERT INTO feedback (staff_id, staff_name, employee_id, category, description, screenshots, page_url, user_agent)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(staffId, staffName, employeeId, category || 'other', (description || '').trim(),
           screenshots, page_name || page_url || '', req.headers['user-agent'] || '');

    res.json({ code: 0, msg: '反馈提交成功，感谢您的意见！', data: { id: result.lastInsertRowid } });
  } catch (err) {
    console.error('提交反馈失败:', err);
    res.status(500).json({ code: -1, msg: '提交失败，请稍后重试', data: null });
  }
});

// GET /api/feedback/my - 员工查看自己的反馈列表（也允许管理员通过employee_id访问）
router.get('/my', authMiddleware, (req, res) => {
  try {
    // 管理员可能有双重身份，通过employee_id查找
    let staffId = null;
    let employeeId = null;

    if (req.user.type === 'employee') {
      staffId = req.user.id;
      employeeId = req.user.employee_id;
    } else if (req.user.type === 'admin') {
      // 管理员也是员工，通过username(工号)查找staff_id
      const username = req.user.username || req.user.username;
      if (username) {
        const staff = db.prepare('SELECT id, employee_id FROM staff WHERE employee_id = ?').get(username);
        if (staff) {
          staffId = staff.id;
          employeeId = staff.employee_id;
        }
      }
    }

    if (!staffId) {
      return res.status(403).json({ code: -1, msg: '无权限', data: null });
    }

    let { page = 1, pageSize = 20 } = req.query;
    page = Math.max(1, parseInt(page) || 1);
    pageSize = Math.min(50, Math.max(1, parseInt(pageSize) || 20));

    const total = db.prepare(`SELECT COUNT(*) as cnt FROM feedback WHERE staff_id = ?`).get(staffId).cnt;
    const offset = (page - 1) * pageSize;
    // 按创建时间升序（最旧的消息在前，最新的在底部）
    const items = db.prepare(`SELECT * FROM feedback WHERE staff_id = ? ORDER BY created_at ASC LIMIT ? OFFSET ?`)
      .all(staffId, Number(pageSize), offset);

    items.forEach(item => {
      if (item.screenshots) {
        try { item.screenshots = JSON.parse(item.screenshots); } catch (e) { item.screenshots = []; }
      }
    });

    res.json({ code: 0, msg: 'success', data: { items, total, page, pageSize } });
  } catch (err) {
    console.error('获取我的反馈失败:', err);
    res.status(500).json({ code: -1, msg: '服务器错误', data: null });
  }
});

// GET /api/feedback - 管理员查看反馈列表
router.get('/', authMiddleware, adminMiddleware, (req, res) => {
  try {
    let { status, category, page = 1, pageSize = 20 } = req.query;
    let where = '1=1';
    const params = [];

    // 验证 status 白名单
    const validStatuses = ['pending', 'viewed', 'processing', 'resolved', 'rejected'];
    if (status && validStatuses.includes(status)) {
      where += ' AND status = ?'; params.push(status);
    }
    // 验证 category 白名单（支持逗号分隔多选）
    const validCategories = ['bug', 'suggestion', 'ui', 'performance', 'other'];
    if (category && validCategories.includes(category)) {
      where += ' AND category LIKE ?'; params.push('%' + category + '%');
    }

    // page/pageSize 边界检查
    page = Math.max(1, parseInt(page) || 1);
    pageSize = Math.min(100, Math.max(1, parseInt(pageSize) || 20));

    const total = db.prepare(`SELECT COUNT(*) as cnt FROM feedback WHERE ${where}`).get(...params).cnt;
    const offset = (page - 1) * pageSize;
    const items = db.prepare(`SELECT * FROM feedback WHERE ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`)
      .all(...params, Number(pageSize), offset);

    items.forEach(item => {
      if (item.screenshots) {
        try { item.screenshots = JSON.parse(item.screenshots); } catch (e) { item.screenshots = []; }
      }
    });

    res.json({ code: 0, msg: 'success', data: { items, total, page: Number(page), pageSize: Number(pageSize) } });
  } catch (err) {
    console.error('获取反馈列表失败:', err);
    res.status(500).json({ code: -1, msg: '服务器错误', data: null });
  }
});

// GET /api/feedback/:id - 管理员查看反馈详情（自动标记为已查看）
router.get('/:id', authMiddleware, adminMiddleware, (req, res) => {
  try {
    const item = db.prepare('SELECT * FROM feedback WHERE id = ?').get(req.params.id);
    if (!item) return res.status(404).json({ code: -1, msg: '反馈不存在', data: null });

    // 如果状态是 pending，自动改为 viewed
    if (item.status === 'pending') {
      db.prepare(`UPDATE feedback SET status = 'viewed', updated_at = datetime('now', 'localtime') WHERE id = ?`).run(req.params.id);
      item.status = 'viewed';
    }

    if (item.screenshots) {
      try { item.screenshots = JSON.parse(item.screenshots); } catch (e) { item.screenshots = []; }
    }
    res.json({ code: 0, msg: 'success', data: item });
  } catch (err) {
    console.error('获取反馈详情失败:', err);
    res.status(500).json({ code: -1, msg: '服务器错误', data: null });
  }
});

// PUT /api/feedback/:id/reply - 管理员回复
router.put('/:id/reply', authMiddleware, adminMiddleware, (req, res) => {
  try {
    const { reply, status } = req.body;
    const item = db.prepare('SELECT * FROM feedback WHERE id = ?').get(req.params.id);
    if (!item) return res.status(404).json({ code: -1, msg: '反馈不存在', data: null });

    const newStatus = status || 'resolved';
    const resolvedAt = newStatus === 'resolved' ? new Date().toISOString() : item.resolved_at;

    db.prepare(`
      UPDATE feedback SET admin_reply = ?, status = ?, resolved_at = ?, updated_at = datetime('now', 'localtime')
      WHERE id = ?
    `).run(reply || '', newStatus, resolvedAt, req.params.id);

    res.json({ code: 0, msg: '回复成功', data: null });
  } catch (err) {
    console.error('回复反馈失败:', err);
    res.status(500).json({ code: -1, msg: '服务器错误', data: null });
  }
});

// PUT /api/feedback/:id/status - 管理员更新状态
router.put('/:id/status', authMiddleware, adminMiddleware, (req, res) => {
  try {
    const { status } = req.body;
    const validStatuses = ['pending', 'viewed', 'processing', 'resolved', 'rejected'];
    if (!status || !validStatuses.includes(status)) {
      return res.status(400).json({ code: -1, msg: '无效的状态值', data: null });
    }

    const resolvedAt = status === 'resolved' ? new Date().toISOString() : null;
    db.prepare(`
      UPDATE feedback SET status = ?, resolved_at = ?, updated_at = datetime('now', 'localtime')
      WHERE id = ?
    `).run(status, resolvedAt, req.params.id);

    res.json({ code: 0, msg: '状态已更新', data: null });
  } catch (err) {
    console.error('更新反馈状态失败:', err);
    res.status(500).json({ code: -1, msg: '服务器错误', data: null });
  }
});

module.exports = router;
