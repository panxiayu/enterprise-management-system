const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { execFile } = require('child_process');
const { promisify } = require('util');

const router = express.Router();
const db = require('../models/database');
const { authMiddleware } = require('../middleware/auth');

const execFileAsync = promisify(execFile);
const RECEIPT_UPLOAD_DIR = path.join(__dirname, '../../uploads/travel-receipts');
if (!fs.existsSync(RECEIPT_UPLOAD_DIR)) {
  fs.mkdirSync(RECEIPT_UPLOAD_DIR, { recursive: true });
}

const receiptStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, RECEIPT_UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase() || '.jpg';
    cb(null, `receipt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`);
  }
});

const receiptUpload = multer({
  storage: receiptStorage,
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = new Set(['.jpg', '.jpeg', '.png', '.webp', '.bmp', '.tif', '.tiff']);
    const ext = path.extname(file.originalname || '').toLowerCase();
    cb(null, allowed.has(ext));
  }
});

const ORDER_STATUS = new Set(['draft', 'upcoming', 'completed', 'cancelled']);
const REIMBURSEMENT_STATUS = new Set(['pending', 'processing', 'reimbursed']);
const INVOICE_STATUS = new Set(['not_received', 'partial', 'complete']);
const ITEM_TYPES = new Set(['ticket', 'hotel', 'other']);

function jsonError(res, msg, status = 400) {
  return res.status(status).json({ code: -1, msg, data: null });
}

function normalizeText(value) {
  return String(value == null ? '' : value).trim();
}

function normalizeNullableText(value) {
  const text = normalizeText(value);
  return text || null;
}

function normalizeMoney(value) {
  const num = Number(value || 0);
  return Number.isFinite(num) ? Number(num.toFixed(2)) : 0;
}

function normalizeOcrText(value) {
  return String(value || '')
    .replace(/\r/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function cleanOcrMoney(value) {
  return String(value || '')
    .replace(/[，,\s]/g, '')
    .replace(/([0-9])\.(?=[0-9]{1,2}\b)/, '$1.')
    .replace(/[^\d.]/g, '');
}

function pickReceiptAmount(text) {
  const source = String(text || '');
  const strongPatterns = [
    /(?:票价|票款|实付|应付|支付金额|订单金额|金额)[^\d¥￥]{0,12}[¥￥]?\s*([0-9]+(?:[,，\s][0-9]{3})*(?:\.\s*[0-9]{1,2})?)/gi,
    /(?:价税合计|合计金额|金额合计|总金额|小写|合计)[^\d¥￥]{0,12}[¥￥]?\s*([0-9]+(?:[,，][0-9]{3})*(?:\.[0-9]{1,2})?)/gi,
    /[¥￥]\s*([0-9]+(?:[,，\s][0-9]{3})*(?:\.\s*[0-9]{1,2})?)/g
  ];
  for (const pattern of strongPatterns) {
    const matches = Array.from(source.matchAll(pattern))
      .map((match) => normalizeMoney(cleanOcrMoney(match[1])))
      .filter((num) => num > 0);
    if (matches.length) return Math.max(...matches);
  }
  const all = Array.from(source.matchAll(/\b([0-9]{1,6}(?:[,，][0-9]{3})*(?:\.[0-9]{1,2}))\b/g))
    .map((match) => normalizeMoney(String(match[1]).replace(/[，,]/g, '')))
    .filter((num) => num > 0 && num < 1000000);
  return all.length ? Math.max(...all) : 0;
}

function pickReceiptDate(text) {
  const source = String(text || '');
  const patterns = [
    /(?:出发日期|乘车日期|发车日期|日期)[:：\s]*(\d{4})[年\-\/.](\d{1,2})[月\-\/.](\d{1,2})日?/,
    /(\d{4})[年\-\/.](\d{1,2})[月\-\/.](\d{1,2})日?/,
    /(\d{2})[年\-\/.](\d{1,2})[月\-\/.](\d{1,2})日?/
  ];
  for (const pattern of patterns) {
    const match = source.match(pattern);
    if (!match) continue;
    const year = match[1].length === 2 ? `20${match[1]}` : match[1];
    return `${year}-${String(match[2]).padStart(2, '0')}-${String(match[3]).padStart(2, '0')}`;
  }
  return '';
}

function pickReceiptNo(text) {
  const source = String(text || '');
  const match = source.match(/(?:发票号码|发票号|票据号码|订单号|单号)[:：\s]*([A-Z0-9\-]{6,32})/i);
  return match ? normalizeText(match[1]) : '';
}

function pickReceiptVendor(text) {
  const lines = normalizeOcrText(text).split('\n').map((line) => line.trim()).filter(Boolean);
  const labeled = lines.find((line) => /(销售方|收款方|商户|单位名称|名称)[:：]/.test(line));
  if (labeled) {
    const value = labeled.split(/[:：]/).pop();
    if (normalizeText(value)) return normalizeText(value).slice(0, 40);
  }
  const companyLine = lines.find((line) => /(公司|酒店|宾馆|铁路|航空|机场|客运|出租|网约车|餐饮|服务区)/.test(line));
  return companyLine ? normalizeText(companyLine).slice(0, 40) : '';
}

function inferReceiptType(text) {
  const source = String(text || '');
  if (/酒店|宾馆|住宿|客房|房费/.test(source)) return 'hotel';
  if (/火车|铁路|高铁|动车|机票|航班|出租|网约车|滴滴|加油|过路费|高速|客运|车票|交通/.test(source)) return 'ticket';
  return 'other';
}

function normalizeRouteText(value) {
  return normalizeText(value)
    .replace(/\s+/g, '')
    .replace(/[—–-]/g, '一')
    .replace(/站/g, '');
}

function normalizeOcrStation(value) {
  const text = normalizeRouteText(value);
  const known = [
    ['Tianjinnan', '天津南'],
    ['Tianjin', '天津'],
    ['Ninghai', '宁海'],
    ['Ningbo', '宁波']
  ];
  const found = known.find(([key]) => new RegExp(key, 'i').test(text));
  return found ? found[1] : text;
}

function pickRoute(text) {
  const source = normalizeOcrText(text);
  const direct = source.match(/([\u4e00-\u9fa5]{2,8})\s*[一到至→-]\s*([\u4e00-\u9fa5]{2,8})/);
  if (direct) return { from: normalizeOcrStation(direct[1]), to: normalizeOcrStation(direct[2]) };

  const englishStations = Array.from(source.matchAll(/\b(Ninghai|Tianjinnan|Tianjin|Ningbo)\b/gi)).map((match) => normalizeOcrStation(match[1]));
  if (englishStations.length >= 2) return { from: englishStations[0], to: englishStations[1] };

  const chineseStations = Array.from(source.matchAll(/([\u4e00-\u9fa5]{2,8})站/g)).map((match) => normalizeOcrStation(match[1]));
  if (chineseStations.length >= 2) return { from: chineseStations[0], to: chineseStations[1] };
  return { from: '', to: '' };
}

function pickTrainOrFlightNo(text) {
  const source = String(text || '');
  const match = source.match(/\b([GDCZKT]\d{2,5}|[A-Z]{2}\d{3,5}|[0-9][A-Z]\d{3,5})\b/i);
  return match ? match[1].toUpperCase() : '';
}

function parseTravelOrderBlocks(text) {
  const source = normalizeOcrText(text);
  const blocks = source.split(/(?=口?订单号[:：])/).map((block) => block.trim()).filter((block) => /订单号[:：]/.test(block));
  return blocks.map((block) => {
    const route = pickRoute(block);
    const amount = pickReceiptAmount(block);
    const date = pickReceiptDate(block);
    const orderNo = pickReceiptNo(block);
    const trafficNo = pickTrainOrFlightNo(block);
    const title = [route.from && route.to ? `${route.from}-${route.to}` : '', trafficNo].filter(Boolean).join(' ');
    return {
      order_no: orderNo,
      title: title || '交通费用',
      route,
      amount,
      date,
      traffic_no: trafficNo,
      raw_text: block
    };
  }).filter((item) => item.amount > 0 || item.title !== '交通费用');
}

function buildReceiptDescription(ocr) {
  const items = Array.isArray(ocr.order_items) ? ocr.order_items : [];
  if (items.length > 1) {
    return items.map((item) => item.title).filter(Boolean).join('、') || '交通费用';
  }
  const routeText = ocr.route?.from && ocr.route?.to ? `${ocr.route.from}-${ocr.route.to}` : '';
  return [routeText, ocr.traffic_no, ocr.item_type === 'hotel' ? '酒店费用' : itemTypeNameForOcr(ocr.item_type)]
    .filter(Boolean)
    .join(' ') || itemTypeNameForOcr(ocr.item_type);
}

function itemTypeNameForOcr(type) {
  if (type === 'hotel') return '酒店费用';
  if (type === 'ticket') return '交通费用';
  return '其他费用';
}

async function runReceiptOcr(filePath) {
  const outputs = [];
  for (const psm of ['6', '11']) {
    const { stdout } = await execFileAsync('tesseract', [
      filePath,
      'stdout',
      '-l',
      'chi_sim+eng',
      '--psm',
      psm
    ], {
      timeout: 30000,
      maxBuffer: 1024 * 1024 * 6
    });
    outputs.push(stdout);
  }
  const text = normalizeOcrText(outputs.join('\n'));
  const orderItems = parseTravelOrderBlocks(text);
  const totalFromOrders = orderItems.reduce((sum, item) => sum + normalizeMoney(item.amount), 0);
  const route = pickRoute(text);
  const ocr = {
    text,
    amount: totalFromOrders > 0 ? normalizeMoney(totalFromOrders) : pickReceiptAmount(text),
    date: pickReceiptDate(text),
    vendor_name: pickReceiptVendor(text),
    receipt_no: pickReceiptNo(text),
    item_type: inferReceiptType(text),
    route,
    traffic_no: pickTrainOrFlightNo(text),
    order_items: orderItems
  };
  return { ...ocr, description: buildReceiptDescription(ocr) };
}

function normalizeCompanyName(value) {
  const text = normalizeText(value);
  if (!text) return '';
  if (text.includes('兴利汽车模具')) return '兴利汽车模具';
  if (text.includes('兴利模具')) return '兴利模具';
  return text;
}

function normalizeTravelerMembers(input) {
  const rows = Array.isArray(input) ? input : [];
  return rows
    .map((row) => ({
      staff_id: Number(row?.staff_id || 0) || null,
      name: normalizeText(row?.name),
      employee_id: normalizeText(row?.employee_id),
      company: normalizeCompanyName(row?.company),
      department: normalizeText(row?.department),
      position: normalizeText(row?.position)
    }))
    .filter((row) => row.name || row.employee_id || row.department || row.company)
    .slice(0, 8);
}

function normalizeTravelerAllocations(input) {
  let rows = Array.isArray(input) ? input : [];
  if (!rows.length && typeof input === 'string' && input.trim()) {
    try {
      const parsed = JSON.parse(input);
      rows = Array.isArray(parsed) ? parsed : [];
    } catch (err) {
      rows = [];
    }
  }
  return rows
    .map((row) => ({
      staff_id: Number(row?.staff_id || 0) || null,
      name: normalizeText(row?.name),
      employee_id: normalizeText(row?.employee_id),
      company: normalizeCompanyName(row?.company),
      department: normalizeText(row?.department),
      position: normalizeText(row?.position),
      vehicle_type: normalizeText(row?.vehicle_type) || normalizeText(row?.vehicle) || '',
      from_location: normalizeText(row?.from_location) || normalizeText(row?.from),
      to_location: normalizeText(row?.to_location) || normalizeText(row?.to),
      amount: normalizeMoney(row?.amount)
    }))
    .filter((row) => row.name || row.employee_id || row.company || row.amount > 0)
    .slice(0, 20);
}

function buildTravelerMembers(primaryStaff, body) {
  const normalized = normalizeTravelerMembers(body?.traveler_members_json || body?.traveler_members || body?.travelers);
  if (normalized.length) return normalized;
  if (!primaryStaff) return [];
  return [{
    staff_id: Number(primaryStaff.id || 0) || null,
    name: normalizeText(primaryStaff.name),
    employee_id: normalizeText(primaryStaff.employee_id),
    company: normalizeCompanyName(body?.company_snapshot),
    department: normalizeText(body?.department_snapshot) || normalizeText(primaryStaff.department),
    position: normalizeText(body?.position_snapshot) || normalizeText(primaryStaff.position)
  }];
}

function buildDepartmentSnapshot(members, fallback) {
  const list = Array.from(new Set((members || []).map((row) => normalizeText(row.department)).filter(Boolean)));
  return normalizeNullableText(list.join('、')) || normalizeNullableText(fallback);
}

function buildCompanySnapshot(members, fallback, mouldAmount, autoAmount) {
  const set = new Set((members || []).map((row) => normalizeCompanyName(row.company)).filter(Boolean));
  if (mouldAmount > 0) set.add('兴利模具');
  if (autoAmount > 0) set.add('兴利汽车模具');
  const joined = Array.from(set).join(' / ');
  return normalizeNullableText(joined) || normalizeNullableText(fallback);
}

function parseCompanySplit(body, fallbackCompany) {
  let mouldAmount = normalizeMoney(body?.xingli_mould_amount);
  let autoAmount = normalizeMoney(body?.xingli_auto_amount);
  if (mouldAmount === 0 && autoAmount === 0) {
    const total = normalizeMoney(body?.total_amount);
    const company = normalizeCompanyName(body?.company_snapshot || fallbackCompany);
    if (total > 0 && company) {
      if (company.includes('汽车模具')) autoAmount = total;
      else if (company.includes('兴利模具')) mouldAmount = total;
    }
  }
  return { mouldAmount, autoAmount };
}

function getEmployeeStaffByUser(user) {
  if (!user) return null;
  const fetchStaffById = db.prepare(`
    SELECT id, employee_id, name, department, position, status,
           travel_view_permission, travel_manage_permission
    FROM staff
    WHERE id = ?
    LIMIT 1
  `);
  const fetchStaffByEmployeeId = db.prepare(`
    SELECT id, employee_id, name, department, position, status,
           travel_view_permission, travel_manage_permission
    FROM staff
    WHERE employee_id = ?
    LIMIT 1
  `);

  if (user.type === 'employee') {
    const staff = fetchStaffById.get(Number(user.id || 0));
    if (staff) return staff;
  } else if (Number(user.userId || 0) > 0) {
    const boundUser = db.prepare(`
      SELECT staff_id, username, nickname
      FROM users
      WHERE id = ?
      LIMIT 1
    `).get(Number(user.userId || 0));
    if (Number(boundUser?.staff_id || 0) > 0) {
      const linkedStaff = fetchStaffById.get(Number(boundUser.staff_id || 0));
      if (linkedStaff) return linkedStaff;
    }
    if (normalizeText(boundUser?.username)) {
      const matchedStaff = fetchStaffByEmployeeId.get(normalizeText(boundUser.username));
      if (matchedStaff) return matchedStaff;
    }
  }

  return null;
}

function actorNameFromRequest(req, staff) {
  if (staff?.name) return staff.name;
  if (req.user?.role === 'admin') {
    return normalizeText(req.user.nickname) || normalizeText(req.user.username) || '管理员';
  }
  return normalizeText(req.user?.name) || '员工';
}

function isTravelManager(req, staff) {
  if (req.user?.role === 'admin') return true;
  return Number(staff?.travel_manage_permission || 0) === 1;
}

function canViewTravel(req, staff) {
  if (req.user?.role === 'admin') return true;
  return Number(staff?.travel_view_permission || 0) === 1 || Number(staff?.travel_manage_permission || 0) === 1;
}

function ensureTravelManage(req, res, next) {
  const staff = getEmployeeStaffByUser(req.user);
  if (req.user?.role !== 'admin' && (!staff || staff.status !== 'active')) {
    return jsonError(res, '员工信息不存在或已停用', 403);
  }
  if (!isTravelManager(req, staff)) {
    return jsonError(res, '暂无差旅管理权限', 403);
  }
  req.employeeStaff = staff;
  next();
}

function ensureTravelView(req, res, next) {
  const staff = getEmployeeStaffByUser(req.user);
  if (req.user?.role !== 'admin' && (!staff || staff.status !== 'active')) {
    return jsonError(res, '员工信息不存在或已停用', 403);
  }
  if (!canViewTravel(req, staff)) {
    return jsonError(res, '暂无差旅查看权限', 403);
  }
  req.employeeStaff = staff;
  next();
}

function buildOrderListWhere(query, params) {
  const clauses = [];
  if (normalizeText(query.staff_name)) {
    clauses.push('o.staff_name_snapshot LIKE ?');
    params.push(`%${normalizeText(query.staff_name)}%`);
  }
  if (normalizeText(query.order_no)) {
    clauses.push('o.order_no LIKE ?');
    params.push(`%${normalizeText(query.order_no)}%`);
  }
  if (normalizeText(query.destination)) {
    clauses.push('o.destination LIKE ?');
    params.push(`%${normalizeText(query.destination)}%`);
  }
  if (normalizeText(query.status)) {
    clauses.push('o.status = ?');
    params.push(normalizeText(query.status));
  }
  if (normalizeText(query.reimbursement_status)) {
    clauses.push('o.reimbursement_status = ?');
    params.push(normalizeText(query.reimbursement_status));
  }
  if (normalizeText(query.company_snapshot)) {
    clauses.push('o.company_snapshot LIKE ?');
    params.push(`%${normalizeText(query.company_snapshot)}%`);
  }
  if (normalizeText(query.department_snapshot)) {
    clauses.push('o.department_snapshot LIKE ?');
    params.push(`%${normalizeText(query.department_snapshot)}%`);
  }
  if (normalizeText(query.date_from)) {
    clauses.push('date(o.start_time) >= date(?)');
    params.push(normalizeText(query.date_from));
  }
  if (normalizeText(query.date_to)) {
    clauses.push('date(o.start_time) <= date(?)');
    params.push(normalizeText(query.date_to));
  }
  return clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
}

const listSelect = `
  SELECT o.*,
         COALESCE((SELECT SUM(amount) FROM travel_order_items i WHERE i.order_id = o.id AND i.item_type = 'ticket'), 0) AS ticket_amount,
         COALESCE((SELECT SUM(amount) FROM travel_order_items i WHERE i.order_id = o.id AND i.item_type = 'hotel'), 0) AS hotel_amount,
         COALESCE((SELECT SUM(amount) FROM travel_order_items i WHERE i.order_id = o.id AND i.item_type = 'other'), 0) AS other_amount,
         COALESCE((SELECT SUM(amount) FROM travel_order_items i WHERE i.order_id = o.id), 0) AS total_amount,
         (SELECT COUNT(*) FROM travel_order_items i WHERE i.order_id = o.id) AS item_count
  FROM travel_orders o
`;

function getOrderWithItems(orderId) {
  const order = db.prepare(`${listSelect} WHERE o.id = ? LIMIT 1`).get(orderId);
  if (!order) return null;
  const items = db.prepare(`
    SELECT *
    FROM travel_order_items
    WHERE order_id = ?
    ORDER BY sort_index ASC, id ASC
  `).all(orderId);
  const logs = db.prepare(`
    SELECT id, action_type, action_desc, operator_staff_id, operator_name, created_at
    FROM travel_order_logs
    WHERE order_id = ?
    ORDER BY id DESC
    LIMIT 20
  `).all(orderId);
  let travelerMembers = [];
  try {
    travelerMembers = normalizeTravelerMembers(JSON.parse(order.traveler_members_json || '[]'));
  } catch (err) {
    travelerMembers = [];
  }
  if (!travelerMembers.length && (order.staff_name_snapshot || order.employee_id_snapshot || order.department_snapshot)) {
    travelerMembers = [{
      staff_id: Number(order.staff_id || 0) || null,
      name: normalizeText(order.staff_name_snapshot),
      employee_id: normalizeText(order.employee_id_snapshot),
      company: normalizeCompanyName(order.company_snapshot),
      department: normalizeText(order.department_snapshot),
      position: normalizeText(order.position_snapshot)
    }];
  }
  return { ...order, traveler_members: travelerMembers, items, logs };
}

function assertOrderEditable(order) {
  return !!order && order.status !== 'cancelled';
}

function validateOrderPayload(body, isUpdate = false) {
  const staffId = Number(body.staff_id || 0);
  const startTime = normalizeText(body.start_time);
  const destination = normalizeText(body.destination);
  const items = Array.isArray(body.items) ? body.items : [];

  if (!isUpdate && !staffId) return '出差人不能为空';
  if (!isUpdate && !startTime) return '出发时间不能为空';
  if (!isUpdate && !destination) return '目的地不能为空';
  if (!isUpdate && items.length === 0) return '至少需要一条费用明细';
  if (normalizeText(body.status) && !ORDER_STATUS.has(normalizeText(body.status))) return '行程状态无效';
  if (normalizeText(body.reimbursement_status) && !REIMBURSEMENT_STATUS.has(normalizeText(body.reimbursement_status))) return '报销状态无效';
  if (normalizeText(body.invoice_status) && !INVOICE_STATUS.has(normalizeText(body.invoice_status))) return '发票状态无效';
  const travelerMembers = normalizeTravelerMembers(body.traveler_members_json || body.traveler_members || body.travelers);
  if (travelerMembers.length > 8) return '出差人部门最多支持 8 人';

  for (const item of items) {
    const itemType = normalizeText(item.item_type);
    if (!ITEM_TYPES.has(itemType)) return '存在无效的费用类型';
  }
  return '';
}

function logOrderAction(orderId, actionType, actionDesc, actorStaffId, actorName) {
  db.prepare(`
    INSERT INTO travel_order_logs (
      order_id, action_type, action_desc, operator_staff_id, operator_name
    ) VALUES (?, ?, ?, ?, ?)
  `).run(orderId, actionType, actionDesc, actorStaffId || null, actorName || null);
}

function createOrderNo(id) {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `BT-${y}${m}${d}-${String(id).padStart(4, '0')}`;
}

function parseOrderTravelerMembers(order) {
  try {
    return normalizeTravelerMembers(JSON.parse(order?.traveler_members_json || '[]'));
  } catch (err) {
    return [];
  }
}

function mergeTravelerMemberLists(...lists) {
  const map = new Map();
  lists.flat().forEach((row) => {
    const person = {
      staff_id: Number(row?.staff_id || 0) || null,
      name: normalizeText(row?.name),
      employee_id: normalizeText(row?.employee_id),
      company: normalizeCompanyName(row?.company),
      department: normalizeText(row?.department),
      position: normalizeText(row?.position)
    };
    const key = person.employee_id
      ? `employee:${person.employee_id}`
      : (person.staff_id
        ? `staff:${person.staff_id}`
        : (person.name ? `name:${person.name}` : ''));
    if (!key) return;
    if (map.has(key)) {
      const existing = map.get(key);
      existing.staff_id = existing.staff_id || person.staff_id;
      existing.employee_id = existing.employee_id || person.employee_id;
      existing.name = existing.name || person.name;
      existing.company = existing.company || person.company;
      existing.department = existing.department || person.department;
      existing.position = existing.position || person.position;
      return;
    }
    map.set(key, person);
  });
  return Array.from(map.values());
}

function insertTravelOrderItems(orderId, items, startSortIndex = 0) {
  const insertItem = db.prepare(`
    INSERT INTO travel_order_items (
      order_id, item_type, item_subtype, title, from_location, to_location, start_time, end_time,
      vendor_name, order_ref_no, payment_method, amount, quantity, unit_price, nights, item_status,
      invoice_status, remark, traveler_allocations_json, sort_index
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  items.forEach((item, index) => {
    insertItem.run(
      orderId,
      normalizeText(item.item_type),
      normalizeNullableText(item.item_subtype),
      normalizeNullableText(item.title),
      normalizeNullableText(item.from_location),
      normalizeNullableText(item.to_location),
      normalizeNullableText(item.start_time),
      normalizeNullableText(item.end_time),
      normalizeNullableText(item.vendor_name),
      normalizeNullableText(item.order_ref_no),
      normalizeText(item.payment_method) || 'company_paid',
      normalizeMoney(item.amount),
      Number(item.quantity || 1) || 1,
      normalizeMoney(item.unit_price),
      Number(item.nights || 0) || 0,
      normalizeNullableText(item.item_status),
      normalizeNullableText(item.invoice_status),
      normalizeNullableText(item.remark),
      JSON.stringify(normalizeTravelerAllocations(item.traveler_allocations || item.traveler_allocations_json || item.allocations)),
      startSortIndex + index + 1
    );
  });
}

function summarizeOrderAllocations(orderId) {
  const rows = db.prepare(`
    SELECT amount, traveler_allocations_json
    FROM travel_order_items
    WHERE order_id = ?
  `).all(orderId);
  let mouldAmount = 0;
  let autoAmount = 0;
  const travelers = [];
  rows.forEach((row) => {
    const allocations = normalizeTravelerAllocations(row.traveler_allocations_json);
    if (!allocations.length) return;
    allocations.forEach((person) => {
      travelers.push(person);
      if (person.company === '兴利模具') mouldAmount += normalizeMoney(person.amount);
      else autoAmount += normalizeMoney(person.amount);
    });
  });
  return {
    mouldAmount: normalizeMoney(mouldAmount),
    autoAmount: normalizeMoney(autoAmount),
    travelers
  };
}

router.get('/access', authMiddleware, (req, res) => {
  const staff = getEmployeeStaffByUser(req.user);
  if (req.user?.role === 'admin') {
    return res.json({
      code: 0,
      data: {
        can_view: true,
        can_manage: true,
        travel_view_permission: 1,
        travel_manage_permission: 1
      }
    });
  }
  if (!staff || staff.status !== 'active') {
    return jsonError(res, '员工信息不存在或已停用', 403);
  }
  res.json({
    code: 0,
    data: {
      can_view: canViewTravel(req, staff),
      can_manage: isTravelManager(req, staff),
      travel_view_permission: Number(staff.travel_view_permission || 0),
      travel_manage_permission: Number(staff.travel_manage_permission || 0)
    }
  });
});

router.get('/my/has-permission', authMiddleware, (req, res) => {
  const staff = getEmployeeStaffByUser(req.user);
  res.json({
    code: 0,
    data: {
      has_permission: !!staff && staff.status === 'active' && canViewTravel(req, staff)
    }
  });
});

router.get('/my/orders', authMiddleware, ensureTravelView, (req, res) => {
  try {
    const staff = req.employeeStaff;
    const rows = db.prepare(`
      ${listSelect}
      WHERE o.staff_id = ?
      ORDER BY date(COALESCE(o.start_time, o.created_at)) DESC, o.id DESC
      LIMIT 50
    `).all(staff.id);
    res.json({ code: 0, data: rows });
  } catch (err) {
    console.error('获取我的差旅单失败:', err);
    res.status(500).json({ code: -1, msg: '服务器错误', data: null });
  }
});

router.post('/receipts/ocr', authMiddleware, ensureTravelManage, receiptUpload.single('image'), async (req, res) => {
  try {
    if (!req.file) return jsonError(res, '请上传票据图片');
    const imageUrl = `/uploads/travel-receipts/${req.file.filename}`;
    let ocr;
    try {
      ocr = await runReceiptOcr(req.file.path);
    } catch (err) {
      console.error('票据 OCR 识别失败:', err);
      return res.json({
        code: 0,
        msg: '图片已上传，OCR 识别失败，请手动录入',
        data: {
          image_url: imageUrl,
          raw_text: '',
          amount: 0,
          date: '',
          vendor_name: '',
          receipt_no: '',
          item_type: 'ticket',
          description: '',
          route: { from: '', to: '' },
          traffic_no: '',
          order_items: [],
          confidence: 0,
          ocr_status: 'failed'
        }
      });
    }
    res.json({
      code: 0,
      msg: '识别完成',
      data: {
        image_url: imageUrl,
        raw_text: ocr.text,
        amount: ocr.amount,
        date: ocr.date,
        vendor_name: ocr.vendor_name,
        receipt_no: ocr.receipt_no,
        item_type: ocr.item_type,
        description: ocr.description,
        route: ocr.route,
        traffic_no: ocr.traffic_no,
        order_items: ocr.order_items,
        confidence: ocr.text ? 0.72 : 0,
        ocr_status: ocr.text ? 'ok' : 'empty'
      }
    });
  } catch (err) {
    console.error('上传票据 OCR 失败:', err);
    res.status(500).json({ code: -1, msg: '票据识别失败', data: null });
  }
});

router.get('/orders', authMiddleware, ensureTravelManage, (req, res) => {
  try {
    const params = [];
    const whereSql = buildOrderListWhere(req.query, params);
    const limit = Math.min(Math.max(Number(req.query.limit || 100), 1), 500);
    const rows = db.prepare(`
      ${listSelect}
      ${whereSql}
      ORDER BY date(COALESCE(o.start_time, o.created_at)) DESC, o.id DESC
      LIMIT ?
    `).all(...params, limit);
    res.json({ code: 0, data: rows });
  } catch (err) {
    console.error('获取差旅单列表失败:', err);
    res.status(500).json({ code: -1, msg: '服务器错误', data: null });
  }
});

router.get('/orders/:id', authMiddleware, (req, res) => {
  try {
    const orderId = Number(req.params.id || 0);
    if (!orderId) return jsonError(res, '参数错误');

    const staff = getEmployeeStaffByUser(req.user);
    const detail = getOrderWithItems(orderId);
    if (!detail) return jsonError(res, '单据不存在', 404);

    const canManage = isTravelManager(req, staff);
    const canSelfView = !!staff && canViewTravel(req, staff) && Number(detail.staff_id) === Number(staff.id);
    if (!(req.user?.role === 'admin' || canManage || canSelfView)) {
      return jsonError(res, '暂无权限查看该差旅单', 403);
    }
    res.json({ code: 0, data: detail });
  } catch (err) {
    console.error('获取差旅单详情失败:', err);
    res.status(500).json({ code: -1, msg: '服务器错误', data: null });
  }
});

router.post('/orders', authMiddleware, ensureTravelManage, (req, res) => {
  try {
    const errMsg = validateOrderPayload(req.body, false);
    if (errMsg) return jsonError(res, errMsg);

    const actorStaff = req.employeeStaff || getEmployeeStaffByUser(req.user);
    const actorName = actorNameFromRequest(req, actorStaff);
    const actorStaffId = actorStaff?.id || null;
    const staffId = Number(req.body.staff_id);
    const targetStaff = db.prepare(`
      SELECT id, employee_id, name, department, position
      FROM staff
      WHERE id = ? AND status = 'active'
      LIMIT 1
    `).get(staffId);
    if (!targetStaff) return jsonError(res, '出差人不存在或已停用');

    const orderInfo = db.transaction((body) => {
      const travelerMembers = buildTravelerMembers(targetStaff, body);
      const items = body.items || [];
      const totalAmount = items.reduce((sum, item) => sum + normalizeMoney(item.amount), 0);
      const split = parseCompanySplit(body, body.company_snapshot);
      const insertOrder = db.prepare(`
        INSERT INTO travel_orders (
          staff_id, staff_name_snapshot, employee_id_snapshot, company_snapshot, department_snapshot, position_snapshot,
          traveler_members_json, xingli_mould_amount, xingli_auto_amount,
          trip_type, start_time, end_time, destination, trip_reason,
          status, reimbursement_status, reimbursement_no, reimbursement_date, invoice_status,
          created_by_staff_id, created_by_name, remark
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      const result = insertOrder.run(
        targetStaff.id,
        targetStaff.name,
        targetStaff.employee_id || '',
        buildCompanySnapshot(travelerMembers, body.company_snapshot, split.mouldAmount, split.autoAmount),
        buildDepartmentSnapshot(travelerMembers, body.department_snapshot) || normalizeNullableText(targetStaff.department),
        normalizeNullableText(body.position_snapshot) || normalizeNullableText(targetStaff.position),
        JSON.stringify(travelerMembers),
        split.mouldAmount || 0,
        split.autoAmount || 0,
        normalizeText(body.trip_type) || '出差',
        normalizeText(body.start_time),
        normalizeNullableText(body.end_time),
        normalizeText(body.destination),
        normalizeNullableText(body.trip_reason),
        normalizeText(body.status) || 'draft',
        normalizeText(body.reimbursement_status) || 'pending',
        normalizeNullableText(body.reimbursement_no),
        normalizeNullableText(body.reimbursement_date),
        normalizeText(body.invoice_status) || 'not_received',
        actorStaffId,
        actorName,
        normalizeNullableText(body.remark)
      );
      const orderId = Number(result.lastInsertRowid);
      const orderNo = normalizeText(body.order_no) || createOrderNo(orderId);
      db.prepare('UPDATE travel_orders SET order_no = ?, updated_at = datetime(\'now\', \'localtime\') WHERE id = ?').run(orderNo, orderId);

      const insertItem = db.prepare(`
        INSERT INTO travel_order_items (
          order_id, item_type, item_subtype, title, from_location, to_location, start_time, end_time,
          vendor_name, order_ref_no, payment_method, amount, quantity, unit_price, nights, item_status,
          invoice_status, remark, traveler_allocations_json, sort_index
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      body.total_amount = totalAmount;
      items.forEach((item, index) => {
        insertItem.run(
          orderId,
          normalizeText(item.item_type),
          normalizeNullableText(item.item_subtype),
          normalizeNullableText(item.title),
          normalizeNullableText(item.from_location),
          normalizeNullableText(item.to_location),
          normalizeNullableText(item.start_time),
          normalizeNullableText(item.end_time),
          normalizeNullableText(item.vendor_name),
          normalizeNullableText(item.order_ref_no),
          normalizeText(item.payment_method) || 'company_paid',
          normalizeMoney(item.amount),
          Number(item.quantity || 1) || 1,
          normalizeMoney(item.unit_price),
          Number(item.nights || 0) || 0,
          normalizeNullableText(item.item_status),
          normalizeNullableText(item.invoice_status),
          normalizeNullableText(item.remark),
          JSON.stringify(normalizeTravelerAllocations(item.traveler_allocations || item.traveler_allocations_json || item.allocations)),
          index + 1
        );
      });
      logOrderAction(orderId, 'create', '创建差旅单', actorStaffId, actorName);
      return orderId;
    })(req.body);

    res.json({ code: 0, msg: '创建成功', data: getOrderWithItems(orderInfo) });
  } catch (err) {
    console.error('创建差旅单失败:', err);
    res.status(500).json({ code: -1, msg: '服务器错误', data: null });
  }
});

router.post('/orders/:id/items', authMiddleware, ensureTravelManage, (req, res) => {
  try {
    const orderId = Number(req.params.id || 0);
    if (!orderId) return jsonError(res, '参数错误');
    const order = db.prepare('SELECT * FROM travel_orders WHERE id = ? LIMIT 1').get(orderId);
    if (!assertOrderEditable(order)) return jsonError(res, '单据不存在或已作废', 404);

    const items = Array.isArray(req.body.items) ? req.body.items : [];
    if (!items.length) return jsonError(res, '至少需要一条费用明细');
    const errMsg = validateOrderPayload({
      ...req.body,
      staff_id: order.staff_id,
      start_time: req.body.start_time || order.start_time,
      destination: req.body.destination || order.destination,
      items
    }, true);
    if (errMsg) return jsonError(res, errMsg);

    const currentMembers = parseOrderTravelerMembers(order);
    const payloadMembers = normalizeTravelerMembers(req.body.traveler_members_json || req.body.traveler_members || req.body.travelers);
    const payloadAllocationMembers = items.flatMap((item) => normalizeTravelerAllocations(item.traveler_allocations || item.traveler_allocations_json || item.allocations));
    const previewMembers = mergeTravelerMemberLists(currentMembers, payloadMembers, payloadAllocationMembers);
    if (previewMembers.length > 8) return jsonError(res, '一张差旅单最多支持 8 名出差人员');

    const actorStaff = req.employeeStaff || getEmployeeStaffByUser(req.user);
    const actorName = actorNameFromRequest(req, actorStaff);
    const actorStaffId = actorStaff?.id || null;

    db.transaction(() => {
      const maxSort = db.prepare('SELECT COALESCE(MAX(sort_index), 0) AS value FROM travel_order_items WHERE order_id = ?').get(orderId)?.value || 0;
      insertTravelOrderItems(orderId, items, Number(maxSort || 0));

      const summary = summarizeOrderAllocations(orderId);
      const mergedMembers = mergeTravelerMemberLists(currentMembers, payloadMembers, summary.travelers);
      const startDates = [
        normalizeText(order.start_time),
        normalizeText(req.body.start_time),
        ...items.map((item) => normalizeText(item.start_time))
      ].filter(Boolean).sort();
      const startTime = startDates[0] || order.start_time;

      db.prepare(`
        UPDATE travel_orders
        SET start_time = ?, destination = ?, traveler_members_json = ?, company_snapshot = ?, department_snapshot = ?,
            xingli_mould_amount = ?, xingli_auto_amount = ?, updated_at = datetime('now', 'localtime')
        WHERE id = ?
      `).run(
        startTime,
        normalizeText(req.body.destination) || order.destination,
        JSON.stringify(mergedMembers),
        buildCompanySnapshot(mergedMembers, order.company_snapshot, summary.mouldAmount, summary.autoAmount),
        buildDepartmentSnapshot(mergedMembers, order.department_snapshot) || order.department_snapshot,
        summary.mouldAmount,
        summary.autoAmount,
        orderId
      );

      logOrderAction(orderId, 'append_items', `追加 ${items.length} 条费用明细`, actorStaffId, actorName);
    })();

    res.json({ code: 0, msg: '追加成功', data: getOrderWithItems(orderId) });
  } catch (err) {
    console.error('追加差旅费用明细失败:', err);
    res.status(500).json({ code: -1, msg: '服务器错误', data: null });
  }
});

router.put('/orders/:id', authMiddleware, ensureTravelManage, (req, res) => {
  try {
    const orderId = Number(req.params.id || 0);
    if (!orderId) return jsonError(res, '参数错误');
    const order = db.prepare('SELECT * FROM travel_orders WHERE id = ? LIMIT 1').get(orderId);
    if (!assertOrderEditable(order)) return jsonError(res, '单据不存在或已作废', 404);

    const errMsg = validateOrderPayload({ ...order, ...req.body, items: Array.isArray(req.body.items) ? req.body.items : [] }, true);
    if (errMsg) return jsonError(res, errMsg);

    const actorStaff = req.employeeStaff || getEmployeeStaffByUser(req.user);
    const actorName = actorNameFromRequest(req, actorStaff);
    const actorStaffId = actorStaff?.id || null;

    db.transaction((body) => {
      const travelerMembers = buildTravelerMembers({
        id: order.staff_id,
        name: order.staff_name_snapshot,
        employee_id: order.employee_id_snapshot,
        department: order.department_snapshot,
        position: order.position_snapshot
      }, body);
      const items = Array.isArray(body.items) ? body.items : null;
      const totalAmount = Array.isArray(items) ? items.reduce((sum, item) => sum + normalizeMoney(item.amount), 0) : normalizeMoney(order.total_amount);
      const split = parseCompanySplit({ ...body, total_amount: totalAmount }, body.company_snapshot || order.company_snapshot);
      db.prepare(`
        UPDATE travel_orders
        SET trip_type = ?, start_time = ?, end_time = ?, destination = ?, trip_reason = ?,
            status = ?, reimbursement_status = ?, reimbursement_no = ?, reimbursement_date = ?,
            invoice_status = ?, company_snapshot = ?, department_snapshot = ?, position_snapshot = ?,
            traveler_members_json = ?, xingli_mould_amount = ?, xingli_auto_amount = ?, remark = ?,
            updated_at = datetime('now', 'localtime')
        WHERE id = ?
      `).run(
        normalizeText(body.trip_type) || order.trip_type || '出差',
        normalizeText(body.start_time) || order.start_time,
        normalizeNullableText(body.end_time),
        normalizeText(body.destination) || order.destination,
        normalizeNullableText(body.trip_reason),
        normalizeText(body.status) || order.status,
        normalizeText(body.reimbursement_status) || order.reimbursement_status,
        normalizeNullableText(body.reimbursement_no),
        normalizeNullableText(body.reimbursement_date),
        normalizeText(body.invoice_status) || order.invoice_status,
        buildCompanySnapshot(travelerMembers, body.company_snapshot || order.company_snapshot, split.mouldAmount, split.autoAmount),
        buildDepartmentSnapshot(travelerMembers, body.department_snapshot || order.department_snapshot) || order.department_snapshot,
        normalizeNullableText(body.position_snapshot) || order.position_snapshot,
        JSON.stringify(travelerMembers),
        split.mouldAmount || 0,
        split.autoAmount || 0,
        normalizeNullableText(body.remark),
        orderId
      );

      if (Array.isArray(body.items)) {
        db.prepare('DELETE FROM travel_order_items WHERE order_id = ?').run(orderId);
        const insertItem = db.prepare(`
          INSERT INTO travel_order_items (
            order_id, item_type, item_subtype, title, from_location, to_location, start_time, end_time,
            vendor_name, order_ref_no, payment_method, amount, quantity, unit_price, nights, item_status,
            invoice_status, remark, traveler_allocations_json, sort_index
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        body.items.forEach((item, index) => {
          insertItem.run(
            orderId,
            normalizeText(item.item_type),
            normalizeNullableText(item.item_subtype),
            normalizeNullableText(item.title),
            normalizeNullableText(item.from_location),
            normalizeNullableText(item.to_location),
            normalizeNullableText(item.start_time),
            normalizeNullableText(item.end_time),
            normalizeNullableText(item.vendor_name),
            normalizeNullableText(item.order_ref_no),
            normalizeText(item.payment_method) || 'company_paid',
            normalizeMoney(item.amount),
            Number(item.quantity || 1) || 1,
            normalizeMoney(item.unit_price),
            Number(item.nights || 0) || 0,
            normalizeNullableText(item.item_status),
            normalizeNullableText(item.invoice_status),
            normalizeNullableText(item.remark),
            JSON.stringify(normalizeTravelerAllocations(item.traveler_allocations || item.traveler_allocations_json || item.allocations)),
            index + 1
          );
        });
      }
      logOrderAction(orderId, 'update', '编辑差旅单', actorStaffId, actorName);
    })(req.body);

    res.json({ code: 0, msg: '更新成功', data: getOrderWithItems(orderId) });
  } catch (err) {
    console.error('更新差旅单失败:', err);
    res.status(500).json({ code: -1, msg: '服务器错误', data: null });
  }
});

router.put('/orders/:id/status', authMiddleware, ensureTravelManage, (req, res) => {
  try {
    const orderId = Number(req.params.id || 0);
    const status = normalizeText(req.body.status);
    if (!orderId || !ORDER_STATUS.has(status)) return jsonError(res, '状态参数错误');
    const actorStaff = req.employeeStaff || getEmployeeStaffByUser(req.user);
    const actorName = actorNameFromRequest(req, actorStaff);
    const actorStaffId = actorStaff?.id || null;
    const result = db.prepare(`
      UPDATE travel_orders
      SET status = ?, updated_at = datetime('now', 'localtime')
      WHERE id = ?
    `).run(status, orderId);
    if (!result.changes) return jsonError(res, '单据不存在', 404);
    logOrderAction(orderId, 'status', `更新行程状态为 ${status}`, actorStaffId, actorName);
    res.json({ code: 0, msg: '状态更新成功', data: getOrderWithItems(orderId) });
  } catch (err) {
    console.error('更新差旅状态失败:', err);
    res.status(500).json({ code: -1, msg: '服务器错误', data: null });
  }
});

router.put('/orders/:id/reimbursement', authMiddleware, ensureTravelManage, (req, res) => {
  try {
    const orderId = Number(req.params.id || 0);
    const reimbursementStatus = normalizeText(req.body.reimbursement_status);
    const invoiceStatus = normalizeText(req.body.invoice_status);
    if (!orderId || !REIMBURSEMENT_STATUS.has(reimbursementStatus)) {
      return jsonError(res, '报销状态参数错误');
    }
    if (invoiceStatus && !INVOICE_STATUS.has(invoiceStatus)) {
      return jsonError(res, '发票状态参数错误');
    }
    const actorStaff = req.employeeStaff || getEmployeeStaffByUser(req.user);
    const actorName = actorNameFromRequest(req, actorStaff);
    const actorStaffId = actorStaff?.id || null;
    const result = db.prepare(`
      UPDATE travel_orders
      SET reimbursement_status = ?,
          reimbursement_no = ?,
          reimbursement_date = ?,
          invoice_status = COALESCE(?, invoice_status),
          updated_at = datetime('now', 'localtime')
      WHERE id = ?
    `).run(
      reimbursementStatus,
      normalizeNullableText(req.body.reimbursement_no),
      normalizeNullableText(req.body.reimbursement_date),
      invoiceStatus || null,
      orderId
    );
    if (!result.changes) return jsonError(res, '单据不存在', 404);
    logOrderAction(orderId, 'reimbursement', `更新报销状态为 ${reimbursementStatus}`, actorStaffId, actorName);
    res.json({ code: 0, msg: '报销状态更新成功', data: getOrderWithItems(orderId) });
  } catch (err) {
    console.error('更新报销状态失败:', err);
    res.status(500).json({ code: -1, msg: '服务器错误', data: null });
  }
});

router.get('/export/orders', authMiddleware, ensureTravelManage, (req, res) => {
  try {
    const params = [];
    const whereSql = buildOrderListWhere(req.query, params);
    const rows = db.prepare(`
      SELECT o.order_no, o.staff_name_snapshot, o.employee_id_snapshot, o.company_snapshot,
             o.department_snapshot, o.position_snapshot, o.traveler_members_json,
             o.xingli_mould_amount, o.xingli_auto_amount,
             o.start_time, o.end_time, o.destination,
             o.trip_reason, o.status, o.reimbursement_status, o.reimbursement_no, o.invoice_status,
             i.item_type, i.item_subtype, i.title, i.vendor_name, i.order_ref_no, i.amount,
             i.traveler_allocations_json
      FROM travel_orders o
      LEFT JOIN travel_order_items i ON i.order_id = o.id
      ${whereSql}
      ORDER BY date(COALESCE(o.start_time, o.created_at)) DESC, o.id DESC, i.sort_index ASC, i.id ASC
      LIMIT 5000
    `).all(...params);
    res.json({ code: 0, data: rows });
  } catch (err) {
    console.error('导出差旅明细失败:', err);
    res.status(500).json({ code: -1, msg: '服务器错误', data: null });
  }
});

router.get('/export/reimbursements', authMiddleware, ensureTravelManage, (req, res) => {
  try {
    const params = [];
    const whereSql = buildOrderListWhere(req.query, params);
    const rows = db.prepare(`
      ${listSelect}
      ${whereSql}
      ORDER BY date(COALESCE(o.start_time, o.created_at)) DESC, o.id DESC
      LIMIT 5000
    `).all(...params).map((row) => ({
      order_no: row.order_no,
      staff_name_snapshot: row.staff_name_snapshot,
      employee_id_snapshot: row.employee_id_snapshot,
      company_snapshot: row.company_snapshot,
      department_snapshot: row.department_snapshot,
      position_snapshot: row.position_snapshot,
      traveler_members_json: row.traveler_members_json,
      xingli_mould_amount: row.xingli_mould_amount,
      xingli_auto_amount: row.xingli_auto_amount,
      ticket_amount: row.ticket_amount,
      hotel_amount: row.hotel_amount,
      other_amount: row.other_amount,
      total_amount: row.total_amount,
      reimbursement_status: row.reimbursement_status,
      reimbursement_no: row.reimbursement_no,
      reimbursement_date: row.reimbursement_date,
      invoice_status: row.invoice_status
    }));
    res.json({ code: 0, data: rows });
  } catch (err) {
    console.error('导出报销台账失败:', err);
    res.status(500).json({ code: -1, msg: '服务器错误', data: null });
  }
});

module.exports = router;
