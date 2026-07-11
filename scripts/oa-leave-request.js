/**
 * 泛微OA自动请假脚本
 *
 * 功能：
 * 1. 解析下载的考勤Excel文件
 * 2. 查找潘夏煜的考勤记录
 * 3. 检查每日考勤时间（上午8:00-11:30，下午13:00-17:30）
 * 4. 计算缺勤时间（按30分钟粒度）
 * 5. 自动填写请假单（事假）并提交
 *
 * 使用方法：
 *   node scripts/oa-leave-request.js
 *   node scripts/oa-leave-request.js --dry-run  # 仅分析，不提交请假
 *
 * 环境变量：
 *   OA_USERNAME - OA登录账号
 *   OA_PASSWORD - OA登录密码
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const puppeteer = require('puppeteer');
const XLSX = require('xlsx');
const path = require('path');
const fs = require('fs');

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// 配置
const CONFIG = {
  oaUrl: 'http://112.16.178.98:8088/',
  username: process.env.OA_USERNAME,
  password: process.env.OA_PASSWORD,
  targetEmployee: '潘夏煜',
  // 工作时间要求
  workSchedule: {
    morning: { start: '08:00', end: '11:30' },
    afternoon: { start: '13:00', end: '17:30' }
  },
  paths: {
    attendanceDir: path.join(__dirname, '..', 'data', 'oa-export'),
    logFile: path.join(__dirname, '..', 'data', 'oa-export', 'leave-requests.log')
  },
  browser: {
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
    defaultViewport: { width: 1920, height: 1080 },
    timeout: 60000
  }
};

/**
 * Excel日期序列号转日期字符串 YYYY-MM-DD
 */
function excelDateToDateStr(serial) {
  if (!serial || typeof serial !== 'number') return null;
  const utc_days = Math.floor(serial - 25569);
  const utc_value = utc_days * 86400;
  const date_info = new Date(utc_value * 1000);
  return date_info.toISOString().split('T')[0];
}

/**
 * 解析打卡记录字符串，返回上班/下班时间
 * 格式: "8:03进21:42出" 或 "12:28进20:08出"
 */
function parseClockRecord(clockStr) {
  if (!clockStr || typeof clockStr !== 'string') return { clockIn: null, clockOut: null };
  const match = clockStr.match(/(\d{1,2}:\d{2})进.*?(\d{1,2}:\d{2})出/);
  if (match) {
    return { clockIn: match[1], clockOut: match[2] };
  }
  return { clockIn: null, clockOut: null };
}

/**
 * 解析时间字符串为分钟数
 */
function parseTimeToMinutes(timeStr) {
  if (!timeStr) return null;
  const match = timeStr.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (match) {
    return parseInt(match[1]) * 60 + parseInt(match[2]);
  }
  return null;
}

/**
 * 计算缺勤时间（按30分钟粒度向上取整）
 */
function calculateMissingTime(actualStart, actualEnd, requiredStart, requiredEnd) {
  const actualStartMin = parseTimeToMinutes(actualStart);
  const actualEndMin = parseTimeToMinutes(actualEnd);
  const requiredStartMin = parseTimeToMinutes(requiredStart);
  const requiredEndMin = parseTimeToMinutes(requiredEnd);

  // 完全未打卡
  if (actualStartMin === null || actualEndMin === null) {
    return {
      missingMinutes: requiredEndMin - requiredStartMin,
      missingStart: requiredStart,
      missingEnd: requiredEnd
    };
  }

  let missingMinutes = 0;
  let missingStart = null;
  let missingEnd = null;

  // 上班迟到
  if (actualStartMin > requiredStartMin) {
    missingMinutes += actualStartMin - requiredStartMin;
    missingStart = requiredStart;
    missingEnd = actualStart;
  }

  // 下班早退
  if (actualEndMin < requiredEndMin) {
    missingMinutes += requiredEndMin - actualEndMin;
    if (!missingStart) {
      missingStart = actualEnd;
    }
    missingEnd = requiredEnd;
  }

  // 按30分钟粒度向上取整
  missingMinutes = Math.ceil(missingMinutes / 30) * 30;

  return { missingMinutes, missingStart, missingEnd };
}

/**
 * 解析考勤Excel文件，返回潘夏煜的每日考勤数据
 */
function parseAttendanceExcel(filePath) {
  console.log(`解析考勤文件: ${filePath}`);

  const workbook = XLSX.readFile(filePath);
  const sheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[sheetName];
  const data = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

  if (data.length < 2) {
    throw new Error('Excel文件数据为空');
  }

  // 表头在第1行（索引1）
  // 列结构: 0所属单位 1部门 2子部门 3岗位 4姓名 5日期 6备注 7打卡记录 ...
  const NAME_COL = 4;
  const DATE_COL = 5;
  const CLOCK_COL = 7;
  const SHOULD_WORK_COL = 14;
  const LEAVE_COL = 16;
  const ABSENT_COL = 17;

  // 从文件名提取日期范围（如 "202606考勤汇总（06.15-06.21）.xlsx" → 2026-06-15 ~ 2026-06-21）
  const fileName = path.basename(filePath);
  const yearMonthMatch = fileName.match(/^(\d{4})(\d{2})/);
  const rangeMatch = fileName.match(/(\d{1,2})\.(\d{1,2})-(\d{1,2})\.(\d{1,2})/);

  let startDate = null;
  let endDate = null;

  if (yearMonthMatch && rangeMatch) {
    const year = yearMonthMatch[1];
    startDate = `${year}-${rangeMatch[1].padStart(2, '0')}-${rangeMatch[2].padStart(2, '0')}`;
    endDate = `${year}-${rangeMatch[3].padStart(2, '0')}-${rangeMatch[4].padStart(2, '0')}`;
    console.log(`目标日期范围: ${startDate} ~ ${endDate}`);
  } else {
    console.log('未识别到日期范围，处理全部数据');
  }

  // 查找潘夏煜的所有行，只保留目标日期范围内的数据
  const records = [];
  for (let i = 2; i < data.length; i++) {
    const row = data[i];
    if (!row || !row[NAME_COL]) continue;
    if (row[NAME_COL].toString().includes(CONFIG.targetEmployee)) {
      const dateStr = excelDateToDateStr(row[DATE_COL]);
      if (!dateStr) continue;

      // 只保留目标日期范围内的数据
      if (startDate && endDate) {
        if (dateStr < startDate || dateStr > endDate) continue;
      }

      records.push({
        date: dateStr,
        clockRecord: row[CLOCK_COL] || '',
        shouldWork: row[SHOULD_WORK_COL] || 0,
        leave: row[LEAVE_COL] || 0,
        absent: row[ABSENT_COL] || 0
      });
    }
  }

  console.log(`找到 ${records.length} 条 ${CONFIG.targetEmployee} 的考勤记录`);
  return records;
}

/**
 * 分析考勤记录，只处理旷工记录
 * 旷工列的值为负数，单位是小时（如 -4.5 表示旷工4.5小时）
 */
function analyzeAttendance(records) {
  const absentDays = [];

  for (const record of records) {
    const { date, absent } = record;

    // 只处理有旷工记录的日期（旷工值为负数）
    if (!absent || absent >= 0) continue;

    // 转换为正数，单位从小时转为分钟
    const absentHours = Math.abs(absent);
    const absentMinutes = absentHours * 60;

    console.log(`${date}: 旷工 ${absentHours}小时 (${absentMinutes}分钟)`);

    absentDays.push({
      date,
      absentHours,
      absentMinutes
    });
  }

  return absentDays;
}

/**
 * 登录泛微OA
 */
async function loginToOA(page) {
  await page.goto(CONFIG.oaUrl, { waitUntil: 'networkidle2', timeout: CONFIG.browser.timeout });
  await page.waitForSelector('#loginid', { timeout: 10000 });
  await page.type('#loginid', CONFIG.username, { delay: 50 });
  await page.type('#userpassword', CONFIG.password, { delay: 50 });
  await page.click('#submit');
  await sleep(5000);
  console.log('登录成功');
}

/**
 * 提交请假申请（待用户提供表单结构后完善）
 */
async function submitLeaveRequest(page, missingDay) {
  console.log(`\n提交请假申请: ${missingDay.date} ${missingDay.period} ${missingDay.missingMinutes}分钟`);

  // TODO: 根据用户提供的人事流程表单结构完善以下代码
  // 1. 导航到人事模块
  // 2. 打开请假申请表单
  // 3. 填写假别类型（事假）
  // 4. 填写日期和时间
  // 5. 填写请假事由
  // 6. 提交

  console.log('⚠️ 请假提交功能待完善（需要提供人事流程表单结构）');
}

/**
 * 记录日志
 */
function log(message) {
  const timestamp = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
  const logMessage = `[${timestamp}] ${message}\n`;
  console.log(message);
  fs.appendFileSync(CONFIG.paths.logFile, logMessage);
}

/**
 * 主函数
 */
async function main() {
  const isDryRun = process.argv.includes('--dry-run');

  console.log('=== 泛微OA自动请假脚本 ===');
  console.log(`模式: ${isDryRun ? '仅分析（不提交）' : '分析并提交'}`);
  console.log(`开始时间: ${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}`);

  if (!CONFIG.username || !CONFIG.password) {
    console.error('错误: 请设置 OA_USERNAME 和 OA_PASSWORD 环境变量');
    process.exit(1);
  }

  // 查找最新的考勤文件
  const attendanceFiles = fs.readdirSync(CONFIG.paths.attendanceDir)
    .filter(f => f.startsWith('attendance-') && f.endsWith('.xlsx'))
    .sort()
    .reverse();

  if (attendanceFiles.length === 0) {
    // 尝试查找带"考勤"字样的文件
    const allXlsx = fs.readdirSync(CONFIG.paths.attendanceDir)
      .filter(f => f.endsWith('.xlsx') && f.includes('考勤'))
      .sort()
      .reverse();

    if (allXlsx.length === 0) {
      console.error('错误: 未找到考勤文件，请先运行 oa-attendance-sync.js');
      process.exit(1);
    }

    const filePath = path.join(CONFIG.paths.attendanceDir, allXlsx[0]);
    console.log(`使用考勤文件: ${allXlsx[0]}`);

    const records = parseAttendanceExcel(filePath);
    const absentDays = analyzeAttendance(records);

    if (absentDays.length === 0) {
      console.log('\n✅ 未发现旷工记录，无需请假');
      return;
    }

    console.log(`\n发现 ${absentDays.length} 条旷工记录`);
    absentDays.forEach(day => {
      console.log(`  ${day.date}: 旷工 ${day.absentHours}小时`);
    });

    if (!isDryRun) {
      console.log('\n⚠️ 自动提交请假功能待完善（需要提供人事流程表单结构）');
    }
    return;
  }

  const latestFile = attendanceFiles[0];
  const filePath = path.join(CONFIG.paths.attendanceDir, latestFile);
  console.log(`使用考勤文件: ${latestFile}`);

  const records = parseAttendanceExcel(filePath);
  const absentDays = analyzeAttendance(records);

  if (absentDays.length === 0) {
    console.log('\n✅ 未发现旷工记录，无需请假');
    return;
  }

  console.log(`\n发现 ${absentDays.length} 条旷工记录`);

  if (isDryRun) {
    console.log('\n=== 仅分析模式，不提交请假 ===');
    absentDays.forEach(day => {
      console.log(`  ${day.date}: 旷工 ${day.absentHours}小时`);
    });
    return;
  }

  // 提交请假申请
  console.log('\n⚠️ 自动提交请假功能待完善（需要提供人事流程表单结构）');
}

// 执行主函数
main()
  .then(() => {
    console.log('\n=== 执行完成 ===');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n=== 执行失败 ===');
    console.error(error);
    process.exit(1);
  });
