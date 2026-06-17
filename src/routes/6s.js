const express = require('express');
const router = express.Router();
const db = require('../models/database');
const { authMiddleware, adminMiddleware } = require('../middleware/auth');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { deleteFromCloud } = require('../utils/cloud-storage');
const { getS6UploadDir } = require('../utils/s6-storage');
const { enqueueS6CloudSync, deleteQueueRowsForField, deleteQueueRowsForTarget, buildS6LocalUrl } = require('../services/s6-cloud-sync');
const { actorFromRequestUser, createNotification, createNotifications, listS6AdminRecipients } = require('../services/notification-service');

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const d = getS6UploadDir();
    if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
    cb(null, d);
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + "-" + Math.round(Math.random() * 1E9) + path.extname(file.originalname));
  }
});
const upload = multer({ storage, limits: { fileSize: 20 * 1024 * 1024 } });

const s6Perm = (req, res, next) => {
  if (req.user.type === "employee" && req.user.s6_permission !== 1) {
    return res.status(403).json({ code: -1, msg: "没有6S管理权限", data: null });
  }
  next();
};

function normalizeImageList(images, fallbackImage) {
  if (Array.isArray(images) && images.length) return images.filter(Boolean);
  if (typeof images === "string" && images.trim()) {
    try {
      const parsed = JSON.parse(images);
      if (Array.isArray(parsed) && parsed.length) return parsed.filter(Boolean);
    } catch (err) {}
  }
  return fallbackImage ? [fallbackImage] : [];
}

function serializeImageList(images) {
  const list = normalizeImageList(images);
  return list.length ? JSON.stringify(list) : null;
}

function safeUnlink(filePath) {
  if (!filePath) return;
  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch (err) {
    console.error('删除临时文件失败:', filePath, err.message);
  }
}

function isCloudUrl(value) {
  return /^https?:\/\//i.test(String(value || ''));
}

async function persist6SFiles(files) {
  if (!files || !files.length) return { urls: [], storage: 'cloud' };
  return {
    urls: files.map((file) => buildS6LocalUrl(file.filename)),
    storage: 'local'
  };
}

function logReview(rid, action, comment, uid, uname, images, imageTime) {
  const imageList = normalizeImageList(images);
  const firstImage = imageList[0] || null;
  return db.prepare("INSERT INTO s6_review_logs (record_id, action, comment, operator_id, operator_name, image, images, image_time) VALUES (?,?,?,?,?,?,?,CASE WHEN ? IS NULL THEN NULL ELSE COALESCE(?, datetime('now','localtime')) END)")
    .run(rid, action, comment||null, uid||null, uname||null, firstImage, serializeImageList(imageList), firstImage, imageTime||null);
}

function getFallbackAfterImages(recordId) {
  const latestRejectedLog = db.prepare(`
    SELECT images, image
    FROM s6_review_logs
    WHERE record_id = ? AND action = 'rejected'
    ORDER BY created_at DESC, id DESC
    LIMIT 1
  `).get(recordId);
  return normalizeImageList(latestRejectedLog?.images, latestRejectedLog?.image);
}

function normalizeCheckDate(value) {
  const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;
  return `${match[1]}-${match[2]}-${match[3]}`;
}

function getTodayDate() {
  const now = new Date();
  return [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0")
  ].join("-");
}

function getNextProjectCode(checkDate) {
  const normalized = normalizeCheckDate(checkDate);
  if (!normalized) return null;
  const prefix = normalized.replace(/-/g, "");
  const rows = db.prepare("SELECT project_code FROM six_s_records WHERE project_code LIKE ?").all(`${prefix}-%`);
  let maxSeq = 0;
  rows.forEach((row) => {
    const match = String(row.project_code || "").match(new RegExp(`^${prefix}-(\\d+)$`));
    if (!match) return;
    const seq = Number(match[1]);
    if (Number.isFinite(seq) && seq > maxSeq) maxSeq = seq;
  });
  return `${prefix}-${String(maxSeq + 1).padStart(3, "0")}`;
}

function getStatusLabel(row) {
  if (row.review_status === 'approved') return '已达标';
  if (row.review_status === 'submitted') return '待审核';
  if (Number(row.reject_count || 0) > 0) return `未达标${row.reject_count}`;
  return '待整改';
}

function getDateRange(period, from, to) {
  if (from || to) {
    return { from: normalizeCheckDate(from) || null, to: normalizeCheckDate(to) || null };
  }
  const now = new Date();
  const end = getTodayDate();
  let start = new Date(now);
  if (period === 'week') {
    const day = start.getDay() || 7;
    start.setDate(start.getDate() - day + 1);
  } else if (period === 'year') {
    start = new Date(now.getFullYear(), 0, 1);
  } else {
    start = new Date(now.getFullYear(), now.getMonth(), 1);
  }
  return {
    from: [
      start.getFullYear(),
      String(start.getMonth() + 1).padStart(2, '0'),
      String(start.getDate()).padStart(2, '0')
    ].join('-'),
    to: end
  };
}

const AREA_ZONE_ORDER = ['生产区', '仓库区', '公共区', '办公区'];
const AREA_TEMPLATE_PATH = path.resolve(__dirname, '../../public/js/6s-areas.js');

function splitMultiValue(value) {
  return String(value || '')
    .split(/[\/、,，;；\n]+/)
    .map(item => item.trim())
    .filter(Boolean);
}

function firstDefined(row, keys) {
  for (const key of keys) {
    if (row[key] !== undefined && row[key] !== null && String(row[key]).trim() !== '') {
      return String(row[key]).trim();
    }
  }
  return '';
}

function loadBundledAreaTemplateRows() {
  const raw = fs.readFileSync(AREA_TEMPLATE_PATH, 'utf8');
  const zones = JSON.parse(raw);
  const zoneOrder = AREA_ZONE_ORDER.filter(name => zones[name]).concat(Object.keys(zones).filter(name => !AREA_ZONE_ORDER.includes(name)));
  const rows = [];
  zoneOrder.forEach(zoneName => {
    const zone = zones[zoneName] || {};
    Object.entries(zone.subs || {}).forEach(([category, items]) => {
      (items || []).forEach(item => {
        rows.push({
          zone_name: zoneName,
          category,
          area_code: item.id ?? '',
          area_name: item.name || '',
          floor: item.floor || '',
          responsible: item.person || '',
          responsible_employee_id: '',
          py: item.py || '',
          py_person: item.py_person || '',
        });
      });
    });
  });
  return rows;
}

function normalizeAreaImportRows(rows) {
  if (!Array.isArray(rows)) throw new Error('导入数据格式错误');
  const cleaned = rows.map((row, index) => {
    const zone_name = firstDefined(row, ['zone_name', '大区', '分区', '区域大区']);
    const category = firstDefined(row, ['category', '子分类', '分类', '区域分类']);
    const area_name = firstDefined(row, ['area_name', '区域名称', '区域', 'name']);
    const areaCodeRaw = firstDefined(row, ['area_code', '区域编号', '编号', 'id', 'code']);
    const floor = firstDefined(row, ['floor', '楼层']);
    const responsible = firstDefined(row, ['responsible', '责任人', '负责人', 'person']);
    const py = firstDefined(row, ['py', '区域拼音']);
    const py_person = firstDefined(row, ['py_person', '责任人拼音', '负责人拼音']);
    const responsible_employee_id = firstDefined(row, ['responsible_employee_id', '责任人工号', '工号', 'employee_id']);
    if (!zone_name || !category || !area_name) {
      throw new Error(`第 ${index + 2} 行缺少必填列（大区 / 子分类 / 区域名称）`);
    }
    const area_code = areaCodeRaw ? Number(areaCodeRaw) : null;
    if (areaCodeRaw && !Number.isFinite(area_code)) {
      throw new Error(`第 ${index + 2} 行区域编号不是有效数字`);
    }
    return {
      zone_name,
      category,
      area_name,
      area_code,
      floor,
      responsible,
      py,
      py_person,
      responsible_employee_id
    };
  }).filter(row => row.zone_name && row.category && row.area_name);

  if (!cleaned.length) throw new Error('没有可导入的区域数据');
  return cleaned;
}

function importAreaRows(rows) {
  const normalizedRows = normalizeAreaImportRows(rows);
  const staffRows = db.prepare("SELECT id, name, employee_id, status FROM staff").all();
  const staffByEmployeeId = new Map();
  const staffByName = new Map();
  staffRows.forEach(staff => {
    if (staff.employee_id) staffByEmployeeId.set(String(staff.employee_id).trim(), staff);
    if (!staffByName.has(staff.name)) staffByName.set(staff.name, []);
    staffByName.get(staff.name).push(staff);
  });

  const tx = db.transaction((inputRows) => {
    db.prepare("DELETE FROM s6_area_responsibles").run();
    db.prepare("DELETE FROM s6_areas").run();

    const insertArea = db.prepare(`
      INSERT INTO s6_areas (name, parent_id, area_code, floor, responsible, responsible_employee_id, py, py_person, sort_order)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insertResponsible = db.prepare("INSERT OR IGNORE INTO s6_area_responsibles (area_id, staff_id) VALUES (?, ?)");

    const zoneMap = new Map();
    const categoryMap = new Map();
    const zoneOrder = [];
    const categoryOrder = new Map();
    inputRows.forEach(row => {
      if (!zoneMap.has(row.zone_name)) zoneOrder.push(row.zone_name);
      zoneMap.set(row.zone_name, zoneMap.get(row.zone_name) || null);
      const categoryKey = `${row.zone_name}@@${row.category}`;
      if (!categoryOrder.has(categoryKey)) categoryOrder.set(categoryKey, []);
      categoryOrder.get(categoryKey).push(row);
    });

    zoneOrder.forEach((zoneName, zoneIndex) => {
      const zoneId = insertArea.run(zoneName, 0, null, null, null, null, null, null, zoneIndex + 1).lastInsertRowid;
      zoneMap.set(zoneName, zoneId);
    });

    const categoryKeys = [];
    inputRows.forEach(row => {
      const key = `${row.zone_name}@@${row.category}`;
      if (!categoryMap.has(key)) categoryKeys.push(key);
      categoryMap.set(key, categoryMap.get(key) || null);
    });

    const categorySortCounter = new Map();
    categoryKeys.forEach(key => {
      const [zoneName, categoryName] = key.split('@@');
      const sortOrder = (categorySortCounter.get(zoneName) || 0) + 1;
      categorySortCounter.set(zoneName, sortOrder);
      const categoryId = insertArea.run(categoryName, zoneMap.get(zoneName), null, null, null, null, null, null, sortOrder).lastInsertRowid;
      categoryMap.set(key, categoryId);
    });

    const areaSortCounter = new Map();
    let importedBindings = 0;
    inputRows.forEach(row => {
      const categoryKey = `${row.zone_name}@@${row.category}`;
      const sortOrder = (areaSortCounter.get(categoryKey) || 0) + 1;
      areaSortCounter.set(categoryKey, sortOrder);
      const areaId = insertArea.run(
        row.area_name,
        categoryMap.get(categoryKey),
        row.area_code,
        row.floor || null,
        row.responsible || null,
        row.responsible_employee_id || null,
        row.py || null,
        row.py_person || null,
        sortOrder
      ).lastInsertRowid;

      const boundStaffIds = new Set();
      splitMultiValue(row.responsible_employee_id).forEach(employeeId => {
        const staff = staffByEmployeeId.get(employeeId);
        if (staff) boundStaffIds.add(staff.id);
      });
      if (!boundStaffIds.size) {
        splitMultiValue(row.responsible).forEach(name => {
          (staffByName.get(name) || []).forEach(staff => boundStaffIds.add(staff.id));
        });
      }
      boundStaffIds.forEach(staffId => {
        insertResponsible.run(areaId, staffId);
        importedBindings += 1;
      });
    });

    return {
      zones: zoneOrder.length,
      categories: categoryKeys.length,
      areas: inputRows.length,
      bindings: importedBindings
    };
  });

  return tx(normalizedRows);
}

function buildAreaTree(flatAreas) {
  const byParent = new Map();
  flatAreas.forEach(area => {
    if (!byParent.has(area.parent_id)) byParent.set(area.parent_id, []);
    byParent.get(area.parent_id).push(area);
  });
  function attach(node, zoneName, categoryName) {
    const children = (byParent.get(node.id) || []).map((child) => attach(
      child,
      node.parent_id === 0 ? node.name : zoneName,
      node.parent_id === 0 ? child.name : categoryName
    ));
    return {
      ...node,
      zone_name: node.parent_id === 0 ? node.name : zoneName,
      category: node.parent_id === 0 ? null : (children.length ? node.name : categoryName),
      children
    };
  }
  return (byParent.get(0) || []).map(root => attach(root, root.name, null));
}

function buildAreaLeaves(flatAreas) {
  const childCount = new Map();
  flatAreas.forEach(area => childCount.set(area.parent_id, (childCount.get(area.parent_id) || 0) + 1));
  const parentById = new Map(flatAreas.map(area => [area.id, area]));
  return flatAreas
    .filter(area => area.parent_id !== 0 && !childCount.get(area.id))
    .map(area => {
      const category = parentById.get(area.parent_id) || null;
      const zone = category ? parentById.get(category.parent_id) : null;
      return {
        ...area,
        zone_name: zone ? zone.name : null,
        category: category ? category.name : null
      };
    });
}

function build6SListWhere(query, isAdmin, uid) {
  const where = [];
  const params = [];
  if (!isAdmin) {
    where.push('s.created_by=?');
    params.push(uid);
  }
  if (query.project_code || query.project) {
    where.push('s.project_code=?');
    params.push(query.project_code || query.project);
  }
  if (query.area) {
    where.push('s.area=?');
    params.push(query.area);
  }
  if (query.responsible) {
    const kw = `%${query.responsible}%`;
    where.push(`(
      s.person_charge LIKE ?
      OR s.assigned_name LIKE ?
      OR EXISTS (
        SELECT 1
        FROM staff sf
        WHERE (sf.name LIKE ? OR sf.employee_id LIKE ? OR sf.name_pinyin LIKE ?)
          AND (sf.id = s.assigned_to OR sf.name = s.person_charge OR sf.name = s.assigned_name)
      )
    )`);
    params.push(kw, kw, kw, kw, kw);
  }
  if (query.created_by) {
    where.push('s.created_by_username LIKE ?');
    params.push(`%${query.created_by}%`);
  }
  if (query.date_from) {
    where.push('date(COALESCE(s.check_date,s.created_at))>=date(?)');
    params.push(query.date_from);
  }
  if (query.date_to) {
    where.push('date(COALESCE(s.check_date,s.created_at))<=date(?)');
    params.push(query.date_to);
  }
  if (query.keyword || query.search) {
    const kw = `%${query.keyword || query.search}%`;
    where.push('(s.project_code LIKE ? OR s.area LIKE ? OR s.description LIKE ? OR s.person_charge LIKE ? OR s.assigned_name LIKE ? OR s.created_by_username LIKE ?)');
    params.push(kw, kw, kw, kw, kw, kw);
  }
  if (query.status) {
    if (query.status === 'pending') where.push("(s.review_status IS NULL OR s.review_status='pending')");
    else if (query.status === 'submitted') where.push("s.review_status='submitted'");
    else if (query.status === 'approved') where.push("s.review_status='approved'");
    else if (query.status === 'rejected') where.push("COALESCE((SELECT COUNT(*) FROM s6_review_logs l WHERE l.record_id=s.id AND l.action='rejected'),0)>0 AND s.review_status!='submitted' AND s.review_status!='approved'");
    else if (query.status === 'overdue') where.push("s.review_status!='approved' AND s.deadline IS NOT NULL AND date(s.deadline)<date('now','localtime')");
  }
  return { sql: where.length ? ` WHERE ${where.join(' AND ')}` : '', params };
}

// GET /api/6s - admin active (not approved), or filtered by created_by
router.get("/", authMiddleware, (req, res) => {
  try {
    const viewAll = req.query.view === 'all';
    const isAdmin = req.user.type !== "employee" || req.user.s6_permission === 1;
    const uid = req.user.type === "employee" ? req.user.id : req.user.userId;

    let q, records;
    if (viewAll) {
      // PC后台全量数据 - 管理员看全部，非管理员只看自己创建的
      const built = build6SListWhere(req.query, isAdmin, uid);
      q = "SELECT s.*, st.name as aname, COALESCE((SELECT COUNT(*) FROM s6_review_logs l WHERE l.record_id=s.id AND l.action='rejected'),0) as reject_count FROM six_s_records s LEFT JOIN staff st ON s.assigned_to=st.id" + built.sql + " ORDER BY s.created_at DESC";
      records = db.prepare(q).all(...built.params);
    } else {
      if (isAdmin) {
        // 移动端 6S 管理 - 管理员之间数据互通，查看全部记录
        q = "SELECT s.*, COALESCE((SELECT COUNT(*) FROM s6_review_logs l WHERE l.record_id=s.id AND l.action='rejected'),0) as reject_count FROM six_s_records s WHERE s.created_at >= date('now', '-15 days') ORDER BY s.created_at DESC";
        records = db.prepare(q).all();
      } else {
        // 移动端普通员工列表 - 仅查看自己创建的记录
        q = "SELECT s.*, COALESCE((SELECT COUNT(*) FROM s6_review_logs l WHERE l.record_id=s.id AND l.action='rejected'),0) as reject_count FROM six_s_records s WHERE s.created_by=? AND s.created_at >= date('now', '-15 days') ORDER BY s.created_at DESC";
        records = db.prepare(q).all(uid);
      }
    }
    records = records.map(r => ({ ...r, status_label: getStatusLabel(r) }));
    const stats = {
      total: records.length,
      pending: records.filter(r => !r.review_status || r.review_status === 'pending').length,
      submitted: records.filter(r => r.review_status === 'submitted').length,
      approved: records.filter(r => r.review_status === 'approved').length,
      rejected: records.filter(r => Number(r.reject_count || 0) > 0).length,
      overdue: records.filter(r => r.review_status !== 'approved' && r.deadline && new Date(r.deadline) < new Date()).length
    };
    const projects = db.prepare("SELECT DISTINCT project_code FROM six_s_records WHERE project_code IS NOT NULL AND project_code!='' ORDER BY project_code").all();
    res.json({ code: 0, msg: "success", data: { records, stats, projects } });
  } catch (err) {
    console.error("list err:", err);
    res.status(500).json({ code: -1, msg: "服务器错误", data: null });
  }
});

// GET /api/6s/next-project-code - 根据检查日期预览下一个项目编号
router.get("/next-project-code", authMiddleware, s6Perm, (req, res) => {
  try {
    const checkDate = normalizeCheckDate(req.query.check_date);
    if (!checkDate) return res.status(400).json({ code: -1, msg: "检查日期格式错误", data: null });
    const projectCode = getNextProjectCode(checkDate);
    res.json({ code: 0, msg: "success", data: { check_date: checkDate, project_code: projectCode } });
  } catch (err) {
    console.error("next project code err:", err);
    res.status(500).json({ code: -1, msg: "服务器错误", data: null });
  }
});

// GET /api/6s/areas - 获取区域分级列表
router.get("/areas", authMiddleware, (req, res) => {
  try {
    const areas = db.prepare("SELECT * FROM s6_areas ORDER BY parent_id, sort_order").all();
    const tree = buildAreaTree(areas);
    const leaves = buildAreaLeaves(areas);
    res.json({ code: 0, msg: "success", data: { flat: areas, tree, leaves } });
  } catch (err) {
    console.error("areas err:", err);
    res.status(500).json({ code: -1, msg: "服务器错误", data: null });
  }
});

// GET /api/6s/areas/template - 获取区域导入模板
router.get("/areas/template", authMiddleware, s6Perm, (req, res) => {
  try {
    const rows = loadBundledAreaTemplateRows();
    res.json({
      code: 0,
      msg: "success",
      data: {
        filename: "6S区域导入模板.xlsx",
        headers: ['大区', '子分类', '区域编号', '区域名称', '楼层', '责任人', '区域拼音', '责任人拼音', '责任人工号'],
        rows
      }
    });
  } catch (err) {
    console.error("area template err:", err);
    res.status(500).json({ code: -1, msg: "服务器错误", data: null });
  }
});

// POST /api/6s/areas/import-builtin - 导入内置区域模板
router.post("/areas/import-builtin", authMiddleware, s6Perm, (req, res) => {
  try {
    const result = importAreaRows(loadBundledAreaTemplateRows());
    res.json({ code: 0, msg: "内置模板导入成功", data: result });
  } catch (err) {
    console.error("area import builtin err:", err);
    res.status(500).json({ code: -1, msg: err.message || "导入失败", data: null });
  }
});

// POST /api/6s/areas/import - 导入区域模板
router.post("/areas/import", authMiddleware, s6Perm, (req, res) => {
  try {
    const result = importAreaRows(req.body.rows || []);
    res.json({ code: 0, msg: "区域导入成功", data: result });
  } catch (err) {
    console.error("area import err:", err);
    res.status(500).json({ code: -1, msg: err.message || "导入失败", data: null });
  }
});

// GET /api/6s/area-responsibles - 获取区域绑定的责任人
router.get("/area-responsibles", authMiddleware, (req, res) => {
  try {
    const { area_name, area_id } = req.query;
    if (!area_name && !area_id) return res.status(400).json({ code: -1, msg: "缺少区域参数", data: null });

    let area = null;
    if (area_id) {
      area = db.prepare("SELECT id FROM s6_areas WHERE id=?").get(area_id);
    }
    if (!area && area_name) {
      area = db.prepare("SELECT id FROM s6_areas WHERE name=? ORDER BY id DESC LIMIT 1").get(area_name);
    }
    if (!area) return res.json({ code: 0, msg: "success", data: [] });

    // 查找绑定的工作人员
    const responsibles = db.prepare(`
      SELECT st.id, st.name, st.employee_id, st.department, st.team
      FROM s6_area_responsibles sar
      JOIN staff st ON sar.staff_id = st.id
      WHERE sar.area_id = ? AND st.status = 'active'
    `).all(area.id);

    res.json({ code: 0, msg: "success", data: responsibles });
  } catch (err) {
    console.error("area-responsibles err:", err);
    res.status(500).json({ code: -1, msg: "服务器错误", data: null });
  }
});

// GET /api/6s/all - ALL records (admin only)
router.get("/all", authMiddleware, adminMiddleware, (req, res) => {
  try {
    const r = db.prepare("SELECT s.*, st.name as aname, COALESCE((SELECT COUNT(*) FROM s6_review_logs l WHERE l.record_id=s.id AND l.action='rejected'),0) as reject_count FROM six_s_records s LEFT JOIN staff st ON s.assigned_to=st.id ORDER BY s.created_at DESC").all();
    res.json({ code: 0, msg: "success", data: r });
  } catch (err) {
    console.error("all err:", err);
    res.status(500).json({ code: -1, msg: "服务器错误", data: null });
  }
});

// GET /api/6s/my-tasks - 责任人任务列表
router.get("/my-tasks", authMiddleware, (req, res) => {
  try {
    const uid = req.user.type === "employee" ? req.user.id : req.user.userId;
    // 按 assigned_to 筛选，保留15天内已审核通过的记录
    const r = db.prepare(`
      SELECT s.*, COALESCE((SELECT COUNT(*) FROM s6_review_logs l WHERE l.record_id=s.id AND l.action='rejected'),0) as reject_count
      FROM six_s_records s
      WHERE s.assigned_to=? AND s.review_status != 'approved' AND s.created_at >= date('now', '-15 days')
      ORDER BY s.deadline IS NULL, s.deadline ASC
    `).all(uid);
    res.json({ code: 0, msg: "success", data: r });
  } catch (err) {
    console.error("tasks err:", err);
    res.status(500).json({ code: -1, msg: "服务器错误", data: null });
  }
});

// GET /api/6s/stats/summary - 支持 period 参数 (week/month/year)
router.get("/stats/summary", authMiddleware, (req, res) => {
  try {
    const period = req.query.period || 'month';
    let dateFilter;
    if (period === 'week') {
      dateFilter = "created_at >= date('now', '-7 days')";
    } else if (period === 'year') {
      dateFilter = "created_at >= date('now', '-12 months')";
    } else {
      dateFilter = "created_at >= date('now', '-12 months')";
    }

    const s = {
      total: db.prepare("SELECT COUNT(*) as c FROM six_s_records").get().c,
      pending: db.prepare("SELECT COUNT(*) as c FROM six_s_records WHERE review_status IS NULL OR review_status='pending'").get().c,
      submitted: db.prepare("SELECT COUNT(*) as c FROM six_s_records WHERE review_status='submitted'").get().c,
      approved: db.prepare("SELECT COUNT(*) as c FROM six_s_records WHERE review_status='approved'").get().c,
      rejected: db.prepare("SELECT COUNT(*) as c FROM six_s_records WHERE review_status='rejected'").get().c
    };

    const baseWhere = "area IS NOT NULL AND area!=''";
    const ba = db.prepare("SELECT area,COUNT(*) as c,SUM(CASE WHEN review_status='approved' THEN 1 ELSE 0 END) as fixed,SUM(CASE WHEN review_status='submitted' THEN 1 ELSE 0 END) as submitted,SUM(CASE WHEN review_status IS NULL OR review_status='pending' THEN 1 ELSE 0 END) as pending FROM six_s_records WHERE " + baseWhere + " GROUP BY area ORDER BY c DESC").all();
    const bp = db.prepare("SELECT person_charge as name,COUNT(*) as c,SUM(CASE WHEN review_status='approved' THEN 1 ELSE 0 END) as fixed,SUM(CASE WHEN review_status='submitted' THEN 1 ELSE 0 END) as submitted,SUM(CASE WHEN review_status IS NULL OR review_status='pending' THEN 1 ELSE 0 END) as pending FROM six_s_records WHERE person_charge IS NOT NULL AND person_charge!='' GROUP BY person_charge ORDER BY c DESC").all();

    let timeFormat, timeGroup;
    if (period === 'week') {
      timeFormat = "'%Y-%m-%d'";
      timeGroup = "strftime('%Y-%m-%d', created_at)";
    } else if (period === 'year') {
      timeFormat = "'%Y'";
      timeGroup = "strftime('%Y', created_at)";
    } else {
      timeFormat = "'%Y-%m'";
      timeGroup = "strftime('%Y-%m', created_at)";
    }
    const m = db.prepare("SELECT strftime(" + timeFormat + ",created_at) as period,COUNT(*) as c,SUM(CASE WHEN review_status='approved' THEN 1 ELSE 0 END) as fixed,SUM(CASE WHEN review_status IS NULL OR review_status!='approved' THEN 1 ELSE 0 END) as pending FROM six_s_records WHERE " + dateFilter + " GROUP BY " + timeGroup + " ORDER BY period DESC").all();

    res.json({ code: 0, msg: "success", data: { ...s, byArea: ba, byPerson: bp, monthly: m } });
  } catch (err) {
    console.error("stats err:", err);
    res.status(500).json({ code: -1, msg: "服务器错误", data: null });
  }
});

// GET /api/6s/report - 领导汇报看板
router.get("/report", authMiddleware, s6Perm, (req, res) => {
  try {
    const period = ['week', 'month', 'year'].includes(req.query.period) ? req.query.period : 'month';
    const range = getDateRange(period, req.query.date_from, req.query.date_to);
    const params = [];
    let where = " WHERE 1=1";
    if (range.from) {
      where += " AND date(COALESCE(s.check_date,s.created_at))>=date(?)";
      params.push(range.from);
    }
    if (range.to) {
      where += " AND date(COALESCE(s.check_date,s.created_at))<=date(?)";
      params.push(range.to);
    }
    const records = db.prepare(`
      SELECT s.*,
        COALESCE((SELECT COUNT(*) FROM s6_review_logs l WHERE l.record_id=s.id AND l.action='rejected'),0) as reject_count
      FROM six_s_records s
      ${where}
      ORDER BY COALESCE(s.check_date,s.created_at) DESC
    `).all(...params).map(r => {
      const beforeList = normalizeImageList(r.before_images, r.before_image);
      const afterList = normalizeImageList(r.after_images, r.after_image);
      const fallbackAfterList = afterList.length ? afterList : getFallbackAfterImages(r.id);
      return {
        ...r,
        status_label: getStatusLabel(r),
        before_list: beforeList,
        after_list: fallbackAfterList
      };
    });

    const now = new Date();
    const approved = records.filter(r => r.review_status === 'approved');
    const overdue = records.filter(r => r.review_status !== 'approved' && r.deadline && new Date(r.deadline) < now);
    const rejectTotal = records.reduce((sum, r) => sum + Number(r.reject_count || 0), 0);
    const avgHours = approved.length ? Math.round(approved.reduce((sum, r) => {
      const start = new Date(r.created_at || r.check_date || now);
      const end = new Date(r.reviewed_at || r.updated_at || now);
      const hours = Math.max(0, end - start) / 36e5;
      return sum + hours;
    }, 0) / approved.length) : 0;

    const trendMap = {};
    records.forEach(r => {
      const date = String(r.check_date || r.created_at || '').slice(0, 10);
      let key = date.slice(0, 7);
      if (period === 'week') key = date;
      if (period === 'year') key = date.slice(0, 7);
      if (!trendMap[key]) trendMap[key] = { period: key, total: 0, approved: 0, rejected: 0 };
      trendMap[key].total += 1;
      if (r.review_status === 'approved') trendMap[key].approved += 1;
      trendMap[key].rejected += Number(r.reject_count || 0);
    });

    const byAreaMap = {};
    const byPersonMap = {};
    records.forEach(r => {
      const area = r.area || '未填写';
      if (!byAreaMap[area]) byAreaMap[area] = { name: area, total: 0, rejected: 0, pending: 0, submitted: 0, approved: 0, overdue: 0 };
      byAreaMap[area].total += 1;
      byAreaMap[area].rejected += Number(r.reject_count || 0);
      if (r.review_status === 'approved') byAreaMap[area].approved += 1;
      else if (r.review_status === 'submitted') byAreaMap[area].submitted += 1;
      else byAreaMap[area].pending += 1;
      if (overdue.includes(r)) byAreaMap[area].overdue += 1;

      const person = r.person_charge || r.assigned_name || '未填写';
      if (!byPersonMap[person]) byPersonMap[person] = { name: person, total: 0, pending: 0, submitted: 0, approved: 0, rejected: 0, overdue: 0 };
      byPersonMap[person].total += 1;
      byPersonMap[person].rejected += Number(r.reject_count || 0);
      if (r.review_status === 'approved') byPersonMap[person].approved += 1;
      else if (r.review_status === 'submitted') byPersonMap[person].submitted += 1;
      else byPersonMap[person].pending += 1;
      if (overdue.includes(r)) byPersonMap[person].overdue += 1;
    });

    const cases = records.filter(r => r.before_list.length && r.after_list.length);
    const recordDates = [...new Set(records.map(r => String(r.check_date || '').slice(0, 10)).filter(Boolean))];
    res.json({
      code: 0,
      msg: "success",
      data: {
        period,
        range,
        summary: {
          total: records.length,
          pending: records.filter(r => !r.review_status || r.review_status === 'pending').length,
          submitted: records.filter(r => r.review_status === 'submitted').length,
          approved: approved.length,
          close_rate: records.length ? Math.round(approved.length / records.length * 100) : 0,
          avg_rectify_hours: avgHours,
          reject_total: rejectTotal,
          overdue: overdue.length
        },
        statusDistribution: [
          { name: '待整改', value: records.filter(r => !r.review_status || r.review_status === 'pending').length },
          { name: '待审核', value: records.filter(r => r.review_status === 'submitted').length },
          { name: '已达标', value: approved.length },
          { name: '未达标次数', value: rejectTotal }
        ],
        trend: Object.values(trendMap).sort((a, b) => String(a.period).localeCompare(String(b.period))),
        areaRanking: Object.values(byAreaMap).sort((a, b) => b.total - a.total).slice(0, 10),
        areaRejectRanking: Object.values(byAreaMap).sort((a, b) => b.rejected - a.rejected).slice(0, 10),
        personRanking: Object.values(byPersonMap).sort((a, b) => b.pending - a.pending).slice(0, 10),
        overdueRanking: Object.values(byPersonMap).sort((a, b) => b.overdue - a.overdue).slice(0, 10),
        importantIssues: records.filter(r => r.review_status !== 'approved').slice(0, 10),
        overdueRecords: overdue.slice(0, 20),
        repeatedRejects: records.filter(r => Number(r.reject_count || 0) > 1).sort((a, b) => Number(b.reject_count || 0) - Number(a.reject_count || 0)).slice(0, 20),
        cases,
        recordDates
      }
    });
  } catch (err) {
    console.error("report err:", err);
    res.status(500).json({ code: -1, msg: "服务器错误", data: null });
  }
});

// GET /api/6s/:id
router.get("/:id", authMiddleware, (req, res) => {
  try {
    const r = db.prepare("SELECT s.*, COALESCE((SELECT COUNT(*) FROM s6_review_logs l WHERE l.record_id=s.id AND l.action='rejected'),0) as reject_count FROM six_s_records s WHERE s.id=?").get(req.params.id);
    if (!r) return res.status(404).json({ code: -1, msg: "不存在", data: null });
    const logs = db.prepare("SELECT * FROM s6_review_logs WHERE record_id=? ORDER BY created_at DESC").all(req.params.id);
    res.json({ code: 0, msg: "success", data: { ...r, logs } });
  } catch (err) {
    console.error("detail err:", err);
    res.status(500).json({ code: -1, msg: "服务器错误", data: null });
  }
});

// POST /api/6s - create
router.post("/", authMiddleware, s6Perm, upload.fields([{name:"before_image",maxCount:9},{name:"after_image",maxCount:9}]), (req, res) => {
  (async () => {
  try {
    const { area, description, person_charge, assigned_to, assigned_name, deadline, check_date } = req.body;
    const normalizedCheckDate = normalizeCheckDate(check_date) || getTodayDate();
    if (!area || !description) {
      return res.status(400).json({ code: -1, msg: "区域、问题描述必填", data: null });
    }
    const projectCode = getNextProjectCode(normalizedCheckDate);
    const beforeFiles = req.files?.before_image || [];
    const afterFiles = req.files?.after_image || [];
    const beforeResult = await persist6SFiles(beforeFiles);
    const afterResult = await persist6SFiles(afterFiles);
    const beforeUrls = beforeResult.urls;
    const afterUrls = afterResult.urls;
    const bi = beforeUrls[0] || null;
    const ai = afterUrls[0] || null;
    const cb = req.user.type === "employee" ? req.user.id : req.user.userId;
    const cbUsername = req.user.username || req.user.name || "";
    const now = "datetime('now','localtime')";

    // 如果没有指定截止日期，默认3天
    let finalDeadline = deadline;
    if (!finalDeadline && check_date) {
      finalDeadline = check_date; // 让SQL计算3天后的日期
    }

    // 计算截止日期：如果有check_date则默认+3天
    let deadlineSql = "NULL";
    let deadlineParams = [];
    if (finalDeadline) {
      deadlineSql = "date(?, '+3 days')";
      deadlineParams = [finalDeadline];
    } else if (check_date) {
      deadlineSql = "date(?, '+3 days')";
      deadlineParams = [check_date];
    }

    // 照片时间戳
    const beforeTime = bi ? now : "NULL";
    const afterTime = ai ? now : "NULL";

    const result = db.prepare(`INSERT INTO six_s_records
      (project_code,area,description,person_charge,assigned_to,assigned_name,deadline,before_image,before_images,after_image,after_images,check_date,status,review_status,created_by,created_by_username,before_image_time,after_image_time,created_at,updated_at,review_comment,reject_reason,reviewed_at,reviewed_by,submitted_at,default_deadline_days)
      VALUES (?,?,?,?,?,?,${deadlineSql},?,?,?,?,?,?,?,?,?,${beforeTime},${afterTime},${now},${now},NULL,NULL,NULL,NULL,NULL,3)`)
      .run(projectCode, area, description, person_charge||"", assigned_to||null, assigned_name||person_charge||"", ...deadlineParams, bi, serializeImageList(beforeUrls), ai, serializeImageList(afterUrls), normalizedCheckDate, 'pending', 'pending', cb, cbUsername);

    const recordId = result.lastInsertRowid;
    if (beforeResult.storage === 'local') {
      enqueueS6CloudSync('six_s_records', recordId, 'before_image', 'before_images', beforeUrls);
    }
    if (afterResult.storage === 'local') {
      enqueueS6CloudSync('six_s_records', recordId, 'after_image', 'after_images', afterUrls);
    }
    if (assigned_to) {
      createNotification(
        { type: 'employee', id: Number(assigned_to) },
        {
          ...actorFromRequestUser(req.user),
          category: 's6_assigned',
          module: '6s',
          source_id: recordId,
          title: '收到新的 6S 整改任务',
          content: `${area} · ${description.slice(0, 52)}${description.length > 52 ? '...' : ''}`,
          level: 'warning'
        }
      );
    }

    res.json({ code: 0, msg: "添加成功", data: { project_code: projectCode } });
  } catch (err) {
    console.error("create err:", err);
    res.status(500).json({ code: -1, msg: "服务器错误", data: null });
  }
  })();
});

// PUT /api/6s/:id - update (仅创建者可更新)
router.put("/:id", authMiddleware, upload.fields([{name:"after_image",maxCount:9},{name:"before_image",maxCount:9}]), (req, res) => {
  (async () => {
  try {
    const r = db.prepare("SELECT * FROM six_s_records WHERE id=?").get(req.params.id);
    if (!r) return res.status(404).json({ code: -1, msg: "不存在", data: null });
    const uid = req.user.type === "employee" ? req.user.id : req.user.userId;
    // 仅创建者可更新，或管理员可更新
    if (r.created_by !== uid && req.user.role !== "admin") {
      return res.status(403).json({ code: -1, msg: "无权限更新此记录", data: null });
    }
    const newAfterFiles = req.files?.after_image || [];
    const newBeforeFiles = req.files?.before_image || [];
    const afterResult = newAfterFiles.length ? await persist6SFiles(newAfterFiles) : { urls: normalizeImageList(r.after_images, r.after_image), storage: isCloudUrl(r.after_image) ? 'cloud' : 'local' };
    const afterUrls = afterResult.urls;
    const ai = afterUrls[0] || null;
    const beforeResult = newBeforeFiles.length ? await persist6SFiles(newBeforeFiles) : { urls: normalizeImageList(r.before_images, r.before_image), storage: isCloudUrl(r.before_image) ? 'cloud' : 'local' };
    const beforeUrls = beforeResult.urls;
    const bi = beforeUrls[0] || null;
    const { deadline, description, person_charge, area, project_code } = req.body;
    db.prepare("UPDATE six_s_records SET after_image=?,after_images=?,before_image=?,before_images=?,deadline=COALESCE(?,deadline),description=COALESCE(?,description),person_charge=COALESCE(?,person_charge),area=COALESCE(?,area),project_code=COALESCE(?,project_code),updated_at=datetime('now','localtime') WHERE id=?")
      .run(ai, serializeImageList(afterUrls), bi, serializeImageList(beforeUrls), deadline, description, person_charge, area, project_code, req.params.id);
    if (newBeforeFiles.length) {
      deleteQueueRowsForField('six_s_records', req.params.id, 'before_image');
      if (beforeResult.storage === 'local') {
        enqueueS6CloudSync('six_s_records', req.params.id, 'before_image', 'before_images', beforeUrls);
      }
      for (const imageUrl of normalizeImageList(r.before_images, r.before_image)) {
        if (isCloudUrl(imageUrl)) await deleteFromCloud(imageUrl);
      }
    }
    if (newAfterFiles.length) {
      deleteQueueRowsForField('six_s_records', req.params.id, 'after_image');
      if (afterResult.storage === 'local') {
        enqueueS6CloudSync('six_s_records', req.params.id, 'after_image', 'after_images', afterUrls);
      }
      for (const imageUrl of normalizeImageList(r.after_images, r.after_image)) {
        if (isCloudUrl(imageUrl)) await deleteFromCloud(imageUrl);
      }
    }
    res.json({ code: 0, msg: "更新成功", data: null });
  } catch (err) {
    console.error("update err:", err);
    res.status(500).json({ code: -1, msg: "服务器错误", data: null });
  }
  })();
});

// PUT /api/6s/:id/submit - 责任人提交整改；6S管理员可代提交整改
router.put("/:id/submit", authMiddleware, upload.fields([{name:"after_image",maxCount:9}]), (req, res) => {
  (async () => {
  try {
    const r = db.prepare("SELECT * FROM six_s_records WHERE id=?").get(req.params.id);
    if (!r) return res.status(404).json({ code: -1, msg: "不存在", data: null });
    const uid = req.user.type === "employee" ? req.user.id : req.user.userId;
    const isS6Admin = req.user.type === "employee" && req.user.s6_permission === 1;

    // 责任人或6S管理员可提交；管理员用于代提交整改
    if ((!r.assigned_to || r.assigned_to !== uid) && !isS6Admin) {
      return res.status(403).json({ code: -1, msg: "您不是此记录的责任人", data: null });
    }
    // 仅在 pending 或 rejected 状态下可提交
    if (!['pending', 'rejected'].includes(r.review_status)) {
      return res.status(400).json({ code: -1, msg: "当前状态不允许提交整改", data: null });
    }
    const newAfterFiles = req.files?.after_image || [];
    const afterResult = newAfterFiles.length ? await persist6SFiles(newAfterFiles) : { urls: normalizeImageList(r.after_images, r.after_image), storage: isCloudUrl(r.after_image) ? 'cloud' : 'local' };
    const afterUrls = afterResult.urls;
    const ai = afterUrls[0] || null;
    if (!ai) return res.status(400).json({ code: -1, msg: "请上传整改后照片", data: null });
    db.prepare("UPDATE six_s_records SET after_image=?,after_images=?,status='fixed',review_status='submitted',reject_reason=NULL,review_comment=NULL,reviewed_at=NULL,reviewed_by=NULL,submitted_at=datetime('now','localtime'),after_image_time=datetime('now','localtime'),updated_at=datetime('now','localtime') WHERE id=?")
      .run(ai, serializeImageList(afterUrls), req.params.id);
    const submitLog = logReview(req.params.id, "submit", isS6Admin && r.assigned_to !== uid ? "管理员代提交整改待审核" : "提交整改", uid, req.user.name||"", afterUrls);
    deleteQueueRowsForField('six_s_records', req.params.id, 'after_image');
    if (afterResult.storage === 'local') {
      enqueueS6CloudSync('six_s_records', req.params.id, 'after_image', 'after_images', afterUrls);
      enqueueS6CloudSync('s6_review_logs', submitLog.lastInsertRowid, 'image', 'images', afterUrls);
    }
    createNotifications(
      listS6AdminRecipients(),
      {
        ...actorFromRequestUser(req.user),
        category: 's6_submitted',
        module: '6s',
        source_id: Number(req.params.id),
        title: '有新的 6S 整改待审核',
        content: `${r.area || '6S问题'} · ${r.assigned_name || r.person_charge || '责任人'} 已提交整改`,
        level: 'info'
      }
    );
    res.json({ code: 0, msg: "整改已提交，等待审核", data: null });
  } catch (err) {
    console.error("submit err:", err);
    res.status(500).json({ code: -1, msg: "服务器错误", data: null });
  }
  })();
});

// PUT /api/6s/:id/recheck - 6S管理员复核整改（待整改阶段直接判定）
router.put("/:id/recheck", authMiddleware, s6Perm, upload.fields([{name:"after_image",maxCount:9}]), (req, res) => {
  (async () => {
  try {
    const r = db.prepare("SELECT * FROM six_s_records WHERE id=?").get(req.params.id);
    if (!r) return res.status(404).json({ code: -1, msg: "不存在", data: null });
    if (!['pending', 'rejected'].includes(r.review_status)) {
      return res.status(400).json({ code: -1, msg: "当前状态不允许复核整改", data: null });
    }

    const uid = req.user.type === "employee" ? req.user.id : req.user.userId;
    const un = req.user.name || "";
    const { action, comment } = req.body || {};
    if (!["approved", "rejected"].includes(action)) {
      return res.status(400).json({ code: -1, msg: "操作无效", data: null });
    }
    if (action === "rejected" && !String(comment || "").trim()) {
      return res.status(400).json({ code: -1, msg: "未达标请填写审核意见", data: null });
    }

    const newAfterFiles = req.files?.after_image || [];
    const afterResult = newAfterFiles.length ? await persist6SFiles(newAfterFiles) : { urls: normalizeImageList(r.after_images, r.after_image), storage: isCloudUrl(r.after_image) ? 'cloud' : 'local' };
    const afterUrls = afterResult.urls;
    const ai = afterUrls[0] || null;
    if (!ai) return res.status(400).json({ code: -1, msg: "请上传整改后照片", data: null });

    if (action === "approved") {
      const approvedComment = `6S管理员${un || ''}代提交整改`;
      db.prepare("UPDATE six_s_records SET after_image=?,after_images=?,status='fixed',review_status='approved',review_comment=?,reject_reason=NULL,submitted_at=datetime('now','localtime'),after_image_time=datetime('now','localtime'),reviewed_at=datetime('now','localtime'),reviewed_by=?,updated_at=datetime('now','localtime') WHERE id=?")
        .run(ai, serializeImageList(afterUrls), approvedComment, uid, req.params.id);
      const approvedLog = logReview(req.params.id, "approved", approvedComment, uid, un, afterUrls);
      deleteQueueRowsForField('six_s_records', req.params.id, 'after_image');
      if (afterResult.storage === 'local') {
        enqueueS6CloudSync('six_s_records', req.params.id, 'after_image', 'after_images', afterUrls);
        enqueueS6CloudSync('s6_review_logs', approvedLog.lastInsertRowid, 'image', 'images', afterUrls);
      }
      if (r.assigned_to) {
        createNotification(
          { type: 'employee', id: Number(r.assigned_to) },
          {
            ...actorFromRequestUser(req.user),
            category: 's6_review',
            module: '6s',
            source_id: Number(req.params.id),
            title: '你的 6S 整改复核已通过',
            content: `${r.area || '6S问题'} · ${approvedComment}`,
            level: 'success'
          }
        );
      }
      return res.json({ code: 0, msg: "已达标", data: null });
    }

    db.prepare("UPDATE six_s_records SET review_status='pending',status='pending',review_comment=NULL,reject_reason=?,reviewed_at=datetime('now','localtime'),reviewed_by=?,after_image=NULL,after_images=NULL,updated_at=datetime('now','localtime') WHERE id=?")
      .run(String(comment || "").trim(), uid, req.params.id);
    const rejectLog = logReview(req.params.id, "rejected", String(comment || "").trim(), uid, un, afterUrls);
    deleteQueueRowsForField('six_s_records', req.params.id, 'after_image');
    if (afterResult.storage === 'local') {
      enqueueS6CloudSync('s6_review_logs', rejectLog.lastInsertRowid, 'image', 'images', afterUrls);
    }
    if (r.assigned_to) {
      createNotification(
        { type: 'employee', id: Number(r.assigned_to) },
        {
          ...actorFromRequestUser(req.user),
          category: 's6_review',
          module: '6s',
          source_id: Number(req.params.id),
          title: '你的 6S 整改复核未通过',
          content: `${r.area || '6S问题'} · ${String(comment || "").trim()}`,
          level: 'warning'
        }
      );
    }
    return res.json({ code: 0, msg: "未达标", data: null });
  } catch (err) {
    console.error("recheck err:", err);
    res.status(500).json({ code: -1, msg: "服务器错误", data: null });
  }
  })();
});

// PUT /api/6s/:id/review - 审核（通过/驳回）
router.put("/:id/review", authMiddleware, s6Perm, (req, res) => {
  try {
    const r = db.prepare("SELECT * FROM six_s_records WHERE id=?").get(req.params.id);
    if (!r) return res.status(404).json({ code: -1, msg: "不存在", data: null });
    // 必须先提交才能审核
    if (r.review_status !== "submitted") return res.status(400).json({ code: -1, msg: "未提交整改", data: null });
    const { action, comment } = req.body;
    if (!["approved","rejected"].includes(action)) return res.status(400).json({ code: -1, msg: "操作无效", data: null });
    const uid = req.user.type === "employee" ? req.user.id : req.user.userId;
    const un = req.user.name||"";
    if (action === "approved") {
      db.prepare("UPDATE six_s_records SET review_status='approved',review_comment=?,reject_reason=NULL,reviewed_at=datetime('now','localtime'),reviewed_by=?,updated_at=datetime('now','localtime') WHERE id=?").run(comment||null, uid, req.params.id);
      logReview(req.params.id, "approved", comment, uid, un);
      if (r.assigned_to) {
        createNotification(
          { type: 'employee', id: Number(r.assigned_to) },
          {
            ...actorFromRequestUser(req.user),
            category: 's6_review',
            module: '6s',
            source_id: Number(req.params.id),
            title: '你的 6S 整改已审核通过',
            content: `${r.area || '6S问题'} · ${comment || '请继续保持'}`,
            level: 'success'
          }
        );
      }
      res.json({ code: 0, msg: "已达标", data: null });
    } else {
      if (!comment) return res.status(400).json({ code: -1, msg: "驳回请填理由", data: null });
      // 驳回后退回待整改状态，而不是rejected
      db.prepare("UPDATE six_s_records SET review_status='pending',reject_reason=?,reviewed_at=datetime('now','localtime'),reviewed_by=?,after_image=NULL,after_images=NULL,updated_at=datetime('now','localtime') WHERE id=?").run(comment, uid, req.params.id);
      const rejectedImages = normalizeImageList(r.after_images, r.after_image);
      const rejectLog = logReview(req.params.id, "rejected", comment, uid, un, rejectedImages, r.after_image_time);
      if (rejectedImages.some((url) => !isCloudUrl(url))) {
        enqueueS6CloudSync('s6_review_logs', rejectLog.lastInsertRowid, 'image', 'images', rejectedImages);
      }
      if (r.assigned_to) {
        createNotification(
          { type: 'employee', id: Number(r.assigned_to) },
          {
            ...actorFromRequestUser(req.user),
            category: 's6_review',
            module: '6s',
            source_id: Number(req.params.id),
            title: '你的 6S 整改被退回',
            content: `${r.area || '6S问题'} · ${comment}`,
            level: 'warning'
          }
        );
      }
      res.json({ code: 0, msg: "未达标", data: null });
    }
  } catch (err) {
    console.error("review err:", err);
    res.status(500).json({ code: -1, msg: "服务器错误", data: null });
  }
});

// DELETE /api/6s/:id
router.delete("/:id", authMiddleware, adminMiddleware, (req, res) => {
  (async () => {
  try {
    const r = db.prepare("SELECT * FROM six_s_records WHERE id=?").get(req.params.id);
    if (!r) return res.status(404).json({ code: -1, msg: "不存在", data: null });
    for (const imageUrl of normalizeImageList(r.before_images, r.before_image)) {
      if (isCloudUrl(imageUrl)) await deleteFromCloud(imageUrl);
    }
    for (const imageUrl of normalizeImageList(r.after_images, r.after_image)) {
      if (isCloudUrl(imageUrl)) await deleteFromCloud(imageUrl);
    }
    const logs = db.prepare("SELECT * FROM s6_review_logs WHERE record_id=?").all(req.params.id);
    for (const log of logs) {
      for (const imageUrl of normalizeImageList(log.images, log.image)) {
        if (isCloudUrl(imageUrl)) await deleteFromCloud(imageUrl);
      }
      deleteQueueRowsForTarget('s6_review_logs', log.id);
    }
    deleteQueueRowsForTarget('six_s_records', req.params.id);
    db.prepare("DELETE FROM s6_review_logs WHERE record_id=?").run(req.params.id);
    db.prepare("DELETE FROM six_s_records WHERE id=?").run(req.params.id);
    res.json({ code: 0, msg: "删除成功", data: null });
  } catch (err) {
    console.error("delete err:", err);
    res.status(500).json({ code: -1, msg: "服务器错误", data: null });
  }
  })();
});

module.exports = router;
