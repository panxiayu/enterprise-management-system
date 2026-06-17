const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(__dirname, '..', 'data', 'exam.db');
const db = new Database(dbPath);

const MARK = '【界面预览-DEMO】';
const now = new Date();

function fmt(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  const ss = String(date.getSeconds()).padStart(2, '0');
  return `${y}-${m}-${d} ${hh}:${mm}:${ss}`;
}

function shiftDays(days, hour, minute) {
  const date = new Date(now);
  date.setDate(date.getDate() + days);
  date.setHours(hour, minute, 0, 0);
  return fmt(date);
}

function syncParentStatus(parentId) {
  const counts = db.prepare(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed_count,
      SUM(CASE WHEN status = 'in_progress' THEN 1 ELSE 0 END) AS in_progress_count
    FROM tasks
    WHERE parent_task_id = ?
  `).get(parentId);
  if (!counts || !counts.total) return;

  let status = 'pending';
  if (Number(counts.completed_count || 0) >= Number(counts.total || 0)) status = 'completed';
  else if (Number(counts.completed_count || 0) > 0 || Number(counts.in_progress_count || 0) > 0) status = 'in_progress';

  db.prepare(`
    UPDATE tasks
    SET status = ?,
        completed_at = CASE WHEN ? = 'completed' THEN datetime('now', 'localtime') ELSE NULL END,
        updated_at = datetime('now', 'localtime')
    WHERE id = ?
  `).run(status, status, parentId);
}

function getAdmin() {
  const admin = db.prepare(`SELECT id, username, staff_id FROM users WHERE username = 'admin' LIMIT 1`).get();
  if (!admin) throw new Error('未找到 admin 用户');
  return admin;
}

function getAssignees() {
  const rows = db.prepare(`
    SELECT id, name, department, position
    FROM staff
    WHERE status = 'active'
    ORDER BY id ASC
    LIMIT 8
  `).all();
  if (rows.length < 4) throw new Error('可用员工数量不足，无法生成演示任务');
  return rows;
}

function cleanupExisting() {
  const parentIds = db.prepare(`SELECT id FROM tasks WHERE title LIKE ?`).all(`${MARK}%`).map(row => row.id);
  if (parentIds.length) {
    const deleteChildren = db.prepare(`DELETE FROM tasks WHERE parent_task_id = ?`);
    const deleteTask = db.prepare(`DELETE FROM tasks WHERE id = ?`);
    const tx = db.transaction(() => {
      parentIds.forEach(id => {
        deleteChildren.run(id);
        deleteTask.run(id);
      });
      db.prepare(`DELETE FROM tasks WHERE title LIKE ? OR description LIKE ?`).run(`${MARK}%`, `%${MARK}%`);
    });
    tx();
  }
}

const admin = getAdmin();
const assignees = getAssignees();

cleanupExisting();

const insertTask = db.prepare(`
  INSERT INTO tasks (
    title, description, type, assigned_to, assigned_by, due_date, priority, status,
    scope, category, owner_user_id, assigned_staff_id, created_by_user_id, due_at,
    parent_task_id, task_kind, completed_at, created_at, updated_at
  ) VALUES (
    ?, ?, ?, ?, ?, ?, ?, ?,
    ?, ?, ?, ?, ?, ?,
    ?, ?, ?, datetime('now', 'localtime'), datetime('now', 'localtime')
  )
`);

const singles = [
  {
    title: `${MARK} 今日巡检问题复核`,
    description: `${MARK} 用于查看“今日到期 + 进行中”样式。`,
    category: 'quality',
    priority: 'high',
    status: 'in_progress',
    due_at: shiftDays(0, 16, 30),
    scope: 'personal'
  },
  {
    title: `${MARK} 车间地面标识补录`,
    description: `${MARK} 用于查看“待处理 + 今日到期”样式。`,
    category: 's6',
    priority: 'medium',
    status: 'pending',
    due_at: shiftDays(0, 18, 0),
    scope: 'personal'
  },
  {
    title: `${MARK} 上周物料差异说明`,
    description: `${MARK} 用于查看逾期状态和警示色。`,
    category: 'production',
    priority: 'high',
    status: 'pending',
    due_at: shiftDays(-2, 11, 0),
    scope: 'personal'
  },
  {
    title: `${MARK} 员工培训记录归档`,
    description: `${MARK} 用于查看已完成行样式。`,
    category: 'training',
    priority: 'low',
    status: 'completed',
    due_at: shiftDays(-1, 17, 30),
    scope: 'personal',
    completed_at: shiftDays(-1, 15, 30)
  },
  {
    title: `${MARK} 晚班报餐名单确认`,
    description: `${MARK} 用于查看普通指派任务样式。`,
    category: 'meal',
    priority: 'medium',
    status: 'pending',
    due_at: shiftDays(1, 10, 0),
    scope: 'assigned',
    assigned_staff_id: assignees[0].id
  },
  {
    title: `${MARK} 办公区资料柜整理`,
    description: `${MARK} 用于查看低优先级未来任务样式。`,
    category: 'daily',
    priority: 'low',
    status: 'pending',
    due_at: shiftDays(3, 14, 0),
    scope: 'personal'
  }
];

const parentTasks = [
  {
    title: `${MARK} 6S周会整改推进总任务`,
    description: `${MARK} 父任务样式预览，包含逾期、今日、进行中混合子项。`,
    category: 's6',
    priority: 'high',
    due_at: shiftDays(1, 17, 0),
    children: [
      { title: `${MARK} 整理模具备件区`, description: `${MARK} 子任务 A`, assigned_staff_id: assignees[1].id, priority: 'high', status: 'in_progress', due_at: shiftDays(0, 15, 0) },
      { title: `${MARK} 清理物料通道`, description: `${MARK} 子任务 B`, assigned_staff_id: assignees[2].id, priority: 'medium', status: 'pending', due_at: shiftDays(0, 18, 0) },
      { title: `${MARK} 张贴责任牌`, description: `${MARK} 子任务 C`, assigned_staff_id: assignees[3].id, priority: 'low', status: 'completed', due_at: shiftDays(-1, 16, 0), completed_at: shiftDays(-1, 15, 10) }
    ]
  },
  {
    title: `${MARK} 月度库位优化安排`,
    description: `${MARK} 父任务样式预览，偏生产类协同。`,
    category: 'production',
    priority: 'medium',
    due_at: shiftDays(2, 16, 30),
    children: [
      { title: `${MARK} 复核成品区编号`, description: `${MARK} 子任务 D`, assigned_staff_id: assignees[4].id, priority: 'medium', status: 'pending', due_at: shiftDays(1, 11, 30) },
      { title: `${MARK} 补齐仓位标签`, description: `${MARK} 子任务 E`, assigned_staff_id: assignees[5].id, priority: 'high', status: 'pending', due_at: shiftDays(2, 12, 0) },
      { title: `${MARK} 导出盘点清单`, description: `${MARK} 子任务 F`, assigned_staff_id: assignees[6].id, priority: 'low', status: 'pending', due_at: shiftDays(3, 9, 0) }
    ]
  }
];

const tx = db.transaction(() => {
  for (const item of singles) {
    insertTask.run(
      item.title,
      item.description,
      item.scope === 'personal' ? 'personal' : item.category,
      admin.id,
      admin.id,
      item.due_at ? item.due_at.slice(0, 10) : null,
      item.priority,
      item.status,
      item.scope,
      item.category,
      admin.id,
      item.assigned_staff_id || null,
      admin.id,
      item.due_at,
      null,
      'task',
      item.completed_at || null
    );
  }

  for (const parent of parentTasks) {
    const result = insertTask.run(
      parent.title,
      parent.description,
      'personal',
      admin.id,
      admin.id,
      parent.due_at.slice(0, 10),
      parent.priority,
      'pending',
      'personal',
      parent.category,
      admin.id,
      null,
      admin.id,
      parent.due_at,
      null,
      'parent',
      null
    );

    const parentId = result.lastInsertRowid;
    for (const child of parent.children) {
      insertTask.run(
        child.title,
        child.description,
        parent.category,
        admin.id,
        admin.id,
        child.due_at.slice(0, 10),
        child.priority,
        child.status,
        'assigned',
        parent.category,
        null,
        child.assigned_staff_id,
        admin.id,
        child.due_at,
        parentId,
        'subtask',
        child.completed_at || null
      );
    }
    syncParentStatus(parentId);
  }
});

tx();

const total = db.prepare(`SELECT COUNT(*) AS count FROM tasks WHERE title LIKE ?`).get(`${MARK}%`);
console.log(`已注入 ${total.count} 条带标记的演示任务，标记为 ${MARK}`);
