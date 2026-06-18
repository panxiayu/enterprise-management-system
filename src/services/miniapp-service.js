const db = require('../models/database');

const DEFAULT_APP_ID = String(process.env.WECHAT_MINIAPP_APP_ID || '').trim();
const DEFAULT_WEBVIEW_ORIGIN = String(
  process.env.MINIAPP_WEBVIEW_ORIGIN || process.env.PUBLIC_WEB_ORIGIN || 'https://www.xlmould.work'
).replace(/\/+$/, '');
const DEFAULT_ENTRY_PAGE = String(process.env.MINIAPP_ENTRY_PAGE || 'pages/webview/webview').trim();

const TEMPLATE_REGISTRY = {
  s6_task_assigned: {
    label: '6S整改任务通知',
    categories: ['s6_assigned'],
    module: '6s',
    level: 'warning'
  },
  s6_task_result: {
    label: '6S整改结果通知',
    categories: ['s6_review'],
    module: '6s',
    level: 'info'
  },
  s6_admin_review: {
    label: '6S待审核提醒',
    categories: ['s6_submitted'],
    module: '6s',
    level: 'info'
  },
  task_assigned: {
    label: '任务分派提醒',
    categories: ['task_assigned', 'task_reassigned'],
    module: 'task',
    level: 'warning'
  },
  task_progress: {
    label: '任务进度通知',
    categories: ['task_progress'],
    module: 'task',
    level: 'info'
  }
};

function getAppId(appId) {
  return String(appId || DEFAULT_APP_ID || '').trim();
}

function getRecipientFromUser(user) {
  if (!user) return null;
  if (user.type === 'employee') {
    const id = Number(user.id);
    if (!id) return null;
    return { recipient_type: 'employee', recipient_id: id };
  }

  const id = Number(user.userId || user.id);
  if (!id) return null;
  return { recipient_type: 'admin', recipient_id: id };
}

function getTemplateRegistry() {
  return Object.entries(TEMPLATE_REGISTRY).map(([key, value]) => ({
    template_key: key,
    label: value.label,
    module: value.module,
    categories: value.categories.slice(),
    level: value.level
  }));
}

function resolveTemplateKey(payload = {}) {
  const category = String(payload.category || '').trim();
  if (!category) return '';
  for (const [templateKey, item] of Object.entries(TEMPLATE_REGISTRY)) {
    if (item.categories.includes(category)) return templateKey;
  }
  return '';
}

function buildHybridPath(payload = {}, recipient = {}) {
  const moduleName = String(payload.module || '').trim();
  const sourceId = Number(payload.source_id || 0) || '';
  if (moduleName === '6s') {
    if (payload.category === 's6_assigned' || payload.category === 's6_review') {
      return recipient.recipient_type === 'employee'
        ? `/mobile-6s-detail.html?id=${sourceId}&source=task`
        : '/mobile-6s-list.html';
    }
    if (payload.category === 's6_submitted') return '/mobile-6s-list.html';
    return recipient.recipient_type === 'employee' ? '/mobile-6s-tasks.html' : '/mobile-6s-list.html';
  }

  if (moduleName === 'task') {
    return recipient.recipient_type === 'employee'
      ? `/mobile-my-tasks.html?focus=${sourceId}`
      : `/dashboard.html?focusTask=${sourceId}`;
  }

  return recipient.recipient_type === 'employee' ? '/employee.html' : '/dashboard.html';
}

function buildMiniAppPagePath(payload = {}, recipient = {}, explicitHybridPath = '') {
  const hybridPath = String(explicitHybridPath || buildHybridPath(payload, recipient) || '/employee.html').trim();
  return `${DEFAULT_ENTRY_PAGE}?path=${encodeURIComponent(hybridPath)}`;
}

function getMiniAppConfig(req) {
  const hostOrigin = req
    ? `${req.protocol}://${req.get('host')}`.replace(/\/+$/, '')
    : DEFAULT_WEBVIEW_ORIGIN;
  return {
    app_id: getAppId(),
    entry_page: DEFAULT_ENTRY_PAGE,
    webview_origin: DEFAULT_WEBVIEW_ORIGIN || hostOrigin,
    server_origin: hostOrigin,
    template_registry: getTemplateRegistry()
  };
}

function upsertBinding(recipient, payload = {}) {
  const appId = getAppId(payload.app_id);
  if (!recipient?.recipient_type || !recipient?.recipient_id) {
    throw new Error('缺少绑定对象');
  }
  if (!payload.openid) {
    throw new Error('openid 不能为空');
  }

  db.prepare(`
    INSERT INTO miniapp_user_bindings (
      recipient_type, recipient_id, app_id, openid, unionid, nickname, avatar_url, status,
      last_seen_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'active', datetime('now', 'localtime'), datetime('now', 'localtime'), datetime('now', 'localtime'))
    ON CONFLICT(recipient_type, recipient_id, app_id) DO UPDATE SET
      openid = excluded.openid,
      unionid = excluded.unionid,
      nickname = COALESCE(NULLIF(excluded.nickname, ''), miniapp_user_bindings.nickname),
      avatar_url = COALESCE(NULLIF(excluded.avatar_url, ''), miniapp_user_bindings.avatar_url),
      status = 'active',
      last_seen_at = datetime('now', 'localtime'),
      updated_at = datetime('now', 'localtime')
  `).run(
    recipient.recipient_type,
    recipient.recipient_id,
    appId,
    String(payload.openid || '').trim(),
    payload.unionid ? String(payload.unionid).trim() : null,
    payload.nickname ? String(payload.nickname).trim() : null,
    payload.avatar_url ? String(payload.avatar_url).trim() : null
  );

  return getBinding(recipient, appId);
}

function getBinding(recipient, appId = DEFAULT_APP_ID) {
  return db.prepare(`
    SELECT *
    FROM miniapp_user_bindings
    WHERE recipient_type = ? AND recipient_id = ? AND app_id = ?
    LIMIT 1
  `).get(recipient.recipient_type, recipient.recipient_id, getAppId(appId));
}

function listSubscriptions(recipient, appId = DEFAULT_APP_ID) {
  return db.prepare(`
    SELECT *
    FROM miniapp_template_subscriptions
    WHERE recipient_type = ? AND recipient_id = ? AND app_id = ?
    ORDER BY template_key ASC
  `).all(recipient.recipient_type, recipient.recipient_id, getAppId(appId));
}

function saveSubscriptions(recipient, items, appId = DEFAULT_APP_ID) {
  const finalAppId = getAppId(appId);
  const normalized = (Array.isArray(items) ? items : [])
    .map((item) => ({
      template_key: String(item.template_key || '').trim(),
      template_id: String(item.template_id || '').trim(),
      page_path: String(item.page_path || '').trim(),
      scene: String(item.scene || '').trim(),
      subscribed: item.subscribed === 0 || item.subscribed === false ? 0 : 1
    }))
    .filter((item) => item.template_key);

  if (!normalized.length) return listSubscriptions(recipient, finalAppId);

  const upsert = db.prepare(`
    INSERT INTO miniapp_template_subscriptions (
      recipient_type, recipient_id, app_id, template_key, template_id, page_path, scene,
      subscribed, updated_at, last_subscribed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now', 'localtime'),
      CASE WHEN ? = 1 THEN datetime('now', 'localtime') ELSE NULL END
    )
    ON CONFLICT(recipient_type, recipient_id, app_id, template_key) DO UPDATE SET
      template_id = COALESCE(NULLIF(excluded.template_id, ''), miniapp_template_subscriptions.template_id),
      page_path = COALESCE(NULLIF(excluded.page_path, ''), miniapp_template_subscriptions.page_path),
      scene = COALESCE(NULLIF(excluded.scene, ''), miniapp_template_subscriptions.scene),
      subscribed = excluded.subscribed,
      updated_at = datetime('now', 'localtime'),
      last_subscribed_at = CASE
        WHEN excluded.subscribed = 1 THEN datetime('now', 'localtime')
        ELSE miniapp_template_subscriptions.last_subscribed_at
      END
  `);

  const tx = db.transaction((rows) => {
    rows.forEach((item) => {
      upsert.run(
        recipient.recipient_type,
        recipient.recipient_id,
        finalAppId,
        item.template_key,
        item.template_id || null,
        item.page_path || null,
        item.scene || '',
        item.subscribed,
        item.subscribed
      );
    });
  });
  tx(normalized);

  return listSubscriptions(recipient, finalAppId);
}

function listPushQueue({ status = 'pending', limit = 100 } = {}) {
  const params = [];
  let sql = `
    SELECT *
    FROM miniapp_push_queue
    WHERE 1 = 1
  `;
  if (status && status !== 'all') {
    sql += ' AND status = ?';
    params.push(status);
  }
  sql += ' ORDER BY created_at DESC LIMIT ?';
  params.push(Math.min(500, Math.max(1, Number(limit) || 100)));
  return db.prepare(sql).all(...params);
}

function updateQueueStatus(id, status, errorMessage = '') {
  const normalizedStatus = String(status || '').trim();
  if (!['pending', 'sent', 'failed', 'skipped'].includes(normalizedStatus)) {
    throw new Error('状态无效');
  }
  db.prepare(`
    UPDATE miniapp_push_queue
    SET status = ?,
        error_message = CASE WHEN ? = '' THEN NULL ELSE ? END,
        sent_at = CASE WHEN ? = 'sent' THEN datetime('now', 'localtime') ELSE sent_at END
    WHERE id = ?
  `).run(normalizedStatus, String(errorMessage || '').trim(), String(errorMessage || '').trim(), normalizedStatus, Number(id));
}

function queueMiniAppNotifications(notifications) {
  const rows = Array.isArray(notifications) ? notifications : [];
  if (!rows.length) return 0;
  const insert = db.prepare(`
    INSERT INTO miniapp_push_queue (
      notification_id, recipient_type, recipient_id, app_id, openid, template_key, template_id,
      page_path, title, content, payload_json, status, source_module, source_category, source_id, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, datetime('now', 'localtime'))
  `);

  let inserted = 0;
  rows.forEach((notification) => {
    const recipient = {
      recipient_type: notification.recipient_type,
      recipient_id: Number(notification.recipient_id)
    };
    const templateKey = resolveTemplateKey(notification);
    if (!templateKey) return;

    const binding = getBinding(recipient, notification.app_id || DEFAULT_APP_ID);
    if (!binding || binding.status !== 'active' || !binding.openid) return;

    const subscription = db.prepare(`
      SELECT *
      FROM miniapp_template_subscriptions
      WHERE recipient_type = ? AND recipient_id = ? AND app_id = ? AND template_key = ? AND subscribed = 1
      LIMIT 1
    `).get(recipient.recipient_type, recipient.recipient_id, binding.app_id, templateKey);
    if (!subscription) return;

    const payload = {
      title: notification.title || '',
      content: notification.content || '',
      source_id: notification.source_id || null,
      module: notification.module || '',
      category: notification.category || '',
      level: notification.level || 'info',
      created_at: notification.created_at || null
    };

    insert.run(
      notification.id || null,
      recipient.recipient_type,
      recipient.recipient_id,
      binding.app_id,
      binding.openid,
      templateKey,
      subscription.template_id || null,
      subscription.page_path || buildMiniAppPagePath(notification, recipient, notification.link),
      notification.title || '',
      notification.content || '',
      JSON.stringify(payload),
      notification.module || 'system',
      notification.category || 'notice',
      notification.source_id || null
    );
    inserted += 1;
  });

  return inserted;
}

module.exports = {
  buildHybridPath,
  buildMiniAppPagePath,
  getBinding,
  getMiniAppConfig,
  getRecipientFromUser,
  getTemplateRegistry,
  listPushQueue,
  listSubscriptions,
  queueMiniAppNotifications,
  resolveTemplateKey,
  saveSubscriptions,
  updateQueueStatus,
  upsertBinding
};
