/**
 * SMB 员工数据同步脚本
 * 从 SMB 共享下载 Excel 员工花名册，解密并同步到数据库
 * 
 * 使用方法:
 *   node smb-staff-sync.js
 * 
 * 环境变量:
 *   SMB_HOST=192.168.110.4
 *   SMB_PATH=办公部门数据盘$/行政部/行政部共享数据
 *   SMB_USER=xlmould\\HMCTB
 *   SMB_PASS=HMCTB123
 *   EXCEL_PASSWORD=1111
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const XLSX = require('xlsx');
const Database = require('better-sqlite3');

// 配置
const CONFIG = {
  smb: {
    host: process.env.SMB_HOST || '192.168.110.4',
    share: process.env.SMB_SHARE || '办公部门数据盘$',  // 共享名（不含路径）
    subdir: process.env.SMB_SUBDIR || '行政部/行政部共享数据',  // 子目录
    user: process.env.SMB_USER || 'xlmould\\HMCTB',
    pass: process.env.SMB_PASS || 'HMCTB123'
  },
  excel: {
    password: process.env.EXCEL_PASSWORD || '1111',
    filename: '1★员工花名册.xlsx',
    activeSheetName: '在职名册（员工）',
    resignedSheetName: '离职名册（2021-2026）'
  },
  db: {
    path: process.env.DB_PATH || path.join(__dirname, '../data/exam.db')
  },
  tempDir: path.join(__dirname, '../tmp')
};

// 确保临时目录存在
if (!fs.existsSync(CONFIG.tempDir)) {
  fs.mkdirSync(CONFIG.tempDir, { recursive: true });
}

// 日志函数
function log(level, msg) {
  console.log(`[${new Date().toISOString()}] [${level}] ${msg}`);
}

function getShanghaiDateTimeString() {
  const formatter = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });
  return formatter.format(new Date());
}

function postSyncTime(result) {
  return new Promise((resolve) => {
    try {
      const http = require('http');
      const syncSecret = process.env.SYNC_SECRET || 'sync-secret-change-me';
      const postData = JSON.stringify({
        result: result?.result || (result?.skipped ? 'skipped_no_change' : 'success'),
        details: JSON.stringify(result || {}),
        synced_at: getShanghaiDateTimeString()
      });
      const req = http.request({
        hostname: '127.0.0.1',
        port: 3000,
        path: '/api/staff/sync-time',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData),
          'X-Sync-Secret': syncSecret
        }
      }, (res) => {
        res.on('data', () => {});
        res.on('end', resolve);
      });
      req.on('error', () => resolve());
      req.write(postData);
      req.end();
    } catch (e) {
      resolve();
    }
  });
}

// 下载文件
function downloadFromSMB() {
  log('INFO', '正在连接 SMB 共享...');

  const localPath = path.join(CONFIG.tempDir, CONFIG.excel.filename);

  // 使用 smbclient -c 选项直接传递命令，更可靠
  const smbCmd = `smbclient -U '${CONFIG.smb.user}' --password='${CONFIG.smb.pass}' //${CONFIG.smb.host}/'${CONFIG.smb.share}' -c 'cd 行政部; cd 行政部共享数据; prompt OFF; get "${CONFIG.excel.filename}" "${localPath}"; quit'`;

  try {
    execSync(smbCmd, { stdio: 'pipe', shell: '/bin/bash', timeout: 60000 });
    log('INFO', `文件已下载到: ${localPath}`);
    return localPath;
  } catch (err) {
    log('ERROR', `SMB 下载失败: ${err.message}`);
    throw err;
  }
}

// 解密 Excel 文件
function decryptExcel(encryptedPath) {
  log('INFO', '正在解密 Excel 文件...');
  
  const decryptedPath = path.join(CONFIG.tempDir, 'staff_decrypted.xlsx');
  
  try {
    // 使用 msoffcrypto 解密
    const decryptCmd = `/usr/bin/python3 -c "
import msoffcrypto
with open('${encryptedPath}', 'rb') as f:
    file = msoffcrypto.OfficeFile(f)
    file.load_key(password='${CONFIG.excel.password}')
    with open('${decryptedPath}', 'wb') as out:
        file.decrypt(out)
print('Decrypted successfully')
"`;
    execSync(decryptCmd, { stdio: 'pipe' });
    log('INFO', '文件解密成功');
    return decryptedPath;
  } catch (err) {
    log('ERROR', `解密失败: ${err.message}`);
    throw err;
  }
}

// Excel 日期序列号转 YYYY-MM-DD
function excelSerialToDate(serial) {
  if (serial == null || serial === '') return null;
  if (serial instanceof Date && !Number.isNaN(serial.getTime())) {
    const year = serial.getFullYear();
    const month = String(serial.getMonth() + 1).padStart(2, '0');
    const day = String(serial.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
  if (typeof serial === 'string') {
    return serial.trim() || null;
  }
  if (typeof serial !== 'number') return null;

  const parsed = XLSX.SSF.parse_date_code(serial);
  if (!parsed) return null;
  const year = String(parsed.y).padStart(4, '0');
  const month = String(parsed.m).padStart(2, '0');
  const day = String(parsed.d).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function firstIndex(header, names) {
  for (const name of names) {
    const index = header.indexOf(name);
    if (index >= 0) return index;
  }
  return -1;
}

function getCell(row, index) {
  return index >= 0 ? row[index] : '';
}

function getText(row, index) {
  return String(getCell(row, index) || '').trim();
}

function findHeaderRow(data) {
  for (let i = 0; i < data.length; i++) {
    const row = data[i] || [];
    const hasName = row.includes('姓名');
    const hasEmployeeId = row.includes('工号') || row.includes('员工工号');
    if (row.includes('序号') && hasEmployeeId && hasName) return i;
  }
  return -1;
}

function buildColumnMap(header) {
  return {
    serial: firstIndex(header, ['序号']),
    status: firstIndex(header, ['状态', '类别']),
    leaveDate: firstIndex(header, ['离职日期']),
    seniority: firstIndex(header, ['工龄']),
    oa: firstIndex(header, ['OA']),
    employeeId: firstIndex(header, ['工号', '员工工号']),
    hireDate: firstIndex(header, ['入职日期']),
    name: firstIndex(header, ['姓名']),
    department: firstIndex(header, ['部门']),
    team: firstIndex(header, ['班组', '子部门']),
    position: firstIndex(header, ['职位']),
    employer: firstIndex(header, ['所属单位', '参保单位']),
    phone: firstIndex(header, ['联系电话']),
    officePhone: firstIndex(header, ['办公室座机']),
    virtualPhone: firstIndex(header, ['虚拟座机']),
    idCard: firstIndex(header, ['身份证号码']),
    idValidity: firstIndex(header, ['有效期限']),
    gender: firstIndex(header, ['性别']),
    birthday: firstIndex(header, ['出生年月']),
    age: firstIndex(header, ['年龄']),
    nationality: firstIndex(header, ['民族']),
    household: firstIndex(header, ['户口']),
    address: firstIndex(header, ['家庭住址']),
    currentAddress: firstIndex(header, ['现居住地址']),
    education: firstIndex(header, ['学历']),
    major: firstIndex(header, ['专业']),
    graduateSchool: firstIndex(header, ['毕业院校']),
    graduateDate: firstIndex(header, ['毕业时间']),
    trialPeriod: firstIndex(header, ['试用期限']),
    trialEvalDate: firstIndex(header, ['试用期评价日期', '试用到期时间']),
    confirmed: firstIndex(header, ['是否转正']),
    confirmedDate: firstIndex(header, ['转正日期']),
    contractSigned: firstIndex(header, ['是否已签合同']),
    nda: firstIndex(header, ['保密协议']),
    nonCompete: firstIndex(header, ['竞业协议']),
    contractPeriod: firstIndex(header, ['合同期限']),
    jobChangeRecord: firstIndex(header, ['调岗调薪记录']),
    category: firstIndex(header, ['类别', '参保类别']),
    insuranceStartDate: firstIndex(header, ['缴纳日期', '参保时间']),
    insuranceEndDate: firstIndex(header, ['停缴日期']),
    emergencyContact: firstIndex(header, ['姓名.1']),
    emergencyRelation: firstIndex(header, ['与本人关系']),
    emergencyPhone: firstIndex(header, ['紧急联系电话']),
    carPlate: firstIndex(header, ['车牌号']),
    otherInfo: firstIndex(header, ['其他信息']),
    bankAccount: firstIndex(header, ['工资卡账号']),
    bankName: firstIndex(header, ['开户行']),
    bankBranch: firstIndex(header, ['开户支行']),
    bankCode: firstIndex(header, ['行号'])
  };
}

function parseRosterSheet(workbook, sheetName, rosterStatus) {
  const worksheet = workbook.Sheets[sheetName];
  if (!worksheet) {
    log('WARN', `未找到工作表: ${sheetName}`);
    return [];
  }
  const data = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '' });
  const headerRow = findHeaderRow(data);
  if (headerRow === -1) {
    throw new Error(`无法找到 ${sheetName} 表头行`);
  }

  const header = data[headerRow];
  const colMap = buildColumnMap(header);
  const staffList = [];
  for (let i = headerRow + 1; i < data.length; i++) {
    const row = data[i];
    if (!row || !getText(row, colMap.name)) continue;

    const employeeId = getText(row, colMap.employeeId);
    const name = getText(row, colMap.name);
    if (!employeeId || !name) continue;

    const rawLeaveType = getText(row, colMap.status);
    staffList.push({
      serial: getText(row, colMap.serial),
      employee_id: employeeId,
      name,
      phone: getText(row, colMap.phone),
      department: getText(row, colMap.department),
      team: getText(row, colMap.team),
      position: getText(row, colMap.position),
      hire_date: colMap.hireDate >= 0 ? excelSerialToDate(getCell(row, colMap.hireDate)) : null,
      id_card: getText(row, colMap.idCard),
      gender: getText(row, colMap.gender),
      birthday: colMap.birthday >= 0 ? excelSerialToDate(getCell(row, colMap.birthday)) || getText(row, colMap.birthday) : '',
      nationality: getText(row, colMap.nationality),
      household: getText(row, colMap.household),
      address: getText(row, colMap.address),
      current_address: getText(row, colMap.currentAddress),
      education: getText(row, colMap.education),
      major: getText(row, colMap.major),
      graduate_school: getText(row, colMap.graduateSchool),
      contract_signed: getText(row, colMap.contractSigned),
      contract_period: getText(row, colMap.contractPeriod),
      category: getText(row, colMap.category),
      bank_account: getText(row, colMap.bankAccount),
      status: rosterStatus,
      leave_date: rosterStatus === 'inactive' && colMap.leaveDate >= 0 ? excelSerialToDate(getCell(row, colMap.leaveDate)) : null,
      leave_type: rosterStatus === 'inactive' ? rawLeaveType : '',
      seniority: getText(row, colMap.seniority),
      oa: getText(row, colMap.oa),
      employer: getText(row, colMap.employer),
      office_phone: getText(row, colMap.officePhone),
      virtual_phone: getText(row, colMap.virtualPhone),
      id_validity: colMap.idValidity >= 0 ? excelSerialToDate(getCell(row, colMap.idValidity)) || getText(row, colMap.idValidity) : '',
      age: getText(row, colMap.age),
      graduate_date: colMap.graduateDate >= 0 ? excelSerialToDate(getCell(row, colMap.graduateDate)) : null,
      trial_period: getText(row, colMap.trialPeriod),
      trial_eval_date: colMap.trialEvalDate >= 0 ? excelSerialToDate(getCell(row, colMap.trialEvalDate)) || getText(row, colMap.trialEvalDate) : null,
      confirmed: getText(row, colMap.confirmed),
      confirmed_date: colMap.confirmedDate >= 0 ? excelSerialToDate(getCell(row, colMap.confirmedDate)) : null,
      nda: getText(row, colMap.nda),
      non_compete: getText(row, colMap.nonCompete),
      job_change_record: getText(row, colMap.jobChangeRecord),
      insurance_start_date: colMap.insuranceStartDate >= 0 ? excelSerialToDate(getCell(row, colMap.insuranceStartDate)) : null,
      insurance_end_date: colMap.insuranceEndDate >= 0 ? excelSerialToDate(getCell(row, colMap.insuranceEndDate)) : null,
      emergency_contact: getText(row, colMap.emergencyContact),
      emergency_relation: getText(row, colMap.emergencyRelation),
      emergency_phone: getText(row, colMap.emergencyPhone),
      car_plate: getText(row, colMap.carPlate),
      other_info: getText(row, colMap.otherInfo),
      bank_name: getText(row, colMap.bankName),
      bank_branch: getText(row, colMap.bankBranch),
      bank_code: getText(row, colMap.bankCode),
      sync_source: rosterStatus === 'active' ? 'active_roster' : 'resigned_roster'
    });
  }
  log('INFO', `${sheetName} 解析到 ${staffList.length} 条记录`);
  return staffList;
}

// 解析 Excel
function parseExcel(filePath) {
  log('INFO', '正在解析 Excel 文件...');
  const wb = XLSX.readFile(filePath);
  const activeList = parseRosterSheet(wb, CONFIG.excel.activeSheetName, 'active');
  const resignedList = parseRosterSheet(wb, CONFIG.excel.resignedSheetName, 'inactive');
  const activeIds = new Set(activeList.map((staff) => staff.employee_id));
  const conflicts = resignedList
    .filter((staff) => activeIds.has(staff.employee_id))
    .map((staff) => ({ employee_id: staff.employee_id, name: staff.name }));
  const merged = activeList.concat(resignedList.filter((staff) => !activeIds.has(staff.employee_id)));
  log('INFO', `合并后 ${merged.length} 条员工记录（在职 ${activeList.length}, 离职 ${resignedList.length}, 冲突 ${conflicts.length}）`);
  return { staffList: merged, activeCount: activeList.length, inactiveCount: resignedList.length, conflicts };
}

function ensureColumn(db, table, name, definition) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!columns.some((column) => column.name === name)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`);
  }
}

function ensureSyncSchema(db) {
  [
    ['department', 'TEXT'],
    ['position', 'TEXT'],
    ['id_card', 'TEXT'],
    ['gender', 'TEXT'],
    ['birthday', 'TEXT'],
    ['nationality', 'TEXT'],
    ['household', 'TEXT'],
    ['address', 'TEXT'],
    ['education', 'TEXT'],
    ['major', 'TEXT'],
    ['graduate_school', 'TEXT'],
    ['contract_signed', 'TEXT'],
    ['contract_period', 'TEXT'],
    ['category', 'TEXT'],
    ['bank_account', 'TEXT'],
    ['team', 'TEXT'],
    ['serial', 'TEXT'],
    ['current_address', 'TEXT'],
    ['leave_date', 'TEXT'],
    ['leave_type', 'TEXT'],
    ['sync_source', 'TEXT'],
    ['workwear_leave_date', 'TEXT'],
    ['workwear_leave_confirmed_at', 'TEXT'],
    ['seniority', 'TEXT'],
    ['oa', 'TEXT'],
    ['employer', 'TEXT'],
    ['office_phone', 'TEXT'],
    ['virtual_phone', 'TEXT'],
    ['id_validity', 'TEXT'],
    ['age', 'TEXT'],
    ['graduate_date', 'TEXT'],
    ['trial_period', 'TEXT'],
    ['trial_eval_date', 'TEXT'],
    ['confirmed', 'TEXT'],
    ['confirmed_date', 'TEXT'],
    ['nda', 'TEXT'],
    ['non_compete', 'TEXT'],
    ['job_change_record', 'TEXT'],
    ['insurance_start_date', 'TEXT'],
    ['insurance_end_date', 'TEXT'],
    ['emergency_contact', 'TEXT'],
    ['emergency_relation', 'TEXT'],
    ['emergency_phone', 'TEXT'],
    ['car_plate', 'TEXT'],
    ['other_info', 'TEXT'],
    ['bank_name', 'TEXT'],
    ['bank_branch', 'TEXT'],
    ['bank_code', 'TEXT']
  ].forEach(([name, definition]) => ensureColumn(db, 'staff', name, definition));

  ensureColumn(db, 'workwear_records', 'deduction_status', 'TEXT');
  ensureColumn(db, 'workwear_records', 'final_leave_date', 'TEXT');
  ensureColumn(db, 'workwear_records', 'final_deduction_ratio', 'REAL');
  ensureColumn(db, 'workwear_records', 'final_deduction', 'REAL');
  ensureColumn(db, 'workwear_records', 'deduction_reviewed_at', 'TEXT');
  db.exec(`
    CREATE TABLE IF NOT EXISTS staff_sync_file_state (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      file_hash TEXT,
      file_size INTEGER,
      updated_at DATETIME DEFAULT (datetime('now', 'localtime'))
    );
    CREATE TABLE IF NOT EXISTS workwear_deduction_adjustments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      staff_id INTEGER,
      employee_id TEXT,
      staff_name TEXT NOT NULL,
      record_id INTEGER,
      item_name TEXT,
      model TEXT,
      quantity INTEGER DEFAULT 0,
      unit_price REAL DEFAULT 0,
      provisional_leave_date TEXT,
      official_leave_date TEXT,
      original_deduction_ratio REAL DEFAULT 0,
      official_deduction_ratio REAL DEFAULT 0,
      original_deduction REAL DEFAULT 0,
      official_deduction REAL DEFAULT 0,
      diff_amount REAL DEFAULT 0,
      source TEXT DEFAULT 'excel_sync',
      status TEXT DEFAULT 'pending',
      created_at DATETIME DEFAULT (datetime('now', 'localtime')),
      updated_at DATETIME DEFAULT (datetime('now', 'localtime')),
      UNIQUE(record_id, official_leave_date)
    );
    CREATE INDEX IF NOT EXISTS idx_workwear_deduction_adjustments_staff ON workwear_deduction_adjustments(staff_id);
    CREATE INDEX IF NOT EXISTS idx_workwear_deduction_adjustments_status ON workwear_deduction_adjustments(status);
  `);
}

function getFileHash(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function getFileState(db) {
  return db.prepare('SELECT file_hash, file_size FROM staff_sync_file_state WHERE id = 1').get() || null;
}

function saveFileState(db, fileHash, fileSize) {
  db.prepare(`
    INSERT INTO staff_sync_file_state (id, file_hash, file_size, updated_at)
    VALUES (1, ?, ?, datetime('now', 'localtime'))
    ON CONFLICT(id) DO UPDATE SET
      file_hash = excluded.file_hash,
      file_size = excluded.file_size,
      updated_at = datetime('now', 'localtime')
  `).run(fileHash, fileSize);
}

function parseDateTextToDate(value) {
  const text = String(value || '').trim();
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(date.getTime()) ? null : date;
}

function calculateLeaveDeductionRatio(hireDate, leaveDate) {
  const hire = parseDateTextToDate(hireDate);
  const leave = parseDateTextToDate(leaveDate);
  if (!hire || !leave || leave.getTime() < hire.getTime()) return null;
  let years = leave.getFullYear() - hire.getFullYear();
  if (
    leave.getMonth() < hire.getMonth() ||
    (leave.getMonth() === hire.getMonth() && leave.getDate() < hire.getDate())
  ) {
    years -= 1;
  }
  if (years >= 2) return 0;
  if (years >= 1) return 50;
  return 80;
}

function calculateRecordDeduction(row, officialLeaveDate) {
  const ratio = calculateLeaveDeductionRatio(row.hire_date, officialLeaveDate);
  if (ratio == null) return null;
  const quantity = Number(row.quantity) || 0;
  const unitPrice = Number(row.unit_price) || 0;
  const selfPurchase = Number(row.self_purchase) || 0;
  const chargeBase = selfPurchase > 0 ? 0 : quantity * unitPrice;
  const deductionRatio = chargeBase > 0 ? ratio : 0;
  const deduction = chargeBase > 0 ? Number((chargeBase * (ratio / 100)).toFixed(2)) : 0;
  return { deductionRatio, deduction };
}

function reviewWorkwearDeductions(db, officialStaffList) {
  const officialRows = officialStaffList.filter((staff) => staff.status === 'inactive' && staff.leave_date);
  if (!officialRows.length) return { reviewed: 0, finalized: 0, adjustments: 0, skipped: 0 };

  const getStaffStmt = db.prepare(`
    SELECT id, employee_id, name
    FROM staff
    WHERE employee_id = ?
    LIMIT 1
  `);
  const selectRecords = db.prepare(`
    SELECT wr.*, s.employee_id, s.name AS current_staff_name, s.hire_date AS staff_hire_date
    FROM workwear_records wr
    LEFT JOIN staff s ON s.id = wr.staff_id
    WHERE wr.status = 'active'
      AND TRIM(COALESCE(wr.leave_date, '')) != ''
      AND COALESCE(wr.deduction_status, 'provisional') = 'provisional'
      AND (
        wr.staff_id = ?
        OR (
          wr.staff_id IS NULL
          AND TRIM(COALESCE(wr.staff_name, '')) = TRIM(COALESCE(?, ''))
        )
      )
  `);
  const markFinal = db.prepare(`
    UPDATE workwear_records
    SET deduction_status = 'final',
        leave_date = ?,
        final_leave_date = ?,
        final_deduction_ratio = ?,
        final_deduction = ?,
        deduction_reviewed_at = datetime('now', 'localtime'),
        updated_at = datetime('now', 'localtime')
    WHERE id = ?
  `);
  const upsertAdjustment = db.prepare(`
    INSERT INTO workwear_deduction_adjustments (
      staff_id, employee_id, staff_name, record_id, item_name, model, quantity, unit_price,
      provisional_leave_date, official_leave_date,
      original_deduction_ratio, official_deduction_ratio,
      original_deduction, official_deduction, diff_amount,
      source, status, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'excel_sync', 'pending', datetime('now', 'localtime'))
    ON CONFLICT(record_id, official_leave_date) DO UPDATE SET
      staff_id = excluded.staff_id,
      employee_id = excluded.employee_id,
      staff_name = excluded.staff_name,
      item_name = excluded.item_name,
      model = excluded.model,
      quantity = excluded.quantity,
      unit_price = excluded.unit_price,
      provisional_leave_date = excluded.provisional_leave_date,
      original_deduction_ratio = excluded.original_deduction_ratio,
      official_deduction_ratio = excluded.official_deduction_ratio,
      original_deduction = excluded.original_deduction,
      official_deduction = excluded.official_deduction,
      diff_amount = excluded.diff_amount,
      status = CASE WHEN workwear_deduction_adjustments.status = 'pending' THEN 'pending' ELSE workwear_deduction_adjustments.status END,
      updated_at = datetime('now', 'localtime')
  `);

  let reviewed = 0;
  let finalized = 0;
  let adjustments = 0;
  let skipped = 0;
  const tx = db.transaction(() => {
    officialRows.forEach((staff) => {
      const persistedStaff = getStaffStmt.get(staff.employee_id);
      if (!persistedStaff) {
        skipped++;
        return;
      }
      const records = selectRecords.all(persistedStaff.id, persistedStaff.name);
      records.forEach((record) => {
        reviewed++;
        const hireDate = record.hire_date || record.staff_hire_date;
        const official = calculateRecordDeduction({ ...record, hire_date: hireDate }, staff.leave_date);
        if (!official) {
          skipped++;
          return;
        }
        const originalDeduction = Number(record.deduction) || 0;
        const originalRatio = Number(record.deduction_ratio) || 0;
        const diff = Number((official.deduction - originalDeduction).toFixed(2));
        markFinal.run(staff.leave_date, staff.leave_date, official.deductionRatio, official.deduction, record.id);
        finalized++;
        if (Math.abs(diff) >= 0.01) {
          upsertAdjustment.run(
            persistedStaff.id,
            staff.employee_id,
            record.staff_name || persistedStaff.name || staff.name || record.current_staff_name || '',
            record.id,
            record.item_name || '',
            record.model || '',
            Number(record.quantity) || 0,
            Number(record.unit_price) || 0,
            record.leave_date || '',
            staff.leave_date,
            originalRatio,
            official.deductionRatio,
            originalDeduction,
            official.deduction,
            diff
          );
          adjustments++;
        }
      });
    });
  });
  tx();
  return { reviewed, finalized, adjustments, skipped };
}

// 同步到数据库
function syncToDatabase(parsed, fileMeta = {}) {
  log('INFO', '正在同步到数据库...');
  const staffList = Array.isArray(parsed) ? parsed : parsed.staffList;
  
  const db = new Database(CONFIG.db.path);
  ensureSyncSchema(db);
  
  // 确保 department 字段存在（添加列如果不存在）
  try {
    db.exec("ALTER TABLE staff ADD COLUMN department TEXT");
  } catch (e) {}
  try {
    db.exec("ALTER TABLE staff ADD COLUMN position TEXT");
  } catch (e) {}
  try {
    db.exec("ALTER TABLE staff ADD COLUMN id_card TEXT");
  } catch (e) {}
  try {
    db.exec("ALTER TABLE staff ADD COLUMN gender TEXT");
  } catch (e) {}
  try {
    db.exec("ALTER TABLE staff ADD COLUMN birthday TEXT");
  } catch (e) {}
  try {
    db.exec("ALTER TABLE staff ADD COLUMN nationality TEXT");
  } catch (e) {}
  try {
    db.exec("ALTER TABLE staff ADD COLUMN household TEXT");
  } catch (e) {}
  try {
    db.exec("ALTER TABLE staff ADD COLUMN address TEXT");
  } catch (e) {}
  try {
    db.exec("ALTER TABLE staff ADD COLUMN education TEXT");
  } catch (e) {}
  try {
    db.exec("ALTER TABLE staff ADD COLUMN major TEXT");
  } catch (e) {}
  try {
    db.exec("ALTER TABLE staff ADD COLUMN graduate_school TEXT");
  } catch (e) {}
  try {
    db.exec("ALTER TABLE staff ADD COLUMN contract_signed TEXT");
  } catch (e) {}
  try {
    db.exec("ALTER TABLE staff ADD COLUMN contract_period TEXT");
  } catch (e) {}
  try {
    db.exec("ALTER TABLE staff ADD COLUMN category TEXT");
  } catch (e) {}
  try {
    db.exec("ALTER TABLE staff ADD COLUMN bank_account TEXT");
  } catch (e) {}
  try {
    db.exec("ALTER TABLE staff ADD COLUMN team TEXT");
  } catch (e) {}
  try {
    db.exec("ALTER TABLE staff ADD COLUMN serial TEXT");
  } catch (e) {}
  try {
    db.exec("ALTER TABLE staff ADD COLUMN current_address TEXT");
  } catch (e) {}
  // 新增字段
  try {
    db.exec("ALTER TABLE staff ADD COLUMN leave_date TEXT");
  } catch (e) {}
  try {
    db.exec("ALTER TABLE staff ADD COLUMN seniority TEXT");
  } catch (e) {}
  try {
    db.exec("ALTER TABLE staff ADD COLUMN oa TEXT");
  } catch (e) {}
  try {
    db.exec("ALTER TABLE staff ADD COLUMN employer TEXT");
  } catch (e) {}
  try {
    db.exec("ALTER TABLE staff ADD COLUMN office_phone TEXT");
  } catch (e) {}
  try {
    db.exec("ALTER TABLE staff ADD COLUMN virtual_phone TEXT");
  } catch (e) {}
  try {
    db.exec("ALTER TABLE staff ADD COLUMN id_validity TEXT");
  } catch (e) {}
  try {
    db.exec("ALTER TABLE staff ADD COLUMN age TEXT");
  } catch (e) {}
  try {
    db.exec("ALTER TABLE staff ADD COLUMN graduate_date TEXT");
  } catch (e) {}
  try {
    db.exec("ALTER TABLE staff ADD COLUMN trial_period TEXT");
  } catch (e) {}
  try {
    db.exec("ALTER TABLE staff ADD COLUMN trial_eval_date TEXT");
  } catch (e) {}
  try {
    db.exec("ALTER TABLE staff ADD COLUMN confirmed TEXT");
  } catch (e) {}
  try {
    db.exec("ALTER TABLE staff ADD COLUMN confirmed_date TEXT");
  } catch (e) {}
  try {
    db.exec("ALTER TABLE staff ADD COLUMN nda TEXT");
  } catch (e) {}
  try {
    db.exec("ALTER TABLE staff ADD COLUMN non_compete TEXT");
  } catch (e) {}
  try {
    db.exec("ALTER TABLE staff ADD COLUMN job_change_record TEXT");
  } catch (e) {}
  try {
    db.exec("ALTER TABLE staff ADD COLUMN insurance_start_date TEXT");
  } catch (e) {}
  try {
    db.exec("ALTER TABLE staff ADD COLUMN insurance_end_date TEXT");
  } catch (e) {}
  try {
    db.exec("ALTER TABLE staff ADD COLUMN emergency_contact TEXT");
  } catch (e) {}
  try {
    db.exec("ALTER TABLE staff ADD COLUMN emergency_relation TEXT");
  } catch (e) {}
  try {
    db.exec("ALTER TABLE staff ADD COLUMN emergency_phone TEXT");
  } catch (e) {}
  try {
    db.exec("ALTER TABLE staff ADD COLUMN car_plate TEXT");
  } catch (e) {}
  try {
    db.exec("ALTER TABLE staff ADD COLUMN other_info TEXT");
  } catch (e) {}
  try {
    db.exec("ALTER TABLE staff ADD COLUMN bank_name TEXT");
  } catch (e) {}
  try {
    db.exec("ALTER TABLE staff ADD COLUMN bank_branch TEXT");
  } catch (e) {}
  try {
    db.exec("ALTER TABLE staff ADD COLUMN bank_code TEXT");
  } catch (e) {}
  try {
    db.exec("ALTER TABLE staff ADD COLUMN leave_type TEXT");
  } catch (e) {}
  try {
    db.exec("ALTER TABLE staff ADD COLUMN sync_source TEXT");
  } catch (e) {}
  try {
    db.exec("ALTER TABLE staff ADD COLUMN workwear_leave_date TEXT");
  } catch (e) {}
  try {
    db.exec("ALTER TABLE staff ADD COLUMN workwear_leave_confirmed_at TEXT");
  } catch (e) {}
  
  let inserted = 0;
  let updated = 0;
  let activeInserted = 0;
  let activeUpdated = 0;
  let inactiveInserted = 0;
  let inactiveUpdated = 0;
  let skipped = []; // 已存在且无变化的员工
  let leaveDateConflicts = [];
  const existingStaff = []; // 数据库中已存在的员工（用于后续比对）
  
  const insertStmt = db.prepare(`
    INSERT INTO staff (
      serial, employee_id, name, phone, department, team, position, hire_date,
      id_card, gender, birthday, nationality, household, address, current_address,
      education, major, graduate_school, contract_signed, contract_period,
      category, bank_account, status, exam_permission, meal_permission,
      leave_date, leave_type, sync_source, seniority, oa, employer, office_phone, virtual_phone,
      id_validity, age, graduate_date, trial_period, trial_eval_date,
      confirmed, confirmed_date, nda, non_compete, job_change_record,
      insurance_start_date, insurance_end_date, emergency_contact,
      emergency_relation, emergency_phone, car_plate, other_info,
      bank_name, bank_branch, bank_code
    ) VALUES (
      @serial, @employee_id, @name, @phone, @department, @team, @position, @hire_date,
      @id_card, @gender, @birthday, @nationality, @household, @address, @current_address,
      @education, @major, @graduate_school, @contract_signed, @contract_period,
      @category, @bank_account, @status, 1, 1,
      @leave_date, @leave_type, @sync_source, @seniority, @oa, @employer, @office_phone, @virtual_phone,
      @id_validity, @age, @graduate_date, @trial_period, @trial_eval_date,
      @confirmed, @confirmed_date, @nda, @non_compete, @job_change_record,
      @insurance_start_date, @insurance_end_date, @emergency_contact,
      @emergency_relation, @emergency_phone, @car_plate, @other_info,
      @bank_name, @bank_branch, @bank_code
    )
  `);
  
  const updateStmt = db.prepare(`
    UPDATE staff SET
      serial = @serial,
      name = @name,
      phone = @phone,
      department = @department,
      team = @team,
      position = @position,
      hire_date = @hire_date,
      id_card = @id_card,
      gender = @gender,
      birthday = @birthday,
      nationality = @nationality,
      household = @household,
      address = @address,
      current_address = @current_address,
      education = @education,
      major = @major,
      graduate_school = @graduate_school,
      contract_signed = @contract_signed,
      contract_period = @contract_period,
      category = @category,
      bank_account = @bank_account,
      status = @status,
      updated_at = CURRENT_TIMESTAMP,
      leave_date = @leave_date,
      leave_type = @leave_type,
      sync_source = @sync_source,
      seniority = @seniority,
      oa = @oa,
      employer = @employer,
      office_phone = @office_phone,
      virtual_phone = @virtual_phone,
      id_validity = @id_validity,
      age = @age,
      graduate_date = @graduate_date,
      trial_period = @trial_period,
      trial_eval_date = @trial_eval_date,
      confirmed = @confirmed,
      confirmed_date = @confirmed_date,
      nda = @nda,
      non_compete = @non_compete,
      job_change_record = @job_change_record,
      insurance_start_date = @insurance_start_date,
      insurance_end_date = @insurance_end_date,
      emergency_contact = @emergency_contact,
      emergency_relation = @emergency_relation,
      emergency_phone = @emergency_phone,
      car_plate = @car_plate,
      other_info = @other_info,
      bank_name = @bank_name,
      bank_branch = @bank_branch,
      bank_code = @bank_code
    WHERE employee_id = @employee_id
  `);
  
  const getStmt = db.prepare('SELECT * FROM staff WHERE employee_id = ?');
  const preserveWorkwearLeaveStmt = db.prepare(`
    UPDATE staff
    SET workwear_leave_date = COALESCE(NULLIF(TRIM(workwear_leave_date), ''), ?),
        workwear_leave_confirmed_at = COALESCE(workwear_leave_confirmed_at, datetime('now', 'localtime'))
    WHERE id = ?
  `);

  const insertMany = db.transaction((list) => {
    for (const staff of list) {
      const exists = getStmt.get(staff.employee_id);
      if (exists) {
        existingStaff.push({ employee_id: staff.employee_id, name: staff.name });
        if (staff.status === 'active' && exists.leave_date && !String(exists.workwear_leave_date || '').trim()) {
          preserveWorkwearLeaveStmt.run(exists.leave_date, exists.id);
        }
        if (
          staff.status === 'inactive' &&
          staff.leave_date &&
          String(exists.workwear_leave_date || '').trim() &&
          String(exists.workwear_leave_date || '').trim() !== String(staff.leave_date || '').trim()
        ) {
          leaveDateConflicts.push({
            employee_id: staff.employee_id,
            name: staff.name,
            workwear_leave_date: exists.workwear_leave_date,
            official_leave_date: staff.leave_date
          });
        }
        // 对比字段，有变化才更新
        const changed = exists.serial !== staff.serial ||
          exists.name !== staff.name ||
          exists.phone !== staff.phone ||
          exists.department !== staff.department ||
          exists.team !== staff.team ||
          exists.position !== staff.position ||
          exists.hire_date !== staff.hire_date ||
          exists.id_card !== staff.id_card ||
          exists.gender !== staff.gender ||
          exists.birthday !== staff.birthday ||
          exists.nationality !== staff.nationality ||
          exists.household !== staff.household ||
          exists.address !== staff.address ||
          exists.current_address !== staff.current_address ||
          exists.education !== staff.education ||
          exists.major !== staff.major ||
          exists.graduate_school !== staff.graduate_school ||
          exists.contract_signed !== staff.contract_signed ||
          exists.contract_period !== staff.contract_period ||
          exists.category !== staff.category ||
          exists.bank_account !== staff.bank_account ||
          exists.status !== staff.status ||
          exists.leave_date !== staff.leave_date ||
          exists.leave_type !== staff.leave_type ||
          exists.sync_source !== staff.sync_source ||
          exists.seniority !== staff.seniority ||
          exists.oa !== staff.oa ||
          exists.employer !== staff.employer ||
          exists.office_phone !== staff.office_phone ||
          exists.virtual_phone !== staff.virtual_phone ||
          exists.id_validity !== staff.id_validity ||
          exists.age !== staff.age ||
          exists.graduate_date !== staff.graduate_date ||
          exists.trial_period !== staff.trial_period ||
          exists.trial_eval_date !== staff.trial_eval_date ||
          exists.confirmed !== staff.confirmed ||
          exists.confirmed_date !== staff.confirmed_date ||
          exists.nda !== staff.nda ||
          exists.non_compete !== staff.non_compete ||
          exists.job_change_record !== staff.job_change_record ||
          exists.insurance_start_date !== staff.insurance_start_date ||
          exists.insurance_end_date !== staff.insurance_end_date ||
          exists.emergency_contact !== staff.emergency_contact ||
          exists.emergency_relation !== staff.emergency_relation ||
          exists.emergency_phone !== staff.emergency_phone ||
          exists.car_plate !== staff.car_plate ||
          exists.other_info !== staff.other_info ||
          exists.bank_name !== staff.bank_name ||
          exists.bank_branch !== staff.bank_branch ||
          exists.bank_code !== staff.bank_code;
        if (changed) {
          updateStmt.run(staff);
          updated++;
          if (staff.status === 'inactive') inactiveUpdated++;
          else activeUpdated++;
        } else {
          // 已存在且无变化，记录为跳过
          skipped.push({ employee_id: staff.employee_id, name: staff.name });
        }
      } else {
        insertStmt.run(staff);
        inserted++;
        if (staff.status === 'inactive') inactiveInserted++;
        else activeInserted++;
      }
    }
  });

  insertMany(staffList);

  // 查找不在Excel中的员工（在数据库中但状态为active且不在同步列表中）
  // 注意：不修改数据库状态，只返回列表供前端展示红色提示
  const notInExcel = db.prepare('SELECT employee_id, name FROM staff WHERE status = ?').all('active');
  const syncedEmployeeIds = new Set(staffList.map(s => s.employee_id));
  const notInExcelList = notInExcel.filter(s => !syncedEmployeeIds.has(s.employee_id));
  const deductionReview = reviewWorkwearDeductions(db, staffList);
  if (fileMeta.hash) {
    saveFileState(db, fileMeta.hash, fileMeta.size || 0);
  }

  db.close();

  log('INFO', `同步完成: 新增 ${inserted} 条, 更新 ${updated} 条, 跳过 ${skipped.length} 条, 未匹配 ${notInExcelList.length} 人, 工服复核 ${deductionReview.reviewed} 条, 差额 ${deductionReview.adjustments} 条`);
  return {
    result: 'success',
    inserted,
    updated,
    activeInserted,
    activeUpdated,
    inactiveInserted,
    inactiveUpdated,
    activeCount: Array.isArray(parsed) ? staffList.filter((s) => s.status === 'active').length : parsed.activeCount,
    inactiveCount: Array.isArray(parsed) ? staffList.filter((s) => s.status === 'inactive').length : parsed.inactiveCount,
    skipped,
    notInExcel: notInExcelList,
    rosterConflicts: Array.isArray(parsed) ? [] : parsed.conflicts,
    leaveDateConflicts,
    deductionReview,
    fileHash: fileMeta.hash || '',
    fileSize: fileMeta.size || 0
  };
}

// 清理临时文件
function cleanup() {
  log('INFO', '正在清理临时文件...');
  // 暂时禁用以调试
}

// 主函数
async function main() {
  log('INFO', '=== SMB 员工数据同步开始 ===');
  
  let encryptedFile = null;
  let decryptedFile = null;
  
  try {
    // 1. 下载文件
    encryptedFile = downloadFromSMB();
    const fileHash = getFileHash(encryptedFile);
    const fileSize = fs.statSync(encryptedFile).size;

    if (process.env.STAFF_SYNC_CHECK_CHANGED === '1') {
      const stateDb = new Database(CONFIG.db.path);
      try {
        ensureSyncSchema(stateDb);
        const prevState = getFileState(stateDb);
        if (prevState && prevState.file_hash === fileHash && Number(prevState.file_size || 0) === fileSize) {
          const result = {
            result: 'skipped_no_change',
            skipped: true,
            fileHash,
            fileSize
          };
          await postSyncTime(result);
          log('INFO', 'Excel 文件未变化，跳过写库');
          console.log(JSON.stringify(result));
          return;
        }
      } finally {
        stateDb.close();
      }
    }
    
    // 2. 解密文件
    decryptedFile = decryptExcel(encryptedFile);
    
    // 3. 解析 Excel
    const parsed = parseExcel(decryptedFile);
    
    // 4. 同步到数据库
    const result = syncToDatabase(parsed, { hash: fileHash, size: fileSize });

    await postSyncTime(result);

    log('INFO', '=== 同步成功 ===');
    console.log(JSON.stringify(result));
    
  } catch (err) {
    log('ERROR', `同步失败: ${err.message}`);
    console.error(err);
    process.exit(1);
  } finally {
    cleanup();
  }
}

main();
