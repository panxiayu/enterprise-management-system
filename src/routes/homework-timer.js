// src/routes/homework-timer.js - 作业计时器API
const express = require('express');
const router = express.Router();
const db = require('../models/database');

// 获取用户ID（从token或deviceId）
const getUserId = (req) => {
  if (req.user) {
    return req.user.type === 'employee' ? req.user.id : req.user.userId;
  }
  return req.body.deviceId || req.query.deviceId;
};

// 初始化作业计时表
function initHomeworkTimerTable() {
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS homework_timer_records (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        device_id TEXT NOT NULL,
        record_date TEXT NOT NULL,
        subject_times TEXT NOT NULL DEFAULT '{}',
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(device_id, record_date)
      )
    `);
  } catch (err) {
    console.error('❌ initHomeworkTimerTable 失败:', err.message);
  }
}

initHomeworkTimerTable();

// 获取计时数据
// GET /api/homework-timer?deviceId=xxx&date=2026-04-22
router.get('/', (req, res) => {
  try {
    const { deviceId, date } = req.query;
    if (!deviceId) {
      return res.json({ code: -1, msg: '缺少设备标识', data: null });
    }

    const recordDate = date || new Date().toISOString().split('T')[0];

    const row = db.prepare(`
      SELECT * FROM homework_timer_records
      WHERE device_id = ? AND record_date = ?
    `).get(deviceId, recordDate);

    if (row) {
      res.json({
        code: 0,
        msg: 'success',
        data: {
          deviceId: row.device_id,
          recordDate: row.record_date,
          subjectTimes: JSON.parse(row.subject_times)
        }
      });
    } else {
      res.json({
        code: 0,
        msg: 'success',
        data: {
          deviceId,
          recordDate,
          subjectTimes: {}
        }
      });
    }
  } catch (err) {
    console.error('获取计时数据失败:', err);
    res.status(500).json({ code: -1, msg: '服务器错误', data: null });
  }
});

// 保存计时数据
// POST /api/homework-timer
router.post('/', (req, res) => {
  try {
    const { deviceId, date, subjectTimes } = req.body;
    if (!deviceId) {
      return res.status(400).json({ code: -1, msg: '缺少设备标识', data: null });
    }

    const recordDate = date || new Date().toISOString().split('T')[0];
    const timesJson = JSON.stringify(subjectTimes || {});

    // 使用 INSERT OR REPLACE 更新数据
    db.prepare(`
      INSERT INTO homework_timer_records (device_id, record_date, subject_times, updated_at)
      VALUES (?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(device_id, record_date) DO UPDATE SET
        subject_times = excluded.subject_times,
        updated_at = CURRENT_TIMESTAMP
    `).run(deviceId, recordDate, timesJson);

    res.json({
      code: 0,
      msg: '保存成功',
      data: { deviceId, recordDate, subjectTimes }
    });
  } catch (err) {
    console.error('保存计时数据失败:', err);
    res.status(500).json({ code: -1, msg: '服务器错误', data: null });
  }
});

// 清除计时数据（跨天后调用）
// DELETE /api/homework-timer?deviceId=xxx
router.delete('/', (req, res) => {
  try {
    const { deviceId, date } = req.query;
    if (!deviceId) {
      return res.status(400).json({ code: -1, msg: '缺少设备标识', data: null });
    }

    if (date) {
      db.prepare('DELETE FROM homework_timer_records WHERE device_id = ? AND record_date = ?')
        .run(deviceId, date);
    } else {
      db.prepare('DELETE FROM homework_timer_records WHERE device_id = ?')
        .run(deviceId);
    }

    res.json({ code: 0, msg: '清除成功', data: null });
  } catch (err) {
    console.error('清除计时数据失败:', err);
    res.status(500).json({ code: -1, msg: '服务器错误', data: null });
  }
});

module.exports = router;
