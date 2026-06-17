// src/routes/exam.js - 考试相关 API
const express = require('express');
const router = express.Router();
const db = require('../models/database');
const { verifyToken } = require('../utils/auth');

// 初始化 exam_records 扩展字段
try {
  db.prepare("ALTER TABLE exam_records ADD COLUMN staff_id INTEGER REFERENCES staff(id)").run();
} catch (e) {}
try {
  db.prepare("ALTER TABLE exam_records ADD COLUMN correct_count INTEGER DEFAULT 0").run();
} catch (e) {}
try {
  db.prepare("ALTER TABLE exam_records ADD COLUMN is_passed INTEGER DEFAULT 0").run();
} catch (e) {}
try {
  db.prepare("ALTER TABLE exam_records ADD COLUMN is_retake INTEGER DEFAULT 0").run();
} catch (e) {}
try {
  db.prepare("ALTER TABLE exam_records ADD COLUMN retake_used INTEGER DEFAULT 0").run();
} catch (e) {}

// ============ 中间件 ============

function authMiddleware(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  
  if (!token) {
    return res.status(401).json({ code: -1, msg: '请先登录', data: null });
  }

  const payload = verifyToken(token);
  if (!payload) {
    return res.status(401).json({ code: -1, msg: 'token 无效', data: null });
  }

  req.user = payload;
  next();
}

// 检查考试权限（只使用粒化权限）
function examPermissionMiddleware(req, res, next) {
  // 管理员拥有所有权限
  if (req.user.can_manage_exam === 1 || req.user.role === 'admin') {
    return next();
  }

  // 员工检查粒化权限
  if (req.user.type === 'employee') {
    // 优先检查具体培训的权限（examId 来自 body 或 query，不使用 params 因为 /:id/detail 的 id 是记录ID不是培训ID）
    const examId = req.body?.examId || req.query?.examId;
    if (examId) {
      const specificPerm = db.prepare(`
        SELECT COUNT(*) as cnt FROM exam_permissions ep
        WHERE ep.staff_id = ? AND ep.exam_id = ? AND ep.can_take = 1
      `).get(req.user.id, examId);
      if (specificPerm && specificPerm.cnt > 0) {
        return next();
      }
    }

    // 回退：检查是否有任意考试权限（用于 list、my-records、detail 等场景）
    const granularPerm = db.prepare(`
      SELECT COUNT(*) as cnt FROM exam_permissions ep
      WHERE ep.staff_id = ? AND ep.can_take = 1
    `).get(req.user.id);

    if (granularPerm && granularPerm.cnt > 0) {
      return next();
    }
  }

  return res.status(403).json({ code: -1, msg: '您没有考试权限', data: null });
}

// 获取用户ID（兼容员工和管理员）
function getUserId(req) {
  return req.user.type === 'employee' ? req.user.id : req.user.userId;
}

// ============ 考生 API ============

// GET /api/exam/list - 获取可用考试列表
router.get('/list', authMiddleware, examPermissionMiddleware, (req, res) => {
  try {
    const userId = getUserId(req);
    const isAdmin = req.user.can_manage_exam === 1 || req.user.role === 'admin';

    // 获取已激活的培训（从 exam_trainings 表）
    // 管理员看到所有培训，员工只看到自己有权限的培训
    let trainings;
    if (isAdmin) {
      trainings = db.prepare(`
        SELECT et.*,
          (SELECT COUNT(*) FROM questions WHERE exam_id = et.question_bank_id) as question_count,
          (SELECT COALESCE(SUM(score), 0) FROM questions WHERE exam_id = et.question_bank_id) as total_score,
          lt.title as learning_task_title,
          lt.end_time as learning_task_end_time
        FROM exam_trainings et
        LEFT JOIN learning_tasks lt ON et.learning_task_id = lt.id
        WHERE et.is_active = 1
        ORDER BY et.created_at DESC
      `).all();
    } else {
      // 员工只能看到自己有权限的培训
      trainings = db.prepare(`
        SELECT et.*,
          (SELECT COUNT(*) FROM questions WHERE exam_id = et.question_bank_id) as question_count,
          (SELECT COALESCE(SUM(score), 0) FROM questions WHERE exam_id = et.question_bank_id) as total_score,
          lt.title as learning_task_title,
          lt.end_time as learning_task_end_time
        FROM exam_trainings et
        LEFT JOIN learning_tasks lt ON et.learning_task_id = lt.id
        INNER JOIN exam_permissions ep ON et.id = ep.exam_id AND ep.can_take = 1
        WHERE et.is_active = 1 AND ep.staff_id = ?
        ORDER BY et.created_at DESC
      `).all(userId);
    }

    // 获取用户已完成的考试记录（区分正式考试和补考）
    const isEmployee = req.user.type === 'employee';
    let completedRecords;
    let retakeUsedRecords;

    if (isEmployee) {
      // 员工使用 staff_id — 子查询取最新记录的分数和状态
      completedRecords = db.prepare(`
        SELECT er.exam_id, er.total_score, er.is_passed, er.is_retake, er.submitted_at as last_submit_at
        FROM exam_records er
        INNER JOIN (
          SELECT exam_id, is_retake, MAX(submitted_at) as max_submit
          FROM exam_records
          WHERE staff_id = ? AND submitted_at IS NOT NULL
          GROUP BY exam_id, is_retake
        ) latest ON er.exam_id = latest.exam_id AND er.is_retake = latest.is_retake AND er.submitted_at = latest.max_submit
        WHERE er.staff_id = ?
      `).all(userId, userId);

      // 获取已使用补考资格的记录
      retakeUsedRecords = db.prepare(`
        SELECT exam_id FROM exam_records
        WHERE staff_id = ? AND submitted_at IS NOT NULL AND is_retake = 1
      `).all(userId);
    } else {
      // 管理员使用 user_id
      completedRecords = db.prepare(`
        SELECT er.exam_id, er.total_score, er.is_passed, er.is_retake, er.submitted_at as last_submit_at
        FROM exam_records er
        INNER JOIN (
          SELECT exam_id, is_retake, MAX(submitted_at) as max_submit
          FROM exam_records
          WHERE user_id = ? AND submitted_at IS NOT NULL
          GROUP BY exam_id, is_retake
        ) latest ON er.exam_id = latest.exam_id AND er.is_retake = latest.is_retake AND er.submitted_at = latest.max_submit
        WHERE er.user_id = ?
      `).all(userId, userId);

      retakeUsedRecords = db.prepare(`
        SELECT exam_id FROM exam_records
        WHERE user_id = ? AND submitted_at IS NOT NULL AND is_retake = 1
      `).all(userId);
    }

    // 构建已完成记录的映射
    const completedMap = {};
    const retakeUsedMap = {};
    completedRecords.forEach(r => {
      completedMap[r.exam_id] = completedMap[r.exam_id] || {};
      completedMap[r.exam_id][r.is_retake] = r;
    });
    retakeUsedRecords.forEach(r => {
      retakeUsedMap[r.exam_id] = true;
    });

    const now = new Date();
    const formattedExams = trainings.map(exam => {
      let isAvailable = true;
      let unavailableReason = '';

      // 检查培训时间
      if (exam.start_time) {
        const startTime = new Date(exam.start_time);
        if (now < startTime) {
          isAvailable = false;
          unavailableReason = '培训尚未开始';
        }
      }
      if (isAvailable && exam.end_time) {
        const endTime = new Date(exam.end_time);
        if (now > endTime) {
          isAvailable = false;
          unavailableReason = '培训已结束';
        }
      }

      // 检查学习任务是否过期
      if (isAvailable && exam.learning_task_id) {
        if (!exam.learning_task_title) {
          isAvailable = false;
          unavailableReason = '学习任务不存在';
        } else if (exam.learning_task_end_time) {
          const endTime = new Date(exam.learning_task_end_time);
          if (now > endTime) {
            isAvailable = false;
            unavailableReason = '学习任务已到期';
          }
        }
      }

      // 正式考试记录
      const examRecord = completedMap[exam.id]?.[0];
      // 补考记录
      const retakeRecord = completedMap[exam.id]?.[1];

      // 状态判断
      const hasExamRecord = !!examRecord;
      const hasPassed = hasExamRecord && examRecord.is_passed === 1;
      const hasRetakeRecord = !!retakeRecord;
      const retakeUsed = retakeUsedMap[exam.id];

      return {
        id: exam.id,
        title: exam.title,
        description: exam.description,
        duration: exam.duration,
        pass_score: exam.pass_score,
        total_score: exam.total_score,
        question_count: exam.question_count,
        created_at: exam.created_at,
        start_time: exam.start_time,
        end_time: exam.end_time,
        // 完成状态
        completed: !!examRecord,
        last_score: examRecord?.total_score,
        is_passed: examRecord?.is_passed,
        last_submit_at: examRecord?.last_submit_at,
        // 补考状态
        has_retake: hasRetakeRecord,
        retake_score: retakeRecord?.total_score,
        retake_used: retakeUsed,
        retake_passed: hasRetakeRecord && retakeRecord.is_passed === 1,
        // 可用性
        learning_task_id: exam.learning_task_id,
        question_bank_id: exam.question_bank_id,
        is_available: isAvailable,
        unavailable_reason: unavailableReason
      };
    });

    res.json({ code: 0, msg: 'success', data: formattedExams });
  } catch (err) {
    console.error('获取考试列表失败:', err);
    res.status(500).json({ code: -1, msg: '服务器错误', data: null });
  }
});

// GET /api/exam/my-records - 获取我的考试成绩
router.get('/my-records', authMiddleware, examPermissionMiddleware, (req, res) => {
  try {
    const userId = getUserId(req);
    const isEmployee = req.user.type === 'employee';
    const staffId = isEmployee ? req.user.id : null;

    let records;
    if (isEmployee) {
      records = db.prepare(`
        SELECT er.*, et.title as exam_title, et.duration, et.pass_score
        FROM exam_records er
        JOIN exam_trainings et ON er.exam_id = et.id
        WHERE er.staff_id = ? AND er.submitted_at IS NOT NULL
        ORDER BY er.submitted_at DESC
      `).all(staffId);
    } else {
      records = db.prepare(`
        SELECT er.*, et.title as exam_title, et.duration, et.pass_score
        FROM exam_records er
        JOIN exam_trainings et ON er.exam_id = et.id
        WHERE er.user_id = ? AND er.submitted_at IS NOT NULL
        ORDER BY er.submitted_at DESC
      `).all(userId);
    }

    res.json({
      code: 0, msg: 'success',
      data: records.map(r => ({
        id: r.id,
        exam_id: r.exam_id,
        exam_title: r.exam_title,
        total_score: r.total_score,
        correctCount: r.correct_count,
        is_passed: r.is_passed,
        submitted_at: r.submitted_at,
        pass_score: r.pass_score,
        is_retake: r.is_retake
      }))
    });
  } catch (err) {
    console.error('获取成绩失败:', err);
    res.status(500).json({ code: -1, msg: '服务器错误', data: null });
  }
});

// GET /api/exam/admin/:recordId/print - 管理员打印试卷（员工姓名、考试成绩、试卷题目、用户答案）
router.get('/admin/:recordId/print', authMiddleware, (req, res) => {
  try {
    const { adminMiddleware } = require('../middleware/auth');
    // 检查是否是管理员
    if (req.user.role !== 'admin' && req.user.can_manage_exam !== 1) {
      return res.status(403).json({ code: -1, msg: '需要管理员权限', data: null });
    }

    const recordId = parseInt(req.params.recordId);

    // 获取考试记录（包含员工信息）
    const record = db.prepare(`
      SELECT er.*, et.title as exam_title, et.question_bank_id, et.pass_score,
             s.name as staff_name, s.employee_id
      FROM exam_records er
      JOIN exam_trainings et ON er.exam_id = et.id
      LEFT JOIN staff s ON er.staff_id = s.id
      WHERE er.id = ?
    `).get(recordId);

    if (!record) {
      return res.status(404).json({ code: -1, msg: '考试记录不存在', data: null });
    }

    if (!record.submitted_at) {
      return res.status(400).json({ code: -1, msg: '考试未提交，无法打印', data: null });
    }

    // 获取题目
    const actualExamId = record.question_bank_id || record.exam_id;
    const questions = db.prepare(`
      SELECT id, type, content, options, answer, score, sort_order
      FROM questions WHERE exam_id = ? ORDER BY sort_order ASC, id ASC
    `).all(actualExamId);

    // 解析用户答案
    let userAnswers = {};
    try {
      userAnswers = JSON.parse(record.answers || '{}');
    } catch (e) {
      userAnswers = {};
    }

    // 构建题目详情（包含正确答案和用户答案）
    const questionsWithDetail = questions.map(q => {
      const userAnswer = userAnswers[q.id.toString()] || userAnswers[q.id] || '';
      const isCorrect = compareAnswer(q.type, q.answer, userAnswer);

      return {
        _id: q.id.toString(),
        type: q.type,
        content: q.content,
        options: q.options ? JSON.parse(q.options) : null,
        answer: q.answer,
        score: q.score,
        sort_order: q.sort_order,
        userAnswer: userAnswer,
        isCorrect: isCorrect
      };
    });

    res.json({
      code: 0,
      msg: 'success',
      data: {
        recordId: record.id,
        examId: record.exam_id,
        examTitle: record.exam_title,
        staffName: record.staff_name || '-',
        employeeId: record.employee_id || '-',
        totalScore: Number(record.total_score) || 0,
        correctCount: Number(record.correct_count) || 0,
        isPassed: record.is_passed === 1,
        isRetake: record.is_retake === 1,
        submittedAt: record.submitted_at,
        passScore: record.pass_score,
        questions: questionsWithDetail
      }
    });
  } catch (err) {
    console.error('获取打印试卷失败:', err);
    res.status(500).json({ code: -1, msg: '服务器错误', data: null });
  }
});

// ============ 临时测试接口：生成随机考试记录 ============
// POST /api/exam/admin/:trainingId/generate-test - 为培训下所有授权员工生成随机考试记录（仅测试用）
router.post('/admin/:trainingId/generate-test', authMiddleware, (req, res) => {
  try {
    const trainingId = parseInt(req.params.trainingId);

    // 获取培训信息
    const training = db.prepare('SELECT * FROM exam_trainings WHERE id = ?').get(trainingId);
    if (!training) {
      return res.status(404).json({ code: -1, msg: '培训不存在', data: null });
    }

    // 获取题库题目
    const actualExamId = training.question_bank_id || training.id;
    const questions = db.prepare(`
      SELECT id, type, content, options, answer, score, sort_order
      FROM questions WHERE exam_id = ? ORDER BY sort_order ASC, id ASC
    `).all(actualExamId);

    if (questions.length === 0) {
      return res.status(400).json({ code: -1, msg: '题库中没有题目', data: null });
    }

    // 获取授权员工
    const staffList = db.prepare(`
      SELECT ep.staff_id, s.name, s.employee_id
      FROM exam_permissions ep
      LEFT JOIN staff s ON ep.staff_id = s.id
      WHERE ep.exam_id = ?
    `).all(trainingId);

    let generated = 0;
    const results = [];

    staffList.forEach(staff => {
      // 检查是否已有考试记录
      const existingRecord = db.prepare(`
        SELECT id FROM exam_records WHERE exam_id = ? AND staff_id = ? AND submitted_at IS NOT NULL
      `).get(trainingId, staff.staff_id);

      if (!existingRecord) {
        // 生成随机答案
        const answers = {};
        let correctCount = 0;
        questions.forEach(q => {
          let randomAnswer = '';
          if (q.type === 'single_choice' && q.options) {
            const opts = JSON.parse(q.options);
            const randomIdx = Math.floor(Math.random() * opts.length);
            randomAnswer = String.fromCharCode(65 + randomIdx); // A, B, C, D...
          } else if (q.type === 'multiple_choice' && q.options) {
            const opts = JSON.parse(q.options);
            const count = Math.floor(Math.random() * opts.length) + 1;
            const indices = [];
            while (indices.length < count) {
              const idx = Math.floor(Math.random() * opts.length);
              if (!indices.includes(idx)) indices.push(idx);
            }
            randomAnswer = indices.map(i => String.fromCharCode(65 + i)).join(',');
          } else if (q.type === 'true_false') {
            randomAnswer = Math.random() > 0.5 ? 'A' : 'B'; // A=正确, B=错误
          } else {
            randomAnswer = '测试答案';
          }
          answers[q.id.toString()] = randomAnswer;

          // 判断是否正确
          if (compareAnswer(q.type, q.answer, randomAnswer)) {
            correctCount++;
          }
        });

        const totalScore = questions.length > 0 ? Math.round((correctCount / questions.length) * 100) : 0;

        // 插入考试记录
        const result = db.prepare(`
          INSERT INTO exam_records (exam_id, staff_id, user_id, answers, total_score, correct_count, is_passed, submitted_at, is_retake)
          VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now', 'localtime'), 0)
        `).run(trainingId, staff.staff_id, staff.staff_id, JSON.stringify(answers), totalScore, correctCount, totalScore >= (training.pass_score || 60) ? 1 : 0);

        results.push({ staffId: staff.staff_id, name: staff.name, employeeId: staff.employee_id, recordId: result.lastInsertRowid });
        generated++;
      }
    });

    res.json({ code: 0, msg: `生成成功，共${generated}条记录`, data: { generated, records: results } });
  } catch (err) {
    console.error('生成测试考试记录失败:', err);
    res.status(500).json({ code: -1, msg: '服务器错误', data: null });
  }
});

// GET /api/exam/:id - 获取考试详情
router.get('/:id', authMiddleware, examPermissionMiddleware, (req, res) => {
  try {
    const trainingId = req.params.id;

    // 从 exam_trainings 获取培训信息
    const exam = db.prepare('SELECT * FROM exam_trainings WHERE id = ? AND is_active = 1').get(trainingId);

    if (!exam) {
      return res.status(404).json({ code: -1, msg: '考试不存在或未激活', data: null });
    }

    // 从关联的 exam_banks 获取题目（使用 question_bank_id 作为 exam_id）
    let questions = [];
    if (exam.question_bank_id) {
      questions = db.prepare(`
        SELECT id, type, content, options, score, sort_order
        FROM questions WHERE exam_id = ? ORDER BY sort_order ASC, id ASC
      `).all(exam.question_bank_id);
    }

    const formattedQuestions = questions.map(q => ({
      _id: q.id.toString(),
      type: q.type,
      content: q.content,
      options: q.options ? JSON.parse(q.options) : null,
      score: q.score,
      sort_order: q.sort_order
      // 注意：考试时不应该返回正确答案
    }));

    res.json({ code: 0, msg: 'success', data: { exam, questions: formattedQuestions } });
  } catch (err) {
    console.error('获取考试失败:', err);
    res.status(500).json({ code: -1, msg: '服务器错误', data: null });
  }
});

// GET /api/exam/:id/detail - 获取考试答题详情
router.get('/:id/detail', authMiddleware, examPermissionMiddleware, (req, res) => {
  try {
    const recordId = parseInt(req.params.id);
    const userId = getUserId(req);
    const isEmployee = req.user.type === 'employee';
    const idField = isEmployee ? 'staff_id' : 'user_id';
    const actualRecordId = isEmployee ? req.user.id : userId;

    // 获取考试记录
    const record = db.prepare(`
      SELECT er.*, et.title as exam_title, et.question_bank_id, et.pass_score
      FROM exam_records er
      JOIN exam_trainings et ON er.exam_id = et.id
      WHERE er.id = ? AND er.${idField} = ?
    `).get(recordId, actualRecordId);

    if (!record) {
      return res.status(404).json({ code: -1, msg: '考试记录不存在', data: null });
    }

    if (!record.submitted_at) {
      return res.status(400).json({ code: -1, msg: '考试未提交', data: null });
    }

    // 获取题目和正确答案
    const actualExamId = record.question_bank_id || record.exam_id;
    const questions = db.prepare(`
      SELECT id, type, content, options, answer, score, sort_order
      FROM questions WHERE exam_id = ? ORDER BY sort_order ASC, id ASC
    `).all(actualExamId);

    // 解析用户答案
    let userAnswers = {};
    try {
      userAnswers = JSON.parse(record.answers || '{}');
    } catch (e) {
      userAnswers = {};
    }

    // 构建题目详情（包含正确答案）
    const questionsWithDetail = questions.map(q => {
      const userAnswer = userAnswers[q.id.toString()] || userAnswers[q.id] || '';
      const isCorrect = compareAnswer(q.type, q.answer, userAnswer);

      return {
        _id: q.id.toString(),
        type: q.type,
        content: q.content,
        options: q.options ? JSON.parse(q.options) : null,
        score: q.score,
        sort_order: q.sort_order,
        // 用户答案
        userAnswer: userAnswer,
        // 是否正确
        isCorrect: isCorrect
      };
    });

    res.json({
      code: 0,
      msg: 'success',
      data: {
        id: record.id,
        exam_id: record.exam_id,
        exam_title: record.exam_title,
        total_score: record.total_score,
        correct_count: record.correct_count,
        is_passed: record.is_passed,
        is_retake: record.is_retake,
        submitted_at: record.submitted_at,
        pass_score: record.pass_score,
        questions: questionsWithDetail
      }
    });
  } catch (err) {
    console.error('获取答题详情失败:', err);
    res.status(500).json({ code: -1, msg: '服务器错误', data: null });
  }
});

// POST /api/exam/start - 开始考试
router.post('/start', authMiddleware, examPermissionMiddleware, (req, res) => {
  try {
    const { examId, is_retake } = req.body;
    const userId = getUserId(req);

    if (!examId) {
      return res.status(400).json({ code: -1, msg: '缺少 examId', data: null });
    }

    // is_retake 默认为 false（正式考试）
    const isRetake = is_retake === true || is_retake === 1;

    // 从 exam_trainings 获取培训信息
    const exam = db.prepare('SELECT * FROM exam_trainings WHERE id = ?').get(examId);
    if (!exam) {
      return res.status(404).json({ code: -1, msg: '考试不存在', data: null });
    }

    // 检查考试是否启用
    if (!exam.is_active) {
      return res.status(400).json({ code: -1, msg: '考试已停止，请联系管理员', data: null });
    }

    // 检查培训时间
    const now = new Date();
    if (exam.start_time) {
      const startTime = new Date(exam.start_time);
      if (now < startTime) {
        return res.status(400).json({ code: -1, msg: '培训尚未开始，请在开始时间后参加', data: { start_time: exam.start_time } });
      }
    }
    if (exam.end_time) {
      const endTime = new Date(exam.end_time);
      if (now > endTime) {
        return res.status(400).json({ code: -1, msg: '培训已结束，无法参加考试', data: { end_time: exam.end_time } });
      }
    }

    // 检查是否绑定了学习任务，且学习任务是否已过期
    if (exam.learning_task_id) {
      const task = db.prepare('SELECT * FROM learning_tasks WHERE id = ?').get(exam.learning_task_id);
      if (!task) {
        return res.status(400).json({ code: -1, msg: '学习任务不存在，考试已失效', data: null });
      }
      if (task.end_time) {
        const now = new Date();
        const endTime = new Date(task.end_time);
        if (now > endTime) {
          return res.status(400).json({ code: -1, msg: '学习任务已到期，考试已自动停止', data: null });
        }
      }

      // 检查该员工是否已完成学习任务（按培训上下文）— 补考时跳过此检查
      const staffId = req.user.type === 'employee' ? req.user.id : null;
      if (staffId && !isRetake) {
        const progress = db.prepare(`
          SELECT status FROM learning_progress
          WHERE task_id = ? AND staff_id = ? AND training_id = ?
        `).get(exam.learning_task_id, staffId, examId);
        if (!progress || progress.status !== 'completed') {
          return res.status(400).json({ code: -1, msg: '请先完成学习任务后再参加考试', data: null });
        }
      }
    }

    // 检查是否有未完成的考试
    // 员工使用 staff_id，管理员使用 user_id
    const isEmployee = req.user.type === 'employee';
    const recordId = isEmployee ? req.user.id : userId;
    const idField = isEmployee ? 'staff_id' : 'user_id';

    // 自动清理超时的未提交记录（超过考试时长2倍视为放弃）
    const timeoutMinutes = (exam.duration || 60) * 2;
    db.prepare(`
      UPDATE exam_records SET submitted_at = datetime('now'), total_score = 0, is_passed = 0, correct_count = 0
      WHERE exam_id = ? AND ${idField} = ? AND submitted_at IS NULL
      AND started_at < datetime('now', '-${timeoutMinutes} minutes')
    `).run(examId, recordId);

    const pendingRecord = db.prepare(`
      SELECT * FROM exam_records
      WHERE exam_id = ? AND ${idField} = ? AND submitted_at IS NULL
    `).get(examId, recordId);

    if (pendingRecord) {
      // 如果待完成的考试类型与请求类型一致，返回继续答题
      if (pendingRecord.is_retake === (isRetake ? 1 : 0)) {
        return res.json({
          code: 0,
          msg: '继续之前的考试',
          data: { answerId: pendingRecord.id, is_retake: isRetake }
        });
      }
      // 类型不一致，说明有另一种考试在进行
      return res.status(400).json({
        code: -1,
        msg: isRetake ? '您还有正式考试未完成，请先完成' : '您还有补考未完成，请先完成',
        data: { pending_type: pendingRecord.is_retake === 1 ? 'retake' : 'exam' }
      });
    }

    if (isRetake) {
      // 补考：检查是否已有正式的已提交且通过的考试
      const passedExam = db.prepare(`
        SELECT * FROM exam_records
        WHERE exam_id = ? AND ${idField} = ? AND submitted_at IS NOT NULL AND is_retake = 0 AND is_passed = 1
      `).get(examId, recordId);

      if (passedExam) {
        return res.status(400).json({
          code: -1,
          msg: '您已通过正式考试，不需要补考',
          data: { is_passed: 1, score: passedExam.total_score }
        });
      }

      // 检查是否已有补考记录且已完成（补考只能一次）
      const existingRetake = db.prepare(`
        SELECT * FROM exam_records
        WHERE exam_id = ? AND ${idField} = ? AND submitted_at IS NOT NULL AND is_retake = 1
      `).get(examId, recordId);

      if (existingRetake) {
        return res.status(400).json({
          code: -1,
          msg: '补考机会已用尽，不能再次参加补考',
          data: { score: existingRetake.total_score, is_passed: existingRetake.is_passed }
        });
      }

      // 检查是否参加过正式考试（必须先参加正式考试才能补考）
      const existingExam = db.prepare(`
        SELECT * FROM exam_records
        WHERE exam_id = ? AND ${idField} = ? AND submitted_at IS NOT NULL AND is_retake = 0
      `).get(examId, recordId);

      if (!existingExam) {
        return res.status(400).json({
          code: -1,
          msg: '请先参加正式考试',
          data: {}
        });
      }
    } else {
      // 正式考试：检查是否已参加过（已通过不允许再考，未通过可以补考）
      const existingRecord = db.prepare(`
        SELECT * FROM exam_records
        WHERE exam_id = ? AND ${idField} = ? AND submitted_at IS NOT NULL AND is_retake = 0
      `).get(examId, recordId);

      if (existingRecord) {
        if (existingRecord.is_passed) {
          return res.status(400).json({
            code: -1,
            msg: '您已完成此考试且已通过',
            data: { is_passed: 1, score: existingRecord.total_score }
          });
        }
        // 未通过，可以继续考（但不允许覆盖已有成绩）
        return res.status(400).json({
          code: -1,
          msg: '您已参加过正式考试，请参加补考',
          data: { is_passed: 0, score: existingRecord.total_score }
        });
      }
    }

    // 创建新的考试记录
    // 员工使用 staff_id，管理员使用 user_id
    // 对于员工，user_id 设为 0（因为 user_id 有 NOT NULL 约束）
    const userIdValue = isEmployee ? 0 : recordId;

    const result = db.prepare(`
      INSERT INTO exam_records (exam_id, user_id, ${idField}, answers, total_score, is_passed, is_retake, started_at, submitted_at)
      VALUES (?, ?, ?, '{}', 0, 0, ?, datetime('now'), NULL)
    `).run(examId, userIdValue, recordId, isRetake ? 1 : 0);

    res.json({
      code: 0,
      msg: isRetake ? '开始补考成功' : '开始考试成功',
      data: { answerId: result.lastInsertRowid, is_retake: isRetake }
    });
  } catch (err) {
    console.error('开始考试失败:', err);
    res.status(500).json({ code: -1, msg: '服务器错误', data: null });
  }
});

// POST /api/exam/submit - 提交考试答案
router.post('/submit', authMiddleware, examPermissionMiddleware, (req, res) => {
  try {
    const { answerId, responses } = req.body;
    const userId = getUserId(req);

    if (!answerId) {
      return res.status(400).json({ code: -1, msg: '缺少 answerId', data: null });
    }

    // 员工使用 staff_id，管理员使用 user_id
    const isEmployee = req.user.type === 'employee';
    const idField = isEmployee ? 'staff_id' : 'user_id';
    const recordId = isEmployee ? req.user.id : userId;

    const record = db.prepare(`SELECT * FROM exam_records WHERE id = ? AND ${idField} = ?`).get(answerId, recordId);
    if (!record) {
      return res.status(404).json({ code: -1, msg: '考试记录不存在', data: null });
    }

    if (record.submitted_at) {
      return res.status(400).json({ code: -1, msg: '考试已提交，不能重复提交', data: null });
    }

    const examId = record.exam_id;

    // 从 exam_trainings 获取关联的 question_bank_id
    const training = db.prepare('SELECT * FROM exam_trainings WHERE id = ?').get(examId);
    if (!training) {
      return res.status(400).json({ code: -1, msg: '考试不存在', data: null });
    }

    // 题目存储在 exam_banks 中，通过 question_bank_id 关联
    const actualExamId = training.question_bank_id || examId;
    const questions = db.prepare('SELECT * FROM questions WHERE exam_id = ?').all(actualExamId);

    if (questions.length === 0) {
      return res.status(400).json({ code: -1, msg: '考试无题目', data: null });
    }

    // 构建答案映射
    const answersMap = {};
    if (Array.isArray(responses)) {
      responses.forEach(r => {
        answersMap[r.questionId] = r.userAnswer;
      });
    } else if (responses) {
      Object.assign(answersMap, responses);
    }

    let totalScore = 0;
    let correctCount = 0;

    for (const q of questions) {
      const userAnswer = answersMap[q.id.toString()] || answersMap[q.id] || '';
      if (!userAnswer) continue;

      const isCorrect = compareAnswer(q.type, q.answer, userAnswer);
      if (isCorrect) {
        totalScore += q.score;
        correctCount++;
      }
    }

    const isPassed = totalScore >= (training.pass_score || 60);

    db.prepare(`
      UPDATE exam_records
      SET answers = ?, total_score = ?, is_passed = ?, correct_count = ?, submitted_at = datetime('now')
      WHERE id = ?
    `).run(JSON.stringify(answersMap), totalScore, isPassed ? 1 : 0, correctCount, answerId);

    res.json({
      code: 0,
      msg: isPassed ? '考试通过！' : '考试未通过',
      data: {
        totalScore,
        correctCount,
        totalQuestions: questions.length,
        isPassed,
        passScore: training.pass_score,
        is_retake: record.is_retake === 1
      }
    });
  } catch (err) {
    console.error('提交失败:', err);
    res.status(500).json({ code: -1, msg: '服务器错误', data: null });
  }
});

// 比较答案
function compareAnswer(type, correctAnswer, userAnswer) {
  if (correctAnswer == null || userAnswer == null) return false;

  if (type === 'multiple_choice') {
    const correct = String(correctAnswer).split(',').sort().join(',');
    const user = String(userAnswer).split(',').sort().join(',');
    return correct === user;
  }
  if (type === 'true_false') {
    // 标准化判断题答案：√/对/正确/true/1 都视为正确，×/错/错误/false/0 都视为错误
    const normalizeAnswer = (ans) => {
      const a = String(ans).trim().toLowerCase();
      if (a === '√' || a === '对' || a === '正确' || a === 'true' || a === '1') return '√';
      if (a === '×' || a === '错' || a === '错误' || a === 'false' || a === '0') return '×';
      return a;
    };
    return normalizeAnswer(correctAnswer) === normalizeAnswer(userAnswer);
  }
  return String(correctAnswer) === String(userAnswer);
}

// GET /api/exam/stats/user - 获取用户考试统计
router.get('/stats/user', authMiddleware, examPermissionMiddleware, (req, res) => {
  try {
    const userId = getUserId(req);
    const isEmployee = req.user.type === 'employee';
    const idField = isEmployee ? 'staff_id' : 'user_id';

    const stats = db.prepare(`
      SELECT
        COUNT(*) as total_exams,
        SUM(CASE WHEN is_passed = 1 THEN 1 ELSE 0 END) as passed_exams,
        MAX(total_score) as max_score,
        AVG(total_score) as avg_score
      FROM exam_records
      WHERE ${idField} = ? AND submitted_at IS NOT NULL
    `).get(userId);

    const recentRecords = db.prepare(`
      SELECT er.*, et.title as exam_title, et.duration, et.pass_score
      FROM exam_records er
      JOIN exam_trainings et ON er.exam_id = et.id
      WHERE er.${idField} = ? AND er.submitted_at IS NOT NULL
      ORDER BY er.submitted_at DESC LIMIT 10
    `).all(userId);

    res.json({
      code: 0, msg: 'success',
      data: {
        summary: stats,
        recent: recentRecords.map(r => ({
          id: r.id,
          exam_id: r.exam_id,
          exam_title: r.exam_title,
          total_score: r.total_score,
          is_passed: r.is_passed,
          submitted_at: r.submitted_at,
          pass_score: r.pass_score
        }))
      }
    });
  } catch (err) {
    console.error('获取统计失败:', err);
    res.status(500).json({ code: -1, msg: '服务器错误', data: null });
  }
});

module.exports = router;
