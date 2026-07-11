// scripts/snapshot-workwear-missing-2026-06-18.js
// 对比 Excel 与系统 workwear_records 表，导入 2026-06-18 起缺失的领用明细作为快照
//
// 用法：
//   1) 本地：node scripts/snapshot-workwear-missing-2026-06-18.js
//   2) 容器内：node scripts/snapshot-workwear-missing-2026-06-18.js
// 数据库路径优先使用 /app/data/exam.db（容器），回退到 ../data/exam.db（本地）

const XLSX = require('xlsx');
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const EXCEL_CANDIDATES = [
  process.env.WORKWEAR_EXCEL_PATH,
  '/home/openclaw/tmp/工作服领用管理总表-最新.xlsx',
  '/tmp/工作服领用管理总表-最新.xlsx',
  '/home/openclaw/tmp/工作服领用管理总表.xlsx',
  '/tmp/工作服领用管理总表.xlsx'
].filter(Boolean);
const SINCE_DATE = process.env.SINCE_DATE || '2026-06-18';
const DRY_RUN = process.argv.includes('--dry-run');

function resolveDbPath() {
  const candidates = ['/app/data/exam.db', path.resolve(__dirname, '../data/exam.db')];
  for (const p of candidates) {
    if (!fs.existsSync(p)) continue;
    // 跳过已知损坏的本地副本
    if (p.endsWith('data/exam.db') && !p.startsWith('/app/')) {
      try {
        const Database = require('better-sqlite3');
        const probe = new Database(p, { readonly: true });
        probe.prepare('SELECT 1').get();
        probe.close();
        return p;
      } catch (err) {
        console.warn(`⚠️  跳过损坏的本地数据库：${p} (${err.message})`);
        continue;
      }
    }
    return p;
  }
  throw new Error('未找到可用的 exam.db，请确认数据库路径');
}

function excelDateToISO(serial) {
  if (!serial || typeof serial !== 'number') return null;
  const parsed = XLSX.SSF.parse_date_code(serial);
  if (!parsed || !parsed.y || !parsed.m || !parsed.d) return null;
  return `${parsed.y}-${String(parsed.m).padStart(2, '0')}-${String(parsed.d).padStart(2, '0')}`;
}

function normalizeText(v) {
  return String(v ?? '').trim();
}

function normalizeKey(s) {
  return String(s ?? '').replace(/\s+/g, '');
}

// 鞋类名归一化：把 `鞋 45`、`鞋45`、`鞋` 等合并成 `鞋|45` 形式便于匹配
function normalizeShoeKey(itemName, model) {
  const combined = normalizeKey(itemName);
  if (combined.startsWith('鞋')) {
    return ['鞋', normalizeKey(combined.slice(1)) || normalizeKey(model)];
  }
  return [normalizeKey(itemName), normalizeKey(model)];
}

// 解析单行 Excel 数据为入库结构（鞋类保留历史 item='鞋' 的写法以与系统既有记录兼容）
function parseExcelRow(row) {
  const staff = normalizeText(row[4]);
  if (!staff || staff === '领用人') return null;
  const issueDate = excelDateToISO(row[8]);
  if (!issueDate || issueDate < SINCE_DATE) return null;

  const hireDate = excelDateToISO(row[5]);
  const department = normalizeText(row[6]);
  const position = normalizeText(row[7]);
  const unit = normalizeText(row[10]);
  const rawItem = normalizeText(row[9]);
  const rawModel = row[11] != null ? String(row[11]).trim() : '';

  const isShoe = rawItem.startsWith('鞋') || unit.includes('双');
  const itemName = isShoe ? '鞋' : rawItem;
  const model = isShoe ? (rawItem.replace(/^鞋/, '').trim() || rawModel) : rawModel;

  const quantity = Number(row[13] || 0);
  const unitPrice = Number(row[12] || 0);
  const selfPurchase = Number(row[16] || 0);
  const sourceRatio = Number(row[14] || 0);
  const leaveDate = excelDateToISO(row[17]);
  const remark = normalizeText(row[18]) || null;

  // 入职未满1年80%、满1年50%、满2年0%
  let ratio = 0;
  if (selfPurchase <= 0 && leaveDate && hireDate) {
    const hire = new Date(`${hireDate}T00:00:00`);
    const leave = new Date(`${leaveDate}T00:00:00`);
    if (!Number.isNaN(hire.getTime()) && !Number.isNaN(leave.getTime()) && leave >= hire) {
      let years = leave.getFullYear() - hire.getFullYear();
      if (leave.getMonth() < hire.getMonth() || (leave.getMonth() === hire.getMonth() && leave.getDate() < hire.getDate())) {
        years -= 1;
      }
      if (years < 1) ratio = 80;
      else if (years < 2) ratio = 50;
      else ratio = 0;
    }
  }
  if (sourceRatio > 0) ratio = sourceRatio;

  const deduction = selfPurchase > 0 ? 0 : Number((unitPrice * quantity * (ratio / 100)).toFixed(2));

  return {
    staff_name: staff,
    department,
    position,
    hire_date: hireDate,
    leave_date: leaveDate,
    issue_date: issueDate,
    item_name: itemName,
    item_type: isShoe ? '工鞋' : '工服',
    model,
    quantity,
    unit_price: unitPrice,
    self_purchase: selfPurchase,
    deduction,
    deduction_ratio: ratio,
    remark,
    source: 'snapshot',
    source_no: row[3] || null
  };
}

function buildKey(record) {
  const [item, model] = normalizeShoeKey(record.item_name, record.model);
  const staffName = record.staff_name || record.staff || '';
  return [
    normalizeKey(staffName),
    normalizeKey(record.issue_date),
    item,
    model,
    String(record.quantity)
  ].join('|');
}

function main() {
  const excelPath = EXCEL_CANDIDATES.find((p) => fs.existsSync(p));
  if (!excelPath) {
    throw new Error(`未找到 Excel 文件，请将文件放到以下任一位置：\n${EXCEL_CANDIDATES.join('\n')}`);
  }
  const dbPath = resolveDbPath();
  console.log(`📦 数据库路径：${dbPath}`);
  console.log(`📂 Excel 文件：${excelPath}`);
  console.log(`🔎 起始日期：${SINCE_DATE}${DRY_RUN ? '（DRY-RUN，不会写入）' : ''}`);

  const workbook = XLSX.readFile(excelPath, { cellDates: false });
  const ws = workbook.Sheets['领用录入'];
  if (!ws) throw new Error('未找到工作表：领用录入');
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null });

  const excelRecords = [];
  for (let i = 4; i < rows.length; i += 1) {
    const parsed = parseExcelRow(rows[i] || []);
    if (parsed) excelRecords.push({ ...parsed, _row: i + 1 });
  }
  console.log(`📊 Excel >= ${SINCE_DATE} 有效记录：${excelRecords.length} 条`);

  const db = new Database(dbPath);
  const existing = db.prepare(`
    SELECT staff_name, issue_date, item_name, model, quantity
    FROM workwear_records
    WHERE status = 'active'
      AND issue_date >= ?
  `).all(SINCE_DATE);

  const dbKeys = new Set(existing.map((row) => {
    const [item, model] = normalizeShoeKey(row.item_name, row.model);
    return [
      normalizeKey(row.staff_name),
      normalizeKey(row.issue_date),
      item,
      model,
      String(row.quantity)
    ].join('|');
  }));
  console.log(`📦 系统已有 active 记录：${existing.length} 条`);
  if (process.env.DEBUG_KEYS) {
    console.log('DB keys:', Array.from(dbKeys));
    console.log('Excel keys:', excelRecords.map(buildKey));
  }

  const staffRows = db.prepare(`SELECT id, name, department, position FROM staff WHERE status = 'active'`).all();
  const staffMap = new Map();
  staffRows.forEach((row) => {
    if (!staffMap.has(row.name)) staffMap.set(row.name, row);
  });

  const missing = [];
  const skipped = [];
  for (const r of excelRecords) {
    const key = buildKey({ ...r });
    if (dbKeys.has(key)) continue;
    const staff = staffMap.get(r.staff_name);
    if (!staff) {
      skipped.push({ ...r, reason: 'staff_not_found' });
      continue;
    }
    missing.push({ ...r, staff_id: staff.id });
  }

  console.log(`\n🚧 缺失待导入：${missing.length} 条；跳过：${skipped.length} 条`);
  if (skipped.length) {
    console.log('  跳过明细：');
    skipped.forEach((s) => console.log('   -', JSON.stringify(s)));
  }
  if (!missing.length) {
    console.log('✅ 没有缺失记录，无需导入');
    db.close();
    return;
  }

  console.log('\n📝 待导入明细：');
  missing.forEach((m, idx) => {
    console.log(`  ${idx + 1}. ${m.issue_date} | ${m.staff_name} (id=${m.staff_id}) | ${m.item_name} ${m.model} × ${m.quantity} | 自购=${m.self_purchase} | 单价=${m.unit_price}`);
  });

  if (DRY_RUN) {
    console.log('\n🧪 DRY-RUN 模式，未写入数据库');
    db.close();
    return;
  }

  const insertStmt = db.prepare(`
    INSERT INTO workwear_records (
      staff_id, staff_name, hire_date, department, position, leave_date, issue_date,
      item_name, item_type, model, quantity, unit_price, deduction,
      self_purchase, deduction_ratio, remark, status,
      created_by, created_by_name
    ) VALUES (
      @staff_id, @staff_name, @hire_date, @department, @position, @leave_date, @issue_date,
      @item_name, @item_type, @model, @quantity, @unit_price, @deduction,
      @self_purchase, @deduction_ratio, @remark, 'active',
      NULL, '快照导入'
    )
  `);

  const tx = db.transaction((items) => {
    for (const r of items) insertStmt.run(r);
  });

  tx(missing);

  const inserted = db.prepare(`
    SELECT id, staff_name, department, position, issue_date, item_name, model, quantity, unit_price,
           self_purchase, deduction_ratio, deduction, hire_date, leave_date
    FROM workwear_records
    WHERE status = 'active' AND issue_date >= ?
    ORDER BY issue_date, staff_name, id
  `).all(SINCE_DATE);

  console.log(`\n✅ 已写入 ${missing.length} 条；当前 ${SINCE_DATE} 起 active 记录共 ${inserted.length} 条`);
  inserted.forEach((row) => {
    console.log(`  #${row.id} ${row.issue_date} | ${row.staff_name} | ${row.item_name} ${row.model} × ${row.quantity}`);
  });

  db.close();
  console.log('\n🎉 完成');
}

try {
  main();
} catch (err) {
  console.error('❌ 失败：', err.message);
  console.error(err.stack);
  process.exit(1);
}