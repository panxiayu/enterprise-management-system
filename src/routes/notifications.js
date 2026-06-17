const express = require('express');
const router = express.Router();
const db = require('../models/database');
const { authMiddleware } = require('../middleware/auth');

function currentRecipient(req) {
  if (req.user.type === 'employee') {
    return { type: 'employee', id: Number(req.user.id) };
  }
  return { type: 'admin', id: Number(req.user.userId || req.user.id) };
}

function notificationLink(row) {
  if (row.link) return row.link;
  if (row.module === 'task') {
    return row.recipient_type === 'employee'
      ? `mobile-my-tasks.html?focus=${row.source_id || ''}`
      : `personal-todo.html?focus=${row.source_id || ''}`;
  }
  if (row.module === '6s') {
    return row.recipient_type === 'employee'
      ? `mobile-6s-tasks.html?focus=${row.source_id || ''}`
      : `6s-list.html`;
  }
  return row.recipient_type === 'employee' ? 'employee.html' : 'dashboard.html';
}

function normalizeReadFilter(query) {
  if (query.unread === '1' || query.read === 'unread') return 'unread';
  if (query.read === 'read') return 'read';
  return 'all';
}

function buildNotificationOrder({ module = '', unread = '' }) {
  if (module === 'task') {
    return `
      ORDER BY
        CASE WHEN task_due_at IS NULL OR task_due_at = '' THEN 1 ELSE 0 END ASC,
        datetime(task_due_at) ASC,
        datetime(notifications.created_at) ASC
    `;
  }

  if (unread === '1') {
    return 'ORDER BY datetime(notifications.created_at) ASC';
  }

  return `
    ORDER BY
      notifications.is_read ASC,
      CASE
        WHEN notifications.is_read = 0 AND notifications.module = 'task' AND task_due_at IS NOT NULL AND task_due_at != '' THEN 0
        WHEN notifications.is_read = 0 THEN 1
        WHEN notifications.module = 'task' AND task_due_at IS NOT NULL AND task_due_at != '' THEN 2
        ELSE 3
      END ASC,
      CASE
        WHEN notifications.module = 'task' AND task_due_at IS NOT NULL AND task_due_at != '' THEN datetime(task_due_at)
      END ASC,
      CASE
        WHEN notifications.is_read = 0 AND NOT (notifications.module = 'task' AND task_due_at IS NOT NULL AND task_due_at != '') THEN datetime(notifications.created_at)
      END ASC,
      CASE
        WHEN notifications.is_read = 1 AND NOT (notifications.module = 'task' AND task_due_at IS NOT NULL AND task_due_at != '') THEN datetime(COALESCE(notifications.read_at, notifications.created_at))
      END DESC,
      datetime(notifications.created_at) DESC
  `;
}

router.get('/', authMiddleware, (req, res) => {
  try {
    const recipient = currentRecipient(req);
    const { module = '', limit = 50, task_scope = '' } = req.query;
    const readFilter = normalizeReadFilter(req.query);
    const params = [recipient.type, recipient.id];
    let query = `
      SELECT notifications.*,
             t.due_at AS task_due_at,
             t.priority AS task_priority,
             t.status AS task_status
      FROM notifications
      LEFT JOIN tasks t
        ON notifications.module = 'task'
       AND notifications.source_id = t.id
      WHERE notifications.recipient_type = ? AND notifications.recipient_id = ?
    `;
    if (readFilter === 'unread') query += ' AND notifications.is_read = 0';
    if (readFilter === 'read') query += ' AND notifications.is_read = 1';
    if (module) {
      query += ' AND notifications.module = ?';
      params.push(module);
    }
    if (task_scope === 'today') {
      query += " AND notifications.module = 'task' AND t.due_at IS NOT NULL AND date(t.due_at) = date('now', 'localtime')";
    } else if (task_scope === 'overdue') {
      query += " AND notifications.module = 'task' AND t.due_at IS NOT NULL AND date(t.due_at) < date('now', 'localtime') AND COALESCE(t.status, 'pending') <> 'completed'";
    } else if (task_scope === 'high') {
      query += " AND notifications.module = 'task' AND COALESCE(t.priority, '') = 'high' AND COALESCE(t.status, 'pending') <> 'completed'";
    }
    query += ` ${buildNotificationOrder({ module, unread: readFilter === 'unread' ? '1' : '' })} LIMIT ?`;
    params.push(Math.min(200, Math.max(1, Number(limit) || 50)));

    const rows = db.prepare(query).all(...params).map((row) => ({
      ...row,
      link: notificationLink(row)
    }));
    res.json({ code: 0, msg: 'success', data: rows });
  } catch (err) {
    console.error('获取通知列表失败:', err);
    res.status(500).json({ code: -1, msg: '服务器错误', data: null });
  }
});

router.get('/summary', authMiddleware, (req, res) => {
  try {
    const recipient = currentRecipient(req);
    const rows = db.prepare(`
      SELECT COUNT(*) AS total,
             SUM(CASE WHEN is_read = 0 THEN 1 ELSE 0 END) AS unread,
             SUM(CASE WHEN is_read = 0 AND module = 'task' THEN 1 ELSE 0 END) AS task_unread,
             SUM(CASE WHEN module = 'task' AND source_id IN (
               SELECT id FROM tasks
               WHERE due_at IS NOT NULL AND date(due_at) = date('now', 'localtime') AND status <> 'completed'
             ) THEN 1 ELSE 0 END) AS task_due_today,
             SUM(CASE WHEN module = 'task' AND source_id IN (
               SELECT id FROM tasks
               WHERE due_at IS NOT NULL AND date(due_at) < date('now', 'localtime') AND status <> 'completed'
             ) THEN 1 ELSE 0 END) AS task_overdue
      FROM notifications
      WHERE recipient_type = ? AND recipient_id = ?
    `).get(recipient.type, recipient.id);
    res.json({ code: 0, msg: 'success', data: rows || { total: 0, unread: 0, task_unread: 0, task_due_today: 0, task_overdue: 0 } });
  } catch (err) {
    console.error('获取通知摘要失败:', err);
    res.status(500).json({ code: -1, msg: '服务器错误', data: null });
  }
});

router.post('/:id/read', authMiddleware, (req, res) => {
  try {
    const recipient = currentRecipient(req);
    const row = db.prepare(`
      SELECT *
      FROM notifications
      WHERE id = ? AND recipient_type = ? AND recipient_id = ?
    `).get(req.params.id, recipient.type, recipient.id);
    if (!row) return res.status(404).json({ code: -1, msg: '通知不存在', data: null });
    db.prepare(`
      UPDATE notifications
      SET is_read = 1,
          read_at = COALESCE(read_at, datetime('now', 'localtime'))
      WHERE id = ?
    `).run(row.id);
    res.json({ code: 0, msg: '已标记已读', data: null });
  } catch (err) {
    console.error('标记通知失败:', err);
    res.status(500).json({ code: -1, msg: '服务器错误', data: null });
  }
});

router.post('/read-all', authMiddleware, (req, res) => {
  try {
    const recipient = currentRecipient(req);
    db.prepare(`
      UPDATE notifications
      SET is_read = 1,
          read_at = COALESCE(read_at, datetime('now', 'localtime'))
      WHERE recipient_type = ? AND recipient_id = ? AND is_read = 0
    `).run(recipient.type, recipient.id);
    res.json({ code: 0, msg: '全部已读', data: null });
  } catch (err) {
    console.error('全部已读失败:', err);
    res.status(500).json({ code: -1, msg: '服务器错误', data: null });
  }
});

module.exports = router;
