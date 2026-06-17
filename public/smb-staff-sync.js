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
const XLSX = require('xlsx');
const Database = require('better-sqlite3');

// 配置
const CONFIG = {
  smb: {
    host: process.env.SMB_HOST || '192.168.110.4',
    share: process.env.SMB_SHARE || '办公部门数据盘$',
    subdir: process.env.SMB_SUBDIR || '行政部/行政部共享数据',
    user: process.env.SMB_USER || 'xlmould\\HMCTB',
    pass: process.env.SMB_PASS || 'HMCTB123'
  },
  excel: {
    password: process.env.EXCEL_PASSWORD || '1111',
    filename: '1★员工花名册.xlsx',
    sheetName: '在职名册（员工）'
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

// 下载文件
function downloadFromSMB() {
  log('INFO', '正在连接 SMB 共享...');

  const localPath = path.join(CONFIG.tempDir, CONFIG.excel.filename);

  const scriptPath = path.join(CONFIG.tempDir, 'smb_commands.txt');
  const commands = `cd 行政部
cd 行政部共享数据
prompt OFF
get ${CONFIG.excel.filename} ${localPath}
quit`;
  fs.writeFileSync(scriptPath, commands);

  const smbCmd = `smbclient -U '${CONFIG.smb.user}' --password='${CONFIG.smb.pass}' //${CONFIG.smb.host}/'${CONFIG.smb.share}' < ${scriptPath}`;

  try {
    execSync(smbCmd, { stdio: 'pipe', shell: '/bin/bash' });
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
    const decryptCmd = `python3 -c "
import msoffcrypto
with open('${encryptedPath}', 'rb') as f:
    file = msoffcrypto.OfficeFile(f)
    file.load_key(password='${CONFIG.excel.password}')
    with open('${decryptedPath}', 'wb') as out:
        file.decrypt(out)
print('Decrypted successfully')
"`;
    execSync(decryptCmd, { stdio: 'pipe', cwd: '/app' });
    log('INFO', '文件解密成功');
    return decryptedPath;
  } catch (err) {
    log('ERROR', `解密失败: ${err.message}`);
    throw err;
  }
}

// Excel 日期序列号转 YYYY-MM-DD
function excelSerialToDate(serial) {
  if (!serial || typeof serial !== 'number') return null;
  const date = new Date((serial - 1) * 86400000 + new Date(1899, 11, 30).getTime());
  return date.toISOString().split('T')[0];
}

// 解析 Excel
function parseExcel(filePath) {
  log('INFO', '正在解析 Excel 文件...');

  const wb = XLSX.readFile(filePath);
  const ws = wb.Sheets[CONFIG.excel.sheetName];
  const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

  // 找到表头行（Row 2，包含 "序号", "工号", "姓名" 等）
  let headerRow = -1;
  for (let i = 0; i < data.length; i++) {
    const row = data[i];
    if (row.includes('序号') && row.includes('工号') && row.includes('姓名')) {
      headerRow = i;
      break;
    }
  }

  if (headerRow === -1) {
    throw new Error('无法找到表头行');
  }

  log('INFO', `表头在第 ${headerRow + 1} 行`);

  const header = data[headerRow];

  // 建立列索引映射（跳过序号、状态、备注）
  const colMap = {
    leave_date: header.indexOf('离职日期'),
    seniority: header.indexOf('工龄'),
    oa: header.indexOf('OA'),
    employee_id: header.indexOf('工号'),
    hire_date: header.indexOf('入职日期'),
    name: header.indexOf('姓名'),
    department: header.indexOf('部门'),
    team: header.indexOf('班组'),
    position: header.indexOf('职位'),
    employer: header.indexOf('所属单位'),
    phone: header.indexOf('联系电话'),
    office_phone: header.indexOf('办公室座机'),
    virtual_phone: header.indexOf('虚拟座机'),
    id_card: header.indexOf('身份证号码'),
    id_validity: header.indexOf('有效期限'),
    gender: header.indexOf('性别'),
    birthday: header.indexOf('出生年月'),
    age: header.indexOf('年龄'),
    nationality: header.indexOf('民族'),
    household: header.indexOf('户口'),
    address: header.indexOf('家庭住址'),
    current_address: header.indexOf('现居住地址'),
    education: header.indexOf('学历'),
    major: header.indexOf('专业'),
    graduate_school: header.indexOf('毕业院校'),
    graduate_date: header.indexOf('毕业时间'),
    trial_period: header.indexOf('试用期限'),
    trial_eval_date: header.indexOf('试用期评价日期'),
    confirmed: header.indexOf('是否转正'),
    confirm_date: header.indexOf('转正日期'),
    contract_signed: header.indexOf('是否已签合同'),
    nda: header.indexOf('保密协议'),
    non_compete: header.indexOf('竞业协议'),
    contract_period: header.indexOf('合同期限'),
    job_change_record: header.indexOf('调岗调薪记录'),
    category: header.indexOf('类别'),
    insurance_start_date: header.indexOf('缴纳日期'),
    insurance_end_date: header.indexOf('停缴日期'),
    emergency_contact: header.indexOf('姓名') >= 0 ? header.indexOf('姓名') : -1, // 紧急联系人姓名（后续会特殊处理）
    emergency_relation: header.indexOf('与本人关系'),
    emergency_phone: header.indexOf('紧急联系电话'),
    car_plate: header.indexOf('车牌号'),
    other_info: header.indexOf('其他信息'),
    bank_account: header.indexOf('工资卡账号'),
    bank_name: header.indexOf('开户行'),
    bank_branch: header.indexOf('开户支行'),
    bank_code: header.indexOf('行号')
  };

  // 紧急联系人姓名列需要单独找（41列是紧急联系人姓名）
  const emergencyContactIdx = 40; // 第41列，索引40

  log('INFO', `找到 ${Object.keys(colMap).length} 个字段映射`);

  // 解析数据行
  const staffList = [];
  for (let i = headerRow + 1; i < data.length; i++) {
    const row = data[i];

    // 跳过空行
    if (!row || row.length === 0) continue;

    const employeeId = colMap.employee_id >= 0 ? String(row[colMap.employee_id] || '').trim() : '';
    const name = colMap.name >= 0 ? String(row[colMap.name] || '').trim() : '';

    // 工号必须存在
    if (!employeeId || !name) continue;

    // 处理状态：在职=active，离职=inactive
    const statusIdx = header.indexOf('状态');
    let status = statusIdx >= 0 ? String(row[statusIdx] || '').trim() : '';
    if (status === '离职') {
      status = 'inactive';
    } else {
      status = 'active';
    }

    const staff = {
      employee_id: employeeId,
      name: name,
      phone: getVal(colMap.phone, row),
      department: getVal(colMap.department, row),
      team: getVal(colMap.team, row),
      position: getVal(colMap.position, row),
      hire_date: colMap.hire_date >= 0 ? excelSerialToDate(row[colMap.hire_date]) : null,
      leave_date: colMap.leave_date >= 0 ? excelSerialToDate(row[colMap.leave_date]) : null,
      seniority: getVal(colMap.seniority, row),
      oa: getVal(colMap.oa, row),
      employer: getVal(colMap.employer, row),
      office_phone: getVal(colMap.office_phone, row),
      virtual_phone: getVal(colMap.virtual_phone, row),
      id_card: getVal(colMap.id_card, row),
      id_validity: getVal(colMap.id_validity, row),
      gender: getVal(colMap.gender, row),
      birthday: getVal(colMap.birthday, row),
      age: getVal(colMap.age, row),
      nationality: getVal(colMap.nationality, row),
      household: getVal(colMap.household, row),
      address: getVal(colMap.address, row),
      current_address: getVal(colMap.current_address, row),
      education: getVal(colMap.education, row),
      major: getVal(colMap.major, row),
      graduate_school: getVal(colMap.graduate_school, row),
      graduate_date: getVal(colMap.graduate_date, row),
      trial_period: getVal(colMap.trial_period, row),
      trial_eval_date: getVal(colMap.trial_eval_date, row),
      confirmed: getVal(colMap.confirmed, row),
      confirm_date: colMap.confirm_date >= 0 ? excelSerialToDate(row[colMap.confirm_date]) : null,
      contract_signed: getVal(colMap.contract_signed, row),
      nda: getVal(colMap.nda, row),
      non_compete: getVal(colMap.non_compete, row),
      contract_period: getVal(colMap.contract_period, row),
      job_change_record: getVal(colMap.job_change_record, row),
      category: getVal(colMap.category, row),
      insurance_start_date: colMap.insurance_start_date >= 0 ? excelSerialToDate(row[colMap.insurance_start_date]) : null,
      insurance_end_date: colMap.insurance_end_date >= 0 ? excelSerialToDate(row[colMap.insurance_end_date]) : null,
      emergency_contact: emergencyContactIdx >= 0 && emergencyContactIdx < row.length ? getVal(emergencyContactIdx, row) : '',
      emergency_relation: getVal(colMap.emergency_relation, row),
      emergency_phone: getVal(colMap.emergency_phone, row),
      car_plate: getVal(colMap.car_plate, row),
      other_info: getVal(colMap.other_info, row),
      bank_account: getVal(colMap.bank_account, row),
      bank_name: getVal(colMap.bank_name, row),
      bank_branch: getVal(colMap.bank_branch, row),
      bank_code: getVal(colMap.bank_code, row),
      status: status
    };

    staffList.push(staff);
  }

  log('INFO', `解析到 ${staffList.length} 条员工记录（含在职和离职）`);
  return staffList;
}

// 获取列值
function getVal(idx, row) {
  if (idx < 0 || idx >= row.length) return '';
  const val = row[idx];
  if (val === null || val === undefined) return '';
  if (typeof val === 'number') return String(val);
  return String(val).trim();
}

// 确保数据库列存在
function ensureColumns(db) {
  const columns = [
    'department', 'team', 'position', 'id_card', 'gender', 'birthday',
    'nationality', 'household', 'address', 'education', 'major', 'graduate_school',
    'contract_signed', 'contract_period', 'category', 'bank_account',
    'leave_date', 'seniority', 'oa', 'employer', 'office_phone', 'virtual_phone',
    'id_validity', 'age', 'current_address', 'graduate_date', 'trial_period',
    'trial_eval_date', 'confirmed', 'nda', 'non_compete', 'job_change_record',
    'insurance_start_date', 'insurance_end_date', 'emergency_contact',
    'emergency_relation', 'emergency_phone', 'car_plate', 'other_info',
    'bank_name', 'bank_branch', 'bank_code'
  ];

  for (const col of columns) {
    try {
      db.exec(`ALTER TABLE staff ADD COLUMN ${col} TEXT`);
    } catch (e) {
      // 列已存在，忽略
    }
  }
}

// 同步到数据库
function syncToDatabase(staffList) {
  log('INFO', '正在同步到数据库...');

  const db = new Database(CONFIG.db.path);

  // 确保所有列存在
  ensureColumns(db);

  let inserted = 0;
  let updated = 0;
  let skipped = 0;

  // 所有需要同步的字段
  const fields = [
    'name', 'phone', 'department', 'team', 'position', 'hire_date',
    'id_card', 'gender', 'birthday', 'nationality', 'household', 'address',
    'education', 'major', 'graduate_school', 'contract_signed', 'contract_period',
    'category', 'bank_account', 'leave_date', 'seniority', 'oa', 'employer',
    'office_phone', 'virtual_phone', 'id_validity', 'age', 'current_address',
    'graduate_date', 'trial_period', 'trial_eval_date', 'confirmed', 'nda',
    'non_compete', 'job_change_record', 'insurance_start_date', 'insurance_end_date',
    'emergency_contact', 'emergency_relation', 'emergency_phone', 'car_plate',
    'other_info', 'bank_name', 'bank_branch', 'bank_code', 'status'
  ];

  const insertStmt = db.prepare(`
    INSERT INTO staff (
      employee_id, ${fields.join(', ')},
      exam_permission, meal_permission
    ) VALUES (
      @employee_id, ${fields.map(f => '@' + f).join(', ')}, 1, 1
    )
  `);

  const updateFields = fields.map(f => `${f} = @${f}`).join(', ');
  const updateStmt = db.prepare(`
    UPDATE staff SET ${updateFields}, updated_at = CURRENT_TIMESTAMP
    WHERE employee_id = @employee_id
  `);

  const getStmt = db.prepare('SELECT * FROM staff WHERE employee_id = ?');

  const syncOne = db.transaction((staff) => {
    const exists = getStmt.get(staff.employee_id);

    if (exists) {
      // 检查是否有变化
      let changed = false;
      for (const f of fields) {
        const oldVal = exists[f] || '';
        const newVal = staff[f] || '';
        if (oldVal !== newVal) {
          changed = true;
          break;
        }
      }

      if (changed) {
        updateStmt.run(staff);
        updated++;
      } else {
        skipped++;
      }
    } else {
      insertStmt.run(staff);
      inserted++;
    }
  });

  for (const staff of staffList) {
    syncOne(staff);
  }

  // 查找不在Excel中的员工（数据库中状态为active但不在同步列表中）
  const notInExcel = db.prepare('SELECT employee_id, name FROM staff WHERE status = ?').all('active');
  const syncedEmployeeIds = new Set(staffList.map(s => s.employee_id));
  const notInExcelList = notInExcel.filter(s => !syncedEmployeeIds.has(s.employee_id));

  db.close();

  log('INFO', `同步完成: 新增 ${inserted} 条, 更新 ${updated} 条, 跳过 ${skipped} 条`);
  log('INFO', `数据库中存在但不在Excel中的员工: ${notInExcelList.length} 条`);
  return { inserted, updated, skipped, notInExcel: notInExcelList };
}

// 清理临时文件
function cleanup() {
  log('INFO', '正在清理临时文件...');
  try {
    const files = fs.readdirSync(CONFIG.tempDir);
    for (const file of files) {
      if (file.endsWith('.xlsx') || file.endsWith('.xls')) {
        fs.unlinkSync(path.join(CONFIG.tempDir, file));
      }
    }
  } catch (e) {}
}

// 主函数
async function main() {
  log('INFO', '=== SMB 员工数据同步开始 ===');

  let encryptedFile = null;
  let decryptedFile = null;

  try {
    // 1. 下载文件
    encryptedFile = downloadFromSMB();

    // 2. 解密文件
    decryptedFile = decryptExcel(encryptedFile);

    // 3. 解析 Excel
    const staffList = parseExcel(decryptedFile);

    // 4. 同步到数据库
    const result = syncToDatabase(staffList);

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
