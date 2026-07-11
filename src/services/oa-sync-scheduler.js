/**
 * 泛微OA考勤自动同步调度器
 * 
 * 功能：
 * - 每周二 20:00 和每周三 08:00 自动执行考勤下载和请假流程
 * - 参考现有 staff-sync.js 调度模式
 * 
 * 调度规则：
 * - 周二 20:00：下载本周考勤数据
 * - 周三 08:00：下载考勤数据并自动提交请假
 */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

// 脚本路径
const ATTENDANCE_SCRIPT = path.join(__dirname, '../../scripts/oa-attendance-sync.js');
const LEAVE_SCRIPT = path.join(__dirname, '../../scripts/oa-leave-request.js');
const SCRIPT_CWD = path.join(__dirname, '../..');

// 调度配置：[星期, 小时, 分钟, 标签, 是否提交请假]
// 星期：0=周日, 1=周一, ..., 6=周六
const SCHEDULES = [
  { day: 2, hour: 20, minute: 0, label: '周二20:00', submitLeave: false },
  { day: 3, hour: 8, minute: 0, label: '周三08:00', submitLeave: true }
];

// 轮询间隔（30秒）
const POLL_MS = 30 * 1000;

// 状态变量
let schedulerStarted = false;
let syncRunning = false;
let lastTriggeredMinute = '';

/**
 * 获取当前时间的分钟键（用于去重）
 */
function getMinuteKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hour = String(date.getHours()).padStart(2, '0');
  const minute = String(date.getMinutes()).padStart(2, '0');
  return `${year}-${month}-${day} ${hour}:${minute}`;
}

/**
 * 运行考勤下载脚本
 */
function runAttendanceScript() {
  if (!fs.existsSync(ATTENDANCE_SCRIPT)) {
    return Promise.reject(new Error('考勤下载脚本不存在'));
  }

  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    let finished = false;

    const child = spawn('node', [ATTENDANCE_SCRIPT], {
      cwd: SCRIPT_CWD,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        OA_USERNAME: process.env.OA_USERNAME,
        OA_PASSWORD: process.env.OA_PASSWORD
      }
    });

    child.stdout.on('data', (data) => { stdout += data.toString(); });
    child.stderr.on('data', (data) => { stderr += data.toString(); });

    // 5分钟超时
    const timeout = setTimeout(() => {
      finished = true;
      child.kill();
      reject(new Error('考勤下载超时'));
    }, 5 * 60 * 1000);

    child.on('close', (code) => {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);

      if (code !== 0) {
        const errorOutput = stderr.trim() || stdout.trim() || `考勤下载脚本退出码 ${code}`;
        return reject(new Error(errorOutput));
      }

      resolve({ success: true, output: stdout });
    });

    child.on('error', (err) => {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      reject(err);
    });
  });
}

/**
 * 运行请假提交脚本
 */
function runLeaveScript(dryRun = false) {
  if (!fs.existsSync(LEAVE_SCRIPT)) {
    return Promise.reject(new Error('请假提交脚本不存在'));
  }

  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    let finished = false;

    const args = [LEAVE_SCRIPT];
    if (dryRun) {
      args.push('--dry-run');
    }

    const child = spawn('node', args, {
      cwd: SCRIPT_CWD,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        OA_USERNAME: process.env.OA_USERNAME,
        OA_PASSWORD: process.env.OA_PASSWORD
      }
    });

    child.stdout.on('data', (data) => { stdout += data.toString(); });
    child.stderr.on('data', (data) => { stderr += data.toString(); });

    // 10分钟超时
    const timeout = setTimeout(() => {
      finished = true;
      child.kill();
      reject(new Error('请假提交超时'));
    }, 10 * 60 * 1000);

    child.on('close', (code) => {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);

      if (code !== 0) {
        const errorOutput = stderr.trim() || stdout.trim() || `请假提交脚本退出码 ${code}`;
        return reject(new Error(errorOutput));
      }

      resolve({ success: true, output: stdout });
    });

    child.on('error', (err) => {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      reject(err);
    });
  });
}

/**
 * 执行定时同步任务
 */
async function tryScheduledSync() {
  const now = new Date();
  const minuteKey = getMinuteKey(now);
  const dayOfWeek = now.getDay(); // 0=周日, 1=周一, ..., 6=周六
  const hour = now.getHours();
  const minute = now.getMinutes();

  // 检查是否匹配调度时间
  const matched = SCHEDULES.find(
    (item) => item.day === dayOfWeek && item.hour === hour && item.minute === minute
  );

  if (!matched) return;
  if (lastTriggeredMinute === minuteKey) return;
  if (syncRunning) {
    console.warn(`[OA_SYNC] ${matched.label} 自动同步跳过，上一轮仍在执行`);
    return;
  }

  lastTriggeredMinute = minuteKey;
  syncRunning = true;
  console.log(`[OA_SYNC] 开始执行 ${matched.label} 自动同步`);

  try {
    // 1. 下载考勤数据
    console.log(`[OA_SYNC] 步骤1: 下载考勤数据...`);
    const downloadResult = await runAttendanceScript();
    console.log(`[OA_SYNC] 考勤数据下载完成`);

    // 2. 如果需要提交请假
    if (matched.submitLeave) {
      console.log(`[OA_SYNC] 步骤2: 提交请假申请...`);
      const leaveResult = await runLeaveScript(false);
      console.log(`[OA_SYNC] 请假申请提交完成`);
    } else {
      console.log(`[OA_SYNC] 步骤2: 仅分析缺勤（不提交请假）...`);
      const leaveResult = await runLeaveScript(true);
      console.log(`[OA_SYNC] 缺勤分析完成`);
    }

    console.log(`[OA_SYNC] ${matched.label} 自动同步成功完成`);

  } catch (err) {
    console.error(`[OA_SYNC] ${matched.label} 自动同步失败:`, err.message);
  } finally {
    syncRunning = false;
  }
}

/**
 * 启动调度器
 */
function startOASyncScheduler() {
  if (schedulerStarted) return;
  schedulerStarted = true;

  console.log('[OA_SYNC] 泛微OA考勤同步调度器已启动');
  console.log('[OA_SYNC] 调度规则:');
  SCHEDULES.forEach(s => {
    console.log(`[OA_SYNC]   - 每周${['日', '一', '二', '三', '四', '五', '六'][s.day]} ${String(s.hour).padStart(2, '0')}:${String(s.minute).padStart(2, '0')} (${s.label}) ${s.submitLeave ? '下载+请假' : '仅下载'}`);
  });

  // 启动轮询
  setInterval(() => {
    tryScheduledSync().catch((err) => {
      console.error('[OA_SYNC] 自动同步轮询异常:', err.message);
    });
  }, POLL_MS);

  // 启动后5秒执行一次检查
  setTimeout(() => {
    tryScheduledSync().catch((err) => {
      console.error('[OA_SYNC] 自动同步初始化异常:', err.message);
    });
  }, 5000);
}

/**
 * 手动触发同步
 */
async function manualSync(submitLeave = false) {
  console.log(`[OA_SYNC] 手动触发同步 (提交请假: ${submitLeave})`);
  
  try {
    // 1. 下载考勤数据
    console.log('[OA_SYNC] 下载考勤数据...');
    await runAttendanceScript();
    
    // 2. 提交请假（如果需要）
    if (submitLeave) {
      console.log('[OA_SYNC] 提交请假申请...');
      await runLeaveScript(false);
    } else {
      console.log('[OA_SYNC] 分析缺勤（不提交）...');
      await runLeaveScript(true);
    }
    
    console.log('[OA_SYNC] 手动同步完成');
    return { success: true };
  } catch (error) {
    console.error('[OA_SYNC] 手动同步失败:', error.message);
    return { success: false, error: error.message };
  }
}

module.exports = {
  startOASyncScheduler,
  manualSync,
  runAttendanceScript,
  runLeaveScript
};
