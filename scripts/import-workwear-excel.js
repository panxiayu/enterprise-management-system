// scripts/import-workwear-excel.js
// 从Excel导入工服领用记录到数据库

const XLSX = require('xlsx');
const path = require('path');

const excelPath = '/home/openclaw/tmp/工作服领用管理总表-最新.xlsx';

console.log('📂 读取Excel文件:', excelPath);
const wb = XLSX.readFile(excelPath);
const ws = wb.Sheets['领用录入'];
const rawData = XLSX.utils.sheet_to_json(ws, { header: 1 });

console.log('📊 总行数:', rawData.length);

// Excel日期序列号转ISO日期字符串
function excelDateToISO(serial) {
  if (!serial || typeof serial !== 'number') return null;
  const d = new Date((serial - 25569) * 86400 * 1000);
  return d.toISOString().slice(0, 10);
}

function parseDateCell(value) {
  if (value == null || value === '' || value === '-') return null;
  if (typeof value === 'number') return excelDateToISO(value);
  const text = String(value).trim();
  if (!text) return null;
  const normalized = text.replace(/\./g, '/').replace(/-/g, '/');
  const parts = normalized.split('/').map((item) => Number(item));
  if (parts.length !== 3 || parts.some((item) => !Number.isFinite(item) || item <= 0)) {
    return null;
  }
  const [year, month, day] = parts;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function calculateLeaveDeductionRatio(hireDate, leaveDate) {
  if (!hireDate || !leaveDate) return 0;
  const hire = new Date(`${hireDate}T00:00:00`);
  const leave = new Date(`${leaveDate}T00:00:00`);
  if (Number.isNaN(hire.getTime()) || Number.isNaN(leave.getTime())) return 0;
  if (leave.getTime() < hire.getTime()) return 0;

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

// 解析物品名称 -> { item_name, item_type, model }
function parseItem(rawName, rawModel, rawUnit) {
  if (!rawName) return { item_name: '', item_type: '工服', model: '' };
  const name = String(rawName).trim();
  const model = rawModel ? String(rawModel).trim() : '';
  
  // 鞋类
  if (name.startsWith('鞋') || (rawUnit && String(rawUnit).includes('双'))) {
    return { item_name: '安全鞋', item_type: '工鞋', model: model || name.replace('鞋', '') };
  }
  
  // 其他全部是工服类
  return { item_name: name, item_type: '工服', model: model };
}

// 解析数值
function parseNum(val, defaultVal = 0) {
  if (val === null || val === undefined || val === '' || val === '-') return defaultVal;
  const n = Number(val);
  return isNaN(n) ? defaultVal : n;
}

// 提取数据行（从索引4开始，跳过标题行）
const records = [];
for (let i = 4; i < rawData.length; i++) {
  const row = rawData[i];
  if (!row[4]) continue; // 跳过空行（没有领用人）

  const staffName = String(row[4]).trim();
  if (!staffName || staffName === '领用人') continue;

  const issueDate = excelDateToISO(row[8]);
  if (!issueDate) continue; // 没有领用日期的跳过

  const { item_name, item_type, model } = parseItem(row[9], row[11], row[10]);
  const unitPrice = parseNum(row[12]);
  const quantity = parseNum(row[13], 1);
  const hireDate = parseDateCell(row[5]);
  const leaveDate = parseDateCell(row[17]);

  // 扣款比例（可能是百分比数值，如50表示50%）
  let deductRatio = parseNum(row[14]);
  if (deductRatio > 0 && deductRatio <= 1) deductRatio = deductRatio * 100; // 0.5 -> 50

  // 自购
  const selfPurchase = parseNum(row[16]);

  if (selfPurchase > 0) {
    deductRatio = 0;
  } else if (!leaveDate) {
    deductRatio = 0;
  } else if (deductRatio <= 0) {
    deductRatio = calculateLeaveDeductionRatio(hireDate, leaveDate);
  }
  const deduction = selfPurchase > 0
    ? 0
    : Math.round(unitPrice * quantity * (deductRatio / 100) * 100) / 100;

  // 备注
  const remark = row[18] ? String(row[18]).trim() : null;

  // D 列(数组下标 3) 是源表的 NO 列,公式 = ROW()-4
  const seqNo = parseNum(row[3]);

  records.push({
    seq_no: seqNo > 0 ? Math.floor(seqNo) : null,
    staff_name: staffName,
    hire_date: hireDate,
    department: row[6] ? String(row[6]).trim() : null,
    position: row[7] ? String(row[7]).trim() : null,
    leave_date: leaveDate,
    issue_date: issueDate,
    item_name,
    item_type,
    model,
    quantity,
    unit_price: unitPrice,
    deduction: Math.round(deduction * 100) / 100,
    self_purchase: selfPurchase,
    deduction_ratio: deductRatio,
    remark
  });
}

console.log(`✅ 解析完成，共 ${records.length} 条有效记录`);

// 统计
const deptSet = new Set(records.map(r => r.department).filter(Boolean));
const yearSet = new Set(records.map(r => r.issue_date.slice(0, 4)));
console.log(`📁 涉及部门: ${deptSet.size} 个`);
console.log(`📅 年份跨度: ${[...yearSet].sort().join(', ')}`);

// 导入到数据库
const Database = require('better-sqlite3');
const dbPath = path.resolve(__dirname, '../data/exam.db');

// 使用容器内的数据库路径（如果运行在容器内）
let db;
try {
  // 先尝试直接打开
  db = new Database('/app/data/exam.db');
  console.log('📦 使用容器内数据库: /app/data/exam.db');
} catch (e) {
  try {
    db = new Database(dbPath);
    console.log('📦 使用本地数据库:', dbPath);
  } catch (e2) {
    console.error('❌ 无法打开数据库:', e2.message);
    process.exit(1);
  }
}

// 确保表存在
db.exec(`
  CREATE TABLE IF NOT EXISTS workwear_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    staff_id INTEGER,
    staff_name TEXT NOT NULL,
    department TEXT,
    position TEXT,
    issue_date TEXT NOT NULL,
    item_name TEXT NOT NULL,
    item_type TEXT DEFAULT '工服',
    model TEXT,
    quantity INTEGER DEFAULT 1,
    unit_price REAL DEFAULT 0,
    deduction REAL DEFAULT 0,
    self_purchase REAL DEFAULT 0,
    deduction_ratio REAL DEFAULT 50,
    leave_date TEXT,
    remark TEXT,
    status TEXT DEFAULT 'active',
    created_by INTEGER,
    created_by_name TEXT,
    created_at DATETIME DEFAULT (datetime('now', 'localtime')),
    updated_at DATETIME DEFAULT (datetime('now', 'localtime')),
    seq_no INTEGER
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS workwear_inventory (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    item_name TEXT NOT NULL,
    item_type TEXT DEFAULT '工服',
    model TEXT,
    quantity INTEGER DEFAULT 0,
    min_stock INTEGER DEFAULT 5,
    unit_price REAL DEFAULT 0,
    remark TEXT,
    updated_at DATETIME DEFAULT (datetime('now', 'localtime')),
    UNIQUE(item_name, model)
  )
`);

// 先清除旧的示例数据
const oldCount = db.prepare('SELECT COUNT(*) as c FROM workwear_records').get().c;
console.log(`🗑️  清除旧记录: ${oldCount} 条`);
db.prepare("UPDATE workwear_records SET status = 'archived' WHERE status = 'active'").run();

// 批量插入
const insertStmt = db.prepare(`
  INSERT INTO workwear_records (
    staff_name, hire_date, department, position, leave_date, issue_date,
    item_name, item_type, model, quantity,
    unit_price, deduction, self_purchase,
    deduction_ratio, remark, status, seq_no
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)
`);

const insertMany = db.transaction((rows) => {
  for (const r of rows) {
    insertStmt.run(
      r.staff_name, r.hire_date, r.department, r.position, r.leave_date, r.issue_date,
      r.item_name, r.item_type, r.model, r.quantity,
      r.unit_price, r.deduction, r.self_purchase,
      r.deduction_ratio, r.remark, r.seq_no
    );
  }
});

insertMany(records);
console.log(`✅ 已导入 ${records.length} 条领用记录`);

// 从"基础-物品信息"sheet导入库存信息（如果有的话）
const wsItems = wb.Sheets['基础-物品信息'];
if (wsItems) {
  const itemsData = XLSX.utils.sheet_to_json(wsItems, { header: 1 });
  const inventoryItems = [];
  for (let i = 4; i < itemsData.length; i++) {
    const row = itemsData[i];
    if (!row[4]) continue; // 没有物品名称就跳过
    const itemName = String(row[4]).trim();
    const itemModel = row[6] !== undefined ? String(row[6]).trim() : '';
    const itemPrice = parseNum(row[7]);
    const itemType = itemName.includes('鞋') ? '工鞋' : '工服';
    inventoryItems.push({ item_name: itemName, item_type: itemType, model: itemModel, unit_price: itemPrice });
  }
  
  if (inventoryItems.length > 0) {
    const upsertStmt = db.prepare(`
      INSERT OR REPLACE INTO workwear_inventory (item_name, item_type, model, quantity, min_stock, unit_price)
      VALUES (?, ?, ?, COALESCE(
        (SELECT quantity FROM workwear_inventory WHERE item_name = ? AND model = ?), 0
      ), 5, ?)
    `);
    
    const upsertMany = db.transaction((items) => {
      for (const item of items) {
        upsertStmt.run(item.item_name, item.item_type, item.model, item.item_name, item.model, item.unit_price);
      }
    });
    
    upsertMany(inventoryItems);
    console.log(`✅ 已导入 ${inventoryItems.length} 条物品基础信息`);
  }
}

// 查看导入结果
const newCount = db.prepare("SELECT COUNT(*) as c FROM workwear_records WHERE status = 'active'").get().c;
const invCount = db.prepare('SELECT COUNT(*) as c FROM workwear_inventory').get().c;
console.log(`\n📊 导入完成!`);
console.log(`  - 领用记录: ${newCount} 条`);
console.log(`  - 物品信息: ${invCount} 条`);

db.close();
console.log('✅ 完成!');
