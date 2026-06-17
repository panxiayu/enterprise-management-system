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
    share: process.env.SMB_SHARE || '办公部门数据盘$',  // 共享名（不含路径）
    subdir: process.env.SMB_SUBDIR || '行政部/行政部共享数据',  // 子目录
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
  if (!serial || typeof serial !== 'number') return null;
  // Excel 日期从 1900-01-01 开始（序列号 1），但 Excel 有个 bug 把 1900 当作闰年，所以需要减 1
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
  
  // 建立列索引映射
  const header = data[headerRow];
  const colMap = {
    serial: header.indexOf('序号'),
    status: header.indexOf('状态'),
    leaveDate: header.indexOf('离职日期'),
    seniority: header.indexOf('工龄'),
    oa: header.indexOf('OA'),
    employeeId: header.indexOf('工号'),
    hireDate: header.indexOf('入职日期'),
    name: header.indexOf('姓名'),
    department: header.indexOf('部门'),
    team: header.indexOf('班组'),
    position: header.indexOf('职位'),
    employer: header.indexOf('所属单位'),
    phone: header.indexOf('联系电话'),
    officePhone: header.indexOf('办公室座机'),
    virtualPhone: header.indexOf('虚拟座机'),
    idCard: header.indexOf('身份证号码'),
    idValidity: header.indexOf('有效期限'),
    gender: header.indexOf('性别'),
    birthday: header.indexOf('出生年月'),
    age: header.indexOf('年龄'),
    nationality: header.indexOf('民族'),
    household: header.indexOf('户口'),
    address: header.indexOf('家庭住址'),
    currentAddress: header.indexOf('现居住地址'),
    education: header.indexOf('学历'),
    major: header.indexOf('专业'),
    graduateSchool: header.indexOf('毕业院校'),
    graduateDate: header.indexOf('毕业时间'),
    trialPeriod: header.indexOf('试用期限'),
    trialEvalDate: header.indexOf('试用期评价日期'),
    confirmed: header.indexOf('是否转正'),
    confirmedDate: header.indexOf('转正日期'),
    contractSigned: header.indexOf('是否已签合同'),
    nda: header.indexOf('保密协议'),
    nonCompete: header.indexOf('竞业协议'),
    contractPeriod: header.indexOf('合同期限'),
    jobChangeRecord: header.indexOf('调岗调薪记录'),
    category: header.indexOf('类别'),
    insuranceStartDate: header.indexOf('缴纳日期'),
    insuranceEndDate: header.indexOf('停缴日期'),
    emergencyContact: header.indexOf('姓名.1'),
    emergencyRelation: header.indexOf('与本人关系'),
    emergencyPhone: header.indexOf('紧急联系电话'),
    carPlate: header.indexOf('车牌号'),
    otherInfo: header.indexOf('其他信息'),
    bankAccount: header.indexOf('工资卡账号'),
    bankName: header.indexOf('开户行'),
    bankBranch: header.indexOf('开户支行'),
    bankCode: header.indexOf('行号')
  };
  
  log('INFO', `找到 ${Object.keys(colMap).length} 个字段映射`);
  
  // 解析数据行
  const staffList = [];
  for (let i = headerRow + 1; i < data.length; i++) {
    const row = data[i];
    
    // 跳过空行
    if (!row || !row[colMap.name]) continue;

    // 处理状态：在职=active，离职=inactive
    let status = colMap.status >= 0 ? row[colMap.status] : '';
    if (status === '离职') {
        status = 'inactive';
    } else {
        status = 'active'; // 默认或在职都设为active
    }

    const employeeId = colMap.employeeId >= 0 ? String(row[colMap.employeeId] || '').trim() : '';
    const name = colMap.name >= 0 ? String(row[colMap.name] || '').trim() : '';

    // 工号必须存在
    if (!employeeId || !name) continue;

    staffList.push({
      serial: colMap.serial >= 0 ? String(row[colMap.serial] || '').trim() : '',
      employee_id: employeeId,
      name: name,
      phone: colMap.phone >= 0 ? String(row[colMap.phone] || '').trim() : '',
      department: colMap.department >= 0 ? String(row[colMap.department] || '').trim() : '',
      team: colMap.team >= 0 ? String(row[colMap.team] || '').trim() : '',
      position: colMap.position >= 0 ? String(row[colMap.position] || '').trim() : '',
      hire_date: colMap.hireDate >= 0 ? excelSerialToDate(row[colMap.hireDate]) : null,
      id_card: colMap.idCard >= 0 ? String(row[colMap.idCard] || '').trim() : '',
      gender: colMap.gender >= 0 ? String(row[colMap.gender] || '').trim() : '',
      birthday: colMap.birthday >= 0 ? String(row[colMap.birthday] || '').trim() : '',
      nationality: colMap.nationality >= 0 ? String(row[colMap.nationality] || '').trim() : '',
      household: colMap.household >= 0 ? String(row[colMap.household] || '').trim() : '',
      address: colMap.address >= 0 ? String(row[colMap.address] || '').trim() : '',
      current_address: colMap.currentAddress >= 0 ? String(row[colMap.currentAddress] || '').trim() : '',
      education: colMap.education >= 0 ? String(row[colMap.education] || '').trim() : '',
      major: colMap.major >= 0 ? String(row[colMap.major] || '').trim() : '',
      graduate_school: colMap.graduateSchool >= 0 ? String(row[colMap.graduateSchool] || '').trim() : '',
      contract_signed: colMap.contractSigned >= 0 ? String(row[colMap.contractSigned] || '').trim() : '',
      contract_period: colMap.contractPeriod >= 0 ? String(row[colMap.contractPeriod] || '').trim() : '',
      category: colMap.category >= 0 ? String(row[colMap.category] || '').trim() : '',
      bank_account: colMap.bankAccount >= 0 ? String(row[colMap.bankAccount] || '').trim() : '',
      status: status,
      // 新增字段
      leave_date: colMap.leaveDate >= 0 ? excelSerialToDate(row[colMap.leaveDate]) : null,
      seniority: colMap.seniority >= 0 ? String(row[colMap.seniority] || '').trim() : '',
      oa: colMap.oa >= 0 ? String(row[colMap.oa] || '').trim() : '',
      employer: colMap.employer >= 0 ? String(row[colMap.employer] || '').trim() : '',
      office_phone: colMap.officePhone >= 0 ? String(row[colMap.officePhone] || '').trim() : '',
      virtual_phone: colMap.virtualPhone >= 0 ? String(row[colMap.virtualPhone] || '').trim() : '',
      id_validity: colMap.idValidity >= 0 ? (typeof row[colMap.idValidity] === 'number' ? excelSerialToDate(row[colMap.idValidity]) : String(row[colMap.idValidity] || '').trim()) : '',
      age: colMap.age >= 0 ? String(row[colMap.age] || '').trim() : '',
      graduate_date: colMap.graduateDate >= 0 ? excelSerialToDate(row[colMap.graduateDate]) : null,
      trial_period: colMap.trialPeriod >= 0 ? String(row[colMap.trialPeriod] || '').trim() : '',
      trial_eval_date: colMap.trialEvalDate >= 0 ? excelSerialToDate(row[colMap.trialEvalDate]) : null,
      confirmed: colMap.confirmed >= 0 ? String(row[colMap.confirmed] || '').trim() : '',
      confirmed_date: colMap.confirmedDate >= 0 ? excelSerialToDate(row[colMap.confirmedDate]) : null,
      nda: colMap.nda >= 0 ? String(row[colMap.nda] || '').trim() : '',
      non_compete: colMap.nonCompete >= 0 ? String(row[colMap.nonCompete] || '').trim() : '',
      job_change_record: colMap.jobChangeRecord >= 0 ? String(row[colMap.jobChangeRecord] || '').trim() : '',
      insurance_start_date: colMap.insuranceStartDate >= 0 ? excelSerialToDate(row[colMap.insuranceStartDate]) : null,
      insurance_end_date: colMap.insuranceEndDate >= 0 ? excelSerialToDate(row[colMap.insuranceEndDate]) : null,
      emergency_contact: colMap.emergencyContact >= 0 ? String(row[colMap.emergencyContact] || '').trim() : '',
      emergency_relation: colMap.emergencyRelation >= 0 ? String(row[colMap.emergencyRelation] || '').trim() : '',
      emergency_phone: colMap.emergencyPhone >= 0 ? String(row[colMap.emergencyPhone] || '').trim() : '',
      car_plate: colMap.carPlate >= 0 ? String(row[colMap.carPlate] || '').trim() : '',
      other_info: colMap.otherInfo >= 0 ? String(row[colMap.otherInfo] || '').trim() : '',
      bank_name: colMap.bankName >= 0 ? String(row[colMap.bankName] || '').trim() : '',
      bank_branch: colMap.bankBranch >= 0 ? String(row[colMap.bankBranch] || '').trim() : '',
      bank_code: colMap.bankCode >= 0 ? String(row[colMap.bankCode] || '').trim() : ''
    });
  }
  
  log('INFO', `解析到 ${staffList.length} 条员工记录（含在职和离职）`);
  return staffList;
}

// 同步到数据库
function syncToDatabase(staffList) {
  log('INFO', '正在同步到数据库...');
  
  const db = new Database(CONFIG.db.path);
  
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
  
  let inserted = 0;
  let updated = 0;
  let skipped = []; // 已存在且无变化的员工
  const existingStaff = []; // 数据库中已存在的员工（用于后续比对）
  
  const insertStmt = db.prepare(`
    INSERT INTO staff (
      serial, employee_id, name, phone, department, team, position, hire_date,
      id_card, gender, birthday, nationality, household, address, current_address,
      education, major, graduate_school, contract_signed, contract_period,
      category, bank_account, status, exam_permission, meal_permission,
      leave_date, seniority, oa, employer, office_phone, virtual_phone,
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
      @leave_date, @seniority, @oa, @employer, @office_phone, @virtual_phone,
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

  const insertMany = db.transaction((list) => {
    for (const staff of list) {
      const exists = getStmt.get(staff.employee_id);
      if (exists) {
        existingStaff.push({ employee_id: staff.employee_id, name: staff.name });
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
          exists.leave_date !== staff.leave_date ||
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
        } else {
          // 已存在且无变化，记录为跳过
          skipped.push({ employee_id: staff.employee_id, name: staff.name });
        }
      } else {
        insertStmt.run(staff);
        inserted++;
      }
    }
  });

  insertMany(staffList);

  // 查找不在Excel中的员工（在数据库中但状态为active且不在同步列表中）
  // 注意：不修改数据库状态，只返回列表供前端展示红色提示
  const notInExcel = db.prepare('SELECT employee_id, name FROM staff WHERE status = ?').all('active');
  const syncedEmployeeIds = new Set(staffList.map(s => s.employee_id));
  const notInExcelList = notInExcel.filter(s => !syncedEmployeeIds.has(s.employee_id));

  db.close();

  log('INFO', `同步完成: 新增 ${inserted} 条, 更新 ${updated} 条, 跳过 ${skipped.length} 条, 未匹配 ${notInExcelList.length} 人`);
  return { inserted, updated, skipped, notInExcel: notInExcelList };
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
    
    // 2. 解密文件
    decryptedFile = decryptExcel(encryptedFile);
    
    // 3. 解析 Excel
    const staffList = parseExcel(decryptedFile);
    
    // 4. 同步到数据库
    const result = syncToDatabase(staffList);

    // 记录同步时间到数据库
    try {
      const http = require('http');
      const syncSecret = process.env.SYNC_SECRET || 'sync-secret-change-me';
      // 使用本地时间（东8区）
      const localTime = new Date();
      const syncedAt = localTime.getFullYear() + '-' +
        String(localTime.getMonth() + 1).padStart(2, '0') + '-' +
        String(localTime.getDate()).padStart(2, '0') + ' ' +
        String(localTime.getHours()).padStart(2, '0') + ':' +
        String(localTime.getMinutes()).padStart(2, '0') + ':' +
        String(localTime.getSeconds()).padStart(2, '0');
      const postData = JSON.stringify({ result: 'success', details: JSON.stringify(result), synced_at: syncedAt });
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
        // ignore response
      });
      req.on('error', () => {});
      req.write(postData);
      req.end();
    } catch (e) {}

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
