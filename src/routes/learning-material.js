// src/routes/learning-material.js - 学习资料 API
const express = require('express');
const router = express.Router();
const db = require('../models/database');
const Joi = require('joi');
const { authMiddleware, adminMiddleware } = require('../middleware/auth');

// 初始化学习进度扩展字段
try {
  db.prepare("ALTER TABLE learning_progress ADD COLUMN last_position REAL DEFAULT 0").run();
} catch (e) {}
try {
  db.prepare("ALTER TABLE learning_progress ADD COLUMN staff_id INTEGER").run();
} catch (e) {}
try {
  db.prepare("ALTER TABLE learning_progress ADD COLUMN training_id INTEGER").run();
} catch (e) {}

// 初始化learning_tasks扩展字段
try {
  db.prepare("ALTER TABLE learning_tasks ADD COLUMN description TEXT").run();
} catch (e) {}

// 初始化learning_tasks视频时长字段
try {
  db.prepare("ALTER TABLE learning_tasks ADD COLUMN duration INTEGER").run();
} catch (e) {}

// 迁移learning_tasks表，使file_type和file_url可以为NULL
try {
  // 检查file_type是否为NOT NULL
  const colInfo = db.prepare("PRAGMA table_info(learning_tasks)").all();
  const fileTypeCol = colInfo.find(c => c.name === 'file_type');
  if (fileTypeCol && fileTypeCol.notnull === 1) {
    // 需要修改表结构，创建新表
    db.exec(`
      CREATE TABLE IF NOT EXISTS learning_tasks_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        description TEXT,
        file_type TEXT,
        file_url TEXT,
        start_time DATETIME,
        end_time DATETIME,
        created_by INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME
      )
    `);
    db.exec(`
      INSERT INTO learning_tasks_new (id, title, description, file_type, file_url, start_time, end_time, created_by, created_at, updated_at)
      SELECT id, title, description, file_type, file_url, start_time, end_time, created_by, created_at, updated_at FROM learning_tasks
    `);
    db.exec('DROP TABLE learning_tasks');
    db.exec('ALTER TABLE learning_tasks_new RENAME TO learning_tasks');
    console.log('✅ learning_tasks表已迁移，file_type/file_url已设为可NULL');
  }
} catch (e) {
  console.log('learning_tasks迁移跳过:', e.message);
}

// 检查用户是否有考试权限（只使用粒化权限）
function checkExamPermission(userId, userType) {
  // 管理员肯定有权限
  if (userType === 'admin') return true;

  // 员工检查粒化考试权限表
  const examPerm = db.prepare('SELECT COUNT(*) as cnt FROM exam_permissions WHERE staff_id = ? AND can_take = 1').get(userId);
  return examPerm && examPerm.cnt > 0;
}

// 检查用户是否有指定考试的学习任务权限（只使用粒化权限）
function checkLearningTaskPermissionByExam(userId, userRole, canManageTraining, examId) {
  // 管理员肯定有权限（超级管理员或有培训管理权限的管理员）
  if (userRole === 'admin' || canManageTraining === 1) return true;

  // 检查粒化考试权限表
  if (examId) {
    const examPerm = db.prepare('SELECT id FROM exam_permissions WHERE staff_id = ? AND exam_id = ? AND can_take = 1').get(userId, examId);
    return !!examPerm;
  }

  // 没有指定考试，检查是否有任何考试权限
  return checkExamPermission(userId);
}

// 检查用户是否有学习任务权限
// 逻辑：员工需要有该学习资料关联的培训考试权限，才能访问学习资料
function checkLearningTaskPermission(userId, userRole, canManageTraining, taskId) {
  // 管理员肯定有权限（超级管理员或有培训管理权限的管理员）
  if (userRole === 'admin' || canManageTraining === 1) return true;

  // 如果没有指定 taskId，检查是否有任何学习任务权限（有任何考试权限即可）
  if (!taskId) {
    const anyExamPerm = db.prepare(`
      SELECT COUNT(*) as cnt FROM exam_permissions WHERE staff_id = ? AND can_take = 1
    `).get(userId);
    return anyExamPerm && anyExamPerm.cnt > 0;
  }

  // 获取该学习资料关联的所有启用培训
  const trainings = db.prepare(`
    SELECT id FROM exam_trainings WHERE learning_task_id = ? AND is_active = 1
  `).all(taskId);

  if (!trainings || trainings.length === 0) {
    // 没有关联的启用培训，检查是否有任何考试权限
    const anyExamPerm = db.prepare(`
      SELECT COUNT(*) as cnt FROM exam_permissions WHERE staff_id = ? AND can_take = 1
    `).get(userId);
    return anyExamPerm && anyExamPerm.cnt > 0;
  }

  // 检查是否有任何一个关联培训的考试权限
  const trainingIds = trainings.map(t => t.id);
  const placeholders = trainingIds.map(() => '?').join(',');

  const examPerm = db.prepare(`
    SELECT COUNT(*) as cnt FROM exam_permissions
    WHERE staff_id = ? AND exam_id IN (${placeholders}) AND can_take = 1
  `).get(userId, ...trainingIds);

  return examPerm && examPerm.cnt > 0;
}

// 获取所有有考试权限的用户(用于统计，只使用粒化权限)
function getAllExamPermissionUsers() {
  const users = db.prepare(`
    SELECT id, username, nickname, role, can_manage_exam FROM users WHERE role = 'admin' OR can_manage_exam = 1
  `).all();

  // 获取有粒化考试权限的员工
  const staffWithExamPermission = db.prepare(`
    SELECT DISTINCT s.id, s.name, s.employee_id
    FROM staff s
    INNER JOIN exam_permissions ep ON s.id = ep.staff_id AND ep.can_take = 1
  `).all();

  // 分别返回,用于区分来源
  return {
    users: users.map(u => ({ ...u, source: 'users' })),
    staff: staffWithExamPermission.map(s => ({
      id: s.id,
      username: s.employee_id || s.name,
      nickname: s.name,
      role: 'staff',
      source: 'staff'
    }))
  };
}

// 简化版:返回所有可学习人员(合并列表)
function getAllLearnableUsers() {
  const result = getAllExamPermissionUsers();
  return [...result.users, ...result.staff];
}

// 获取任务列表(只返回有权限的任务)
// GET /api/learning-tasks
router.get('/', authMiddleware, (req, res) => {
  try {
    const { status } = req.query;

    // 获取用户ID（区分管理员和员工）
    const userId = req.user.type === 'employee' ? req.user.id : req.user.userId;

    // 检查是否有学习任务权限
    const hasPermission = checkLearningTaskPermission(userId, req.user.role, req.user.can_manage_training);

    // 获取当前时间
    const now = new Date();

    // 构建查询 - 根据是否有管理权限决定是否过滤
    // 注意：使用子查询避免 LEFT JOIN exam_trainings 产生笛卡尔积
    let query = `
      SELECT lt.*,
        lp.status as progress_status,
        lp.progress_percent,
        lp.last_position,
        lp.last_access_time,
        (SELECT et.title FROM exam_trainings et WHERE et.learning_task_id = lt.id LIMIT 1) as exam_title,
        (SELECT COUNT(*) FROM exam_permissions ep2
         INNER JOIN exam_trainings et2 ON et2.id = ep2.exam_id AND et2.learning_task_id = lt.id
         WHERE ep2.staff_id = ? AND ep2.can_take = 1 LIMIT 1) as has_perm
      FROM learning_tasks lt
      LEFT JOIN learning_progress lp ON lt.id = lp.task_id AND lp.staff_id = ?
      WHERE 1=1
    `;
    const params = [userId, userId];

    // 非管理员且无学习任务管理权限时，根据考试权限过滤
    if (!hasPermission) {
      query += ' AND (SELECT COUNT(*) FROM exam_permissions ep2 INNER JOIN exam_trainings et2 ON et2.id = ep2.exam_id AND et2.learning_task_id = lt.id WHERE ep2.staff_id = ? AND ep2.can_take = 1) > 0';
      params.push(userId);
    }

    if (status) {
      if (status === 'not_started' || status === 'in_progress' || status === 'completed') {
        // 过滤学习进度
        query += ' AND (lp.status = ? OR (lp.status IS NULL AND ? = "not_started"))';
        params.push(status, status);
      } else {
        // 过滤任务状态
        query += ' AND lt.status = ?';
        params.push(status);
      }
    }

    // 移除时间范围过滤,显示所有任务
    // query += ` AND (lt.start_time IS NULL OR lt.start_time <= ?)`;
    // params.push(now.toISOString());
    // query += ` AND (lt.end_time IS NULL OR lt.end_time >= ?)`;
    // params.push(now.toISOString());

    query += ' ORDER BY lt.created_at DESC';

    const tasks = db.prepare(query).all(...params);

    // 获取所有有考试权限的用户
    const allUsers = getAllLearnableUsers();

    // 为每个任务添加进度统计
    const tasksWithStats = tasks.map(task => {
      const taskId = task.id;

      // 获取所有用户的学习进度
      const progressStats = db.prepare(`
        SELECT status, COUNT(*) as count
        FROM learning_progress
        WHERE task_id = ?
        GROUP BY status
      `).all(taskId);

      const stats = {
        total: allUsers.length,
        not_started: 0,
        in_progress: 0,
        completed: 0
      };

      progressStats.forEach(stat => {
        if (stat.status === 'not_started') {
          stats.not_started = stat.count;
        } else if (stat.status === 'in_progress') {
          stats.in_progress = stat.count;
        } else if (stat.status === 'completed') {
          stats.completed = stat.count;
        }
      });

      // 未开始 = 总人数 - 已开始的人数
      stats.not_started = stats.total - stats.in_progress - stats.completed;

      return {
        ...task,
        stats
      };
    });

    res.json({
      code: 0,
      msg: 'success',
      data: tasksWithStats
    });
  } catch (err) {
    console.error('获取学习任务列表失败:', err);
    res.status(500).json({
      code: -1,
      msg: '服务器错误',
      data: null
    });
  }
});

// 获取我的学习进度
// GET /api/learning-materials/my-progress
router.get('/my-progress', authMiddleware, (req, res) => {
  try {
    const userId = req.user.type === 'employee' ? req.user.id : req.user.userId;

    // 获取当前用户的学习进度
    const progress = db.prepare(`
      SELECT lp.*, lt.title as task_title
      FROM learning_progress lp
      LEFT JOIN learning_tasks lt ON lp.task_id = lt.id
      WHERE lp.staff_id = ?
      ORDER BY lp.updated_at DESC
    `).all(userId);

    res.json({ code: 0, msg: 'success', data: progress });
  } catch (err) {
    console.error('获取学习进度失败:', err);
    res.status(500).json({ code: -1, msg: '服务器错误', data: null });
  }
});

// 获取我的统计数据（已学习、已通过）
// GET /api/learning-materials/my-stats
router.get('/my-stats', authMiddleware, (req, res) => {
  try {
    const userId = req.user.type === 'employee' ? req.user.id : req.user.userId;

    // 已学习：统计已完成的活跃培训任务数（只统计 is_active=1 的培训）
    const learnedResult = db.prepare(`
      SELECT COUNT(DISTINCT lp.training_id) as count
      FROM learning_progress lp
      INNER JOIN exam_trainings et ON lp.training_id = et.id
      WHERE lp.staff_id = ? AND lp.status = 'completed' AND lp.training_id IS NOT NULL AND et.is_active = 1
    `).get(userId);

    // 已通过：统计已通过且已提交的考试数（按exam_id去重）
    const passedResult = db.prepare(`
      SELECT COUNT(DISTINCT exam_id) as count
      FROM exam_records
      WHERE staff_id = ? AND submitted_at IS NOT NULL AND is_passed = 1
    `).get(userId);

    res.json({
      code: 0,
      msg: 'success',
      data: {
        learnedCount: learnedResult ? (learnedResult.count || 0) : 0,
        passedCount: passedResult ? (passedResult.count || 0) : 0
      }
    });
  } catch (err) {
    console.error('获取统计数据失败:', err);
    res.status(500).json({ code: -1, msg: '服务器错误', data: null });
  }
});

// GET /api/learning-tasks/my-records - 获取我的培训记录（按任务分组，显示达成率）
router.get('/my-records', authMiddleware, (req, res) => {
  try {
    const userId = req.user.type === 'employee' ? req.user.id : req.user.userId;
    const isEmployee = req.user.type === 'employee';

    // 获取所有有权限的学习任务
    const tasks = db.prepare(`
      SELECT lt.*,
        lp.status as my_status,
        lp.progress_percent as my_progress,
        e.id as exam_id,
        e.title as exam_title,
        e.is_active as exam_is_active
      FROM learning_tasks lt
      LEFT JOIN learning_progress lp ON lt.id = lp.task_id AND lp.staff_id = ?
      LEFT JOIN exam_trainings e ON e.learning_task_id = lt.id
      ORDER BY lt.end_time DESC
    `).all(userId);

    // 获取每个任务的完成统计
    const records = tasks.map(task => {
      // 获取该任务的总体统计
      const stats = db.prepare(`
        SELECT
          COUNT(*) as total,
          COALESCE(SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END), 0) as completed,
          COALESCE(SUM(CASE WHEN status = 'in_progress' THEN 1 ELSE 0 END), 0) as in_progress
        FROM learning_progress WHERE task_id = ?
      `).get(task.id);

      // 获取关联考试的完成情况
      let examPassed = null;
      if (task.exam_id) {
        if (isEmployee) {
          const examRecord = db.prepare(`
            SELECT is_passed FROM exam_records WHERE exam_id = ? AND staff_id = ? AND submitted_at IS NOT NULL
          `).get(task.exam_id, userId);
          examPassed = examRecord ? !!examRecord.is_passed : false;
        } else {
          const examRecord = db.prepare(`
            SELECT is_passed FROM exam_records WHERE exam_id = ? AND user_id = ? AND submitted_at IS NOT NULL
          `).get(task.exam_id, userId);
          examPassed = examRecord ? !!examRecord.is_passed : false;
        }
      }

      const achievementRate = stats.total > 0 ? Math.round((stats.completed / stats.total) * 100) : 0;

      return {
        task_id: task.id,
        task_title: task.title,
        description: task.description,
        start_time: task.start_time,
        end_time: task.end_time,
        my_status: task.my_status,
        my_progress: task.my_progress,
        exam_id: task.exam_id,
        exam_title: task.exam_title,
        exam_is_active: task.exam_is_active,
        exam_passed: examPassed,
        stats: {
          total: stats.total,
          completed: stats.completed,
          in_progress: stats.in_progress || 0,
          not_started: (stats.total || 0) - (stats.completed || 0) - (stats.in_progress || 0),
          achievement_rate: achievementRate
        }
      };
    });

    res.json({ code: 0, msg: 'success', data: records });
  } catch (err) {
    console.error('获取培训记录失败:', err);
    res.status(500).json({ code: -1, msg: '服务器错误', data: null });
  }
});

// 获取任务详情(带权限检查)
// GET /api/learning-tasks/:id
router.get('/:id', authMiddleware, (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.type === 'employee' ? req.user.id : req.user.userId;
    const trainingId = req.query.trainingId ? parseInt(req.query.trainingId) : null;

    // 获取任务信息
    const task = db.prepare('SELECT * FROM learning_tasks WHERE id = ?').get(id);

    if (!task) {
      return res.status(404).json({
        code: -1,
        msg: '学习任务不存在',
        data: null
      });
    }

    // 检查是否有此学习任务绑定的考试权限
    const hasPermission = checkLearningTaskPermission(userId, req.user.role, req.user.can_manage_training, id);

    if (!hasPermission) {
      return res.status(403).json({
        code: -1,
        msg: '无权访问此学习任务',
        data: null
      });
    }

    // 获取学习进度（按培训上下文）
    let progress;
    if (trainingId) {
      // 新培训上下文：优先查找该培训下的进度记录，如果没有则视为0%
      progress = db.prepare(`
        SELECT * FROM learning_progress
        WHERE staff_id = ? AND task_id = ? AND training_id = ?
      `).get(userId, id, trainingId);
    } else {
      // 兼容旧逻辑：无培训上下文时查找无培训ID的记录
      progress = db.prepare(`
        SELECT * FROM learning_progress
        WHERE staff_id = ? AND task_id = ? AND training_id IS NULL
      `).get(userId, id);
    }

    // 获取当前时间
    const now = new Date();

    // 获取所有有考试权限的用户及其学习进度
    const allUsersObj = getAllExamPermissionUsers();
    const allUsers = [...allUsersObj.users, ...allUsersObj.staff];
    const usersWithProgress = allUsers.map(user => {
      const userProgress = db.prepare(`
        SELECT * FROM learning_progress WHERE staff_id = ? AND task_id = ?
      `).get(user.id, id);

      // 检查是否超时未完成
      let isOverdue = false;
      if (task.end_time && (!userProgress || userProgress.status !== 'completed')) {
        const endTime = new Date(task.end_time);
        if (now > endTime) {
          isOverdue = true;
        }
      }

      return {
        ...user,
        progress: userProgress || {
          status: 'not_started'
        },
        isOverdue
      };
    });

    // 获取学习进度统计
    const progressStats = db.prepare(`
      SELECT status, COUNT(*) as count
      FROM learning_progress
      WHERE task_id = ?
      GROUP BY status
    `).all(id);

    const stats = {
      total: allUsers.length,
      not_started: 0,
      in_progress: 0,
      completed: 0
    };

    progressStats.forEach(stat => {
      if (stat.status === 'not_started') {
        stats.not_started = stat.count;
      } else if (stat.status === 'in_progress') {
        stats.in_progress = stat.count;
      } else if (stat.status === 'completed') {
        stats.completed = stat.count;
      }
    });

    stats.not_started = stats.total - stats.in_progress - stats.completed;

    // 获取关联的培训信息
    const exam = db.prepare('SELECT id, title, duration, pass_score, is_active FROM exam_trainings WHERE learning_task_id = ?').get(id);

    res.json({
      code: 0,
      msg: 'success',
      data: {
        ...task,
        progress: progress || {
          status: 'not_started',
          progress_percent: '0',
          last_position: 0
        },
        users: usersWithProgress,
        stats,
        exam: exam || null
      }
    });
  } catch (err) {
    console.error('获取学习任务详情失败:', err);
    res.status(500).json({
      code: -1,
      msg: '服务器错误',
      data: null
    });
  }
});

// 创建学习任务(管理员)
// POST /api/learning-tasks
router.post('/', authMiddleware, (req, res) => {
  try {
    // 检查管理员权限
    if (req.user.role !== 'admin') {
      return res.status(403).json({
        code: -1,
        msg: '需要管理员权限',
        data: null
      });
    }

    const schema = Joi.object({
      title: Joi.string().required(),
      file_type: Joi.string().valid('mp4').optional(),
      file_url: Joi.string().optional(),
      start_time: Joi.date().optional(),
      end_time: Joi.date().optional(),
      description: Joi.string().allow('').optional(),
      duration: Joi.number().integer().optional()
    });

    const { error, value } = schema.validate(req.body);
    if (error) {
      return res.status(400).json({
        code: -1,
        msg: error.details[0].message,
        data: null
      });
    }

    const { title, description, file_type, file_url, start_time, end_time, duration } = value;

    // 检查标题是否已存在
    const existingTask = db.prepare('SELECT id FROM learning_tasks WHERE title = ?').get(title.trim());
    if (existingTask) {
      return res.status(400).json({ code: -1, msg: '学习资料标题已存在', data: null });
    }

    // 处理时区问题:前端发送的是北京时间 (UTC+8)
    // datetime-local 输入格式: 2026-03-27T20:00 (本地时间)
    // 需要转换为 UTC 存储
    function convertLocalToUTC(localTimeStr) {
      if (!localTimeStr) return null;
      // 创建 Date 对象,会被当作本地时间解析
      const date = new Date(localTimeStr);
      // 直接返回 ISO 字符串(会正确转换为 UTC)
      return date.toISOString();
    }

    // 创建任务
    const stmt = db.prepare(`
      INSERT INTO learning_tasks (title, description, file_type, file_url, start_time, end_time, created_by, duration)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const result = stmt.run(
      title,
      description || '',
      file_type || null,
      file_url || null,
      convertLocalToUTC(start_time),
      convertLocalToUTC(end_time),
      req.user.userId,
      duration || null
    );

    const taskId = result.lastInsertRowid;

    res.json({
      code: 0,
      msg: '学习任务创建成功',
      data: {
        id: taskId,
        title,
        description,
        file_type,
        file_url,
        start_time: convertLocalToUTC(start_time),
        end_time: convertLocalToUTC(end_time),
        duration: duration || null
      }
    });
  } catch (err) {
    console.error('创建学习任务失败:', err);
    res.status(500).json({
      code: -1,
      msg: '服务器错误',
      data: null
    });
  }
});

// 更新学习任务(管理员)
// PUT /api/learning-tasks/:id
router.put('/:id', authMiddleware, (req, res) => {
  try {
    // 检查管理员权限
    if (req.user.role !== 'admin') {
      return res.status(403).json({
        code: -1,
        msg: '需要管理员权限',
        data: null
      });
    }

    const { id } = req.params;

    const task = db.prepare('SELECT * FROM learning_tasks WHERE id = ?').get(id);
    if (!task) {
      return res.status(404).json({
        code: -1,
        msg: '学习任务不存在',
        data: null
      });
    }

    const { title, file_url, start_time, end_time } = req.body;

    // 处理时区问题:前端发送的是北京时间 (UTC+8)
    function convertLocalToUTC(localTimeStr) {
      if (!localTimeStr) return null;
      const date = new Date(localTimeStr);
      return date.toISOString();
    }

    // 更新任务
    const stmt = db.prepare(`
      UPDATE learning_tasks
      SET title = ?, file_url = ?, start_time = ?, end_time = ?, updated_at = datetime('now')
      WHERE id = ?
    `);

    stmt.run(
      title !== undefined ? title : task.title,
      file_url !== undefined ? file_url : task.file_url,
      start_time ? convertLocalToUTC(start_time) : task.start_time,
      end_time ? convertLocalToUTC(end_time) : task.end_time,
      id
    );

    res.json({
      code: 0,
      msg: '学习任务更新成功',
      data: null
    });
  } catch (err) {
    console.error('更新学习任务失败:', err);
    res.status(500).json({
      code: -1,
      msg: '服务器错误',
      data: null
    });
  }
});

// 删除学习任务(管理员)
// DELETE /api/learning-tasks/:id
router.delete('/:id', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { id } = req.params;

    const task = db.prepare('SELECT * FROM learning_tasks WHERE id = ?').get(id);
    if (!task) {
      return res.status(404).json({
        code: -1,
        msg: '学习任务不存在',
        data: null
      });
    }

    // 检查是否有培训关联此学习资料
    const relatedTrainings = db.prepare(`
      SELECT id, title FROM exam_trainings WHERE learning_task_id = ?
    `).all(id);
    if (relatedTrainings.length > 0) {
      return res.status(400).json({
        code: -1,
        msg: `该学习资料已被 ${relatedTrainings.length} 个培训引用，无法删除`,
        data: { related_trainings: relatedTrainings }
      });
    }

    // 删除云存储文件（如果是云存储的文件）
    if (task.file_url && task.file_url.includes('cmecloud.cn')) {
      try {
        const { deleteFromCloud } = require('../utils/cloud-storage');
        await deleteFromCloud(task.file_url);
        console.log('云存储文件已删除:', task.file_url);
      } catch (cloudErr) {
        console.error('删除云存储文件失败:', cloudErr.message);
        // 不阻塞删除流程，继续删除数据库记录
      }
    }

    // 删除任务(级联删除权限和进度)
    db.prepare('DELETE FROM learning_progress WHERE task_id = ?').run(id);
    db.prepare('DELETE FROM learning_tasks WHERE id = ?').run(id);

    res.json({
      code: 0,
      msg: '学习任务删除成功',
      data: null
    });
  } catch (err) {
    console.error('删除学习任务失败:', err);
    res.status(500).json({
      code: -1,
      msg: '服务器错误',
      data: null
    });
  }
});

// 批量删除学习任务(管理员)
// POST /api/learning-tasks/batch-delete
router.post('/batch-delete', authMiddleware, async (req, res) => {
  try {
    // 检查管理员权限
    if (req.user.role !== 'admin') {
      return res.status(403).json({
        code: -1,
        msg: '需要管理员权限',
        data: null
      });
    }

    const { ids } = req.body;

    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({
        code: -1,
        msg: '请选择要删除的任务',
        data: null
      });
    }

    // 检查是否有培训任务引用这些学习资料
    const placeholders = ids.map(() => '?').join(',');
    const referenced = db.prepare(`
      SELECT DISTINCT lt.learning_task_id, et.title as training_title
      FROM exam_trainings et
      INNER JOIN learning_tasks lt ON et.learning_task_id = lt.id
      WHERE lt.id IN (${placeholders})
    `).all(...ids);

    if (referenced.length > 0) {
      const titles = referenced.map(r => r.training_title).join('、');
      return res.status(400).json({
        code: -1,
        msg: `以下学习资料正在被培训任务引用，无法删除：${titles}`,
        data: null
      });
    }

    // 获取要删除的任务的文件信息
    const tasks = db.prepare(`SELECT id, file_url FROM learning_tasks WHERE id IN (${placeholders})`).all(...ids);

    // 删除云存储文件
    try {
      const { deleteFromCloud } = require('../utils/cloud-storage');
      for (const task of tasks) {
        if (task.file_url && task.file_url.includes('cmecloud.cn')) {
          await deleteFromCloud(task.file_url);
        }
      }
    } catch (cloudErr) {
      console.error('批量删除云存储文件失败:', cloudErr.message);
    }

    // 删除任务
    const stmt = db.prepare('DELETE FROM learning_tasks WHERE id = ?');
    ids.forEach(id => stmt.run(id));

    res.json({
      code: 0,
      msg: `成功删除 ${ids.length} 个任务`,
      data: { deleted: ids.length }
    });
  } catch (err) {
    console.error('批量删除学习任务失败:', err);
    res.status(500).json({
      code: -1,
      msg: '服务器错误',
      data: null
    });
  }
});

// 获取学习进度
// GET /api/learning-materials/:id/progress
router.get('/:id/progress', authMiddleware, (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.type === 'employee' ? req.user.id : req.user.userId;

    const task = db.prepare('SELECT * FROM learning_tasks WHERE id = ?').get(id);
    if (!task) {
      return res.status(404).json({ code: -1, msg: '学习任务不存在', data: null });
    }

    // 获取所有人员的学习进度（管理员用），按培训任务区分
    const trainingId = req.query.trainingId;
    let progress;
    if (trainingId) {
      progress = db.prepare(`
        SELECT lp.*, s.name, s.employee_id, s.department
        FROM learning_progress lp
        LEFT JOIN staff s ON lp.staff_id = s.id
        WHERE lp.task_id = ? AND lp.training_id = ?
        ORDER BY s.department, s.name
      `).all(id, trainingId);
    } else {
      progress = db.prepare(`
        SELECT lp.*, s.name, s.employee_id, s.department
        FROM learning_progress lp
        LEFT JOIN staff s ON lp.staff_id = s.id
        WHERE lp.task_id = ?
        ORDER BY s.department, s.name
      `).all(id);
    }

    res.json({ code: 0, msg: 'success', data: progress });
  } catch (err) {
    console.error('获取学习进度失败:', err);
    res.status(500).json({ code: -1, msg: '服务器错误', data: null });
  }
});

// 更新学习进度
// POST /api/learning-tasks/:id/progress
router.post('/:id/progress', authMiddleware, (req, res) => {
  try {
    const { id } = req.params;
    const { status, progress_percent, last_position, training_id } = req.body;
    const userId = req.user.type === 'employee' ? req.user.id : req.user.userId;

    // 验证状态
    if (status && !['not_started', 'in_progress', 'completed'].includes(status)) {
      return res.status(400).json({
        code: -1,
        msg: '无效的学习状态',
        data: null
      });
    }

    // 验证进度百分比
    if (progress_percent !== undefined && (progress_percent < 0 || progress_percent > 100)) {
      return res.status(400).json({
        code: -1,
        msg: '进度百分比必须在0-100之间',
        data: null
      });
    }

    // 获取任务信息
    const task = db.prepare('SELECT * FROM learning_tasks WHERE id = ?').get(id);
    if (!task) {
      return res.status(404).json({
        code: -1,
        msg: '学习任务不存在',
        data: null
      });
    }

    // 检查用户是否有学习任务权限
    const hasPermission = checkLearningTaskPermission(userId, req.user.role, req.user.can_manage_training, id);

    if (!hasPermission) {
      return res.status(403).json({
        code: -1,
        msg: '无权访问此学习任务',
        data: null
      });
    }

    // 检查是否已存在进度记录（按培训上下文）
    let existing;
    if (training_id) {
      existing = db.prepare(`
        SELECT * FROM learning_progress WHERE staff_id = ? AND task_id = ? AND training_id = ?
      `).get(userId, id, training_id);
    } else {
      existing = db.prepare(`
        SELECT * FROM learning_progress WHERE staff_id = ? AND task_id = ? AND training_id IS NULL
      `).get(userId, id);
    }

    // 状态优先级：completed > in_progress > not_started
    const statusPriority = { 'not_started': 0, 'in_progress': 1, 'completed': 2 };

    if (existing) {
      // 只保存最高进度：比较 last_position，取最大值
      const newPosition = last_position !== undefined ? last_position : existing.last_position;
      const existingPosition = existing.last_position || 0;

      // 状态优先级比较：只取更高的状态
      const existingStatusPriority = statusPriority[existing.status] || 0;
      const newStatusPriority = status ? (statusPriority[status] || 0) : 0;

      // 判断是否需要更新
      const shouldUpdatePosition = newPosition > existingPosition;
      const shouldUpdateStatus = newStatusPriority > existingStatusPriority;

      // 如果进度更低，直接返回当前最高进度（不舍弃已有进度）
      if (!shouldUpdatePosition && !shouldUpdateStatus) {
        return res.json({
          code: 0,
          msg: '进度已落后，保留最高记录',
          data: {
            progress_percent: existing.progress_percent,
            last_position: existing.last_position,
            status: existing.status,
            is_updated: false
          }
        });
      }

      // 执行更新
      const updates = [];
      const params = [];

      if (shouldUpdatePosition) {
        updates.push('last_position = ?');
        params.push(newPosition);
      }

      if (shouldUpdateStatus) {
        updates.push('status = ?');
        params.push(status);
      }

      if (progress_percent !== undefined) {
        updates.push('progress_percent = ?');
        params.push(Math.max(progress_percent, existing.progress_percent || 0));
      }

      updates.push("last_access_time = datetime('now')");

      // 根据实际进度百分比决定状态，不再保留旧状态
      const currentPercent = progress_percent !== undefined ? progress_percent : existing.progress_percent || 0;
      const finalStatus = currentPercent >= 100 ? 'completed' : (currentPercent > 0 ? 'in_progress' : 'not_started');
      updates.push('status = ?');
      params.push(finalStatus);

      if (finalStatus === 'completed') {
        updates.push("completed_at = datetime('now')");
      }

      params.push(userId, id);

      let query;
      if (training_id) {
        query = `UPDATE learning_progress SET ${updates.join(', ')} WHERE staff_id = ? AND task_id = ? AND training_id = ?`;
        params.push(training_id);
      } else {
        query = `UPDATE learning_progress SET ${updates.join(', ')} WHERE staff_id = ? AND task_id = ? AND training_id IS NULL`;
      }
      db.prepare(query).run(...params);

      return res.json({
        code: 0,
        msg: '学习进度更新成功',
        data: {
          progress_percent: currentPercent,
          last_position: shouldUpdatePosition ? newPosition : existingPosition,
          status: finalStatus,
          is_updated: true
        }
      });
    } else {
      // 创建新记录
      db.prepare(`
        INSERT INTO learning_progress (staff_id, task_id, training_id, status, progress_percent, last_position, last_access_time, completed_at)
        VALUES (?, ?, ?, ?, ?, ?, datetime('now'), ?)
      `).run(
        userId,
        id,
        training_id || null,
        status || 'not_started',
        progress_percent || 0,
        last_position || 0,
        status === 'completed' ? new Date().toISOString() : null
      );

      res.json({
        code: 0,
        msg: '学习进度创建成功',
        data: {
          progress_percent: progress_percent || 0,
          last_position: last_position || 0,
          status: status || 'not_started',
          is_updated: true
        }
      });
    }
  } catch (err) {
    console.error('更新学习进度失败:', err);
    res.status(500).json({
      code: -1,
      msg: '服务器错误',
      data: null
    });
  }
});

// POST /api/learning-task/upload-ppt - 上传PPT并转换为视频
const multer = require('multer');
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024 } // 100MB
});

router.post('/upload-ppt', authMiddleware, adminMiddleware, upload.single('file'), async (req, res) => {
  const convertType = req.headers['x-convert-type'];
  if (!req.file) {
    return res.status(400).json({ code: -1, msg: '请选择文件', data: null });
  }
  const file = req.file;
  const allowedTypes = [
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/ppt', 'application/pptx'
  ];
  if (!allowedTypes.includes(file.mimetype) && !file.originalname.match(/\.(ppt|pptx)$/i)) {
    return res.status(400).json({ code: -1, msg: '只支持 PPT/PPTX 文件', data: null });
  }

  const { exec, spawn } = require('child_process');
  const path = require('path');
  const fs = require('fs');
  const { randomBytes } = require('crypto');
  const randomHex = randomBytes(8).toString('hex');
  const uploadDir = path.join(__dirname, '../../uploads/learning-task');
  if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
  const pptPath = path.join(uploadDir, `${randomHex}.pptx`);
  const pdfPath = path.join(uploadDir, `${randomHex}.pdf`);
  const imgDir = path.join(uploadDir, `${randomHex}_frames`);
  const videoPath = path.join(uploadDir, `${randomHex}.mp4`);

  fs.writeFileSync(pptPath, file.buffer);

  // SSE progress helper
  const progressClients = [];
  function sendProgress(pct, msg) {
    const data = JSON.stringify({ percent: pct, message: msg });
    progressClients.forEach(res => res.write(`data: ${data}\n\n`));
  }

  // Register this response as SSE client if Accept: text/event-stream
  if (req.headers.accept && req.headers.accept.includes('text/event-stream')) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    progressClients.push(res);
    req.on('close', () => {
      const idx = progressClients.indexOf(res);
      if (idx >= 0) progressClients.splice(idx, 1);
    });
  }

  sendProgress(5, '开始转换...');

  // Step 1: LibreOffice convert PPTX to PDF
  const steps = {
    convertPdf: { done: false, pct: 40 },
    extractFrames: { done: false, pct: 70 },
    encodeVideo: { done: false, pct: 95 }
  };

  function stepDone(name) {
    sendProgress(steps[name].pct, { convertPdf: 'PDF 转换完成', extractFrames: '图片提取完成', encodeVideo: '视频生成完成' }[name]);
    steps[name].done = true;
  }

  const convStep = (cmd, cwd) => new Promise((resolve, reject) => {
    exec(cmd, { cwd }, (err, stdout, stderr) => {
      if (err) { reject(err); }
      else resolve(stdout);
    });
  });

  try {
    // Convert PPTX -> PDF using LibreOffice
    sendProgress(10, 'LibreOffice 转换中 (1/3)...');
    await convStep(
      `libreoffice --headless --convert-to pdf "${pptPath}" --outdir "${uploadDir}"`,
      '/tmp'
    );
    stepDone('convertPdf');

    // Extract PDF pages as images
    sendProgress(45, '提取幻灯片为图片 (2/3)...');
    if (!fs.existsSync(imgDir)) fs.mkdirSync(imgDir, { recursive: true });
    await convStep(
      `pdftoppm -r 150 -png "${pdfPath}" "${imgDir}/slide"`,
      '/tmp'
    );
    const frames = fs.readdirSync(imgDir).filter(f => f.endsWith('.png')).sort();
    if (frames.length === 0) throw new Error('PDF 转图片失败');
    stepDone('extractFrames');

    // Make video from images using FFmpeg
    sendProgress(75, 'FFmpeg 合成视频 (3/3)...');
    const framePattern = path.join(imgDir, 'slide-%d.png');
    // Use 3 seconds per slide
    await convStep(
      `ffmpeg -y -framerate 1/3 -i "${framePattern}" -vf "scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2,setsar=1" -c:v libx264 -pix_fmt yuv420p -r 30 "${videoPath}" 2>&1 | tail -5`,
      '/tmp'
    );
    stepDone('encodeVideo');

    // Clean up temp files
    try { fs.unlinkSync(pptPath); } catch(e) {}
    try { fs.unlinkSync(pdfPath); } catch(e) {}
    try {
      fs.readdirSync(imgDir).forEach(f => fs.unlinkSync(path.join(imgDir, f)));
      fs.rmdirSync(imgDir);
    } catch(e) {}

    sendProgress(100, '转换完成');
    const videoUrl = `/uploads/learning-task/${randomHex}.mp4`;

    // Close SSE clients
    progressClients.forEach(c => c.end());

    res.json({ code: 0, msg: '转换成功', data: { video_url: videoUrl } });
  } catch (err) {
    console.error('PPT转视频失败:', err);
    sendProgress(0, '转换失败: ' + err.message);
    progressClients.forEach(c => c.end());
    // Cleanup
    [pptPath, pdfPath].forEach(f => { try { fs.unlinkSync(f); } catch(e) {} });
    res.status(500).json({ code: -1, msg: '转换失败: ' + err.message, data: null });
  }
});

module.exports = router;
