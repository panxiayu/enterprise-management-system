// src/routes/exam-trainings.js - 培训管理 API
const express = require('express');
const router = express.Router();
const db = require('../models/database');
const Joi = require('joi');
const { authMiddleware, adminMiddleware } = require('../middleware/auth');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// 配置 multer 存储
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, '../../uploads/exam');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({ storage });

// 迁移：为已存在的 exam_trainings 表添加 is_draft 列
try {
  db.prepare("ALTER TABLE exam_trainings ADD COLUMN is_draft INTEGER DEFAULT 0").run();
} catch (e) {}
// 迁移：为已存在的 exam_trainings 表添加 is_archived 列（标记是否曾启用过，停用后保留记录）
try {
  db.prepare("ALTER TABLE exam_trainings ADD COLUMN is_archived INTEGER DEFAULT 0").run();
} catch (e) {}
// 迁移：将已启用的培训任务标记为 is_archived = 1（仅在有未标记的记录时执行）
try {
  const unarchived = db.prepare("SELECT COUNT(*) as cnt FROM exam_trainings WHERE is_active = 1 AND (is_archived IS NULL OR is_archived = 0)").get();
  if (unarchived && unarchived.cnt > 0) {
    db.prepare("UPDATE exam_trainings SET is_archived = 1 WHERE is_active = 1 AND (is_archived IS NULL OR is_archived = 0)").run();
  }
} catch (e) {}
// 迁移：为 exam_trainings 表添加 perm_type 列
try {
  db.prepare("ALTER TABLE exam_trainings ADD COLUMN perm_type TEXT DEFAULT 'all'").run();
} catch (e) {}
// 迁移：更新已有权限的培训为 manual 类型
try {
  db.prepare(`
    UPDATE exam_trainings SET perm_type = 'manual'
    WHERE id IN (SELECT DISTINCT exam_id FROM exam_permissions)
    AND (perm_type IS NULL OR perm_type = 'all')
  `).run();
} catch (e) {}

// GET /api/exam-trainings - 获取培训列表
router.get('/', authMiddleware, adminMiddleware, (req, res) => {
  try {
    const trainings = db.prepare(`
      SELECT et.*, u.nickname as creator_name,
        eb.title as question_bank_title,
        lt.title as learning_task_title,
        (SELECT COUNT(*) FROM questions WHERE exam_id = et.question_bank_id) as question_count,
        (SELECT COUNT(*) FROM exam_permissions WHERE exam_id = et.id) as perm_count
      FROM exam_trainings et
      LEFT JOIN users u ON et.created_by = u.id
      LEFT JOIN exam_banks eb ON et.question_bank_id = eb.id
      LEFT JOIN learning_tasks lt ON et.learning_task_id = lt.id
      ORDER BY et.created_at DESC
    `).all();

    res.json({ code: 0, msg: 'success', data: trainings });
  } catch (err) {
    console.error('获取培训列表失败:', err);
    res.status(500).json({ code: -1, msg: '服务器错误', data: null });
  }
});

// GET /api/exam-trainings/records-summary - 获取培训记录汇总（用于"培训记录"标签页）
router.get('/records-summary', authMiddleware, adminMiddleware, (req, res) => {
  try {
    // 获取已启用的培训任务，或曾经有过考试记录的培训任务（永久保留）
    const trainings = db.prepare(`
      SELECT
        et.id,
        et.title,
        et.description,
        et.start_time,
        et.end_time,
        et.duration,
        et.pass_score,
        et.is_active,
        et.is_archived,
        et.created_at,
        et.learning_task_id,
        et.question_bank_id,
        lt.title as learning_task_title,
        eb.title as question_bank_title,
        (SELECT COUNT(*) FROM exam_permissions WHERE exam_id = et.id) as perm_count,
        (SELECT COUNT(DISTINCT lp.staff_id) FROM exam_permissions ep
         INNER JOIN learning_progress lp ON lp.staff_id = ep.staff_id AND lp.task_id = et.learning_task_id AND lp.training_id = et.id
         WHERE ep.exam_id = et.id AND lp.status = 'completed') as completed_learning_count,
        (SELECT COUNT(DISTINCT er.staff_id) FROM exam_records er WHERE er.exam_id = et.id AND er.submitted_at IS NOT NULL AND er.staff_id > 0) as total_participated,
        (SELECT AVG(CAST(COALESCE(er.total_score, er.score) AS REAL)) FROM exam_records er WHERE er.exam_id = et.id AND er.submitted_at IS NOT NULL) as avg_score,
        (SELECT COUNT(DISTINCT er.staff_id) FROM exam_records er WHERE er.exam_id = et.id AND er.submitted_at IS NOT NULL AND er.is_passed = 1 AND er.staff_id > 0) as passed_count
      FROM exam_trainings et
      LEFT JOIN learning_tasks lt ON et.learning_task_id = lt.id
      LEFT JOIN exam_banks eb ON et.question_bank_id = eb.id
      WHERE et.is_active = 1 OR et.is_archived = 1
      ORDER BY et.is_active DESC, et.created_at DESC
    `).all();

    const formattedTrainings = trainings.map(t => ({
      id: t.id,
      title: t.title,
      description: t.description,
      start_time: t.start_time,
      end_time: t.end_time,
      duration: t.duration,
      pass_score: t.pass_score,
      is_active: t.is_active,
      is_archived: t.is_archived,
      created_at: t.created_at,
      learning_task_id: t.learning_task_id,
      learning_task_title: t.learning_task_title,
      question_bank_id: t.question_bank_id,
      question_bank_title: t.question_bank_title,
      perm_count: t.perm_count || 0,
      completed_learning_count: t.completed_learning_count || 0,
      total_participated: t.total_participated || 0,
      avg_score: t.avg_score ? Math.round(t.avg_score * 10) / 10 : 0,
      passed_count: t.passed_count || 0,
      participation_rate: t.perm_count > 0 ? Math.round((t.total_participated / t.perm_count) * 100) : 0,
      pass_rate: t.perm_count > 0 ? Math.round((t.passed_count / t.perm_count) * 100) : 0
    }));

    res.json({ code: 0, msg: 'success', data: formattedTrainings });
  } catch (err) {
    console.error('获取培训记录汇总失败:', err);
    res.status(500).json({ code: -1, msg: '服务器错误', data: null });
  }
});

// POST /api/exam-trainings - 创建培训
router.post('/', authMiddleware, adminMiddleware, (req, res) => {
  try {
    const { title, description, start_time, end_time, duration, pass_score, is_active, is_draft, learning_task_id, question_bank_id } = req.body;

    if (!title || !title.trim()) {
      return res.status(400).json({ code: -1, msg: '培训标题不能为空', data: null });
    }

    const result = db.prepare(`
      INSERT INTO exam_trainings (title, description, duration, pass_score, is_active, is_draft, start_time, end_time, learning_task_id, question_bank_id, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      title.trim(),
      description || '',
      duration || 60,
      pass_score || 60,
      is_active !== undefined ? (is_active ? 1 : 0) : 0,
      is_draft ? 1 : 0,
      start_time || null,
      end_time || null,
      learning_task_id || null,
      question_bank_id || null,
      req.user.userId
    );

    const training = db.prepare('SELECT * FROM exam_trainings WHERE id = ?').get(result.lastInsertRowid);
    res.json({ code: 0, msg: '培训创建成功', data: training });
  } catch (err) {
    console.error('创建培训失败:', err);
    res.status(500).json({ code: -1, msg: '服务器错误', data: null });
  }
});

// PUT /api/exam-trainings/:id - 更新培训
router.put('/:id', authMiddleware, adminMiddleware, (req, res) => {
  try {
    const { title, description, start_time, end_time, duration, pass_score, is_active, is_draft, learning_task_id, question_bank_id, perm_type } = req.body;

    // 保留原值当参数为 undefined 时
    const currentTraining = db.prepare('SELECT * FROM exam_trainings WHERE id = ?').get(req.params.id);

    // 只有当 title 参数存在且为空时才报错
    if (title !== undefined && !title.trim()) {
      return res.status(400).json({ code: -1, msg: '培训标题不能为空', data: null });
    }

    // 如果启用培训，设置 is_archived = 1（标记曾启用过，停用后保留记录）
    const shouldArchive = is_active !== undefined && is_active === true && currentTraining.is_active !== 1;

    db.prepare(`
      UPDATE exam_trainings SET
        title = ?, description = ?, duration = ?, pass_score = ?, is_active = ?, is_draft = ?,
        start_time = ?, end_time = ?,
        learning_task_id = ?, question_bank_id = ?, perm_type = ?,
        is_archived = ?, updated_at = datetime('now', 'localtime')
      WHERE id = ?
    `).run(
      title !== undefined ? title.trim() : currentTraining.title,
      description !== undefined ? description : currentTraining.description,
      duration !== undefined ? duration : currentTraining.duration,
      pass_score !== undefined ? pass_score : currentTraining.pass_score,
      is_active !== undefined ? (is_active ? 1 : 0) : currentTraining.is_active,
      is_draft !== undefined ? (is_draft ? 1 : 0) : currentTraining.is_draft,
      start_time !== undefined ? start_time : currentTraining.start_time,
      end_time !== undefined ? end_time : currentTraining.end_time,
      learning_task_id !== undefined ? learning_task_id : currentTraining.learning_task_id,
      question_bank_id !== undefined ? question_bank_id : currentTraining.question_bank_id,
      perm_type !== undefined ? perm_type : currentTraining.perm_type,
      shouldArchive ? 1 : currentTraining.is_archived,
      req.params.id
    );

    const training = db.prepare('SELECT * FROM exam_trainings WHERE id = ?').get(req.params.id);
    res.json({ code: 0, msg: '培训更新成功', data: training });
  } catch (err) {
    console.error('更新培训失败:', err);
    res.status(500).json({ code: -1, msg: '服务器错误', data: null });
  }
});

// POST /api/exam-trainings/:id/publish - 将草稿发布为正式培训
router.post('/:id/publish', authMiddleware, adminMiddleware, (req, res) => {
  try {
    const training = db.prepare('SELECT * FROM exam_trainings WHERE id = ?').get(req.params.id);
    if (!training) {
      return res.status(404).json({ code: -1, msg: '培训不存在', data: null });
    }

    // 验证必填项
    if (!training.title || !training.learning_task_id || !training.question_bank_id) {
      return res.status(400).json({ code: -1, msg: '请先填写完整的培训信息', data: null });
    }

    // 将 is_draft 设为 0，is_active 保持 0（未启用）
    db.prepare(`
      UPDATE exam_trainings SET is_draft = 0, is_active = 0, updated_at = datetime('now', 'localtime')
      WHERE id = ?
    `).run(req.params.id);

    const updated = db.prepare('SELECT * FROM exam_trainings WHERE id = ?').get(req.params.id);
    res.json({ code: 0, msg: '发布成功', data: updated });
  } catch (err) {
    console.error('发布培训失败:', err);
    res.status(500).json({ code: -1, msg: '服务器错误', data: null });
  }
});

// DELETE /api/exam-trainings/:id - 删除培训
router.delete('/:id', authMiddleware, adminMiddleware, (req, res) => {
  try {
    const training = db.prepare('SELECT * FROM exam_trainings WHERE id = ?').get(req.params.id);
    if (!training) {
      return res.status(404).json({ code: -1, msg: '培训不存在', data: null });
    }

    // 未停用的培训任务不允许删除
    if (training.is_active === 1) {
      return res.status(400).json({ code: -1, msg: '未停用的培训任务不允许删除', data: null });
    }

    // 删除权限、记录、学习进度，然后删除培训
    db.prepare('DELETE FROM exam_permissions WHERE exam_id = ?').run(req.params.id);
    db.prepare('DELETE FROM exam_records WHERE exam_id = ?').run(req.params.id);
    db.prepare('DELETE FROM learning_progress WHERE training_id = ?').run(req.params.id);
    db.prepare('DELETE FROM exam_trainings WHERE id = ?').run(req.params.id);

    res.json({ code: 0, msg: '培训删除成功', data: null });
  } catch (err) {
    console.error('删除培训失败:', err);
    res.status(500).json({ code: -1, msg: '服务器错误', data: null });
  }
});

// GET /api/exam-trainings/:id/permissions - 获取培训权限
router.get('/:id/permissions', authMiddleware, adminMiddleware, (req, res) => {
  try {
    const training = db.prepare('SELECT * FROM exam_trainings WHERE id = ?').get(req.params.id);
    if (!training) {
      return res.status(404).json({ code: -1, msg: '培训不存在', data: null });
    }

    // 只获取已授权的员工
    const staff = db.prepare(`
      SELECT s.id, s.name, s.name_pinyin, s.employee_id, s.department, s.team,
        1 as has_perm
      FROM staff s
      INNER JOIN exam_permissions ep ON s.id = ep.staff_id AND ep.exam_id = ?
      ORDER BY s.department, s.name
    `).all(req.params.id);

    res.json({ code: 0, msg: 'success', data: staff });
  } catch (err) {
    console.error('获取培训权限失败:', err);
    res.status(500).json({ code: -1, msg: '服务器错误', data: null });
  }
});

// GET /api/exam-trainings/:id/all-staff - 获取全部员工（用于人员权限修改）
router.get('/:id/all-staff', authMiddleware, adminMiddleware, (req, res) => {
  try {
    const training = db.prepare('SELECT * FROM exam_trainings WHERE id = ?').get(req.params.id);
    if (!training) {
      return res.status(404).json({ code: -1, msg: '培训不存在', data: null });
    }

    // 获取所有员工，带权限标记
    const staff = db.prepare(`
      SELECT s.id, s.name, s.name_pinyin, s.employee_id, s.department, s.team,
        CASE WHEN ep.id IS NOT NULL THEN 1 ELSE 0 END as has_perm
      FROM staff s
      LEFT JOIN exam_permissions ep ON s.id = ep.staff_id AND ep.exam_id = ?
      ORDER BY s.department, s.name
    `).all(req.params.id);

    res.json({ code: 0, msg: 'success', data: staff });
  } catch (err) {
    console.error('获取员工列表失败:', err);
    res.status(500).json({ code: -1, msg: '服务器错误', data: null });
  }
});

// PUT /api/exam-trainings/:id/permissions - 更新培训权限
router.put('/:id/permissions', authMiddleware, adminMiddleware, (req, res) => {
  try {
    const { staff_ids } = req.body;

    if (!Array.isArray(staff_ids)) {
      return res.status(400).json({ code: -1, msg: '参数错误', data: null });
    }

    // 校验培训是否存在
    const training = db.prepare('SELECT id FROM exam_trainings WHERE id = ?').get(req.params.id);
    if (!training) {
      return res.status(404).json({ code: -1, msg: '培训不存在', data: null });
    }

    // 校验员工ID是否存在，忽略不存在的ID
    if (staff_ids.length > 0) {
      const validStaffIds = db.prepare(`
        SELECT id FROM staff WHERE id IN (${staff_ids.map(() => '?').join(',')})
      `).all(...staff_ids).map(r => r.id);

      const invalidCount = staff_ids.length - validStaffIds.length;

      // 使用事务保证原子性
      const updatePermissions = db.transaction((examId, ids) => {
        db.prepare('DELETE FROM exam_permissions WHERE exam_id = ?').run(examId);
        if (ids.length > 0) {
          const insertStmt = db.prepare(`
            INSERT INTO exam_permissions (exam_id, staff_id, can_take)
            VALUES (?, ?, 1)
          `);
          for (const staffId of ids) {
            insertStmt.run(examId, staffId);
          }
        }
      });

      updatePermissions(req.params.id, validStaffIds);

      res.json({ code: 0, msg: '权限已保存', data: { count: validStaffIds.length, ignored: invalidCount } });
    } else {
      // 空数组 = 清空权限
      db.prepare('DELETE FROM exam_permissions WHERE exam_id = ?').run(req.params.id);
      res.json({ code: 0, msg: '权限已保存', data: { count: 0, ignored: 0 } });
    }
  } catch (err) {
    console.error('保存培训权限失败:', err);
    res.status(500).json({ code: -1, msg: '服务器错误', data: null });
  }
});

// GET /api/exam-trainings/:id/exam-records - 获取培训考试记录
router.get('/:id/exam-records', authMiddleware, adminMiddleware, (req, res) => {
  try {
    const training = db.prepare('SELECT * FROM exam_trainings WHERE id = ?').get(req.params.id);
    if (!training) {
      return res.status(404).json({ code: -1, msg: '培训不存在', data: null });
    }

    // 自动清理超时的未提交记录（超过考试时长2倍视为放弃）
    const timeoutMinutes = (training.duration || 60) * 2;
    const cleanupResult = db.prepare(`
      UPDATE exam_records SET submitted_at = datetime('now'), total_score = 0, is_passed = 0, correct_count = 0
      WHERE exam_id = ? AND submitted_at IS NULL
      AND (started_at < datetime('now', '-${timeoutMinutes} minutes') OR started_at IS NULL)
    `).run(req.params.id);

    // 如果培训已结束，也清理未提交的记录
    if (training.end_time) {
      db.prepare(`
        UPDATE exam_records SET submitted_at = datetime('now'), total_score = 0, is_passed = 0, correct_count = 0
        WHERE exam_id = ? AND submitted_at IS NULL
      `).run(req.params.id);
    }

    // 如果清理了记录，记录日志
    if (cleanupResult.changes > 0) {
      console.log(`[exam-trainings] 清理了 ${cleanupResult.changes} 条超时未提交的考试记录`);
    }

    const records = db.prepare(`
      SELECT er.*, s.name, s.employee_id, s.department,
        CASE WHEN er.staff_id > 0 THEN er.staff_id ELSE er.user_id END as match_id
      FROM exam_records er
      LEFT JOIN staff s ON (er.staff_id > 0 AND er.staff_id = s.id) OR (er.staff_id = 0 AND er.user_id = s.id)
      WHERE er.exam_id = ?
      ORDER BY er.submitted_at DESC
    `).all(req.params.id);

    res.json({ code: 0, msg: 'success', data: records });
  } catch (err) {
    console.error('获取考试记录失败:', err);
    res.status(500).json({ code: -1, msg: '服务器错误', data: null });
  }
});

// GET /api/exam-trainings/:id/stats - 获取培训统计
router.get('/:id/stats', authMiddleware, adminMiddleware, (req, res) => {
  try {
    const training = db.prepare('SELECT * FROM exam_trainings WHERE id = ?').get(req.params.id);
    if (!training) {
      return res.status(404).json({ code: -1, msg: '培训不存在', data: null });
    }

    // 获取统计数据（使用 staff_id 去重，total_score 代替旧的 score 列）
    const stats = db.prepare(`
      SELECT
        COUNT(DISTINCT er.staff_id) as total_participated,
        AVG(er.total_score) as avg_score,
        MAX(er.total_score) as max_score,
        MIN(er.total_score) as min_score,
        COUNT(DISTINCT CASE WHEN er.total_score >= ? THEN er.staff_id END) as passed_count
      FROM exam_records er
      WHERE er.exam_id = ? AND er.submitted_at IS NOT NULL AND er.staff_id > 0
    `).get(training.pass_score, req.params.id);

    const totalPermissions = db.prepare(`
      SELECT COUNT(*) as count FROM exam_permissions WHERE exam_id = ?
    `).get(req.params.id);

    res.json({
      code: 0, msg: 'success', data: {
        ...stats,
        total_permissions: totalPermissions.count
      }
    });
  } catch (err) {
    console.error('获取培训统计失败:', err);
    res.status(500).json({ code: -1, msg: '服务器错误', data: null });
  }
});

// POST /api/exam-trainings/:id/import-participants - 导入培训人员
router.post('/:id/import-participants', authMiddleware, adminMiddleware, upload.single('file'), (req, res) => {
  try {
    // 获取上传的文件
    if (!req.file) {
      return res.status(400).json({ code: -1, msg: '请上传文件', data: null });
    }

    const trainingId = req.params.id;

    // 校验培训是否存在
    const training = db.prepare('SELECT id FROM exam_trainings WHERE id = ?').get(trainingId);
    if (!training) {
      require('fs').unlinkSync(req.file.path);
      return res.status(404).json({ code: -1, msg: '培训不存在', data: null });
    }

    // 解析 Excel 文件
    const XLSX = require('xlsx');
    const workbook = XLSX.readFile(req.file.path);
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

    // 删除临时文件
    require('fs').unlinkSync(req.file.path);

    // 期望格式：第一列是工号 (employee_id)
    const insertStmt = db.prepare(`
      INSERT OR IGNORE INTO exam_permissions (exam_id, staff_id, can_take)
      SELECT ?, s.id, 1 FROM staff s WHERE s.employee_id = ?
    `);

    let count = 0;
    for (let i = 1; i < data.length; i++) { // 跳过表头
      const row = data[i];
      if (row && row[0]) {
        const employeeId = String(row[0]).trim();
        if (employeeId) {
          insertStmt.run(trainingId, employeeId);
          count++;
        }
      }
    }

    res.json({ code: 0, msg: '导入成功', data: { count } });
  } catch (err) {
    console.error('导入人员失败:', err);
    res.status(500).json({ code: -1, msg: '导入失败：' + err.message, data: null });
  }
});

// GET /api/exam-trainings/:id - 获取培训详情（放在最后，因为是通用路由）
router.get('/:id', authMiddleware, adminMiddleware, (req, res) => {
  try {
    const training = db.prepare(`
      SELECT et.*,
        eb.title as question_bank_title,
        lt.title as learning_task_title
      FROM exam_trainings et
      LEFT JOIN exam_banks eb ON et.question_bank_id = eb.id
      LEFT JOIN learning_tasks lt ON et.learning_task_id = lt.id
      WHERE et.id = ?
    `).get(req.params.id);

    if (!training) {
      return res.status(404).json({ code: -1, msg: '培训不存在', data: null });
    }

    // 获取题目
    let questions = [];
    if (training.question_bank_id) {
      questions = db.prepare(`
        SELECT * FROM questions WHERE exam_id = ? ORDER BY sort_order ASC, id ASC
      `).all(training.question_bank_id);
    }

    res.json({ code: 0, msg: 'success', data: { training, questions } });
  } catch (err) {
    console.error('获取培训详情失败:', err);
    res.status(500).json({ code: -1, msg: '服务器错误', data: null });
  }
});

module.exports = router;
