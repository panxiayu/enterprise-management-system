const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const db = require('../models/database');

const SCRIPT_PATH = path.join(__dirname, '../../scripts/smb-staff-sync.js');
const SCRIPT_CWD = path.join(__dirname, '../..');
const SCHEDULES = [
  { hour: 12, minute: 0, label: '12:00' },
  { hour: 20, minute: 0, label: '20:00' }
];
const POLL_MS = 30 * 1000;

let schedulerStarted = false;
let syncRunning = false;
let lastTriggeredMinute = '';

function getMinuteKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hour = String(date.getHours()).padStart(2, '0');
  const minute = String(date.getMinutes()).padStart(2, '0');
  return `${year}-${month}-${day} ${hour}:${minute}`;
}

function wasSyncedThisMinute(minuteKey) {
  try {
    const row = db.prepare(`
      SELECT synced_at
      FROM sync_log
      WHERE sync_type = ?
      ORDER BY id DESC
      LIMIT 1
    `).get('staff');
    return row && String(row.synced_at || '').slice(0, 16) === minuteKey;
  } catch (err) {
    console.error('[STAFF_SYNC] 检查同步时间失败:', err.message);
    return false;
  }
}

function runStaffSyncScript(source = 'manual') {
  if (!fs.existsSync(SCRIPT_PATH)) {
    return Promise.reject(new Error('同步脚本不存在'));
  }

  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    let finished = false;

    const child = spawn('node', [SCRIPT_PATH], {
      cwd: SCRIPT_CWD,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    child.stdout.on('data', (data) => { stdout += data.toString(); });
    child.stderr.on('data', (data) => { stderr += data.toString(); });

    const timeout = setTimeout(() => {
      finished = true;
      child.kill();
      reject(new Error('同步超时'));
    }, 120000);

    child.on('close', (code) => {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);

      if (code !== 0) {
        const errorOutput = stderr.trim() || stdout.trim() || `同步脚本退出码 ${code}`;
        return reject(new Error(errorOutput));
      }

      let syncResult = {};
      try {
        const lines = stdout.split('\n');
        for (let i = lines.length - 1; i >= 0; i--) {
          const line = lines[i].trim();
          if (line.startsWith('{') && line.endsWith('}')) {
            syncResult = JSON.parse(line);
            break;
          }
        }
      } catch (err) {
        console.warn(`[STAFF_SYNC] ${source} 解析同步结果失败:`, err.message);
      }

      resolve(syncResult);
    });

    child.on('error', (err) => {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      reject(err);
    });
  });
}

async function tryScheduledSync() {
  const now = new Date();
  const minuteKey = getMinuteKey(now);
  const hour = now.getHours();
  const minute = now.getMinutes();
  const matched = SCHEDULES.find((item) => item.hour === hour && item.minute === minute);

  if (!matched) return;
  if (lastTriggeredMinute === minuteKey) return;
  if (wasSyncedThisMinute(minuteKey)) {
    lastTriggeredMinute = minuteKey;
    return;
  }
  if (syncRunning) {
    console.warn(`[STAFF_SYNC] ${matched.label} 自动同步跳过，上一轮仍在执行`);
    return;
  }

  lastTriggeredMinute = minuteKey;
  syncRunning = true;
  console.log(`[STAFF_SYNC] 开始执行 ${matched.label} 自动同步`);
  try {
    const result = await runStaffSyncScript('scheduled');
    console.log(`[STAFF_SYNC] ${matched.label} 自动同步成功: ${JSON.stringify(result)}`);
  } catch (err) {
    console.error(`[STAFF_SYNC] ${matched.label} 自动同步失败:`, err.message);
  } finally {
    syncRunning = false;
  }
}

function startStaffSyncScheduler() {
  if (schedulerStarted) return;
  schedulerStarted = true;
  setInterval(() => {
    tryScheduledSync().catch((err) => {
      console.error('[STAFF_SYNC] 自动同步轮询异常:', err.message);
    });
  }, POLL_MS);
  setTimeout(() => {
    tryScheduledSync().catch((err) => {
      console.error('[STAFF_SYNC] 自动同步初始化异常:', err.message);
    });
  }, 5000);
}

module.exports = {
  runStaffSyncScript,
  startStaffSyncScheduler
};
