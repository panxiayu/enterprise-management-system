const XLSX = require('xlsx');
const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

const dbPath = '/app/data/exam.db';
const excelCandidates = [
  '/home/openclaw/tmp/工作服领用管理总表.xlsx',
  '/tmp/工作服领用管理总表.xlsx',
  path.join(__dirname, '../uploads/工作服领用管理总表.xlsx'),
  path.join(__dirname, '../uploads/workwear-management-source.xlsx')
];

function excelDateToISO(serial) {
  if (!serial || typeof serial !== 'number') return null;
  const parsed = XLSX.SSF.parse_date_code(serial);
  if (!parsed || !parsed.y || !parsed.m || !parsed.d) return null;
  return `${parsed.y}-${String(parsed.m).padStart(2, '0')}-${String(parsed.d).padStart(2, '0')}`;
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

function normalizeText(value) {
  return String(value ?? '').trim();
}

function parseNumber(value, fallback = 0) {
  if (value == null || value === '' || value === '-') return fallback;
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function normalizeRatio(value) {
  let ratio = parseNumber(value, 0);
  if (ratio > 0 && ratio <= 1) ratio *= 100;
  return ratio;
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

function buildItemNameCandidates(rawName, rawUnit) {
  const name = normalizeText(rawName);
  const unit = normalizeText(rawUnit);
  if (!name) return [];
  if (name.startsWith('鞋') || unit.includes('双')) {
    return Array.from(new Set(['鞋', '安全鞋', name]));
  }
  return [name];
}

const excelPath = excelCandidates.find((candidate) => fs.existsSync(candidate));
if (!excelPath) {
  throw new Error('未找到工服领用管理总表.xlsx 数据源');
}

const workbook = XLSX.readFile(excelPath, { cellDates: false });
const worksheet = workbook.Sheets['领用录入'];
if (!worksheet) {
  throw new Error('未找到工作表：领用录入');
}

const rows = XLSX.utils.sheet_to_json(worksheet, { header: 1, raw: true, defval: null });
const db = new Database(dbPath);

const ensureColumn = () => {
  const columns = db.prepare(`PRAGMA table_info(workwear_records)`).all();
  if (!columns.some((column) => column.name === 'hire_date')) {
    db.exec(`ALTER TABLE workwear_records ADD COLUMN hire_date TEXT`);
  }
  if (!columns.some((column) => column.name === 'leave_date')) {
    db.exec(`ALTER TABLE workwear_records ADD COLUMN leave_date TEXT`);
  }
};

ensureColumn();

const selectStmt = db.prepare(`
  SELECT id
  FROM workwear_records
  WHERE status = 'active'
    AND TRIM(COALESCE(staff_name, '')) = ?
    AND TRIM(COALESCE(department, '')) = ?
    AND TRIM(COALESCE(position, '')) = ?
    AND TRIM(COALESCE(issue_date, '')) = ?
    AND TRIM(COALESCE(model, '')) = ?
    AND COALESCE(quantity, 0) = ?
    AND TRIM(COALESCE(item_name, '')) = ?
`);

const updateStmt = db.prepare(`
  UPDATE workwear_records
  SET hire_date = ?, leave_date = ?, deduction_ratio = ?, deduction = ?, updated_at = datetime('now', 'localtime')
  WHERE id = ?
`);

let sourceCount = 0;
let matchedCount = 0;
let updatedCount = 0;
const misses = [];

const run = db.transaction(() => {
  for (let i = 4; i < rows.length; i += 1) {
    const row = rows[i] || [];
    const leaveDate = parseDateCell(row[17]);
    const staffName = normalizeText(row[4]);
    if (!staffName || staffName === '领用人') continue;
    if (!leaveDate && row[14] == null && row[14] !== 0) continue;
    sourceCount += 1;

    const hireDate = parseDateCell(row[5]);
    const department = normalizeText(row[6]);
    const position = normalizeText(row[7]);
    const issueDate = parseDateCell(row[8]);
    const model = normalizeText(row[11]);
    const quantity = Number(row[13] || 0);
    const unitPrice = parseNumber(row[12], 0);
    const selfPurchase = parseNumber(row[16], 0);
    const sourceRatio = normalizeRatio(row[14]);
    const ratio = selfPurchase > 0
      ? 0
      : (!leaveDate ? 0 : (sourceRatio > 0 ? sourceRatio : calculateLeaveDeductionRatio(hireDate, leaveDate)));
    const deduction = selfPurchase > 0 ? 0 : Number((unitPrice * quantity * (ratio / 100)).toFixed(2));
    const itemCandidates = buildItemNameCandidates(row[9], row[10]);

    let ids = [];
    for (const itemName of itemCandidates) {
      ids = selectStmt.all(staffName, department, position, issueDate, model, quantity, itemName);
      if (ids.length) break;
    }

    if (!ids.length) {
      misses.push({
        row: i + 1,
        staff_name: staffName,
        issue_date: issueDate,
        item_name: normalizeText(row[9]),
        model,
        leave_date: leaveDate
      });
      continue;
    }

    matchedCount += ids.length;
    ids.forEach((entry) => {
      updateStmt.run(hireDate, leaveDate, ratio, deduction, entry.id);
      updatedCount += 1;
    });
  }
});

run();

console.log(JSON.stringify({
  sourceCount,
  matchedCount,
  updatedCount,
  missCount: misses.length,
  misses: misses.slice(0, 20)
}, null, 2));
