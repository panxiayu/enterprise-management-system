// src/routes/question-banks.js - 题库管理 API
const express = require('express');
const router = express.Router();
const db = require('../models/database');
const Joi = require('joi');
const { authMiddleware, adminMiddleware } = require('../middleware/auth');

// 初始化 exam_banks 表
try {
  db.exec(`
    CREATE TABLE IF NOT EXISTS exam_banks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      description TEXT DEFAULT '',
      duration INTEGER DEFAULT 60,
      pass_score INTEGER DEFAULT 60,
      is_active INTEGER DEFAULT 0,
      created_by INTEGER,
      created_at DATETIME DEFAULT (datetime('now', 'localtime')),
      updated_at DATETIME DEFAULT (datetime('now', 'localtime'))
    )
  `);
} catch (e) {
  console.log('exam_banks table init:', e.message);
}

// 初始化 exam_trainings 表
try {
  db.exec(`
    CREATE TABLE IF NOT EXISTS exam_trainings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      description TEXT DEFAULT '',
      duration INTEGER DEFAULT 60,
      pass_score INTEGER DEFAULT 60,
      is_active INTEGER DEFAULT 0,
      start_time DATETIME,
      end_time DATETIME,
      learning_task_id INTEGER,
      question_bank_id INTEGER,
      created_by INTEGER,
      created_at DATETIME DEFAULT (datetime('now', 'localtime')),
      updated_at DATETIME DEFAULT (datetime('now', 'localtime'))
    )
  `);
} catch (e) {
  console.log('exam_trainings table init:', e.message);
}

// 迁移：为已存在的 exam_trainings 表添加 start_time 和 end_time 列
try {
  db.prepare("ALTER TABLE exam_trainings ADD COLUMN start_time DATETIME").run();
} catch (e) {}
try {
  db.prepare("ALTER TABLE exam_trainings ADD COLUMN end_time DATETIME").run();
} catch (e) {}
try {
  db.prepare("ALTER TABLE exam_trainings ADD COLUMN is_draft INTEGER DEFAULT 0").run();
} catch (e) {}
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

// GET /api/question-banks - 获取题库列表
router.get('/', authMiddleware, adminMiddleware, (req, res) => {
  try {
    const banks = db.prepare(`
      SELECT eb.*, u.nickname as creator_name,
        (SELECT COUNT(*) FROM questions WHERE exam_id = eb.id) as question_count,
        (SELECT COALESCE(SUM(score), 0) FROM questions WHERE exam_id = eb.id) as total_score
      FROM exam_banks eb
      LEFT JOIN users u ON eb.created_by = u.id
      ORDER BY eb.created_at DESC
    `).all();

    res.json({ code: 0, msg: 'success', data: banks });
  } catch (err) {
    console.error('获取题库列表失败:', err);
    res.status(500).json({ code: -1, msg: '服务器错误', data: null });
  }
});

// POST /api/question-banks - 创建题库
router.post('/', authMiddleware, adminMiddleware, (req, res) => {
  try {
    const { title, description, duration, pass_score } = req.body;

    if (!title || !title.trim()) {
      return res.status(400).json({ code: -1, msg: '题库标题不能为空', data: null });
    }

    // 检查标题是否已存在
    const existing = db.prepare('SELECT id FROM exam_banks WHERE title = ?').get(title.trim());
    if (existing) {
      return res.status(400).json({ code: -1, msg: '题库标题已存在', data: null });
    }

    const result = db.prepare(`
      INSERT INTO exam_banks (title, description, duration, pass_score, created_by)
      VALUES (?, ?, ?, ?, ?)
    `).run(title.trim(), description || '', duration || 60, pass_score || 60, req.user.userId);

    const bank = db.prepare('SELECT * FROM exam_banks WHERE id = ?').get(result.lastInsertRowid);
    res.json({ code: 0, msg: '题库创建成功', data: bank });
  } catch (err) {
    console.error('创建题库失败:', err);
    res.status(500).json({ code: -1, msg: '服务器错误', data: null });
  }
});

// GET /api/question-banks/:id - 获取题库详情
router.get('/:id', authMiddleware, adminMiddleware, (req, res) => {
  try {
    const bank = db.prepare(`
      SELECT eb.*,
        (SELECT COUNT(*) FROM questions WHERE exam_id = eb.id) as question_count,
        (SELECT COALESCE(SUM(score), 0) FROM questions WHERE exam_id = eb.id) as total_score
      FROM exam_banks eb WHERE eb.id = ?
    `).get(req.params.id);
    if (!bank) {
      return res.status(404).json({ code: -1, msg: '题库不存在', data: null });
    }

    const questions = db.prepare(`
      SELECT * FROM questions WHERE exam_id = ? ORDER BY sort_order ASC, id ASC
    `).all(bank.id);

    res.json({ code: 0, msg: 'success', data: { bank, questions } });
  } catch (err) {
    console.error('获取题库详情失败:', err);
    res.status(500).json({ code: -1, msg: '服务器错误', data: null });
  }
});

// PUT /api/question-banks/:id - 更新题库
router.put('/:id', authMiddleware, adminMiddleware, (req, res) => {
  try {
    const { title, description, duration, pass_score } = req.body;

    if (!title || !title.trim()) {
      return res.status(400).json({ code: -1, msg: '题库标题不能为空', data: null });
    }

    // 检查标题是否已存在（排除自己）
    const existing = db.prepare('SELECT id FROM exam_banks WHERE title = ? AND id != ?').get(title.trim(), req.params.id);
    if (existing) {
      return res.status(400).json({ code: -1, msg: '题库标题已存在', data: null });
    }

    db.prepare(`
      UPDATE exam_banks SET title = ?, description = ?, duration = ?, pass_score = ?, updated_at = datetime('now', 'localtime')
      WHERE id = ?
    `).run(title.trim(), description || '', duration || 60, pass_score || 60, req.params.id);

    const bank = db.prepare('SELECT * FROM exam_banks WHERE id = ?').get(req.params.id);
    res.json({ code: 0, msg: '题库更新成功', data: bank });
  } catch (err) {
    console.error('更新题库失败:', err);
    res.status(500).json({ code: -1, msg: '服务器错误', data: null });
  }
});

// DELETE /api/question-banks/:id - 删除题库
router.delete('/:id', authMiddleware, adminMiddleware, (req, res) => {
  try {
    const bank = db.prepare('SELECT * FROM exam_banks WHERE id = ?').get(req.params.id);
    if (!bank) {
      return res.status(404).json({ code: -1, msg: '题库不存在', data: null });
    }

    // 检查是否有培训关联此题库
    const relatedTrainings = db.prepare(`
      SELECT id, title FROM exam_trainings WHERE question_bank_id = ?
    `).all(req.params.id);
    if (relatedTrainings.length > 0) {
      return res.status(400).json({
        code: -1,
        msg: `该题库已被 ${relatedTrainings.length} 个培训引用，无法删除`,
        data: { related_trainings: relatedTrainings }
      });
    }

    // 删除关联题目
    db.prepare('DELETE FROM questions WHERE exam_id = ?').run(req.params.id);
    // 删除题库
    db.prepare('DELETE FROM exam_banks WHERE id = ?').run(req.params.id);

    res.json({ code: 0, msg: '题库删除成功', data: null });
  } catch (err) {
    console.error('删除题库失败:', err);
    res.status(500).json({ code: -1, msg: '服务器错误', data: null });
  }
});

// GET /api/question-banks/:id/questions - 获取题库题目
router.get('/:id/questions', authMiddleware, adminMiddleware, (req, res) => {
  try {
    const questions = db.prepare(`
      SELECT * FROM questions WHERE exam_id = ? ORDER BY sort_order ASC, id ASC
    `).all(req.params.id);

    res.json({ code: 0, msg: 'success', data: questions });
  } catch (err) {
    console.error('获取题目列表失败:', err);
    res.status(500).json({ code: -1, msg: '服务器错误', data: null });
  }
});

// PUT /api/question-banks/:bankId/questions/:questionId - 更新题目
router.put('/:bankId/questions/:questionId', authMiddleware, adminMiddleware, (req, res) => {
  try {
    const { bankId, questionId } = req.params;
    const { content, options, answer, score, sort_order } = req.body;

    if (!content || !content.trim()) {
      return res.status(400).json({ code: -1, msg: '题目内容不能为空', data: null });
    }

    // 检查题目是否存在
    const question = db.prepare('SELECT * FROM questions WHERE id = ? AND exam_id = ?').get(questionId, bankId);
    if (!question) {
      return res.status(404).json({ code: -1, msg: '题目不存在', data: null });
    }

    db.prepare(`
      UPDATE questions
      SET content = ?, options = ?, answer = ?, score = ?, sort_order = ?
      WHERE id = ? AND exam_id = ?
    `).run(
      content.trim(),
      options ? JSON.stringify(options) : question.options,
      answer || '',
      score || question.score || 5,
      sort_order ?? question.sort_order ?? 0,
      questionId,
      bankId
    );

    const updated = db.prepare('SELECT * FROM questions WHERE id = ?').get(questionId);
    res.json({ code: 0, msg: '题目更新成功', data: updated });
  } catch (err) {
    console.error('更新题目失败:', err);
    res.status(500).json({ code: -1, msg: '服务器错误', data: null });
  }
});

// DELETE /api/question-banks/:bankId/questions/:questionId - 删除题目
router.delete('/:bankId/questions/:questionId', authMiddleware, adminMiddleware, (req, res) => {
  try {
    const { bankId, questionId } = req.params;

    const question = db.prepare('SELECT * FROM questions WHERE id = ? AND exam_id = ?').get(questionId, bankId);
    if (!question) {
      return res.status(404).json({ code: -1, msg: '题目不存在', data: null });
    }

    db.prepare('DELETE FROM questions WHERE id = ?').run(questionId);
    res.json({ code: 0, msg: '题目删除成功', data: null });
  } catch (err) {
    console.error('删除题目失败:', err);
    res.status(500).json({ code: -1, msg: '服务器错误', data: null });
  }
});

// POST /api/question-banks/:id/import - 导入题目到题库
router.post('/:id/import', authMiddleware, adminMiddleware, (req, res) => {
  try {
    const bank = db.prepare('SELECT * FROM exam_banks WHERE id = ?').get(req.params.id);
    if (!bank) {
      return res.status(404).json({ code: -1, msg: '题库不存在', data: null });
    }

    const { questions } = req.body;
    if (!Array.isArray(questions) || questions.length === 0) {
      return res.status(400).json({ code: -1, msg: '题目数据无效', data: null });
    }

    let successCount = 0;
    questions.forEach((q, index) => {
      try {
        db.prepare(`
          INSERT INTO questions (exam_id, type, content, options, answer, score, sort_order)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(bank.id, q.type, q.content, JSON.stringify(q.options), q.answer, q.score || 5, index);
        successCount++;
      } catch (err) {
        console.error('插入题目失败:', err);
      }
    });

    res.json({ code: 0, msg: '导入成功', data: { count: successCount } });
  } catch (err) {
    console.error('导入题目失败:', err);
    res.status(500).json({ code: -1, msg: '服务器错误', data: null });
  }
});

module.exports = router;
