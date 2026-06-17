/**
 * SMB 学生名册同步脚本
 * 从 SMB 共享下载 Excel 员工花名册，读取"在职名册(学生)"工作表，
 * 筛选顶岗日期为空的学生，同步到数据库
 *
 * 使用方法:
 *   node smb-student-sync.js
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
    sheetName: '在职名册 (学生)'
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

  const decryptedPath = path.join(CONFIG.tempDir, 'student_decrypted.xlsx');

  try {
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
  if (!serial || typeof serial !== 'number') return null;
  const date = new Date((serial - 1) * 86400000 + new Date(1899, 11, 30).getTime());
  return date.toISOString().split('T')[0];
}

// 解析 Excel
function parseExcel(filePath) {
  log('INFO', '正在解析 Excel 文件...');

  const wb = XLSX.readFile(filePath);

  // 检查工作表是否存在
  if (!wb.SheetNames.includes(CONFIG.excel.sheetName)) {
    throw new Error(`未找到工作表: ${CONFIG.excel.sheetName}`);
  }

  const ws = wb.Sheets[CONFIG.excel.sheetName];
  const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

  // 找到表头行
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

  // 建立列索引映射
  const header = data[headerRow];
  const colMap = {
    serial: header.indexOf('序号'),
    school: header.indexOf('学校'),
    jietiaoDate: header.indexOf('解约日期'),
    dinggangDate: header.indexOf('顶岗日期'),
    oa: header.indexOf('OA'),
    employeeId: header.indexOf('工号'),
    trainingDate: header.indexOf('实训日期'),
    name: header.indexOf('姓名'),
    department: header.indexOf('部门'),
    subDepartment: header.indexOf('子部门'),
    position: header.indexOf('职位'),
    employer: header.indexOf('所属单位'),
    phone: header.indexOf('联系电话'),
    idCard: header.indexOf('身份证号码'),
    idValidity: header.indexOf('身份证有效期'),
    gender: header.indexOf('性别'),
    birthday: header.indexOf('出生年月'),
    age: header.indexOf('年龄'),
    nationality: header.indexOf('民族'),
    household: header.indexOf('户口'),
    homeAddress: header.indexOf('家庭住址'),
    currentAddress: header.indexOf('现居住地址'),
    education: header.indexOf('学历'),
    major: header.indexOf('专业'),
    graduateSchool: header.indexOf('毕业院校'),
    graduateDate: header.indexOf('毕业时间'),
    insuranceType: header.indexOf('参保类别'),
    insuranceDate: header.indexOf('参保时间'),
    emergencyContact: header.indexOf('紧急\n联系人') >= 0 ? header.indexOf('紧急\n联系人') : header.indexOf('紧急联系人'),
    emergencyRelation: header.indexOf('相互\n关系') >= 0 ? header.indexOf('相互\n关系') : header.indexOf('相互关系'),
    emergencyPhone: header.indexOf('紧急\n联系电话') >= 0 ? header.indexOf('紧急\n联系电话') : header.indexOf('紧急联系电话'),
    bankAccount: header.indexOf('银行卡账号'),
    bankName: header.indexOf('开户行'),
    bankBranch: header.indexOf('开户支行'),
    bankCode: header.indexOf('行号'),
    trialPeriod: header.indexOf('试用\n期限') >= 0 ? header.indexOf('试用\n期限') : header.indexOf('试用期'),
    trialEndDate: header.indexOf('试用到\n期时间') >= 0 ? header.indexOf('试用到\n期时间') : header.indexOf('试用期到期时间'),
    confirmed: header.indexOf('是否转正'),
    contractSigned: header.indexOf('是否已签合同'),
    contractPeriod: header.indexOf('合同期限'),
    cardNo: header.indexOf('消费系统卡号'),
    lunarBirthday: header.indexOf('农历生日')
  };

  log('INFO', `找到 ${Object.keys(colMap).filter(k => colMap[k] >= 0).length} 个字段映射`);

  // 解析数据行
  const studentList = [];
  for (let i = headerRow + 1; i < data.length; i++) {
    const row = data[i];

    // 跳过空行
    if (!row || !row[colMap.name]) continue;

    const employeeId = colMap.employeeId >= 0 ? String(row[colMap.employeeId] || '').trim() : '';
    const name = colMap.name >= 0 ? String(row[colMap.name] || '').trim() : '';

    // 姓名必须存在
    if (!name) continue;

    // 顶岗日期为空 - 筛选条件（顶岗日期不为空则跳过）
    let dinggangDate = '';
    if (colMap.dinggangDate >= 0) {
      const val = row[colMap.dinggangDate];
      if (typeof val === 'number' && val > 0) {
        dinggangDate = excelSerialToDate(val);
      } else if (val && String(val).trim() !== '') {
        dinggangDate = String(val).trim();
      }
    }
    // 如果顶岗日期不为空，跳过（已顶岗的学生不再是学生）
    if (dinggangDate && dinggangDate !== '/' && dinggangDate !== 'NaN') {
      continue;
    }

    // 解约日期 - 跳过已解约的
    let jietiaoDate = '';
    if (colMap.jietiaoDate >= 0) {
      const val = row[colMap.jietiaoDate];
      if (typeof val === 'number') {
        jietiaoDate = excelSerialToDate(val);
      } else if (val) {
        jietiaoDate = String(val).trim();
      }
    }
    // 如果解约日期不为空且不是 "/" 或 "中途退出"，跳过
    if (jietiaoDate && jietiaoDate !== '/' && !jietiaoDate.includes('中途退出')) {
      continue;
    }

    studentList.push({
      serial: colMap.serial >= 0 ? String(row[colMap.serial] || '').trim() : '',
      employee_id: employeeId,
      name: name,
      school: colMap.school >= 0 ? String(row[colMap.school] || '').trim() : '',
      department: colMap.department >= 0 ? String(row[colMap.department] || '').trim() : '',
      sub_department: colMap.subDepartment >= 0 ? String(row[colMap.subDepartment] || '').trim() : '',
      position: colMap.position >= 0 ? String(row[colMap.position] || '').trim() : '',
      training_date: colMap.trainingDate >= 0 ? (typeof row[colMap.trainingDate] === 'number' ? excelSerialToDate(row[colMap.trainingDate]) : String(row[colMap.trainingDate] || '').trim()) : '',
      dinggang_date: dinggangDate,
      phone: colMap.phone >= 0 ? String(row[colMap.phone] || '').trim() : '',
      id_card: colMap.idCard >= 0 ? String(row[colMap.idCard] || '').trim() : '',
      home_address: colMap.homeAddress >= 0 ? String(row[colMap.homeAddress] || '').trim() : '',
      education: colMap.education >= 0 ? String(row[colMap.education] || '').trim() : '',
      major: colMap.major >= 0 ? String(row[colMap.major] || '').trim() : '',
      emergency_contact: colMap.emergencyContact >= 0 ? String(row[colMap.emergencyContact] || '').trim() : '',
      emergency_relation: colMap.emergencyRelation >= 0 ? String(row[colMap.emergencyRelation] || '').trim() : '',
      emergency_phone: colMap.emergencyPhone >= 0 ? String(row[colMap.emergencyPhone] || '').trim() : ''
    });
  }

  log('INFO', `解析到 ${studentList.length} 条学生记录（顶岗日期为空且未解约）`);
  return studentList;
}

// 同步到数据库
function syncToDatabase(studentList) {
  log('INFO', '正在同步到数据库...');

  const db = new Database(CONFIG.db.path);

  // 确保 student_roster 表存在
  db.exec(`
    CREATE TABLE IF NOT EXISTS student_roster (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      employee_id TEXT UNIQUE,
      school TEXT,
      department TEXT,
      sub_department TEXT,
      position TEXT,
      training_date TEXT,
      dinggang_date TEXT,
      phone TEXT,
      id_card TEXT,
      home_address TEXT,
      education TEXT,
      major TEXT,
      emergency_contact TEXT,
      emergency_relation TEXT,
      emergency_phone TEXT,
      source_employee_id TEXT,
      synced_at DATETIME DEFAULT (datetime('now', 'localtime')),
      created_at DATETIME DEFAULT (datetime('now', 'localtime'))
    )
  `);

  let inserted = 0;
  let updated = 0;
  let skipped = 0;

  const insertStmt = db.prepare(`
    INSERT INTO student_roster (
      name, employee_id, school, department, sub_department, position,
      training_date, dinggang_date, phone, id_card, home_address,
      education, major, emergency_contact, emergency_relation, emergency_phone,
      synced_at
    ) VALUES (
      @name, @employee_id, @school, @department, @sub_department, @position,
      @training_date, @dinggang_date, @phone, @id_card, @home_address,
      @education, @major, @emergency_contact, @emergency_relation, @emergency_phone,
      datetime('now', 'localtime')
    )
  `);

  const updateStmt = db.prepare(`
    UPDATE student_roster SET
      name = @name,
      school = @school,
      department = @department,
      sub_department = @sub_department,
      position = @position,
      training_date = @training_date,
      dinggang_date = @dinggang_date,
      phone = @phone,
      id_card = @id_card,
      home_address = @home_address,
      education = @education,
      major = @major,
      emergency_contact = @emergency_contact,
      emergency_relation = @emergency_relation,
      emergency_phone = @emergency_phone,
      synced_at = datetime('now', 'localtime')
    WHERE employee_id = @employee_id
  `);

  const getStmt = db.prepare('SELECT * FROM student_roster WHERE employee_id = ?');

  const syncTransaction = db.transaction((list) => {
    for (const student of list) {
      // 跳过没有工号的学生
      if (!student.employee_id) {
        log('WARN', `跳过无工号学生: ${student.name}`);
        continue;
      }

      const exists = getStmt.get(student.employee_id);
      if (exists) {
        // 已存在 - 检查是否有变化
        const changed = exists.name !== student.name ||
          exists.school !== student.school ||
          exists.department !== student.department ||
          exists.sub_department !== student.sub_department ||
          exists.position !== student.position ||
          exists.training_date !== student.training_date ||
          exists.dinggang_date !== student.dinggang_date ||
          exists.phone !== student.phone ||
          exists.id_card !== student.id_card ||
          exists.home_address !== student.home_address ||
          exists.education !== student.education ||
          exists.major !== student.major ||
          exists.emergency_contact !== student.emergency_contact ||
          exists.emergency_relation !== student.emergency_relation ||
          exists.emergency_phone !== student.emergency_phone;

        if (changed) {
          updateStmt.run(student);
          updated++;
        } else {
          skipped++;
        }
      } else {
        insertStmt.run(student);
        inserted++;
      }
    }
  });

  syncTransaction(studentList);

  db.close();

  log('INFO', `同步完成: 新增 ${inserted} 条, 更新 ${updated} 条, 跳过 ${skipped} 条`);
  return { inserted, updated, skipped };
}

// 清理临时文件
function cleanup() {
  // 暂时禁用清理以调试
}

// 主函数
async function main() {
  log('INFO', '=== SMB 学生名册同步开始 ===');

  let encryptedFile = null;
  let decryptedFile = null;

  try {
    // 1. 下载文件
    encryptedFile = downloadFromSMB();

    // 2. 解密文件
    decryptedFile = decryptExcel(encryptedFile);

    // 3. 解析 Excel
    const studentList = parseExcel(decryptedFile);

    // 4. 同步到数据库
    const result = syncToDatabase(studentList);

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
