// src/routes/task.js - 个人待办与团队任务 API
const express = require('express');
const Joi = require('joi');
const router = express.Router();
const db = require('../models/database');
const { authMiddleware } = require('../middleware/auth');
const { actorFromRequestUser, createNotification } = require('../services/notification-service');

const CATEGORY_VALUES = ['daily', 'production', 'quality', 'training', 'meal', 's6', 'other'];
const STATUS_VALUES = ['pending', 'in_progress', 'completed'];
const PRIORITY_VALUES = ['low', 'medium', 'high'];

const taskSelect = `
  SELECT t.*,
         assignee.name AS assigned_staff_name,
         assignee.employee_id AS assigned_staff_employee_id,
         assignee.department AS assigned_staff_department,
         assignee.position AS assigned_staff_position,
         parent.title AS parent_task_title,
         creator.nickname AS created_by_name,
         creator.username AS created_by_username,
         (
           SELECT COUNT(*)
           FROM tasks sub
           WHERE sub.parent_task_id = t.id
         ) AS subtask_count,
         (
           SELECT COUNT(*)
           FROM tasks sub
           WHERE sub.parent_task_id = t.id AND sub.status = 'completed'
         ) AS completed_subtask_count,
         (
           SELECT COUNT(*)
           FROM tasks sub
           WHERE sub.parent_task_id = t.id AND sub.status = 'in_progress'
         ) AS in_progress_subtask_count
  FROM tasks t
  LEFT JOIN staff assignee ON assignee.id = t.assigned_staff_id
  LEFT JOIN tasks parent ON parent.id = t.parent_task_id
  LEFT JOIN users creator ON creator.id = t.created_by_user_id
`;

const subtaskSchema = Joi.object({
  title: Joi.string().trim().max(120).required(),
  description: Joi.string().allow('').max(2000).default(''),
  assigned_staff_id: Joi.number().integer().positive().required(),
  due_at: Joi.date().iso().allow(null, ''),
  priority: Joi.string().valid(...PRIORITY_VALUES).optional()
});

function currentAdmin(req) {
  if (req.user.type === 'employee') return null;
  const userId = Number(req.user.userId || req.user.id);
  if (!userId) return null;
  const user = db.prepare("SELECT * FROM users WHERE id = ? AND role = 'admin'").get(userId);
  if (!user) return null;
  if (!user.staff_id && user.username) {
    const staff = db.prepare('SELECT id FROM staff WHERE employee_id = ? LIMIT 1').get(user.username);
    if (staff) {
      db.prepare('UPDATE users SET staff_id = ? WHERE id = ?').run(staff.id, user.id);
      user.staff_id = staff.id;
    }
  }
  return user;
}

function currentStaffId(req, admin) {
  if (req.user.type === 'employee') return Number(req.user.id);
  return Number(admin?.staff_id) || null;
}

function isSuperAdmin(admin) {
  return admin?.username === 'admin';
}

function requireAdmin(req, res) {
  const admin = currentAdmin(req);
  if (!admin) {
    res.status(403).json({ code: -1, msg: '需要后台账号权限', data: null });
    return null;
  }
  return admin;
}

function taskInboxWhere(req, admin) {
  const staffId = currentStaffId(req, admin);
  if (req.user.type === 'employee') {
    return { clause: "t.scope = 'assigned' AND t.assigned_staff_id = ?", params: [staffId] };
  }
  const parts = ["(t.scope = 'personal' AND t.owner_user_id = ?)"];
  const params = [admin.id];
  if (staffId) {
    parts.push("(t.scope = 'assigned' AND t.assigned_staff_id = ?)");
    params.push(staffId);
  }
  parts.push("(t.scope = 'legacy' AND t.assigned_to = ?)");
  params.push(admin.id);
  return { clause: `(${parts.join(' OR ')})`, params };
}

function taskVisibleTo(req, task, admin) {
  const staffId = currentStaffId(req, admin);
  if (req.user.type === 'employee') {
    return task.scope === 'assigned' && Number(task.assigned_staff_id) === staffId;
  }
  return Number(task.owner_user_id) === admin.id ||
    Number(task.created_by_user_id) === admin.id ||
    (staffId && Number(task.assigned_staff_id) === staffId) ||
    (task.scope === 'legacy' && Number(task.assigned_to) === admin.id) ||
    isSuperAdmin(admin);
}

function getTask(id) {
  return db.prepare(`${taskSelect} WHERE t.id = ?`).get(id);
}

function deriveTaskProgress(task) {
  const total = Number(task?.subtask_count || 0);
  const completed = Number(task?.completed_subtask_count || 0);
  const inProgress = Number(task?.in_progress_subtask_count || 0);
  if (!total) {
    return {
      percent: task?.status === 'completed' ? 100 : task?.status === 'in_progress' ? 50 : 0,
      derived_status: task?.status || 'pending'
    };
  }
  const percent = Math.round((completed / total) * 100);
  let derivedStatus = 'pending';
  if (completed >= total) derivedStatus = 'completed';
  else if (completed > 0 || inProgress > 0) derivedStatus = 'in_progress';
  return { percent, derived_status: derivedStatus };
}

function decorateTask(task) {
  if (!task) return task;
  const progress = deriveTaskProgress(task);
  return { ...task, progress_percent: progress.percent, derived_status: progress.derived_status };
}

function getChildTasks(parentTaskId) {
  return db.prepare(`
    ${taskSelect}
    WHERE t.parent_task_id = ?
    ORDER BY
      CASE WHEN t.status = 'completed' THEN 1 ELSE 0 END,
      CASE WHEN t.due_at IS NULL THEN 1 ELSE 0 END,
      t.due_at ASC,
      t.created_at ASC
  `).all(parentTaskId).map(decorateTask);
}

function syncParentTaskStatus(parentTaskId) {
  if (!parentTaskId) return null;
  const counts = db.prepare(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed_count,
      SUM(CASE WHEN status = 'in_progress' THEN 1 ELSE 0 END) AS in_progress_count
    FROM tasks
    WHERE parent_task_id = ?
  `).get(parentTaskId);
  if (!counts || Number(counts.total || 0) === 0) return null;

  let status = 'pending';
  if (Number(counts.completed_count || 0) >= Number(counts.total || 0)) status = 'completed';
  else if (Number(counts.completed_count || 0) > 0 || Number(counts.in_progress_count || 0) > 0) status = 'in_progress';

  db.prepare(`
    UPDATE tasks
    SET status = ?,
        completed_at = CASE WHEN ? = 'completed' THEN datetime('now', 'localtime') ELSE NULL END,
        updated_at = datetime('now', 'localtime')
    WHERE id = ?
  `).run(status, status, parentTaskId);

  return decorateTask(getTask(parentTaskId));
}

function notifyAssignedTask(req, admin, task, category = 'task_assigned') {
  if (!task?.assigned_staff_id || Number(task.assigned_staff_id) === Number(admin?.staff_id || 0)) return;
  createNotification(
    { type: 'employee', id: task.assigned_staff_id },
    {
      ...actorFromRequestUser(req.user),
      category,
      module: 'task',
      source_id: task.id,
      title: `${taskActorName(admin, req)}给你分派了一项任务`,
      content: `${task.title}${task.due_at ? ` · 截止 ${String(task.due_at).slice(0, 16)}` : ''}`,
      level: task.priority === 'high' ? 'warning' : 'info'
    }
  );
}

function getAssignmentContext(admin) {
  if (isSuperAdmin(admin)) return { superAdmin: true };
  if (!admin.staff_id) return null;
  const staff = db.prepare(`
    SELECT s.*, levels.level, levels.company_wide
    FROM staff s
    LEFT JOIN task_position_levels levels ON levels.position_name = TRIM(s.position)
    WHERE s.id = ?
  `).get(admin.staff_id);
  if (!staff || staff.level == null) return null;
  return {
    superAdmin: false,
    staff,
    can_cross_department: Number(admin.can_manage_task) === 1 && Number(staff.company_wide) === 1
  };
}

function canAssignTo(admin, assignedStaffId) {
  const target = db.prepare(`
    SELECT s.*, levels.level, levels.company_wide
    FROM staff s
    LEFT JOIN task_position_levels levels ON levels.position_name = TRIM(s.position)
    WHERE s.id = ? AND s.status = 'active'
  `).get(assignedStaffId);
  if (!target) return { allowed: false, msg: '负责人不存在或已离职' };

  const context = getAssignmentContext(admin);
  if (!context) return { allowed: false, msg: '当前账号未配置任务分派权限或岗位级别' };
  if (context.superAdmin) return { allowed: true, target };
  if (target.level == null) return { allowed: false, msg: '负责人岗位尚未配置任务级别' };

  const source = context.staff;
  const sameDepartment = String(source.department || '') === String(target.department || '');
  if (!sameDepartment && !context.can_cross_department) {
    return { allowed: false, msg: '当前账号未开启跨部门分派权限' };
  }
  if (Number(target.level) >= Number(source.level)) {
    return { allowed: false, msg: '只能向岗位级别低于自己的员工分派任务' };
  }
  return { allowed: true, target };
}

function normalizeDueAt(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const pad = part => String(part).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function taskActorName(admin, req) {
  if (req.user.type === 'employee') return req.user.name || '员工';
  return admin?.nickname || admin?.username || req.user.name || '管理员';
}

function addFilters(query, params, filters) {
  if (filters.category) {
    query += ' AND t.category = ?';
    params.push(filters.category);
  }
  if (filters.priority) {
    query += ' AND t.priority = ?';
    params.push(filters.priority);
  }
  if (filters.status) {
    query += ' AND t.status = ?';
    params.push(filters.status);
  }
  return query;
}

// GET /api/task
router.get('/', authMiddleware, (req, res) => {
  try {
    const admin = currentAdmin(req);
    const view = req.query.view || 'inbox';
    const params = [];
    let query = `${taskSelect} WHERE 1=1`;

    if (view === 'created') {
      if (!admin) return res.status(403).json({ code: -1, msg: '员工端不支持查看已派任务', data: null });
      query += " AND t.created_by_user_id = ? AND t.scope IN ('assigned', 'personal') AND COALESCE(t.parent_task_id, 0) = 0";
      params.push(admin.id);
    } else {
      const inbox = taskInboxWhere(req, admin);
      query += ` AND ${inbox.clause}`;
      params.push(...inbox.params);
      if (view === 'completed') query += " AND t.status = 'completed'";
      else if (!req.query.status) query += " AND t.status <> 'completed'";
    }

    query = addFilters(query, params, req.query);
    query += `
      ORDER BY
        CASE WHEN t.status = 'completed' THEN 1 ELSE 0 END,
        CASE WHEN t.due_at IS NULL THEN 1 ELSE 0 END,
        t.due_at ASC,
        CASE t.priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END,
        t.created_at DESC
    `;

    const rows = db.prepare(query).all(...params).map(decorateTask);
    res.json({ code: 0, msg: 'success', data: rows });
  } catch (err) {
    console.error('获取任务列表失败:', err);
    res.status(500).json({ code: -1, msg: '服务器错误', data: null });
  }
});

// GET /api/task/summary
router.get('/summary', authMiddleware, (req, res) => {
  try {
    const admin = currentAdmin(req);
    const inbox = taskInboxWhere(req, admin);
    const tasks = db.prepare(`
      SELECT status, due_at
      FROM tasks t
      WHERE ${inbox.clause} AND t.status <> 'completed'
    `).all(...inbox.params);
    const today = new Date().toISOString().slice(0, 10);
    const overdue = tasks.filter(task => task.due_at && String(task.due_at).slice(0, 10) < today).length;
    const dueToday = tasks.filter(task => task.due_at && String(task.due_at).slice(0, 10) === today).length;
    res.json({ code: 0, msg: 'success', data: { pending: tasks.length, due_today: dueToday, overdue } });
  } catch (err) {
    console.error('获取任务摘要失败:', err);
    res.status(500).json({ code: -1, msg: '服务器错误', data: null });
  }
});

// GET /api/task/assignees
router.get('/assignees', authMiddleware, (req, res) => {
  try {
    const admin = requireAdmin(req, res);
    if (!admin) return;
    const context = getAssignmentContext(admin);
    if (!context) return res.json({ code: 0, msg: '当前账号仅支持个人待办', data: [] });

    const { search = '', department = '' } = req.query;
    const params = [];
    let query = `
      SELECT s.id, s.employee_id, s.name, s.department, s.team, s.position, levels.level
      FROM staff s
      LEFT JOIN task_position_levels levels ON levels.position_name = TRIM(s.position)
      WHERE s.status = 'active'
    `;
    if (!context.superAdmin) {
      query += ' AND levels.level < ?';
      params.push(context.staff.level);
      if (!context.can_cross_department) {
        query += ' AND COALESCE(s.department, \'\') = COALESCE(?, \'\')';
        params.push(context.staff.department || '');
      }
    }
    if (search) {
      query += ' AND (s.name LIKE ? OR s.employee_id LIKE ? OR s.name_pinyin LIKE ?)';
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }
    if (department) {
      query += ' AND s.department = ?';
      params.push(department);
    }
    query += ' ORDER BY s.department, s.position, s.name LIMIT 120';
    res.json({ code: 0, msg: 'success', data: db.prepare(query).all(...params) });
  } catch (err) {
    console.error('获取可分派员工失败:', err);
    res.status(500).json({ code: -1, msg: '服务器错误', data: null });
  }
});

// GET /api/task/position-levels
router.get('/position-levels', authMiddleware, (req, res) => {
  try {
    const admin = requireAdmin(req, res);
    if (!admin) return;
    const levels = db.prepare(`
      SELECT levels.*, COUNT(staff.id) AS staff_count
      FROM task_position_levels levels
      LEFT JOIN staff ON TRIM(staff.position) = levels.position_name
      GROUP BY levels.id
      ORDER BY levels.level DESC, levels.position_name
    `).all();
    res.json({ code: 0, msg: 'success', data: levels });
  } catch (err) {
    console.error('获取岗位级别失败:', err);
    res.status(500).json({ code: -1, msg: '服务器错误', data: null });
  }
});

// PUT /api/task/position-levels
router.put('/position-levels', authMiddleware, (req, res) => {
  try {
    const admin = requireAdmin(req, res);
    if (!admin) return;
    if (!isSuperAdmin(admin) && Number(admin.can_manage_permission) !== 1) {
      return res.status(403).json({ code: -1, msg: '需要权限管理能力', data: null });
    }
    const schema = Joi.object({
      items: Joi.array().items(Joi.object({
        position_name: Joi.string().trim().required(),
        level: Joi.number().integer().min(1).max(99).required(),
        company_wide: Joi.number().integer().valid(0, 1).default(0)
      })).required()
    });
    const { error, value } = schema.validate(req.body);
    if (error) return res.status(400).json({ code: -1, msg: error.details[0].message, data: null });

    const update = db.prepare(`
      INSERT INTO task_position_levels (position_name, level, company_wide, updated_at)
      VALUES (?, ?, ?, datetime('now', 'localtime'))
      ON CONFLICT(position_name) DO UPDATE SET
        level = excluded.level,
        company_wide = excluded.company_wide,
        updated_at = excluded.updated_at
    `);
    db.transaction(items => items.forEach(item => update.run(item.position_name, item.level, item.company_wide)))(value.items);
    res.json({ code: 0, msg: '岗位级别已更新', data: null });
  } catch (err) {
    console.error('更新岗位级别失败:', err);
    res.status(500).json({ code: -1, msg: '服务器错误', data: null });
  }
});

// GET /api/task/:id
router.get('/:id', authMiddleware, (req, res) => {
  try {
    const task = getTask(req.params.id);
    if (!task) return res.status(404).json({ code: -1, msg: '任务不存在', data: null });
    const admin = currentAdmin(req);
    if (!taskVisibleTo(req, task, admin)) return res.status(403).json({ code: -1, msg: '无权访问此任务', data: null });
    const detailTask = decorateTask(task);
    detailTask.children = getChildTasks(task.id);
    res.json({ code: 0, msg: 'success', data: detailTask });
  } catch (err) {
    console.error('获取任务详情失败:', err);
    res.status(500).json({ code: -1, msg: '服务器错误', data: null });
  }
});

// POST /api/task
router.post('/', authMiddleware, (req, res) => {
  try {
    const admin = requireAdmin(req, res);
    if (!admin) return;
    const schema = Joi.object({
      title: Joi.string().trim().max(120).required(),
      description: Joi.string().allow('').max(2000).default(''),
      category: Joi.string().valid(...CATEGORY_VALUES).default('daily'),
      priority: Joi.string().valid(...PRIORITY_VALUES).default('medium'),
      due_at: Joi.date().iso().allow(null, ''),
      remind_at: Joi.date().iso().allow(null, ''),
      source_label: Joi.string().trim().max(40).default('manual'),
      assigned_staff_id: Joi.number().integer().positive().allow(null),
      subtasks: Joi.array().items(subtaskSchema).max(20).default([]),
      // 兼容旧调用
      type: Joi.string(),
      assigned_to: Joi.number().integer(),
      due_date: Joi.date().allow(null, '')
    });
    const { error, value } = schema.validate(req.body);
    if (error) return res.status(400).json({ code: -1, msg: error.details[0].message, data: null });

    const assignedStaffId = value.assigned_staff_id || null;
    const subtasks = Array.isArray(value.subtasks) ? value.subtasks : [];
    if (assignedStaffId && subtasks.length) {
      return res.status(400).json({ code: -1, msg: '总任务不能同时直接指定负责人和子任务', data: null });
    }
    const scope = assignedStaffId ? 'assigned' : 'personal';
    if (assignedStaffId) {
      const permission = canAssignTo(admin, assignedStaffId);
      if (!permission.allowed) return res.status(403).json({ code: -1, msg: permission.msg, data: null });
    }
    const dueAt = normalizeDueAt(value.due_at || value.due_date);
    const remindAt = normalizeDueAt(value.remind_at);
    const category = value.category || (CATEGORY_VALUES.includes(value.type) ? value.type : 'other');
    const assignedTo = admin.id;
    const insertTask = db.prepare(`
      INSERT INTO tasks (
        title, description, type, assigned_to, assigned_by, due_date, priority, status,
        scope, category, owner_user_id, assigned_staff_id, created_by_user_id, due_at, remind_at, source_label,
        parent_task_id, task_kind,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now', 'localtime'), datetime('now', 'localtime'))
    `);

    let createdTask;
    db.transaction(() => {
      const result = insertTask.run(
        value.title,
        value.description,
        subtasks.length || scope === 'personal' ? 'personal' : category,
        assignedTo,
        admin.id,
        dueAt ? dueAt.slice(0, 10) : null,
        value.priority,
        subtasks.length ? 'personal' : scope,
        category,
        admin.id,
        subtasks.length ? null : assignedStaffId,
        admin.id,
        dueAt,
        remindAt,
        value.source_label || 'manual',
        null,
        subtasks.length ? 'parent' : 'task'
      );
      createdTask = getTask(result.lastInsertRowid);

      if (subtasks.length) {
        subtasks.forEach((item) => {
          const permission = canAssignTo(admin, item.assigned_staff_id);
          if (!permission.allowed) throw new Error(permission.msg);
          const childDueAt = normalizeDueAt(item.due_at);
          const childResult = insertTask.run(
            item.title,
            item.description || '',
            category,
            assignedTo,
            admin.id,
            childDueAt ? childDueAt.slice(0, 10) : null,
            item.priority || value.priority,
            'assigned',
            category,
            null,
            item.assigned_staff_id,
            admin.id,
            childDueAt,
            remindAt,
            value.source_label || 'manual',
            createdTask.id,
            'subtask'
          );
          const childTask = getTask(childResult.lastInsertRowid);
          notifyAssignedTask(req, admin, childTask);
        });
        createdTask = syncParentTaskStatus(createdTask.id) || decorateTask(createdTask);
      } else {
        createdTask = decorateTask(createdTask);
        notifyAssignedTask(req, admin, createdTask);
      }
    })();

    if (subtasks.length) {
      createdTask.children = getChildTasks(createdTask.id);
    }
    res.json({ code: 0, msg: subtasks.length ? '总任务已创建' : '任务创建成功', data: createdTask });
  } catch (err) {
    console.error('创建任务失败:', err);
    const msg = err && err.message && err.message !== '服务器错误' ? err.message : '服务器错误';
    res.status(msg === '服务器错误' ? 500 : 400).json({ code: -1, msg, data: null });
  }
});

// PUT /api/task/:id
router.put('/:id', authMiddleware, (req, res) => {
  try {
    const admin = requireAdmin(req, res);
    if (!admin) return;
    const task = getTask(req.params.id);
    if (!task) return res.status(404).json({ code: -1, msg: '任务不存在', data: null });
    if (!isSuperAdmin(admin) && Number(task.created_by_user_id || task.assigned_by) !== admin.id && Number(task.owner_user_id) !== admin.id) {
      return res.status(403).json({ code: -1, msg: '只能编辑自己创建的任务', data: null });
    }
    const schema = Joi.object({
      title: Joi.string().trim().max(120),
      description: Joi.string().allow('').max(2000),
      category: Joi.string().valid(...CATEGORY_VALUES),
      priority: Joi.string().valid(...PRIORITY_VALUES),
      due_at: Joi.date().iso().allow(null, ''),
      remind_at: Joi.date().iso().allow(null, ''),
      source_label: Joi.string().trim().max(40),
      assigned_staff_id: Joi.number().integer().positive().allow(null)
    });
    const { error, value } = schema.validate(req.body);
    if (error) return res.status(400).json({ code: -1, msg: error.details[0].message, data: null });

    const assignedStaffId = value.assigned_staff_id === undefined ? task.assigned_staff_id : value.assigned_staff_id;
    if (Number(task.subtask_count || 0) > 0 && assignedStaffId) {
      return res.status(400).json({ code: -1, msg: '总任务请通过子任务分派负责人', data: null });
    }
    const scope = assignedStaffId ? 'assigned' : 'personal';
    if (assignedStaffId && Number(assignedStaffId) !== Number(task.assigned_staff_id)) {
      const permission = canAssignTo(admin, assignedStaffId);
      if (!permission.allowed) return res.status(403).json({ code: -1, msg: permission.msg, data: null });
    }
    const dueAt = value.due_at === undefined ? task.due_at : normalizeDueAt(value.due_at);
    const remindAt = value.remind_at === undefined ? task.remind_at : normalizeDueAt(value.remind_at);
    const category = value.category || task.category || 'other';
    db.prepare(`
      UPDATE tasks SET
        title = ?, description = ?, category = ?, priority = ?, due_at = ?, due_date = ?, remind_at = ?, source_label = ?,
        scope = ?, owner_user_id = ?, assigned_staff_id = ?, assigned_to = ?, type = ?,
        updated_at = datetime('now', 'localtime')
      WHERE id = ?
    `).run(
      value.title || task.title,
      value.description === undefined ? task.description : value.description,
      category, value.priority || task.priority, dueAt, dueAt ? dueAt.slice(0, 10) : null, remindAt, value.source_label || task.source_label || 'manual',
      scope, scope === 'personal' ? admin.id : null, assignedStaffId,
      admin.id, scope === 'personal' ? 'personal' : category, task.id
    );
    let updatedTask = decorateTask(getTask(task.id));
    if (Number(updatedTask.subtask_count || 0) > 0) {
      updatedTask.children = getChildTasks(updatedTask.id);
    }
    if (assignedStaffId && Number(assignedStaffId) !== Number(task.assigned_staff_id) && Number(assignedStaffId) !== Number(admin.staff_id || 0)) {
      createNotification(
        { type: 'employee', id: assignedStaffId },
        {
          ...actorFromRequestUser(req.user),
          category: 'task_reassigned',
          module: 'task',
          source_id: updatedTask.id,
          title: `${taskActorName(admin, req)}调整了你的任务负责人`,
          content: `${updatedTask.title}${dueAt ? ` · 截止 ${String(dueAt).slice(0, 16)}` : ''}`,
          level: updatedTask.priority === 'high' ? 'warning' : 'info'
        }
      );
    }
    res.json({ code: 0, msg: '任务更新成功', data: updatedTask });
  } catch (err) {
    console.error('编辑任务失败:', err);
    res.status(500).json({ code: -1, msg: '服务器错误', data: null });
  }
});

function updateTaskStatus(req, res, requestedStatus) {
  try {
    const status = requestedStatus || req.body.status;
    if (!STATUS_VALUES.includes(status)) return res.status(400).json({ code: -1, msg: '任务状态无效', data: null });
    const task = getTask(req.params.id);
    if (!task) return res.status(404).json({ code: -1, msg: '任务不存在', data: null });
    const admin = currentAdmin(req);
    if (!taskVisibleTo(req, task, admin)) return res.status(403).json({ code: -1, msg: '无权更新此任务', data: null });
    if (Number(task.subtask_count || 0) > 0) {
      return res.status(400).json({ code: -1, msg: '总任务进度会根据子任务自动汇总，请更新子任务状态', data: null });
    }
    db.prepare(`
      UPDATE tasks
      SET status = ?,
          completed_at = CASE WHEN ? = 'completed' THEN datetime('now', 'localtime') ELSE NULL END,
          updated_at = datetime('now', 'localtime')
      WHERE id = ?
    `).run(status, status, task.id);
    let updatedTask = decorateTask(getTask(task.id));
    let parentTask = null;
    if (Number(updatedTask.parent_task_id || 0) > 0) {
      parentTask = syncParentTaskStatus(updatedTask.parent_task_id);
    }
    if (updatedTask.scope === 'assigned' && Number(updatedTask.created_by_user_id) > 0) {
      const actorName = taskActorName(admin, req);
      const actorAdminId = req.user.type === 'employee' ? null : Number(req.user.userId || req.user.id);
      if (!actorAdminId || actorAdminId !== Number(updatedTask.created_by_user_id)) {
        createNotification(
          { type: 'admin', id: updatedTask.created_by_user_id },
          {
            ...actorFromRequestUser(req.user),
            category: 'task_progress',
            module: 'task',
            source_id: updatedTask.id,
            title: status === 'completed' ? '你分派的任务已完成' : '你分派的任务状态已更新',
            content: `${actorName} · ${updatedTask.title} · ${status === 'completed' ? '已完成' : status === 'in_progress' ? '进行中' : '待处理'}${parentTask ? ` · 总进度 ${parentTask.progress_percent}%` : ''}`,
            level: status === 'completed' ? 'success' : 'info'
          }
        );
      }
    }
    return res.json({ code: 0, msg: status === 'completed' ? '任务已完成' : '任务状态已更新', data: updatedTask });
  } catch (err) {
    console.error('更新任务状态失败:', err);
    return res.status(500).json({ code: -1, msg: '服务器错误', data: null });
  }
}

// POST /api/task/:id/status
router.post('/:id/status', authMiddleware, (req, res) => updateTaskStatus(req, res));

// POST /api/task/:id/complete - 兼容旧页面
router.post('/:id/complete', authMiddleware, (req, res) => updateTaskStatus(req, res, 'completed'));

// DELETE /api/task/:id
router.delete('/:id', authMiddleware, (req, res) => {
  try {
    const admin = requireAdmin(req, res);
    if (!admin) return;
    const task = getTask(req.params.id);
    if (!task) return res.status(404).json({ code: -1, msg: '任务不存在', data: null });
    if (!isSuperAdmin(admin) && Number(task.created_by_user_id || task.assigned_by) !== admin.id && Number(task.owner_user_id) !== admin.id) {
      return res.status(403).json({ code: -1, msg: '只能删除自己创建的任务', data: null });
    }
    db.transaction(() => {
      const childIds = db.prepare('SELECT id FROM tasks WHERE parent_task_id = ?').all(task.id).map(row => Number(row.id));
      if (childIds.length) {
        const deleteNotices = db.prepare('DELETE FROM notifications WHERE module = ? AND source_id = ?');
        childIds.forEach(id => deleteNotices.run('task', id));
        db.prepare('DELETE FROM tasks WHERE parent_task_id = ?').run(task.id);
      }
      db.prepare('DELETE FROM notifications WHERE module = ? AND source_id = ?').run('task', task.id);
      db.prepare('DELETE FROM tasks WHERE id = ?').run(task.id);
      if (Number(task.parent_task_id || 0) > 0) {
        syncParentTaskStatus(task.parent_task_id);
      }
    })();
    res.json({ code: 0, msg: '任务删除成功', data: null });
  } catch (err) {
    console.error('删除任务失败:', err);
    res.status(500).json({ code: -1, msg: '服务器错误', data: null });
  }
});

module.exports = router;
