// src/routes/student-roster.js - 学生名册 API
const express = require('express');
const router = express.Router();
const db = require('../models/database');
const { authMiddleware, adminMiddleware } = require('../middleware/auth');
const { execSync } = require('child_process');
const path = require('path');

// 获取学生名册列表
router.get('/', (req, res) => {
  try {
    const { search, page = 1, pageSize = 1000 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(pageSize);

    let sql = 'SELECT * FROM student_roster WHERE 1=1';
    let countSql = 'SELECT COUNT(*) as total FROM student_roster WHERE 1=1';
    const params = [];

    if (search) {
      sql += ' AND (name LIKE ? OR employee_id LIKE ? OR school LIKE ? OR department LIKE ?)';
      countSql += ' AND (name LIKE ? OR employee_id LIKE ? OR school LIKE ? OR department LIKE ?)';
      const searchPattern = `%${search}%`;
      params.push(searchPattern, searchPattern, searchPattern, searchPattern);
    }

    sql += ' ORDER BY id ASC LIMIT ? OFFSET ?';
    const list = db.prepare(sql).all(...params, parseInt(pageSize), offset);
    const { total } = db.prepare(countSql).get(...params);

    // 添加序号
    const data = list.map((item, index) => ({
      ...item,
      serial: offset + index + 1
    }));

    res.json({
      success: true,
      data,
      total,
      page: parseInt(page),
      pageSize: parseInt(pageSize)
    });
  } catch (err) {
    console.error('获取学生名册失败:', err.message);
    res.status(500).json({ success: false, message: '获取数据失败' });
  }
});

// 获取单个学生详情
router.get('/:id', (req, res) => {
  try {
    const { id } = req.params;
    const student = db.prepare('SELECT * FROM student_roster WHERE id = ?').get(id);

    if (!student) {
      return res.status(404).json({ success: false, message: '学生不存在' });
    }

    res.json({ success: true, data: student });
  } catch (err) {
    console.error('获取学生详情失败:', err.message);
    res.status(500).json({ success: false, message: '获取数据失败' });
  }
});

// 新增学生（手动）
router.post('/', authMiddleware, adminMiddleware, (req, res) => {
  try {
    const {
      name, employee_id, school, department, sub_department, position,
      training_date, dinggang_date, phone, id_card, home_address,
      education, major, emergency_contact, emergency_relation, emergency_phone
    } = req.body;

    if (!name) {
      return res.status(400).json({ success: false, message: '姓名不能为空' });
    }

    // 检查工号是否已存在
    if (employee_id) {
      const existing = db.prepare('SELECT id FROM student_roster WHERE employee_id = ?').get(employee_id);
      if (existing) {
        return res.status(400).json({ success: false, message: '该工号已在学生名册中' });
      }
    }

    const result = db.prepare(`
      INSERT INTO student_roster (
        name, employee_id, school, department, sub_department, position,
        training_date, dinggang_date, phone, id_card, home_address,
        education, major, emergency_contact, emergency_relation, emergency_phone,
        synced_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now', 'localtime'))
    `).run(
      name, employee_id, school, department, sub_department, position,
      training_date, dinggang_date, phone, id_card, home_address,
      education, major, emergency_contact, emergency_relation, emergency_phone
    );

    res.json({ success: true, message: '添加成功', id: result.lastInsertRowid });
  } catch (err) {
    console.error('添加学生失败:', err.message);
    res.status(500).json({ success: false, message: '添加失败' });
  }
});

// 更新学生信息
router.put('/:id', authMiddleware, adminMiddleware, (req, res) => {
  try {
    const { id } = req.params;
    const {
      name, employee_id, school, department, sub_department, position,
      training_date, dinggang_date, phone, id_card, home_address,
      education, major, emergency_contact, emergency_relation, emergency_phone
    } = req.body;

    const existing = db.prepare('SELECT id FROM student_roster WHERE id = ?').get(id);
    if (!existing) {
      return res.status(404).json({ success: false, message: '学生不存在' });
    }

    db.prepare(`
      UPDATE student_roster SET
        name = COALESCE(?, name),
        employee_id = COALESCE(?, employee_id),
        school = COALESCE(?, school),
        department = COALESCE(?, department),
        sub_department = COALESCE(?, sub_department),
        position = COALESCE(?, position),
        training_date = COALESCE(?, training_date),
        dinggang_date = COALESCE(?, dinggang_date),
        phone = COALESCE(?, phone),
        id_card = COALESCE(?, id_card),
        home_address = COALESCE(?, home_address),
        education = COALESCE(?, education),
        major = COALESCE(?, major),
        emergency_contact = COALESCE(?, emergency_contact),
        emergency_relation = COALESCE(?, emergency_relation),
        emergency_phone = COALESCE(?, emergency_phone)
      WHERE id = ?
    `).run(
      name, employee_id, school, department, sub_department, position,
      training_date, dinggang_date, phone, id_card, home_address,
      education, major, emergency_contact, emergency_relation, emergency_phone,
      id
    );

    res.json({ success: true, message: '更新成功' });
  } catch (err) {
    console.error('更新学生失败:', err.message);
    res.status(500).json({ success: false, message: '更新失败' });
  }
});

// 删除学生
router.delete('/:id', authMiddleware, adminMiddleware, (req, res) => {
  try {
    const { id } = req.params;
    const existing = db.prepare('SELECT id FROM student_roster WHERE id = ?').get(id);

    if (!existing) {
      return res.status(404).json({ success: false, message: '学生不存在' });
    }

    db.prepare('DELETE FROM student_roster WHERE id = ?').run(id);
    res.json({ success: true, message: '删除成功' });
  } catch (err) {
    console.error('删除学生失败:', err.message);
    res.status(500).json({ success: false, message: '删除失败' });
  }
});

// 批量删除学生
router.post('/batch-delete', authMiddleware, adminMiddleware, (req, res) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ success: false, message: '请选择要删除的学生' });
    }

    const placeholders = ids.map(() => '?').join(',');
    db.prepare(`DELETE FROM student_roster WHERE id IN (${placeholders})`).run(...ids);

    res.json({ success: true, message: `已删除 ${ids.length} 条记录` });
  } catch (err) {
    console.error('批量删除失败:', err.message);
    res.status(500).json({ success: false, message: '删除失败' });
  }
});

// 获取列配置
router.get('/column-config', (req, res) => {
  try {
    const config = db.prepare("SELECT config FROM app_config WHERE key = 'student_roster_columns'").get();
    res.json({ success: true, data: config ? JSON.parse(config.config) : null });
  } catch (err) {
    res.json({ success: true, data: null });
  }
});

// 保存列配置
router.post('/column-config', authMiddleware, adminMiddleware, (req, res) => {
  try {
    const config = req.body;
    const existing = db.prepare("SELECT id FROM app_config WHERE key = 'student_roster_columns'").get();

    if (existing) {
      db.prepare("UPDATE app_config SET config = ? WHERE key = 'student_roster_columns'").run(JSON.stringify(config));
    } else {
      db.prepare("INSERT INTO app_config (key, config) VALUES ('student_roster_columns', ?)").run(JSON.stringify(config));
    }

    res.json({ success: true, message: '配置已保存' });
  } catch (err) {
    console.error('保存列配置失败:', err.message);
    res.status(500).json({ success: false, message: '保存失败' });
  }
});

// 从 SMB 同步学生名册
router.post('/sync', authMiddleware, adminMiddleware, (req, res) => {
  try {
    console.log('[StudentRoster] 开始同步学生名册...');

    const scriptPath = path.join(__dirname, '../../scripts/smb-student-sync.js');

    // 执行同步脚本
    const result = execSync(`node ${scriptPath}`, {
      encoding: 'utf-8',
      timeout: 120000,
      cwd: path.join(__dirname, '../..')
    });

    console.log('[StudentRoster] 同步结果:', result);

    let syncResult;
    try {
      syncResult = JSON.parse(result.trim());
    } catch (e) {
      syncResult = { inserted: 0, updated: 0, skipped: 0 };
    }

    res.json({
      success: true,
      message: '同步成功',
      data: syncResult
    });
  } catch (err) {
    console.error('[StudentRoster] 同步失败:', err.message);
    res.status(500).json({
      success: false,
      message: `同步失败: ${err.message}`,
      data: { inserted: 0, updated: 0, skipped: 0 }
    });
  }
});

module.exports = router;
