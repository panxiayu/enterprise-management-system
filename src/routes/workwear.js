const express = require('express');
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

const router = express.Router();
const db = require('../models/database');
const { authMiddleware } = require('../middleware/auth');
const { calculateAvailability, getIssueCategory } = require('../services/workwearRules');

const WORKWEAR_INVENTORY_XLSX_CANDIDATES = [
  '/home/openclaw/tmp/工作服领用管理总表.xlsx',
  '/tmp/工作服领用管理总表.xlsx',
  path.join(__dirname, '../../uploads/工作服领用管理总表.xlsx'),
  path.join(__dirname, '../../uploads/workwear-management-source.xlsx')
];

const WORKWEAR_SHEET_ITEMS = '基础-物品信息';
const WORKWEAR_SHEET_PURCHASES = '采购录入';
const WORKWEAR_SHEET_INVENTORY = '盘存2026';
const FIRST_REAL_MONTH = '2026-06';

function getWorkbookPath() {
  const workbookPath = WORKWEAR_INVENTORY_XLSX_CANDIDATES.find((candidate) => fs.existsSync(candidate));
  if (!workbookPath) {
    throw new Error('未找到工服领用管理总表.xlsx 数据源');
  }
  return workbookPath;
}

function readWorkbook() {
  return XLSX.readFile(getWorkbookPath(), { cellDates: false });
}

function getSheetRows(sheetName) {
  const workbook = readWorkbook();
  const worksheet = workbook.Sheets[sheetName];
  if (!worksheet) {
    throw new Error(`未找到工作表：${sheetName}`);
  }
  return XLSX.utils.sheet_to_json(worksheet, {
    header: 1,
    raw: false,
    defval: ''
  });
}

function normalizeText(value) {
  return String(value ?? '').trim();
}

const CATEGORY_ALIASES = new Map([
  ['安全鞋', '鞋'],
  ['劳保鞋', '鞋'],
  ['工鞋', '鞋']
]);

function canonicalizeCategory(value) {
  const category = normalizeText(value).replace(/\s+/g, '');
  if (!category) return '';
  return CATEGORY_ALIASES.get(category) || category;
}

function normalizeModel(value) {
  const model = normalizeText(value);
  return model === '-' ? '' : model;
}

function parseMoneyNumber(value) {
  const raw = normalizeText(value)
    .replace(/[￥¥,\s]/g, '')
    .replace(/[^0-9.-]/g, '');
  if (!raw) return 0;
  const numeric = Number(raw);
  return Number.isFinite(numeric) ? numeric : 0;
}

function parseInteger(value) {
  const raw = normalizeText(value).replace(/,/g, '');
  if (!raw) return 0;
  const numeric = Number(raw);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : 0;
}

function normalizeDate(value) {
  const raw = normalizeText(value);
  if (!raw) return '';
  const normalized = raw.replace(/\./g, '/').replace(/-/g, '/');
  const parts = normalized.split('/').map((item) => Number(item));
  if (parts.length !== 3 || parts.some((item) => !Number.isFinite(item) || item <= 0)) {
    return raw;
  }
  const [year, month, day] = parts;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function getLocalToday() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function getYearMonth(dateValue) {
  return normalizeText(dateValue).slice(0, 7);
}

function getCurrentYearMonth() {
  return getLocalToday().slice(0, 7);
}

function getPreviousYearMonth(yearMonth) {
  const [yearRaw, monthRaw] = String(yearMonth || '').split('-');
  const year = Number(yearRaw);
  const month = Number(monthRaw);
  if (!year || !month) return '';
  const date = new Date(year, month - 1, 1);
  date.setMonth(date.getMonth() - 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function compareYearMonth(a, b) {
  return normalizeText(a).localeCompare(normalizeText(b));
}

function getNextYearMonth(yearMonth) {
  const [yearRaw, monthRaw] = String(yearMonth || '').split('-');
  const year = Number(yearRaw);
  const month = Number(monthRaw);
  if (!year || !month) return '';
  const date = new Date(year, month - 1, 1);
  date.setMonth(date.getMonth() + 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function enumerateYearMonths(startYearMonth, endYearMonth) {
  const months = [];
  let cursor = normalizeText(startYearMonth);
  const end = normalizeText(endYearMonth);
  while (cursor && compareYearMonth(cursor, end) <= 0) {
    months.push(cursor);
    cursor = getNextYearMonth(cursor);
  }
  return months;
}

function parseNumberInput(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, Math.trunc(numeric));
}

function buildJsonResponseError(res, code, msg, status = 400) {
  return res.status(status).json({ code, msg, data: null });
}

function getInventorySheetColumnMap(rows) {
  const headerTop = rows[2] || [];
  const headerBottom = rows[3] || [];
  const openingByMonth = new Map();
  const monthlyByMonth = new Map();

  for (let index = 0; index < headerTop.length; index += 1) {
    const top = normalizeText(headerTop[index]);
    const bottom = normalizeText(headerBottom[index]);
    let matched;

    matched = top.match(/^(\d{1,2})月结转盘存$/);
    if (matched) {
      const carryMonth = Number(matched[1]);
      const openingMonth = carryMonth === 12 ? 1 : carryMonth + 1;
      openingByMonth.set(openingMonth, index);
      continue;
    }

    matched = top.match(/^(\d{1,2})月份$/);
    if (matched) {
      const month = Number(matched[1]);
      if (!monthlyByMonth.has(month)) monthlyByMonth.set(month, {});
      monthlyByMonth.get(month).in = index;
      continue;
    }

    if (!top && bottom && monthlyByMonth.size) {
      const months = Array.from(monthlyByMonth.keys()).sort((a, b) => a - b);
      const month = months[months.length - 1];
      const target = monthlyByMonth.get(month);
      if (bottom === '出库') target.out = index;
      if (bottom === '结存') target.closing = index;
    }
  }

  return { openingByMonth, monthlyByMonth };
}

function deriveCategory(itemName, model) {
  const name = normalizeText(itemName);
  const safeModel = normalizeModel(model);
  if (!name) return '';
  if (safeModel && name.endsWith(safeModel)) {
    return canonicalizeCategory(normalizeText(name.slice(0, name.length - safeModel.length)) || name);
  }
  return canonicalizeCategory(name);
}

function buildItemName(category, model) {
  const safeCategory = canonicalizeCategory(category);
  const safeModel = normalizeModel(model);
  return safeModel ? `${safeCategory}${safeModel}` : safeCategory;
}

function normalizeLegacySizeToken(value) {
  const token = normalizeText(value).toUpperCase();
  if (token === 'XXL') return '2XL';
  if (token === 'XXXL') return '3XL';
  return token;
}

function getRawItemNameAliases(rawName) {
  const value = normalizeText(rawName).replace(/\s+/g, '');
  if (!value) return [];
  const aliases = [value];

  const safetyShoeMatch = value.match(/^(?:安全鞋|劳保鞋|工鞋)(\d+)$/);
  if (safetyShoeMatch) {
    aliases.push(`鞋${safetyShoeMatch[1]}`);
  }

  const oldSummerMatch = value.match(/^夏([A-Za-z0-9]+)$/);
  if (oldSummerMatch) {
    const normalizedSize = normalizeLegacySizeToken(oldSummerMatch[1]);
    aliases.push(`车夏${normalizedSize}`);
    aliases.push(`老款夏${normalizedSize}`);
  }

  return Array.from(new Set(aliases));
}

function deriveItemType(category, unit) {
  const safeCategory = canonicalizeCategory(category);
  const safeUnit = normalizeText(unit);
  if (safeUnit === '双' || /鞋|靴/.test(safeCategory)) return '工鞋';
  if (safeUnit === '顶' || /帽|盔/.test(safeCategory)) return '劳保';
  return '工服';
}

function toItemKey(category, model) {
  return `${canonicalizeCategory(category)}::${normalizeModel(model)}`;
}

function getEmployeeStaffByUser(user) {
  if (!user || user.type !== 'employee') return null;
  const staff = db.prepare(`
    SELECT id, employee_id, name, department, position, hire_date, gender, status, workwear_permission
    FROM staff
    WHERE id = ?
    LIMIT 1
  `).get(Number(user.id || 0));
  if (staff) return staff;

  const student = db.prepare(`
    SELECT id, employee_id, name, department
    FROM student_roster
    WHERE id = ?
    LIMIT 1
  `).get(Number(user.id || 0));
  if (!student) return null;

  return {
    id: student.id,
    employee_id: student.employee_id,
    name: student.name,
    department: student.department || '',
    position: '实训生',
    hire_date: '',
    gender: '',
    status: 'active',
    workwear_permission: 0
  };
}

function ensureEmployee(req, res, next) {
  if (req.user?.type !== 'employee') {
    return buildJsonResponseError(res, -1, '仅员工可访问', 403);
  }
  const staff = getEmployeeStaffByUser(req.user);
  if (!staff || staff.status !== 'active') {
    return buildJsonResponseError(res, -1, '员工信息不存在或已停用', 403);
  }
  req.employeeStaff = staff;
  return next();
}

function ensureWorkwearPermission(req, res, next) {
  const staff = req.employeeStaff || getEmployeeStaffByUser(req.user);
  if (!staff || staff.status !== 'active') {
    return buildJsonResponseError(res, -1, '员工信息不存在或已停用', 403);
  }
  if (Number(staff.workwear_permission || 0) !== 1) {
    return buildJsonResponseError(res, -1, '暂无工服管理权限', 403);
  }
  req.employeeStaff = staff;
  return next();
}

function parseBaseItemsFromExcel() {
  const rows = getSheetRows(WORKWEAR_SHEET_ITEMS);
  return rows
    .slice(4)
    .map((row) => {
      const no = parseInteger(row[3]);
      const name = normalizeText(row[4]);
      const unit = normalizeText(row[5]);
      const model = normalizeModel(row[6]);
      const unitPrice = parseMoneyNumber(row[7]);
      const remark = normalizeText(row[8]);
      if (!name) return null;
      const category = deriveCategory(name, model);
      return {
        source_no: no || null,
        name,
        category,
        unit,
        model,
        unit_price: unitPrice,
        remark,
        item_type: deriveItemType(category, unit)
      };
    })
    .filter(Boolean);
}

function parsePurchaseEntriesFromExcel() {
  const rows = getSheetRows(WORKWEAR_SHEET_PURCHASES);
  return rows
    .slice(4)
    .map((row) => {
      const sourceNo = parseInteger(row[3]);
      const purchaseDate = normalizeDate(row[4]);
      const purchaser = normalizeText(row[5]);
      const name = normalizeText(row[6]);
      const unit = normalizeText(row[7]);
      const model = normalizeModel(row[8]);
      const unitPrice = parseMoneyNumber(row[9]);
      const quantity = parseInteger(row[10]);
      const amount = parseMoneyNumber(row[11]);
      const remark = normalizeText(row[12]);
      if (!purchaseDate || !name || !quantity) return null;
      const category = deriveCategory(name, model);
      return {
        source_ref: `excel-purchase-${sourceNo || `${purchaseDate}-${name}-${model}`}`,
        purchase_date: purchaseDate,
        purchaser,
        item_name: name,
        category,
        model,
        unit,
        unit_price: unitPrice,
        quantity,
        amount: amount || unitPrice * quantity,
        remark,
        item_type: deriveItemType(category, unit)
      };
    })
    .filter(Boolean);
}

function parseHistoricalInventoryFromExcel(year = 2026, endMonth = 5) {
  const rows = getSheetRows(WORKWEAR_SHEET_INVENTORY);
  const { openingByMonth, monthlyByMonth } = getInventorySheetColumnMap(rows);

  for (let month = 1; month <= endMonth + 1; month += 1) {
    if (!openingByMonth.has(month)) {
      throw new Error(`盘存表中未找到 ${month} 月期初结转列`);
    }
  }
  for (let month = 1; month <= endMonth; month += 1) {
    const monthly = monthlyByMonth.get(month) || {};
    if (![monthly.in, monthly.out, monthly.closing].every((index) => Number.isInteger(index))) {
      throw new Error(`盘存表中未找到 ${month} 月完整的入库/出库/结存列`);
    }
  }

  return rows
    .slice(4)
    .map((row, rowIndex) => {
      const itemName = normalizeText(row[3]);
      const unitPrice = parseMoneyNumber(row[4]);
      const unit = normalizeText(row[5]);
      if (!itemName) return null;
      const openings = {};
      const monthly = {};
      for (let month = 1; month <= endMonth + 1; month += 1) {
        openings[month] = parseInteger(row[openingByMonth.get(month)]);
      }
      for (let month = 1; month <= endMonth; month += 1) {
        const config = monthlyByMonth.get(month);
        monthly[month] = {
          in_qty: parseInteger(row[config.in]),
          out_qty: parseInteger(row[config.out]),
          closing_qty: parseInteger(row[config.closing])
        };
      }
      return {
        source_ref: `excel-history-${year}-${rowIndex + 4}`,
        year,
        raw_name: itemName,
        unit,
        unit_price: unitPrice,
        openings,
        monthly
      };
    })
    .filter(Boolean);
}

function loadActiveItems() {
  return db.prepare(`
    SELECT id, category, model, unit, unit_price, item_type, remark, min_stock
    FROM workwear_items
    WHERE is_active = 1
    ORDER BY id ASC
  `).all();
}

function buildItemLookup(items) {
  const map = new Map();
  items.forEach((item) => {
    map.set(toItemKey(item.category, item.model), item);
  });
  return map;
}

function ensureBaseItemsSeeded() {
  const count = db.prepare(`SELECT COUNT(*) AS count FROM workwear_items`).get().count || 0;
  if (count > 0) return;

  const items = parseBaseItemsFromExcel();
  const insert = db.prepare(`
    INSERT INTO workwear_items (
      source_no, category, model, unit, unit_price, item_type, remark, is_active, min_stock,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, 0, datetime('now', 'localtime'), datetime('now', 'localtime'))
  `);

  db.transaction(() => {
    items.forEach((item) => {
      insert.run(
        item.source_no,
        item.category,
        item.model,
        item.unit,
        item.unit_price,
        item.item_type,
        item.remark || null
      );
    });
  })();
}

function ensurePurchaseEntriesSeeded() {
  const count = db.prepare(`SELECT COUNT(*) AS count FROM workwear_purchase_entries`).get().count || 0;
  if (count > 0) return;

  const items = loadActiveItems();
  const itemLookup = buildItemLookup(items);
  const entries = parsePurchaseEntriesFromExcel();
  const insertEntry = db.prepare(`
    INSERT OR IGNORE INTO workwear_purchase_entries (
      source_ref, purchase_date, purchaser, item_id, item_name, category, model, unit,
      unit_price, quantity, amount, remark, item_type, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now', 'localtime'), datetime('now', 'localtime'))
  `);
  const insertException = db.prepare(`
    INSERT INTO workwear_inventory_exceptions (
      year_month, source_type, source_id, raw_category, raw_model, raw_name, quantity, reason, created_at
    ) VALUES (?, 'purchase_seed', ?, ?, ?, ?, ?, ?, datetime('now', 'localtime'))
  `);

  db.transaction(() => {
    entries.forEach((entry) => {
      const matchedItem = itemLookup.get(toItemKey(entry.category, entry.model));
      if (!matchedItem) {
        insertException.run(
          getYearMonth(entry.purchase_date),
          entry.source_ref,
          entry.category,
          entry.model,
          entry.item_name,
          entry.quantity,
          '采购记录无法匹配基础物品'
        );
        return;
      }
      insertEntry.run(
        entry.source_ref,
        entry.purchase_date,
        entry.purchaser || null,
        matchedItem.id,
        entry.item_name,
        entry.category,
        entry.model,
        entry.unit,
        entry.unit_price,
        entry.quantity,
        entry.amount,
        entry.remark || null,
        entry.item_type
      );
    });
  })();
}

function importHistoricalInventoryFromExcel(year = 2026, endMonth = 5) {
  const items = loadActiveItems();
  const itemLookup = buildItemLookup(items);
  const itemNameLookup = new Map(items.map((item) => [buildItemName(item.category, item.model), item]));
  const historyRows = parseHistoricalInventoryFromExcel(year, endMonth);
  const monthsToSeed = Array.from({ length: endMonth }, (_, index) => `${year}-${String(index + 1).padStart(2, '0')}`);
  const openingMonthsToSeed = Array.from({ length: endMonth + 1 }, (_, index) => `${year}-${String(index + 1).padStart(2, '0')}`);
  const clearOpenings = db.prepare(`DELETE FROM workwear_inventory_opening WHERE year_month = ?`);
  const clearMonthly = db.prepare(`DELETE FROM workwear_inventory_monthly WHERE year_month = ?`);
  const clearExceptions = db.prepare(`
    DELETE FROM workwear_inventory_exceptions
    WHERE year_month = ? AND source_type IN ('opening_import', 'historical_import')
  `);
  const insertOpening = db.prepare(`
    INSERT INTO workwear_inventory_opening (
      year_month, item_id, opening_qty, source_type, remark, created_at, updated_at
    ) VALUES (?, ?, ?, 'excel_opening', ?, datetime('now', 'localtime'), datetime('now', 'localtime'))
  `);
  const insertMonthly = db.prepare(`
    INSERT INTO workwear_inventory_monthly (
      year_month, item_id, opening_qty, in_qty, out_qty, closing_qty, computed_at, remark
    ) VALUES (?, ?, ?, ?, ?, ?, datetime('now', 'localtime'), ?)
  `);
  const insertException = db.prepare(`
    INSERT INTO workwear_inventory_exceptions (
      year_month, source_type, source_id, raw_category, raw_model, raw_name, quantity, reason, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now', 'localtime'))
  `);

  const openingMap = new Map();
  const monthlyMap = new Map();
  const ensureMonthMap = (targetMonth) => {
    const yearMonth = `${year}-${String(targetMonth).padStart(2, '0')}`;
    if (!monthlyMap.has(yearMonth)) monthlyMap.set(yearMonth, new Map());
    return monthlyMap.get(yearMonth);
  };

  items.forEach((item) => {
    for (let month = 1; month <= endMonth + 1; month += 1) {
      openingMap.set(`${year}-${String(month).padStart(2, '0')}:${item.id}`, 0);
      if (month <= endMonth) {
        ensureMonthMap(month).set(item.id, {
          opening_qty: 0,
          in_qty: 0,
          out_qty: 0,
          closing_qty: 0
        });
      }
    }
  });

  db.transaction(() => {
    openingMonthsToSeed.forEach((yearMonth) => {
      clearOpenings.run(yearMonth);
      clearExceptions.run(yearMonth);
    });
    monthsToSeed.forEach((yearMonth) => {
      clearMonthly.run(yearMonth);
    });

    historyRows.forEach((entry) => {
      const matchedByName = getRawItemNameAliases(entry.raw_name)
        .map((alias) => itemNameLookup.get(alias))
        .find(Boolean);
      const matchedItem = matchedByName || itemLookup.get(toItemKey(deriveCategory(entry.raw_name, ''), ''));
      if (!matchedItem) {
        for (let month = 1; month <= endMonth + 1; month += 1) {
          const yearMonth = `${year}-${String(month).padStart(2, '0')}`;
          const openingQty = Number(entry.openings[month] || 0);
          const monthData = entry.monthly[month];
          const quantity = monthData
            ? openingQty + Number(monthData.in_qty || 0) + Number(monthData.out_qty || 0) + Number(monthData.closing_qty || 0)
            : openingQty;
          if (!quantity) continue;
          insertException.run(
            yearMonth,
            month <= endMonth ? 'historical_import' : 'opening_import',
            entry.source_ref,
            deriveCategory(entry.raw_name, ''),
            '',
            entry.raw_name,
            quantity,
            '历史盘存无法匹配基础物品'
          );
        }
        return;
      }

      for (let month = 1; month <= endMonth + 1; month += 1) {
        const yearMonth = `${year}-${String(month).padStart(2, '0')}`;
        const openingQty = Number(entry.openings[month] || 0);
        openingMap.set(`${yearMonth}:${matchedItem.id}`, openingQty);
      }

      for (let month = 1; month <= endMonth; month += 1) {
        const yearMonth = `${year}-${String(month).padStart(2, '0')}`;
        const currentMap = monthlyMap.get(yearMonth);
        const current = currentMap.get(matchedItem.id) || {
          opening_qty: 0,
          in_qty: 0,
          out_qty: 0,
          closing_qty: 0
        };
        currentMap.set(matchedItem.id, {
          opening_qty: Number(entry.openings[month] || 0),
          in_qty: Number(entry.monthly[month]?.in_qty || 0),
          out_qty: Number(entry.monthly[month]?.out_qty || 0),
          closing_qty: Number(entry.monthly[month]?.closing_qty || 0)
        });
      }
    });

    openingMonthsToSeed.forEach((yearMonth) => {
      items.forEach((item) => {
        insertOpening.run(
          yearMonth,
          item.id,
          Number(openingMap.get(`${yearMonth}:${item.id}`) || 0),
          'excel_history'
        );
      });
    });

    monthsToSeed.forEach((yearMonth) => {
      const currentMap = monthlyMap.get(yearMonth) || new Map();
      items.forEach((item) => {
        const row = currentMap.get(item.id) || {
          opening_qty: Number(openingMap.get(`${yearMonth}:${item.id}`) || 0),
          in_qty: 0,
          out_qty: 0,
          closing_qty: 0
        };
        insertMonthly.run(
          yearMonth,
          item.id,
          Number(row.opening_qty || 0),
          Number(row.in_qty || 0),
          Number(row.out_qty || 0),
          Number(row.closing_qty || 0),
          Number(row.closing_qty || 0) < 0 ? '库存为负数' : 'excel_history'
        );
      });
    });
  })();
}

function ensureHistoricalInventorySeeded() {
  const count = db.prepare(`
    SELECT COUNT(*) AS count FROM workwear_inventory_monthly WHERE year_month IN ('2026-01', '2026-02', '2026-03', '2026-04', '2026-05')
  `).get().count || 0;
  if (count > 0) return;
  importHistoricalInventoryFromExcel(2026, 5);
}

function ensureWorkwearSeeds() {
  ensureBaseItemsSeeded();
  ensurePurchaseEntriesSeeded();
  ensureHistoricalInventorySeeded();
}

function findItemByNameModel(itemName, model) {
  const category = deriveCategory(itemName, model);
  return db.prepare(`
    SELECT id, category, model, unit, unit_price, item_type, min_stock
    FROM workwear_items
    WHERE is_active = 1 AND category = ? AND model = ?
    LIMIT 1
  `).get(category, normalizeModel(model));
}

function rebuildMonthlyInventory(yearMonth = FIRST_REAL_MONTH) {
  ensureWorkwearSeeds();
  const normalizedYearMonth = normalizeText(yearMonth) || FIRST_REAL_MONTH;
  if (compareYearMonth(normalizedYearMonth, FIRST_REAL_MONTH) < 0) {
    ensureHistoricalInventorySeeded();
    return { year_month: normalizedYearMonth, pending_opening: false };
  }

  const items = loadActiveItems();
  const itemLookup = buildItemLookup(items);
  const previousYearMonth = getPreviousYearMonth(normalizedYearMonth);
  const openingRows = db.prepare(`
    SELECT item_id, opening_qty
    FROM workwear_inventory_opening
    WHERE year_month = ?
  `).all(normalizedYearMonth);

  const openingMap = new Map();
  if (openingRows.length) {
    openingRows.forEach((row) => {
      openingMap.set(Number(row.item_id), Number(row.opening_qty) || 0);
    });
  } else if (previousYearMonth && normalizedYearMonth === FIRST_REAL_MONTH) {
    db.prepare(`
      SELECT item_id, closing_qty
      FROM workwear_inventory_monthly
      WHERE year_month = ?
    `).all(previousYearMonth).forEach((row) => {
      openingMap.set(Number(row.item_id), Number(row.closing_qty) || 0);
    });
  } else {
    db.prepare(`DELETE FROM workwear_inventory_monthly WHERE year_month = ?`).run(normalizedYearMonth);
    db.prepare(`DELETE FROM workwear_inventory_exceptions WHERE year_month = ?`).run(normalizedYearMonth);
    return {
      year_month: normalizedYearMonth,
      pending_opening: true,
      previous_year_month: previousYearMonth
    };
  }

  const purchaseRows = db.prepare(`
    SELECT id, purchase_date, item_id, item_name, category, model, quantity
    FROM workwear_purchase_entries
    WHERE substr(purchase_date, 1, 7) = ?
  `).all(normalizedYearMonth);

  const issueRows = db.prepare(`
    SELECT id, issue_date, item_name, model, quantity, self_purchase
    FROM workwear_records
    WHERE status = 'active' AND substr(issue_date, 1, 7) = ?
  `).all(normalizedYearMonth);

  const inMap = new Map();
  const outMap = new Map();
  const exceptions = [];

  const accumulate = (targetMap, itemId, qty) => {
    const current = Number(targetMap.get(itemId) || 0);
    targetMap.set(itemId, current + (Number(qty) || 0));
  };

  purchaseRows.forEach((row) => {
    const itemId = Number(row.item_id || 0);
    if (!itemId) {
      exceptions.push({
        source_type: 'purchase',
        source_id: String(row.id),
        raw_category: deriveCategory(row.item_name, row.model),
        raw_model: normalizeModel(row.model),
        raw_name: normalizeText(row.item_name),
        quantity: Number(row.quantity) || 0,
        reason: '采购记录缺少物品映射'
      });
      return;
    }
    accumulate(inMap, itemId, row.quantity);
  });

  issueRows.forEach((row) => {
    const rawCategory = deriveCategory(row.item_name, row.model);
    const rawModel = normalizeModel(row.model);
    const matchedItem = itemLookup.get(toItemKey(rawCategory, rawModel));
    if (!matchedItem) {
      exceptions.push({
        source_type: Number(row.self_purchase) > 0 ? 'self_purchase' : 'issue',
        source_id: String(row.id),
        raw_category: rawCategory,
        raw_model: rawModel,
        raw_name: normalizeText(row.item_name),
        quantity: Number(row.quantity) || 0,
        reason: '领用记录无法匹配基础物品'
      });
      return;
    }
    accumulate(outMap, matchedItem.id, row.quantity);
  });

  const clearMonthly = db.prepare(`DELETE FROM workwear_inventory_monthly WHERE year_month = ?`);
  const clearExceptions = db.prepare(`DELETE FROM workwear_inventory_exceptions WHERE year_month = ?`);
  const insertMonthly = db.prepare(`
    INSERT INTO workwear_inventory_monthly (
      year_month, item_id, opening_qty, in_qty, out_qty, closing_qty, computed_at, remark
    ) VALUES (?, ?, ?, ?, ?, ?, datetime('now', 'localtime'), ?)
  `);
  const insertException = db.prepare(`
    INSERT INTO workwear_inventory_exceptions (
      year_month, source_type, source_id, raw_category, raw_model, raw_name, quantity, reason, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now', 'localtime'))
  `);

  db.transaction(() => {
    clearMonthly.run(normalizedYearMonth);
    clearExceptions.run(normalizedYearMonth);

    items.forEach((item) => {
      const openingQty = Number(openingMap.get(item.id) || 0);
      const inQty = Number(inMap.get(item.id) || 0);
      const outQty = Number(outMap.get(item.id) || 0);
      const closingQty = openingQty + inQty - outQty;
      insertMonthly.run(
        normalizedYearMonth,
        item.id,
        openingQty,
        inQty,
        outQty,
        closingQty,
        closingQty < 0 ? '库存为负数' : null
      );
    });

    exceptions.forEach((item) => {
      insertException.run(
        normalizedYearMonth,
        item.source_type,
        item.source_id,
        item.raw_category,
        item.raw_model,
        item.raw_name,
        item.quantity,
        item.reason
      );
    });
  })();

  return { year_month: normalizedYearMonth, pending_opening: false };
}

function buildInventorySheetColumns() {
  const columns = [
    { key: 'item_name', top: '物品名称', bottom: '' },
    { key: 'unit_price', top: '单价', bottom: '' },
    { key: 'unit', top: '单位', bottom: '' },
    { key: 'carry_12', top: '12月结转盘存', bottom: '' }
  ];
  for (let month = 1; month <= 12; month += 1) {
    columns.push(
      { key: `month_${month}_in`, top: `${month}月份`, bottom: '入库' },
      { key: `month_${month}_out`, top: '', bottom: '出库' },
      { key: `month_${month}_closing`, top: '', bottom: '结存' }
    );
    if (month < 12) {
      columns.push({ key: `carry_${month}`, top: `${month}月结转盘存`, bottom: '' });
    }
  }
  return columns;
}

function buildInventorySheetPayload(targetYearMonth = FIRST_REAL_MONTH) {
  ensureWorkwearSeeds();
  const year = Number(String(targetYearMonth).slice(0, 4)) || Number(FIRST_REAL_MONTH.slice(0, 4));
  const items = loadActiveItems();
  const openingRows = db.prepare(`
    SELECT year_month, item_id, opening_qty
    FROM workwear_inventory_opening
    WHERE substr(year_month, 1, 4) = ?
  `).all(String(year));
  const monthlyRows = db.prepare(`
    SELECT year_month, item_id, opening_qty, in_qty, out_qty, closing_qty
    FROM workwear_inventory_monthly
    WHERE substr(year_month, 1, 4) = ?
  `).all(String(year));

  const openingMap = new Map();
  openingRows.forEach((row) => {
    openingMap.set(`${row.year_month}:${row.item_id}`, Number(row.opening_qty) || 0);
  });

  const monthlyMap = new Map();
  monthlyRows.forEach((row) => {
    monthlyMap.set(`${row.year_month}:${row.item_id}`, {
      opening_qty: Number(row.opening_qty) || 0,
      in_qty: Number(row.in_qty) || 0,
      out_qty: Number(row.out_qty) || 0,
      closing_qty: Number(row.closing_qty) || 0
    });
  });

  const columns = buildInventorySheetColumns();
  const formatMovementValue = (value) => {
    const numeric = Number(value) || 0;
    return numeric === 0 ? '' : String(numeric);
  };
  const rows = items.map((item) => {
    const row = [
      buildItemName(item.category, item.model),
      item.unit_price ? String(item.unit_price) : '0',
      item.unit || ''
    ];

    const januaryOpening = openingMap.get(`${year}-01:${item.id}`);
    row.push(String(januaryOpening || 0));

    for (let month = 1; month <= 12; month += 1) {
      const yearMonth = `${year}-${String(month).padStart(2, '0')}`;
      const monthly = monthlyMap.get(`${yearMonth}:${item.id}`) || {
        in_qty: 0,
        out_qty: 0,
        closing_qty: 0
      };
      row.push(
        formatMovementValue(monthly.in_qty),
        formatMovementValue(monthly.out_qty),
        String(monthly.closing_qty || 0)
      );
      if (month < 12) {
        const nextYearMonth = `${year}-${String(month + 1).padStart(2, '0')}`;
        const carryValue = openingMap.has(`${nextYearMonth}:${item.id}`)
          ? Number(openingMap.get(`${nextYearMonth}:${item.id}`) || 0)
          : Number(monthly.closing_qty || 0);
        row.push(String(carryValue));
      }
    }
    return row;
  });

  return {
    sheet_name: `真实盘存${year}`,
    title: `真实库存盘存（${year}）`,
    columns,
    rows
  };
}

function getMonthlyInventoryRows(yearMonth) {
  return db.prepare(`
    SELECT
      m.id,
      m.year_month,
      i.id AS item_id,
      i.category,
      i.model,
      i.unit,
      i.unit_price,
      i.item_type,
      i.min_stock,
      m.opening_qty,
      m.in_qty,
      m.out_qty,
      m.closing_qty,
      m.computed_at,
      m.remark
    FROM workwear_inventory_monthly m
    JOIN workwear_items i ON i.id = m.item_id
    WHERE m.year_month = ? AND i.is_active = 1
    ORDER BY i.id ASC
  `).all(yearMonth).map((row) => ({
    ...row,
    item_name: buildItemName(row.category, row.model)
  }));
}

const COUNT_LOCATION_DEFS = [
  { code: 'admin_storage', name: '行政储藏室' },
  { code: 'admin_office', name: '行政办公室' }
];

function getLatestHistoryRowsForStaff(staffId, staffName) {
  const recordParams = [staffId, staffName || ''];
  const recordWhere = `
    status = 'active'
    AND (
      staff_id = ?
      OR (
        staff_id IS NULL
        AND TRIM(COALESCE(staff_name, '')) = TRIM(COALESCE(?, ''))
      )
    )
  `;

  const issueRows = db.prepare(`
    SELECT id, issue_date, item_name, model, quantity, self_purchase, department, position, remark
    FROM workwear_records
    WHERE ${recordWhere}
    ORDER BY issue_date ASC, id ASC
  `).all(...recordParams);

  const recentRows = db.prepare(`
    SELECT id, issue_date, item_name, model, quantity, self_purchase, department, position, remark
    FROM workwear_records
    WHERE ${recordWhere}
    ORDER BY issue_date DESC, id DESC
  `).all(...recordParams);

  return { issueRows, recentRows };
}

function buildEntitlementPayloadForStaff(staff) {
  const { issueRows, recentRows } = getLatestHistoryRowsForStaff(staff.id, staff.name || '');
  const recentByCategory = { summer: null, winter: null, shoes: null };

  recentRows.forEach((row) => {
    const category = getIssueCategory(row.item_name);
    if (category && !recentByCategory[category]) {
      recentByCategory[category] = {
        item_name: row.item_name || '',
        model: row.model || '',
        issue_date: row.issue_date || '',
        quantity: Number(row.quantity) || 0,
        self_purchase: Number(row.self_purchase || 0) > 0
      };
    }
  });

  const availability = calculateAvailability({
    position: staff.position,
    hireDate: staff.hire_date,
    referenceDate: getLocalToday(),
    issueRows
  });

  return {
    staff: {
      id: staff.id,
      employee_id: staff.employee_id || '',
      name: staff.name || '',
      department: staff.department || '',
      position: staff.position || '',
      hire_date: staff.hire_date || '',
      gender: staff.gender || '',
      workwear_permission: Number(staff.workwear_permission || 0)
    },
    rule_key: availability.ruleKey || '',
    rule_label: availability.ruleLabel || '',
    rule_matched: availability.matched,
    available: availability.available,
    details: availability.details,
    recent_by_category: recentByCategory,
    history: recentRows.slice(0, 30).map((row) => ({
      id: row.id,
      issue_date: row.issue_date || '',
      item_name: row.item_name || '',
      model: row.model || '',
      quantity: Number(row.quantity) || 0,
      self_purchase: Number(row.self_purchase || 0) > 0,
      remark: row.remark || ''
    }))
  };
}

function resolveDepartmentApprover(departmentName) {
  const department = normalizeText(departmentName);
  if (!department) return null;

  const configured = db.prepare(`
    SELECT approver_staff_id AS id, approver_name AS name
    FROM workwear_department_approvers
    WHERE department_name = ? AND is_active = 1
    LIMIT 1
  `).get(department);
  if (configured?.id) return { id: Number(configured.id), name: configured.name || '' };

  const candidates = db.prepare(`
    SELECT id, name, position
    FROM staff
    WHERE status = 'active'
      AND TRIM(COALESCE(department, '')) = TRIM(COALESCE(?, ''))
      AND (
        position LIKE '%部长%'
        OR position LIKE '%主管%'
        OR position LIKE '%组长%'
        OR position LIKE '%科长%'
        OR position LIKE '%领班%'
      )
    ORDER BY
      CASE
        WHEN position LIKE '%部长%' THEN 1
        WHEN position LIKE '%主管%' THEN 2
        WHEN position LIKE '%科长%' THEN 3
        WHEN position LIKE '%组长%' THEN 4
        WHEN position LIKE '%领班%' THEN 5
        ELSE 9
      END,
      id ASC
  `).all(department);

  const first = candidates[0];
  return first ? { id: Number(first.id), name: first.name || '' } : null;
}

function getPendingCountMonths() {
  const currentYearMonth = getCurrentYearMonth();
  const lastClosedMonth = getPreviousYearMonth(currentYearMonth);
  if (!lastClosedMonth || compareYearMonth(lastClosedMonth, FIRST_REAL_MONTH) < 0) {
    return [FIRST_REAL_MONTH];
  }
  return enumerateYearMonths(FIRST_REAL_MONTH, lastClosedMonth);
}

function getDefaultInventoryCountMonth() {
  const months = getPendingCountMonths();
  const completed = new Set(db.prepare(`
    SELECT closing_month
    FROM workwear_inventory_count_sessions
    WHERE status = 'completed'
  `).all().map((row) => row.closing_month));
  return months.find((month) => !completed.has(month)) || months[months.length - 1] || FIRST_REAL_MONTH;
}

function ensureInventoryCountSession(closingMonth, employeeStaff) {
  const normalizedClosingMonth = normalizeText(closingMonth);
  const existing = db.prepare(`
    SELECT *
    FROM workwear_inventory_count_sessions
    WHERE closing_month = ?
    LIMIT 1
  `).get(normalizedClosingMonth);
  if (existing) return existing;

  const monthlyRows = getMonthlyInventoryRows(normalizedClosingMonth);
  if (!monthlyRows.length) {
    throw new Error('该月份暂无可盘点的系统结存，请先完成上月结转盘存');
  }

  const openingMonth = getNextYearMonth(normalizedClosingMonth);
  const insertSession = db.prepare(`
    INSERT INTO workwear_inventory_count_sessions (
      closing_month, opening_month, created_by, created_by_name, created_by_department, status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, 'counting', datetime('now', 'localtime'), datetime('now', 'localtime'))
  `);
  const insertItem = db.prepare(`
    INSERT INTO workwear_inventory_count_items (
      session_id, item_id, department_name, system_closing_qty, manual_total_qty, difference_qty, status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, 0, 0, 'draft', datetime('now', 'localtime'), datetime('now', 'localtime'))
  `);
  const insertLocation = db.prepare(`
    INSERT INTO workwear_inventory_count_locations (
      count_item_id, location_code, location_name, quantity, created_at, updated_at
    ) VALUES (?, ?, ?, 0, datetime('now', 'localtime'), datetime('now', 'localtime'))
  `);

  const sessionId = db.transaction(() => {
    const result = insertSession.run(
      normalizedClosingMonth,
      openingMonth,
      employeeStaff.id,
      employeeStaff.name || '',
      employeeStaff.department || ''
    );
    const newSessionId = Number(result.lastInsertRowid);
    monthlyRows.forEach((row) => {
      const itemResult = insertItem.run(
        newSessionId,
        row.item_id,
        employeeStaff.department || '',
        Number(row.closing_qty) || 0
      );
      const countItemId = Number(itemResult.lastInsertRowid);
      COUNT_LOCATION_DEFS.forEach((location) => {
        insertLocation.run(countItemId, location.code, location.name);
      });
    });
    return newSessionId;
  })();

  return db.prepare(`
    SELECT *
    FROM workwear_inventory_count_sessions
    WHERE id = ?
    LIMIT 1
  `).get(sessionId);
}

function getInventoryCountSessionPayload(closingMonth, employeeStaff) {
  const session = ensureInventoryCountSession(closingMonth, employeeStaff);
  const locationRows = db.prepare(`
    SELECT
      ci.id AS count_item_id,
      ci.item_id,
      ci.system_closing_qty,
      ci.manual_total_qty,
      ci.difference_qty,
      ci.remark,
      ci.status,
      ci.approver_name,
      ci.review_comment,
      ci.confirmed_at,
      i.category,
      i.model,
      i.unit,
      l.location_code,
      l.location_name,
      l.quantity
    FROM workwear_inventory_count_items ci
    JOIN workwear_items i ON i.id = ci.item_id
    JOIN workwear_inventory_count_locations l ON l.count_item_id = ci.id
    WHERE ci.session_id = ?
    ORDER BY i.id ASC, l.id ASC
  `).all(session.id);

  const itemMap = new Map();
  locationRows.forEach((row) => {
    if (!itemMap.has(row.count_item_id)) {
      itemMap.set(row.count_item_id, {
        count_item_id: row.count_item_id,
        item_id: row.item_id,
        item_name: buildItemName(row.category, row.model),
        category: row.category || '',
        model: row.model || '',
        unit: row.unit || '',
        system_closing_qty: Number(row.system_closing_qty) || 0,
        manual_total_qty: Number(row.manual_total_qty) || 0,
        difference_qty: Number(row.difference_qty) || 0,
        remark: row.remark || '',
        status: row.status || 'draft',
        approver_name: row.approver_name || '',
        review_comment: row.review_comment || '',
        confirmed_at: row.confirmed_at || '',
        locations: []
      });
    }
    itemMap.get(row.count_item_id).locations.push({
      code: row.location_code,
      name: row.location_name,
      quantity: Number(row.quantity) || 0
    });
  });

  const items = Array.from(itemMap.values());
  const totals = {
    total: items.length,
    confirmed: items.filter((item) => item.status === 'confirmed').length,
    pending_review: items.filter((item) => item.status === 'pending_manager_review').length,
    rejected: items.filter((item) => item.status === 'rejected').length
  };

  return {
    session: {
      id: session.id,
      closing_month: session.closing_month,
      opening_month: session.opening_month,
      status: session.status,
      created_by_name: session.created_by_name || '',
      created_by_department: session.created_by_department || '',
      completed_at: session.completed_at || ''
    },
    items,
    totals,
    available_months: getPendingCountMonths(),
    default_month: getDefaultInventoryCountMonth()
  };
}

function recalculateCountItem(itemId) {
  const locationRows = db.prepare(`
    SELECT quantity
    FROM workwear_inventory_count_locations
    WHERE count_item_id = ?
  `).all(itemId);
  const totalQty = locationRows.reduce((sum, row) => sum + (Number(row.quantity) || 0), 0);
  const item = db.prepare(`
    SELECT system_closing_qty
    FROM workwear_inventory_count_items
    WHERE id = ?
    LIMIT 1
  `).get(itemId);
  const diffQty = totalQty - (Number(item?.system_closing_qty) || 0);
  db.prepare(`
    UPDATE workwear_inventory_count_items
    SET manual_total_qty = ?, difference_qty = ?, updated_at = datetime('now', 'localtime')
    WHERE id = ?
  `).run(totalQty, diffQty, itemId);
  return { totalQty, diffQty };
}

function rebuildInventoryChainFrom(yearMonth) {
  const currentYearMonth = getCurrentYearMonth();
  for (const month of enumerateYearMonths(yearMonth, currentYearMonth)) {
    const result = rebuildMonthlyInventory(month);
    if (result?.pending_opening) break;
  }
}

router.get('/access', authMiddleware, ensureEmployee, (req, res) => {
  res.json({
    code: 0,
    data: {
      can_manage: Number(req.employeeStaff.workwear_permission || 0) === 1,
      can_query: true,
      workwear_permission: Number(req.employeeStaff.workwear_permission || 0)
    }
  });
});

router.get('/my-entitlement', authMiddleware, ensureEmployee, (req, res) => {
  try {
    res.json({
      code: 0,
      data: {
        can_manage: Number(req.employeeStaff.workwear_permission || 0) === 1,
        ...buildEntitlementPayloadForStaff(req.employeeStaff)
      }
    });
  } catch (err) {
    console.error('获取本人工服查询失败:', err);
    res.status(500).json({ code: -1, msg: '获取本人工服查询失败', error: err.message });
  }
});

router.get('/inventory-count/default-month', authMiddleware, ensureEmployee, ensureWorkwearPermission, (req, res) => {
  res.json({
    code: 0,
    data: {
      default_month: getDefaultInventoryCountMonth(),
      available_months: getPendingCountMonths()
    }
  });
});

router.get('/inventory-count', authMiddleware, ensureEmployee, ensureWorkwearPermission, (req, res) => {
  try {
    const closingMonth = normalizeText(req.query.closing_month) || getDefaultInventoryCountMonth();
    const monthlyResult = rebuildMonthlyInventory(closingMonth);
    if (monthlyResult?.pending_opening) {
      return res.status(400).json({
        code: -1,
        msg: `缺少 ${monthlyResult.previous_year_month || getPreviousYearMonth(closingMonth)} 结转盘存生成的期初，暂不能盘点该月份`,
        data: {
          pending_opening: true,
          closing_month: closingMonth
        }
      });
    }
    res.json({ code: 0, data: getInventoryCountSessionPayload(closingMonth, req.employeeStaff) });
  } catch (err) {
    console.error('获取盘点会话失败:', err);
    res.status(500).json({ code: -1, msg: err.message || '获取盘点会话失败', error: err.message });
  }
});

router.put('/inventory-count/items/:id', authMiddleware, ensureEmployee, ensureWorkwearPermission, (req, res) => {
  try {
    const itemId = Number(req.params.id || 0);
    if (!itemId) {
      return buildJsonResponseError(res, -1, '缺少盘点项ID');
    }

    const item = db.prepare(`
      SELECT ci.id, ci.status, cs.status AS session_status
      FROM workwear_inventory_count_items ci
      JOIN workwear_inventory_count_sessions cs ON cs.id = ci.session_id
      WHERE ci.id = ?
      LIMIT 1
    `).get(itemId);
    if (!item) {
      return buildJsonResponseError(res, -1, '盘点项不存在', 404);
    }
    if (item.session_status === 'completed') {
      return buildJsonResponseError(res, -1, '该月份结转已完成，不能再修改');
    }

    const updateLocation = db.prepare(`
      UPDATE workwear_inventory_count_locations
      SET quantity = ?, updated_at = datetime('now', 'localtime')
      WHERE count_item_id = ? AND location_code = ?
    `);
    const locations = Array.isArray(req.body.locations) ? req.body.locations : [];
    locations.forEach((location) => {
      updateLocation.run(parseNumberInput(location.quantity), itemId, normalizeText(location.code));
    });

    const remark = req.body.remark !== undefined ? normalizeText(req.body.remark) : null;
    const recalculated = recalculateCountItem(itemId);
    db.prepare(`
      UPDATE workwear_inventory_count_items
      SET remark = COALESCE(?, remark),
          status = CASE
            WHEN status IN ('confirmed', 'pending_manager_review', 'rejected') THEN 'draft'
            ELSE status
          END,
          approver_staff_id = CASE
            WHEN status IN ('pending_manager_review', 'rejected') THEN NULL
            ELSE approver_staff_id
          END,
          approver_name = CASE
            WHEN status IN ('pending_manager_review', 'rejected') THEN NULL
            ELSE approver_name
          END,
          review_comment = CASE
            WHEN status IN ('pending_manager_review', 'rejected') THEN NULL
            ELSE review_comment
          END,
          updated_at = datetime('now', 'localtime')
      WHERE id = ?
    `).run(remark, itemId);

    res.json({ code: 0, msg: '盘点数量已保存', data: recalculated });
  } catch (err) {
    console.error('保存盘点项失败:', err);
    res.status(500).json({ code: -1, msg: '保存盘点项失败', error: err.message });
  }
});

router.post('/inventory-count/items/:id/confirm', authMiddleware, ensureEmployee, ensureWorkwearPermission, (req, res) => {
  try {
    const itemId = Number(req.params.id || 0);
    const item = db.prepare(`
      SELECT ci.id, ci.difference_qty, ci.status, cs.status AS session_status
      FROM workwear_inventory_count_items ci
      JOIN workwear_inventory_count_sessions cs ON cs.id = ci.session_id
      WHERE ci.id = ?
      LIMIT 1
    `).get(itemId);
    if (!item) {
      return buildJsonResponseError(res, -1, '盘点项不存在', 404);
    }
    if (item.session_status === 'completed') {
      return buildJsonResponseError(res, -1, '该月份结转已完成');
    }
    if (Number(item.difference_qty || 0) !== 0) {
      return buildJsonResponseError(res, -1, '存在差异时请填写备注并提交主管审核');
    }

    db.prepare(`
      UPDATE workwear_inventory_count_items
      SET status = 'confirmed',
          submitted_by = ?,
          confirmed_at = datetime('now', 'localtime'),
          updated_at = datetime('now', 'localtime')
      WHERE id = ?
    `).run(req.employeeStaff.id, itemId);

    res.json({ code: 0, msg: '该项已确认' });
  } catch (err) {
    console.error('确认盘点项失败:', err);
    res.status(500).json({ code: -1, msg: '确认盘点项失败', error: err.message });
  }
});

router.post('/inventory-count/items/:id/submit-review', authMiddleware, ensureEmployee, ensureWorkwearPermission, (req, res) => {
  try {
    const itemId = Number(req.params.id || 0);
    const item = db.prepare(`
      SELECT ci.id, ci.remark, ci.difference_qty, ci.department_name, cs.status AS session_status
      FROM workwear_inventory_count_items ci
      JOIN workwear_inventory_count_sessions cs ON cs.id = ci.session_id
      WHERE ci.id = ?
      LIMIT 1
    `).get(itemId);
    if (!item) {
      return buildJsonResponseError(res, -1, '盘点项不存在', 404);
    }
    if (item.session_status === 'completed') {
      return buildJsonResponseError(res, -1, '该月份结转已完成');
    }
    if (Number(item.difference_qty || 0) === 0) {
      return buildJsonResponseError(res, -1, '无差异项目请直接确认');
    }

    const remark = normalizeText(req.body.remark || item.remark);
    if (!remark) {
      return buildJsonResponseError(res, -1, '存在差异时必须填写备注');
    }

    const approver = resolveDepartmentApprover(item.department_name || req.employeeStaff.department || '');
    if (!approver?.id) {
      return buildJsonResponseError(res, -1, '当前部门未配置主管审核人');
    }

    db.prepare(`
      UPDATE workwear_inventory_count_items
      SET remark = ?,
          status = 'pending_manager_review',
          approver_staff_id = ?,
          approver_name = ?,
          submitted_by = ?,
          submitted_at = datetime('now', 'localtime'),
          updated_at = datetime('now', 'localtime')
      WHERE id = ?
    `).run(remark, approver.id, approver.name || '', req.employeeStaff.id, itemId);

    res.json({ code: 0, msg: '已提交主管审核' });
  } catch (err) {
    console.error('提交主管审核失败:', err);
    res.status(500).json({ code: -1, msg: '提交主管审核失败', error: err.message });
  }
});

router.get('/inventory-count/review-tasks', authMiddleware, ensureEmployee, (req, res) => {
  try {
    const rows = db.prepare(`
      SELECT
        ci.id,
        cs.closing_month,
        cs.created_by_name,
        cs.created_by_department,
        i.category,
        i.model,
        i.unit,
        ci.system_closing_qty,
        ci.manual_total_qty,
        ci.difference_qty,
        ci.remark,
        ci.status,
        ci.submitted_at
      FROM workwear_inventory_count_items ci
      JOIN workwear_inventory_count_sessions cs ON cs.id = ci.session_id
      JOIN workwear_items i ON i.id = ci.item_id
      WHERE ci.status = 'pending_manager_review'
        AND ci.approver_staff_id = ?
      ORDER BY cs.closing_month ASC, i.id ASC
    `).all(req.employeeStaff.id).map((row) => ({
      ...row,
      item_name: buildItemName(row.category, row.model)
    }));
    res.json({ code: 0, data: rows });
  } catch (err) {
    console.error('获取差异审核任务失败:', err);
    res.status(500).json({ code: -1, msg: '获取差异审核任务失败', error: err.message });
  }
});

router.post('/inventory-count/items/:id/review', authMiddleware, ensureEmployee, (req, res) => {
  try {
    const itemId = Number(req.params.id || 0);
    const action = normalizeText(req.body.action);
    const comment = normalizeText(req.body.comment);
    const item = db.prepare(`
      SELECT id, approver_staff_id, status
      FROM workwear_inventory_count_items
      WHERE id = ?
      LIMIT 1
    `).get(itemId);
    if (!item) {
      return buildJsonResponseError(res, -1, '盘点项不存在', 404);
    }
    if (Number(item.approver_staff_id || 0) !== Number(req.employeeStaff.id || 0)) {
      return buildJsonResponseError(res, -1, '仅指定主管可审核该差异项', 403);
    }
    if (item.status !== 'pending_manager_review') {
      return buildJsonResponseError(res, -1, '当前状态不可审核');
    }
    if (!['approved', 'rejected'].includes(action)) {
      return buildJsonResponseError(res, -1, '审核动作无效');
    }
    if (action === 'rejected' && !comment) {
      return buildJsonResponseError(res, -1, '驳回时请填写意见');
    }

    db.prepare(`
      UPDATE workwear_inventory_count_items
      SET status = ?,
          reviewed_by = ?,
          reviewed_at = datetime('now', 'localtime'),
          review_result = ?,
          review_comment = ?,
          confirmed_at = CASE WHEN ? = 'approved' THEN datetime('now', 'localtime') ELSE confirmed_at END,
          updated_at = datetime('now', 'localtime')
      WHERE id = ?
    `).run(action === 'approved' ? 'confirmed' : 'rejected', req.employeeStaff.id, action, comment || null, action, itemId);

    res.json({ code: 0, msg: action === 'approved' ? '审核已通过' : '已驳回该差异项' });
  } catch (err) {
    console.error('审核差异项失败:', err);
    res.status(500).json({ code: -1, msg: '审核差异项失败', error: err.message });
  }
});

router.post('/inventory-count/:id/complete', authMiddleware, ensureEmployee, ensureWorkwearPermission, (req, res) => {
  try {
    const sessionId = Number(req.params.id || 0);
    const session = db.prepare(`
      SELECT *
      FROM workwear_inventory_count_sessions
      WHERE id = ?
      LIMIT 1
    `).get(sessionId);
    if (!session) {
      return buildJsonResponseError(res, -1, '盘点会话不存在', 404);
    }
    if (session.status === 'completed') {
      return buildJsonResponseError(res, -1, '该月份结转已完成');
    }

    const pending = db.prepare(`
      SELECT COUNT(*) AS count
      FROM workwear_inventory_count_items
      WHERE session_id = ?
        AND status != 'confirmed'
    `).get(sessionId);
    if (Number(pending?.count || 0) > 0) {
      return buildJsonResponseError(res, -1, '仍有未确认或待审核项目，不能完成本月结转');
    }

    const items = db.prepare(`
      SELECT item_id, manual_total_qty
      FROM workwear_inventory_count_items
      WHERE session_id = ?
      ORDER BY item_id ASC
    `).all(sessionId);

    const upsertOpening = db.prepare(`
      INSERT INTO workwear_inventory_opening (
        year_month, item_id, opening_qty, source_type, remark, created_at, updated_at
      ) VALUES (?, ?, ?, 'manual_count', ?, datetime('now', 'localtime'), datetime('now', 'localtime'))
      ON CONFLICT(year_month, item_id) DO UPDATE SET
        opening_qty = excluded.opening_qty,
        source_type = excluded.source_type,
        remark = excluded.remark,
        updated_at = datetime('now', 'localtime')
    `);

    db.transaction(() => {
      items.forEach((item) => {
        upsertOpening.run(
          session.opening_month,
          item.item_id,
          Number(item.manual_total_qty) || 0,
          `manual_count:${session.closing_month}`
        );
      });
      db.prepare(`
        UPDATE workwear_inventory_count_sessions
        SET status = 'completed',
            completed_by = ?,
            completed_at = datetime('now', 'localtime'),
            updated_at = datetime('now', 'localtime')
        WHERE id = ?
      `).run(req.employeeStaff.id, sessionId);
    })();

    rebuildInventoryChainFrom(session.opening_month);

    res.json({
      code: 0,
      msg: '本月结转盘存已完成，已生成下个月结转数据',
      data: {
        closing_month: session.closing_month,
        opening_month: session.opening_month
      }
    });
  } catch (err) {
    console.error('完成结转盘存失败:', err);
    res.status(500).json({ code: -1, msg: '完成结转盘存失败', error: err.message });
  }
});

router.get('/', (req, res) => {
  try {
    const {
      page = 1,
      limit = 50,
      search,
      staff_id,
      staff_name,
      department,
      position,
      date_from,
      date_to,
      type
    } = req.query;
    const offset = (page - 1) * limit;
    const parseMulti = (value) => String(value || '')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);

    let where = "WHERE status = 'active'";
    const params = [];

    if (search) {
      const normalizedSearch = String(search || '').trim().toLowerCase();
      where += `
        AND (
          staff_name LIKE ?
          OR item_name LIKE ?
          OR department LIKE ?
          OR position LIKE ?
          OR model LIKE ?
          OR issue_date LIKE ?
          OR COALESCE(remark, '') LIKE ?
          OR EXISTS (
            SELECT 1
            FROM staff s
            WHERE s.id = workwear_records.staff_id
              AND s.employee_id LIKE ?
          )
          OR EXISTS (
            SELECT 1
            FROM staff s
            WHERE workwear_records.staff_id IS NULL
              AND TRIM(COALESCE(s.name, '')) = TRIM(COALESCE(workwear_records.staff_name, ''))
              AND s.employee_id LIKE ?
          )
          OR (? IN ('zg', '自购') AND self_purchase > 0)
        )
      `;
      const searchPattern = `%${search}%`;
      params.push(
        searchPattern,
        searchPattern,
        searchPattern,
        searchPattern,
        searchPattern,
        searchPattern,
        searchPattern,
        searchPattern,
        searchPattern,
        normalizedSearch
      );
    }

    const numericStaffId = Number(staff_id || 0);
    const exactStaffName = normalizeText(staff_name);
    if (numericStaffId || exactStaffName) {
      const exactStaffClauses = [];
      if (numericStaffId) {
        exactStaffClauses.push('staff_id = ?');
        params.push(numericStaffId);
      }
      if (exactStaffName) {
        exactStaffClauses.push("(staff_id IS NULL AND TRIM(COALESCE(staff_name, '')) = TRIM(COALESCE(?, '')))");
        params.push(exactStaffName);
      }
      where += ` AND (${exactStaffClauses.join(' OR ')})`;
    }

    const departments = parseMulti(department);
    if (departments.length) {
      where += ` AND department IN (${departments.map(() => '?').join(',')})`;
      params.push(...departments);
    }

    const positions = parseMulti(position);
    if (positions.length) {
      const normalPositions = positions.filter((item) => item !== '__empty__');
      const positionClauses = [];
      if (normalPositions.length) {
        positionClauses.push(`position IN (${normalPositions.map(() => '?').join(',')})`);
        params.push(...normalPositions);
      }
      if (positions.includes('__empty__')) {
        positionClauses.push(`(position IS NULL OR TRIM(position) = '')`);
      }
      if (positionClauses.length) {
        where += ` AND (${positionClauses.join(' OR ')})`;
      }
    }

    if (date_from) {
      where += ' AND issue_date >= ?';
      params.push(date_from);
    }

    if (date_to) {
      where += ' AND issue_date <= ?';
      params.push(date_to);
    }

    const types = parseMulti(type);
    if (types.length) {
      const typeClauses = [];
      if (types.includes('夏工服')) {
        typeClauses.push("(item_type = '工服' AND item_name LIKE '%夏%')");
      }
      if (types.includes('冬工服')) {
        typeClauses.push("(item_type = '工服' AND item_name LIKE '%冬%')");
      }
      if (types.includes('劳保鞋')) {
        typeClauses.push("(item_type = '工鞋' OR item_name LIKE '%鞋%')");
      }
      if (typeClauses.length) {
        where += ` AND (${typeClauses.join(' OR ')})`;
      }
    }

    const countSql = `SELECT COUNT(*) as total FROM workwear_records ${where}`;
    const { total } = db.prepare(countSql).get(...params);

    const records = db.prepare(`
      SELECT * FROM workwear_records
      ${where}
      ORDER BY issue_date DESC, id DESC
      LIMIT ? OFFSET ?
    `).all(...params, parseInt(limit, 10), parseInt(offset, 10));

    const departmentPositions = {};
    const appendDepartmentPositions = (rows) => {
      rows.forEach((row) => {
        const dept = normalizeText(row.department);
        const pos = normalizeText(row.position);
        if (!dept) return;
        if (!departmentPositions[dept]) departmentPositions[dept] = new Set();
        if (pos) departmentPositions[dept].add(pos);
      });
    };

    appendDepartmentPositions(db.prepare(`
      SELECT DISTINCT TRIM(department) AS department, TRIM(position) AS position
      FROM staff
      WHERE department IS NOT NULL AND TRIM(department) != ''
      ORDER BY department, position
    `).all());

    appendDepartmentPositions(db.prepare(`
      SELECT DISTINCT TRIM(department) AS department, TRIM(position) AS position
      FROM workwear_records
      WHERE status = 'active' AND department IS NOT NULL AND TRIM(department) != ''
      ORDER BY department, position
    `).all());

    const preferredDepartmentOrder = [
      '总经办', '财务部', '行政部', '市场部', '项目部', '技术部',
      '品质部', '采购部', '生产部', '注塑部', '制品部', '迈卡蒂', '设计部'
    ];
    const preferredDepartmentIndex = new Map(preferredDepartmentOrder.map((name, index) => [name, index]));
    const departmentTree = Object.keys(departmentPositions)
      .sort((a, b) => {
        const aIndex = preferredDepartmentIndex.has(a) ? preferredDepartmentIndex.get(a) : Number.MAX_SAFE_INTEGER;
        const bIndex = preferredDepartmentIndex.has(b) ? preferredDepartmentIndex.get(b) : Number.MAX_SAFE_INTEGER;
        if (aIndex !== bIndex) return aIndex - bIndex;
        return a.localeCompare(b, 'zh-CN');
      })
      .map((name) => ({
        name,
        positions: Array.from(departmentPositions[name]).sort((a, b) => a.localeCompare(b, 'zh-CN'))
      }));

    res.json({
      code: 0,
      data: {
        list: records,
        total,
        page: parseInt(page, 10),
        limit: parseInt(limit, 10),
        department_tree: departmentTree
      }
    });
  } catch (err) {
    console.error('获取工服记录失败:', err);
    res.status(500).json({ code: -1, msg: '获取记录失败', error: err.message });
  }
});

router.get('/items', (req, res) => {
  try {
    ensureBaseItemsSeeded();
    const includeInactive = String(req.query.include_inactive || '1') === '1';
    const items = db.prepare(`
      SELECT id, source_no, category, model, unit, unit_price, item_type, remark, min_stock, is_active
      FROM workwear_items
      ${includeInactive ? '' : 'WHERE is_active = 1'}
      ORDER BY id ASC
    `).all().map((item) => ({
      id: item.id,
      no: item.source_no || item.id,
      name: buildItemName(item.category, item.model),
      category: item.category,
      model: item.model,
      unit: item.unit,
      price: Number(item.unit_price) || 0,
      item_type: item.item_type,
      remark: item.remark || '',
      min_stock: Number(item.min_stock) || 0,
      is_active: Number(item.is_active) === 1
    }));
    res.json({ code: 0, data: items });
  } catch (err) {
    console.error('获取基础物品失败:', err);
    res.status(500).json({ code: -1, msg: '获取基础物品失败', error: err.message });
  }
});

router.post('/items', (req, res) => {
  try {
    const category = normalizeText(req.body.category);
    const model = normalizeModel(req.body.model);
    const unit = normalizeText(req.body.unit);
    const remark = normalizeText(req.body.remark);
    const unitPrice = Number(req.body.unit_price ?? req.body.price ?? 0) || 0;
    const isActive = req.body.is_active === false || String(req.body.is_active) === '0' ? 0 : 1;
    if (!category || !unit) {
      return res.status(400).json({ code: -1, msg: '类别和单位为必填项' });
    }
    const exists = db.prepare(`
      SELECT id FROM workwear_items WHERE category = ? AND model = ? AND is_active = 1 LIMIT 1
    `).get(category, model);
    if (exists) {
      return res.status(400).json({ code: -1, msg: '该类别和型号已存在' });
    }
    const result = db.prepare(`
      INSERT INTO workwear_items (
        category, model, unit, unit_price, item_type, remark, is_active, min_stock,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, datetime('now', 'localtime'), datetime('now', 'localtime'))
    `).run(
      category,
      model,
      unit,
      unitPrice,
      deriveItemType(category, unit),
      remark || null,
      isActive
    );
    rebuildMonthlyInventory(FIRST_REAL_MONTH);
    res.json({ code: 0, msg: '新增物品成功', data: { id: result.lastInsertRowid } });
  } catch (err) {
    console.error('新增基础物品失败:', err);
    res.status(500).json({ code: -1, msg: '新增基础物品失败', error: err.message });
  }
});

router.put('/items/:id', (req, res) => {
  try {
    const id = Number(req.params.id || 0);
    const category = normalizeText(req.body.category);
    const model = normalizeModel(req.body.model);
    const unit = normalizeText(req.body.unit);
    const remark = normalizeText(req.body.remark);
    const unitPrice = Number(req.body.unit_price ?? req.body.price ?? 0) || 0;
    const isActive = req.body.is_active === false || String(req.body.is_active) === '0' ? 0 : 1;
    if (!id || !category || !unit) {
      return res.status(400).json({ code: -1, msg: '参数不完整' });
    }
    const item = db.prepare(`SELECT id FROM workwear_items WHERE id = ? LIMIT 1`).get(id);
    if (!item) {
      return res.status(404).json({ code: -1, msg: '物品不存在' });
    }
    const duplicated = db.prepare(`
      SELECT id FROM workwear_items
      WHERE id != ? AND category = ? AND model = ? AND is_active = 1
      LIMIT 1
    `).get(id, category, model);
    if (duplicated) {
      return res.status(400).json({ code: -1, msg: '该类别和型号已存在' });
    }
    db.prepare(`
      UPDATE workwear_items
      SET category = ?, model = ?, unit = ?, unit_price = ?, item_type = ?, remark = ?,
          is_active = ?,
          updated_at = datetime('now', 'localtime')
      WHERE id = ?
    `).run(
      category,
      model,
      unit,
      unitPrice,
      deriveItemType(category, unit),
      remark || null,
      isActive,
      id
    );
    rebuildMonthlyInventory(FIRST_REAL_MONTH);
    res.json({ code: 0, msg: isActive ? '保存成功' : '物品已停用' });
  } catch (err) {
    console.error('编辑基础物品失败:', err);
    res.status(500).json({ code: -1, msg: '编辑基础物品失败', error: err.message });
  }
});

router.delete('/items/:id', (req, res) => {
  try {
    const id = Number(req.params.id || 0);
    if (!id) {
      return res.status(400).json({ code: -1, msg: '缺少物品ID' });
    }
    const item = db.prepare(`
      SELECT id, category, model
      FROM workwear_items
      WHERE id = ?
      LIMIT 1
    `).get(id);
    if (!item) {
      return res.status(404).json({ code: -1, msg: '物品不存在' });
    }
    const refs = {
      purchase: db.prepare(`
        SELECT COUNT(*) AS count
        FROM workwear_purchase_entries
        WHERE item_id = ?
           OR (TRIM(COALESCE(category, '')) = TRIM(COALESCE(?, ''))
               AND TRIM(COALESCE(model, '')) = TRIM(COALESCE(?, '')))
      `).get(id, item.category, item.model).count || 0,
      opening: db.prepare(`
        SELECT COUNT(*) AS count
        FROM workwear_inventory_opening
        WHERE item_id = ?
      `).get(id).count || 0,
      monthly: db.prepare(`
        SELECT COUNT(*) AS count
        FROM workwear_inventory_monthly
        WHERE item_id = ?
      `).get(id).count || 0,
      records: db.prepare(`
        SELECT COUNT(*) AS count
        FROM workwear_records
        WHERE TRIM(COALESCE(category, '')) = TRIM(COALESCE(?, ''))
          AND TRIM(COALESCE(model, '')) = TRIM(COALESCE(?, ''))
      `).get(item.category, item.model).count || 0
    };
    if (refs.purchase || refs.opening || refs.monthly || refs.records) {
      return res.status(400).json({
        code: -1,
        msg: '该物品已有库存或业务记录，不能删除，请使用停用'
      });
    }
    db.prepare(`DELETE FROM workwear_items WHERE id = ?`).run(id);
    rebuildMonthlyInventory(FIRST_REAL_MONTH);
    res.json({ code: 0, msg: '物品已删除' });
  } catch (err) {
    console.error('删除基础物品失败:', err);
    res.status(500).json({ code: -1, msg: '删除基础物品失败', error: err.message });
  }
});

router.get('/stats', (req, res) => {
  try {
    const currentMonth = getCurrentYearMonth();
    rebuildMonthlyInventory(currentMonth);
    const staffCount = db.prepare(`
      SELECT COUNT(DISTINCT staff_name) as count FROM workwear_records
      WHERE issue_date LIKE ? AND status = 'active'
    `).get(`${currentMonth}%`);
    const itemCount = db.prepare(`
      SELECT COALESCE(SUM(quantity), 0) as count FROM workwear_records
      WHERE issue_date LIKE ? AND status = 'active'
    `).get(`${currentMonth}%`);
    const inventoryTotal = db.prepare(`
      SELECT COALESCE(SUM(closing_qty), 0) as total
      FROM workwear_inventory_monthly
      WHERE year_month = ?
    `).get(currentMonth);
    const alertCount = db.prepare(`
      SELECT COUNT(*) as count
      FROM workwear_inventory_monthly m
      JOIN workwear_items i ON i.id = m.item_id
      WHERE m.year_month = ? AND i.is_active = 1
        AND m.closing_qty <= COALESCE(i.min_stock, 0)
    `).get(currentMonth);
    const deductionSum = db.prepare(`
      SELECT COALESCE(SUM(deduction), 0) as total FROM workwear_records
      WHERE status = 'active'
    `).get();
    const alerts = db.prepare(`
      SELECT i.category, i.model, i.min_stock, m.closing_qty as stock
      FROM workwear_inventory_monthly m
      JOIN workwear_items i ON i.id = m.item_id
      WHERE m.year_month = ? AND i.is_active = 1
        AND m.closing_qty <= COALESCE(i.min_stock, 0)
      ORDER BY m.closing_qty ASC, i.id ASC
    `).all(currentMonth).map((row) => ({
      item_name: buildItemName(row.category, row.model),
      model: row.model || '',
      stock: Number(row.stock) || 0,
      min_stock: Number(row.min_stock) || 0
    }));

    res.json({
      code: 0,
      data: {
        staff_count: staffCount.count,
        item_count: itemCount.count,
        inventory_total: Number(inventoryTotal.total) || 0,
        alert_count: alertCount.count,
        deduction_total: Number(deductionSum.total) || 0,
        alerts
      }
    });
  } catch (err) {
    console.error('获取统计数据失败:', err);
    res.status(500).json({ code: -1, msg: '获取统计失败', error: err.message });
  }
});

router.get('/inventory-sheet', (req, res) => {
  try {
    const yearMonth = normalizeText(req.query.year_month) || getCurrentYearMonth();
    rebuildMonthlyInventory(yearMonth);
    res.json({ code: 0, data: buildInventorySheetPayload(yearMonth) });
  } catch (err) {
    console.error('读取真实盘存失败:', err);
    res.status(500).json({ code: -1, msg: '读取真实盘存失败', error: err.message });
  }
});

router.post('/inventory-sheet/import', (req, res) => {
  try {
    ensureBaseItemsSeeded();
    ensurePurchaseEntriesSeeded();
    importHistoricalInventoryFromExcel(2026, 5);
    rebuildMonthlyInventory(FIRST_REAL_MONTH);
    res.json({ code: 0, msg: '真实库存初始化成功', data: buildInventorySheetPayload(FIRST_REAL_MONTH) });
  } catch (err) {
    console.error('初始化真实库存失败:', err);
    res.status(500).json({ code: -1, msg: '初始化真实库存失败', error: err.message });
  }
});

router.get('/inventory-monthly', (req, res) => {
  try {
    const yearMonth = normalizeText(req.query.year_month) || getCurrentYearMonth();
    rebuildMonthlyInventory(yearMonth);
    res.json({
      code: 0,
      data: {
        year_month: yearMonth,
        rows: getMonthlyInventoryRows(yearMonth),
        sheet: buildInventorySheetPayload(yearMonth)
      }
    });
  } catch (err) {
    console.error('获取月度真实库存失败:', err);
    res.status(500).json({ code: -1, msg: '获取月度真实库存失败', error: err.message });
  }
});

router.post('/inventory-monthly/rebuild', (req, res) => {
  try {
    const yearMonth = normalizeText(req.body.year_month || req.query.year_month) || FIRST_REAL_MONTH;
    if (compareYearMonth(yearMonth, FIRST_REAL_MONTH) < 0) {
      importHistoricalInventoryFromExcel(2026, 5);
    }
    rebuildMonthlyInventory(yearMonth);
    res.json({
      code: 0,
      msg: '月度真实库存重算成功',
      data: {
        year_month: yearMonth,
        rows: getMonthlyInventoryRows(yearMonth)
      }
    });
  } catch (err) {
    console.error('重算月度真实库存失败:', err);
    res.status(500).json({ code: -1, msg: '重算月度真实库存失败', error: err.message });
  }
});

router.get('/inventory-exceptions', (req, res) => {
  try {
    const yearMonth = normalizeText(req.query.year_month) || FIRST_REAL_MONTH;
    const rows = db.prepare(`
      SELECT id, year_month, source_type, source_id, raw_category, raw_model, raw_name, quantity, reason, created_at
      FROM workwear_inventory_exceptions
      WHERE year_month = ?
      ORDER BY id DESC
    `).all(yearMonth);
    res.json({ code: 0, data: rows });
  } catch (err) {
    console.error('获取库存异常失败:', err);
    res.status(500).json({ code: -1, msg: '获取库存异常失败', error: err.message });
  }
});

router.get('/staff-issue-summary', (req, res) => {
  try {
    const staffId = Number(req.query.staff_id || 0);
    if (!staffId) {
      return res.status(400).json({ code: -1, msg: 'staff_id 不能为空', data: null });
    }

    const staff = db.prepare(`
      SELECT id, name, department, position, hire_date, status
      FROM staff
      WHERE id = ?
      LIMIT 1
    `).get(staffId);

    if (!staff || staff.status !== 'active') {
      return res.status(404).json({ code: -1, msg: '人员不存在或已停用', data: null });
    }

    const recordParams = [staffId, staff.name || ''];
    const recordWhere = `
      status = 'active'
      AND (
        staff_id = ?
        OR (
          staff_id IS NULL
          AND TRIM(COALESCE(staff_name, '')) = TRIM(COALESCE(?, ''))
        )
      )
    `;

    const lastIssue = db.prepare(`
      SELECT issue_date, item_name, model, quantity
      FROM workwear_records
      WHERE ${recordWhere}
      ORDER BY issue_date DESC, id DESC
      LIMIT 1
    `).get(...recordParams);

    const issueRows = db.prepare(`
      SELECT issue_date, item_name, quantity
      FROM workwear_records
      WHERE ${recordWhere}
      ORDER BY issue_date ASC, id ASC
    `).all(...recordParams);

    const recentRows = db.prepare(`
      SELECT issue_date, item_name, model, quantity
      FROM workwear_records
      WHERE ${recordWhere}
      ORDER BY issue_date DESC, id DESC
    `).all(...recordParams);

    const recentByCategory = { summer: null, winter: null, shoes: null };
    recentRows.forEach((row) => {
      const category = getIssueCategory(row.item_name);
      if (category && !recentByCategory[category]) {
        recentByCategory[category] = {
          item_name: row.item_name || '',
          model: row.model || '',
          issue_date: row.issue_date || '',
          quantity: Number(row.quantity) || 0
        };
      }
    });

    const availability = calculateAvailability({
      position: staff.position,
      hireDate: staff.hire_date,
      referenceDate: getLocalToday(),
      issueRows
    });

    res.json({
      code: 0,
      msg: 'ok',
      data: {
        rule_key: availability.ruleKey || '',
        rule_label: availability.ruleLabel || '',
        rule_matched: availability.matched,
        hire_date: staff.hire_date || '',
        last_issue_date: lastIssue?.issue_date || '',
        last_issue_text: lastIssue ? `${lastIssue.item_name || ''}${lastIssue.model ? ` ${lastIssue.model}` : ''}`.trim() : '',
        available: availability.available,
        details: availability.details,
        recent_by_category: recentByCategory
      }
    });
  } catch (err) {
    console.error('获取快速录入摘要失败:', err);
    res.status(500).json({ code: -1, msg: '获取人员工服摘要失败', error: err.message });
  }
});

router.post('/', (req, res) => {
  try {
    const {
      staff_id, staff_name, department, position,
      issue_date, item_name, item_type, model,
      quantity = 1, unit_price = 0, self_purchase = 0, remark
    } = req.body;

    let snapshotStaffId = staff_id ? Number(staff_id) : null;
    let snapshotStaffName = normalizeText(staff_name);
    let snapshotDepartment = normalizeText(department) || null;
    let snapshotPosition = normalizeText(position) || null;
    let snapshotHireDate = null;

    if (snapshotStaffId) {
      const currentStaff = db.prepare(`
        SELECT id, name, department, position, hire_date, status
        FROM staff
        WHERE id = ?
        LIMIT 1
      `).get(snapshotStaffId);

      if (!currentStaff || currentStaff.status !== 'active') {
        return res.status(400).json({ code: -1, msg: '所选领用人不存在或已停用' });
      }

      snapshotStaffId = currentStaff.id;
      snapshotStaffName = normalizeText(currentStaff.name);
      snapshotDepartment = normalizeText(currentStaff.department) || null;
      snapshotPosition = normalizeText(currentStaff.position) || null;
      snapshotHireDate = normalizeText(currentStaff.hire_date) || null;
    }

    if (!snapshotStaffName || !item_name || !issue_date) {
      return res.status(400).json({ code: -1, msg: '领用人、物品和领用日期为必填项' });
    }

    const issueDate = normalizeDate(issue_date);
    const isSelfPurchase = Number(self_purchase) > 0;
    const deduction = isSelfPurchase ? Number(self_purchase) || 0 : 0;
    const finalDeductionRatio = isSelfPurchase ? 100 : 0;

    const result = db.prepare(`
      INSERT INTO workwear_records (
        staff_id, staff_name, department, position, hire_date,
        issue_date, item_name, item_type, model, quantity, unit_price,
        deduction, self_purchase, deduction_ratio, remark, status,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active',
        datetime('now', 'localtime'), datetime('now', 'localtime'))
    `).run(
      snapshotStaffId,
      snapshotStaffName,
      snapshotDepartment,
      snapshotPosition,
      snapshotHireDate,
      issueDate,
      item_name,
      item_type || deriveItemType(deriveCategory(item_name, model), ''),
      normalizeModel(model),
      Number(quantity) || 1,
      Number(unit_price) || 0,
      deduction,
      Number(self_purchase) || 0,
      finalDeductionRatio,
      normalizeText(remark) || null
    );

    rebuildMonthlyInventory(getYearMonth(issueDate) || FIRST_REAL_MONTH);

    res.json({
      code: 0,
      msg: '领用记录已创建',
      data: { id: result.lastInsertRowid }
    });
  } catch (err) {
    console.error('创建领用记录失败:', err);
    res.status(500).json({ code: -1, msg: '创建记录失败', error: err.message });
  }
});

router.put('/:id', (req, res) => {
  try {
    const id = Number(req.params.id || 0);
    const record = db.prepare('SELECT * FROM workwear_records WHERE id = ?').get(id);
    if (!record) {
      return res.status(404).json({ code: -1, msg: '记录不存在' });
    }

    const allowedFields = [
      'staff_name', 'department', 'position', 'issue_date',
      'item_name', 'item_type', 'model', 'quantity',
      'unit_price', 'deduction', 'self_purchase', 'remark'
    ];

    const setClauses = [];
    const values = [];
    allowedFields.forEach((field) => {
      if (req.body[field] !== undefined) {
        let value = req.body[field];
        if (field === 'issue_date') value = normalizeDate(value);
        if (field === 'model') value = normalizeModel(value);
        if (typeof value === 'string') value = normalizeText(value);
        setClauses.push(`${field} = ?`);
        values.push(value);
      }
    });

    if (!setClauses.length) {
      return res.status(400).json({ code: -1, msg: '没有可更新的字段' });
    }

    setClauses.push(`updated_at = datetime('now', 'localtime')`);
    values.push(id);
    db.prepare(`UPDATE workwear_records SET ${setClauses.join(', ')} WHERE id = ?`).run(...values);

    rebuildMonthlyInventory(getYearMonth(record.issue_date) || FIRST_REAL_MONTH);
    const nextIssueDate = req.body.issue_date ? normalizeDate(req.body.issue_date) : record.issue_date;
    if (getYearMonth(nextIssueDate) !== getYearMonth(record.issue_date)) {
      rebuildMonthlyInventory(getYearMonth(nextIssueDate) || FIRST_REAL_MONTH);
    }

    res.json({ code: 0, msg: '更新成功' });
  } catch (err) {
    console.error('更新记录失败:', err);
    res.status(500).json({ code: -1, msg: '更新失败', error: err.message });
  }
});

router.delete('/:id', (req, res) => {
  try {
    const id = Number(req.params.id || 0);
    const record = db.prepare('SELECT * FROM workwear_records WHERE id = ?').get(id);
    if (!record) {
      return res.status(404).json({ code: -1, msg: '记录不存在' });
    }

    db.prepare(`
      UPDATE workwear_records
      SET status = 'deleted', updated_at = datetime('now', 'localtime')
      WHERE id = ?
    `).run(id);

    rebuildMonthlyInventory(getYearMonth(record.issue_date) || FIRST_REAL_MONTH);

    res.json({ code: 0, msg: '删除成功' });
  } catch (err) {
    console.error('删除记录失败:', err);
    res.status(500).json({ code: -1, msg: '删除失败', error: err.message });
  }
});

router.get('/inventory', (req, res) => {
  try {
    const yearMonth = normalizeText(req.query.year_month) || getCurrentYearMonth();
    rebuildMonthlyInventory(yearMonth);
    const inventory = getMonthlyInventoryRows(yearMonth).map((row) => ({
      item_name: row.item_name,
      item_type: row.item_type,
      model: row.model,
      quantity: row.closing_qty,
      min_stock: row.min_stock,
      unit_price: row.unit_price
    }));
    res.json({ code: 0, data: inventory });
  } catch (err) {
    console.error('获取库存失败:', err);
    res.status(500).json({ code: -1, msg: '获取库存失败', error: err.message });
  }
});

router.post('/inventory', (req, res) => {
  try {
    ensureWorkwearSeeds();
    const itemName = normalizeText(req.body.item_name);
    const model = normalizeModel(req.body.model);
    const quantity = Number(req.body.quantity) || 0;
    if (!itemName || !quantity) {
      return res.status(400).json({ code: -1, msg: '物品和数量为必填项' });
    }

    const matchedItem = findItemByNameModel(itemName, model);
    if (!matchedItem) {
      return res.status(400).json({ code: -1, msg: '采购物品未在基础物品中维护，请先新增基础物品' });
    }

    const purchaseDate = normalizeDate(req.body.purchase_date || getLocalToday());
    const purchaser = normalizeText(req.body.purchaser || req.body.staff_name || '');
    const remark = normalizeText(req.body.remark);
    const unitPrice = Number(req.body.unit_price) || Number(matchedItem.unit_price) || 0;
    const sourceRef = `manual-purchase-${purchaseDate}-${matchedItem.id}-${Date.now()}`;

    db.prepare(`
      INSERT INTO workwear_purchase_entries (
        source_ref, purchase_date, purchaser, item_id, item_name, category, model, unit,
        unit_price, quantity, amount, remark, item_type, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now', 'localtime'), datetime('now', 'localtime'))
    `).run(
      sourceRef,
      purchaseDate,
      purchaser || null,
      matchedItem.id,
      itemName,
      matchedItem.category,
      matchedItem.model,
      matchedItem.unit,
      unitPrice,
      quantity,
      unitPrice * quantity,
      remark || null,
      matchedItem.item_type
    );

    rebuildMonthlyInventory(getYearMonth(purchaseDate) || FIRST_REAL_MONTH);

    res.json({ code: 0, msg: '采购入库成功' });
  } catch (err) {
    console.error('采购入库失败:', err);
    res.status(500).json({ code: -1, msg: '采购入库失败', error: err.message });
  }
});

router.get('/export', (req, res) => {
  try {
    const { department, position, date_from, date_to } = req.query;
    let where = "WHERE status = 'active'";
    const params = [];

    if (department) {
      where += ' AND department = ?';
      params.push(department);
    }
    if (position) {
      where += ' AND position = ?';
      params.push(position);
    }
    if (date_from) {
      where += ' AND issue_date >= ?';
      params.push(date_from);
    }
    if (date_to) {
      where += ' AND issue_date <= ?';
      params.push(date_to);
    }

    const records = db.prepare(`
      SELECT staff_name as 领用人, department as 部门, position as 岗位,
             issue_date as 领用日期, item_name as 类别, model as 型号,
             quantity as 数量, unit_price as 单价, deduction as 扣款,
             self_purchase as 自购, remark as 备注
      FROM workwear_records
      ${where}
      ORDER BY issue_date DESC, id DESC
    `).all(...params);

    res.json({ code: 0, data: records });
  } catch (err) {
    console.error('导出数据失败:', err);
    res.status(500).json({ code: -1, msg: '导出失败', error: err.message });
  }
});

module.exports = router;
