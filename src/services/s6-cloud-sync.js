const db = require('../models/database');
const { uploadToCloud } = require('../utils/cloud-storage');
const { getS6UploadPath, getS6FileNameFromUrl, buildS6LocalUrl } = require('../utils/s6-storage');
const fs = require('fs');

const RETRY_MINUTES = 5;
const POLL_MS = 60 * 1000;
let workerStarted = false;
let workerBusy = false;

function parseUrlList(value) {
  if (Array.isArray(value)) return value.filter(Boolean);
  if (typeof value === 'string' && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed.filter(Boolean);
    } catch (err) {}
  }
  return value ? [value] : [];
}

function serializeUrlList(urls) {
  return urls && urls.length ? JSON.stringify(urls) : null;
}

function isLocalS6Url(url) {
  return String(url || '').startsWith('/uploads/6s/');
}

function safeUnlink(filePath) {
  try {
    if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch (err) {
    console.error('删除 6S 本地缓存失败:', filePath, err.message);
  }
}

function enqueueS6CloudSync(targetTable, targetId, primaryField, listField, localUrls) {
  const urls = parseUrlList(localUrls).filter(isLocalS6Url);
  if (!urls.length) return;
  db.prepare(`
    INSERT INTO s6_cloud_sync_queue (target_table, target_id, primary_field, list_field, local_urls, status, retry_count, next_retry_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 'pending', 0, datetime('now','localtime'), datetime('now','localtime'), datetime('now','localtime'))
  `).run(targetTable, targetId, primaryField, listField || null, JSON.stringify(urls));
}

function deleteQueueRowsForField(targetTable, targetId, primaryField) {
  const rows = db.prepare('SELECT id, local_urls FROM s6_cloud_sync_queue WHERE target_table=? AND target_id=? AND primary_field=?').all(targetTable, targetId, primaryField);
  rows.forEach((row) => {
    parseUrlList(row.local_urls).forEach((url) => {
      safeUnlink(getS6UploadPath(getS6FileNameFromUrl(url)));
    });
  });
  db.prepare('DELETE FROM s6_cloud_sync_queue WHERE target_table=? AND target_id=? AND primary_field=?').run(targetTable, targetId, primaryField);
}

function deleteQueueRowsForTarget(targetTable, targetId) {
  const rows = db.prepare('SELECT id, local_urls FROM s6_cloud_sync_queue WHERE target_table=? AND target_id=?').all(targetTable, targetId);
  rows.forEach((row) => {
    parseUrlList(row.local_urls).forEach((url) => {
      safeUnlink(getS6UploadPath(getS6FileNameFromUrl(url)));
    });
  });
  db.prepare('DELETE FROM s6_cloud_sync_queue WHERE target_table=? AND target_id=?').run(targetTable, targetId);
}

function hasOtherQueueReference(localUrl, excludingId) {
  const rows = db.prepare('SELECT id, local_urls FROM s6_cloud_sync_queue WHERE id != ?').all(excludingId);
  return rows.some((row) => parseUrlList(row.local_urls).includes(localUrl));
}

async function syncQueueRow(row) {
  const localUrls = parseUrlList(row.local_urls).filter(isLocalS6Url);
  if (!localUrls.length) {
    db.prepare('DELETE FROM s6_cloud_sync_queue WHERE id=?').run(row.id);
    return;
  }

  const record = db.prepare(`SELECT * FROM ${row.target_table} WHERE id=?`).get(row.target_id);
  if (!record) {
    localUrls.forEach((url) => safeUnlink(getS6UploadPath(getS6FileNameFromUrl(url))));
    db.prepare('DELETE FROM s6_cloud_sync_queue WHERE id=?').run(row.id);
    return;
  }

  const cloudUrls = [];
  for (const localUrl of localUrls) {
    const fileName = getS6FileNameFromUrl(localUrl);
    const filePath = getS6UploadPath(fileName);
    if (!fs.existsSync(filePath)) {
      throw new Error(`本地待同步文件不存在: ${fileName}`);
    }
    cloudUrls.push(await uploadToCloud(filePath, fileName, '6s/'));
  }

  const primaryValue = cloudUrls[0] || null;
  if (row.list_field) {
    db.prepare(`UPDATE ${row.target_table} SET ${row.primary_field}=?, ${row.list_field}=?, updated_at=datetime('now','localtime') WHERE id=?`)
      .run(primaryValue, serializeUrlList(cloudUrls), row.target_id);
  } else {
    const hasUpdatedAt = Object.prototype.hasOwnProperty.call(record, 'updated_at');
    const sql = hasUpdatedAt
      ? `UPDATE ${row.target_table} SET ${row.primary_field}=?, updated_at=datetime('now','localtime') WHERE id=?`
      : `UPDATE ${row.target_table} SET ${row.primary_field}=? WHERE id=?`;
    db.prepare(sql).run(primaryValue, row.target_id);
  }

  db.prepare('DELETE FROM s6_cloud_sync_queue WHERE id=?').run(row.id);
  localUrls.forEach((localUrl) => {
    if (!hasOtherQueueReference(localUrl, row.id)) {
      safeUnlink(getS6UploadPath(getS6FileNameFromUrl(localUrl)));
    }
  });
}

async function processPendingS6CloudSync() {
  if (workerBusy) return;
  workerBusy = true;
  try {
    const rows = db.prepare(`
      SELECT * FROM s6_cloud_sync_queue
      WHERE status='pending' OR (status='failed' AND next_retry_at <= datetime('now','localtime'))
      ORDER BY created_at ASC
      LIMIT 10
    `).all();

    for (const row of rows) {
      try {
        await syncQueueRow(row);
      } catch (err) {
        db.prepare(`
          UPDATE s6_cloud_sync_queue
          SET status='failed',
              retry_count=retry_count+1,
              last_error=?,
              next_retry_at=datetime('now','localtime', ?),
              updated_at=datetime('now','localtime')
          WHERE id=?
        `).run(err.message, `+${RETRY_MINUTES} minutes`, row.id);
        console.error('6S 云补传失败:', row.id, err.message);
      }
    }
  } finally {
    workerBusy = false;
  }
}

function startS6CloudSyncWorker() {
  if (workerStarted) return;
  workerStarted = true;
  setInterval(() => {
    processPendingS6CloudSync().catch((err) => {
      console.error('6S 云补传轮询失败:', err.message);
    });
  }, POLL_MS);
  setTimeout(() => {
    processPendingS6CloudSync().catch((err) => {
      console.error('6S 云补传初始化失败:', err.message);
    });
  }, 5000);
}

module.exports = {
  enqueueS6CloudSync,
  deleteQueueRowsForField,
  deleteQueueRowsForTarget,
  processPendingS6CloudSync,
  startS6CloudSyncWorker,
  buildS6LocalUrl
};
