const db = require('../models/database');

function normalizeRecipient(recipient) {
  if (!recipient) return null;
  const recipientType = recipient.recipient_type || recipient.type;
  const recipientId = Number(recipient.recipient_id || recipient.id);
  if (!recipientType || !recipientId) return null;
  return { recipient_type: recipientType, recipient_id: recipientId };
}

function uniqueRecipients(recipients) {
  const seen = new Set();
  return (Array.isArray(recipients) ? recipients : [])
    .map(normalizeRecipient)
    .filter(Boolean)
    .filter((item) => {
      const key = `${item.recipient_type}:${item.recipient_id}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function createNotifications(recipients, payload) {
  const rows = uniqueRecipients(recipients);
  if (!rows.length) return 0;
  const insert = db.prepare(`
    INSERT INTO notifications (
      recipient_type, recipient_id, category, module, source_id,
      title, content, link, level,
      created_by_type, created_by_id, created_by_name,
      created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now', 'localtime'))
  `);

  db.transaction((items) => {
    items.forEach((recipient) => {
      insert.run(
        recipient.recipient_type,
        recipient.recipient_id,
        payload.category || 'notice',
        payload.module || 'system',
        payload.source_id || null,
        payload.title,
        payload.content || '',
        payload.link || null,
        payload.level || 'info',
        payload.created_by_type || null,
        payload.created_by_id || null,
        payload.created_by_name || null
      );
    });
  })(rows);

  return rows.length;
}

function createNotification(recipient, payload) {
  return createNotifications([recipient], payload);
}

function actorFromRequestUser(user) {
  if (!user) return { created_by_type: null, created_by_id: null, created_by_name: null };
  return {
    created_by_type: user.type === 'employee' ? 'employee' : 'admin',
    created_by_id: Number(user.id || user.userId) || null,
    created_by_name: user.nickname || user.name || user.username || '系统'
  };
}

function listS6AdminRecipients() {
  const admins = db.prepare(`
    SELECT id
    FROM users
    WHERE role = 'admin' AND status = 'active' AND (can_manage_6s = 1 OR username = 'admin')
  `).all();
  return admins.map((item) => ({ recipient_type: 'admin', recipient_id: item.id }));
}

module.exports = {
  actorFromRequestUser,
  createNotification,
  createNotifications,
  listS6AdminRecipients
};
