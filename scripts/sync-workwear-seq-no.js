// scripts/sync-workwear-seq-no.js
// 从源表「领用录入」D 列(seq_no)同步到数据库 workwear_records.seq_no
// 按 (staff_name, issue_date, item_name, model) 匹配回填

const XLSX = require('xlsx');
const path = require('path');

const excelPath = process.env.SEQ_NO_EXCEL_PATH || '/tmp/工作服领用管理总表-最新.xlsx';

console.log('📂 读取源 Excel:', excelPath);
const wb = XLSX.readFile(excelPath);
const ws = wb.Sheets['领用录入'];
if (!ws) {
  console.error('❌ 源表没有「领用录入」sheet');
  process.exit(1);
}
const rawData = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });

function excelDateToISO(serial) {
  if (!serial || typeof serial !== 'number') return null;
  const d = new Date((serial - 25569) * 86400 * 1000);
  return d.toISOString().slice(0, 10);
}

function parseItem(rawName, rawModel, rawUnit) {
  const name = rawName ? String(rawName).trim() : '';
  const model = rawModel ? String(rawModel).trim() : '';
  if (name.startsWith('鞋') || (rawUnit && String(rawUnit).includes('双'))) {
    return { item_name: '安全鞋', item_type: '工鞋', model: model || name.replace('鞋', '') };
  }
  return { item_name: name, item_type: '工服', model };
}

function normalizeModel(model) {
  return String(model || '').trim().replace(/码$/i, '').toUpperCase();
}

// 解析源表 D 列(seq_no) 与 (staff_name, issue_date, model) 的对应关系
// 兼容:同一员工同一天领多件时用 model 区分(item_name 在源/库可能不一致)
const sourceMap = new Map();
const sourceOrder = [];
let seqMin = null;
let seqMax = null;
let rowCount = 0;
for (let i = 4; i < rawData.length; i++) {
  const row = rawData[i];
  if (!row[4]) continue;
  const staffName = String(row[4]).trim();
  if (!staffName || staffName === '领用人') continue;
  const issueDate = excelDateToISO(row[8]);
  if (!issueDate) continue;
  const seqNo = Number(row[3]);
  if (!Number.isFinite(seqNo) || seqNo <= 0) continue;
  const { model } = parseItem(row[9], row[11], row[10]);
  const key = `${staffName}|${issueDate}|${normalizeModel(model)}`;
  sourceMap.set(key, seqNo);
  sourceOrder.push({ key, seqNo });
  rowCount += 1;
  if (seqMin === null || seqNo < seqMin) seqMin = seqNo;
  if (seqMax === null || seqNo > seqMax) seqMax = seqNo;
}
console.log(`✅ 源表解析: ${rowCount} 行(seq_no ${seqMin ?? '-'} ~ ${seqMax ?? '-'})`);

// 连接数据库(优先容器内)
const Database = require('better-sqlite3');
let db;
try {
  db = new Database('/app/data/exam.db');
  console.log('📦 容器内数据库');
} catch (e) {
  db = new Database(path.resolve(__dirname, '../data/exam.db'));
  console.log('📦 本地数据库');
}

// 先把 active 记录按 (staff_name, issue_date, item_name, model) 取出
const records = db.prepare(`
  SELECT id, staff_name, issue_date, item_name, model, seq_no
  FROM workwear_records
  WHERE status = 'active'
`).all();
console.log(`📊 数据库 active 记录: ${records.length} 条`);

const updateStmt = db.prepare(`UPDATE workwear_records SET seq_no = ? WHERE id = ?`);
const tx = db.transaction((rows) => {
  for (const r of rows) {
    updateStmt.run(r.seq_no, r.id);
  }
});

let matched = 0;
let unmatched = 0;
const unmatchedSamples = [];
const updates = [];
for (const r of records) {
  const key = `${r.staff_name}|${r.issue_date}|${normalizeModel(r.model)}`;
  const seq = sourceMap.get(key);
  if (seq) {
    updates.push({ id: r.id, seq_no: seq });
    matched += 1;
  } else {
    unmatched += 1;
    if (unmatchedSamples.length < 5) {
      unmatchedSamples.push(`  - id=${r.id} ${r.issue_date} ${r.staff_name} item=${r.item_name} model=${r.model}`);
    }
  }
}

tx(updates);
console.log(`✅ 已回填 ${matched} 条; 未匹配 ${unmatched} 条`);
if (unmatchedSamples.length) {
  console.log('❓ 未匹配示例(前 5 条):');
  unmatchedSamples.forEach((s) => console.log(s));
}