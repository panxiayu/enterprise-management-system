// src/routes/meal.js - 报餐系统（按日报名，支持中餐/晚餐启用控制）
const express = require('express');
const router = express.Router();
const db = require('../models/database');
const Joi = require('joi');
const { authMiddleware, adminMiddleware } = require('../middleware/auth');
const EventEmitter = require('events');

// 食堂实时推送事件
const canteenEmitter = new EventEmitter();
canteenEmitter.setMaxListeners(100);

const emptyCanteenStats = () => ({
  lunch_employee: 0,
  dinner_employee: 0,
  lunch_guest: 0,
  dinner_guest: 0,
  lunch_guests: [],
  dinner_guests: []
});

// 推送更新到食堂端
function notifyCanteenUpdate() {
  canteenEmitter.emit('update');
}

// 食堂端 SSE 流
router.get('/canteen-stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');

  // 发送初始连接成功
  res.write('event: connected\ndata: ok\n\n');

  // 立即发送当前数据
  const today = new Date();
  const todayStr = today.toISOString().slice(0, 10);

  const activities = db.prepare(`
    SELECT id, title FROM meal_activities_v4
    WHERE is_active = 1 AND date('now') BETWEEN start_date AND end_date
  `).all();

  if (activities.length > 0) {
    const activityIds = activities.map(a => a.id);
    const placeholders = activityIds.map(() => '?').join(',');

    const stats = db.prepare(`
      SELECT
        SUM(CASE WHEN meal_type = 'lunch' AND guest_count = 0 THEN employee_count ELSE 0 END) as lunch_employee,
        SUM(CASE WHEN meal_type = 'dinner' AND guest_count = 0 THEN employee_count ELSE 0 END) as dinner_employee,
        SUM(CASE WHEN meal_type = 'lunch' AND guest_count > 0 THEN guest_count ELSE 0 END) as lunch_guest,
        SUM(CASE WHEN meal_type = 'dinner' AND guest_count > 0 THEN guest_count ELSE 0 END) as dinner_guest
      FROM meal_signups_v4
      WHERE activity_id IN (${placeholders}) AND signup_date = ?
    `).get(...activityIds, todayStr);

    res.write(`event: data\ndata: ${JSON.stringify(stats)}\n\n`);
  } else {
    res.write(`event: data\ndata: ${JSON.stringify(emptyCanteenStats())}\n\n`);
  }

  // 监听更新
  const handler = () => {
    const now = new Date();
    const ts = now.toISOString().slice(0, 10);

    const acts = db.prepare(`
      SELECT id FROM meal_activities_v4
      WHERE is_active = 1 AND date('now') BETWEEN start_date AND end_date
    `).all();

    if (acts.length === 0) {
      res.write(`event: update\ndata: ${JSON.stringify(emptyCanteenStats())}\n\n`);
      return;
    }

    const ids = acts.map(a => a.id);
    const ph = ids.map(() => '?').join(',');

    const data = db.prepare(`
      SELECT
        SUM(CASE WHEN meal_type = 'lunch' AND guest_count = 0 THEN employee_count ELSE 0 END) as lunch_employee,
        SUM(CASE WHEN meal_type = 'dinner' AND guest_count = 0 THEN employee_count ELSE 0 END) as dinner_employee,
        SUM(CASE WHEN meal_type = 'lunch' AND guest_count > 0 THEN guest_count ELSE 0 END) as lunch_guest,
        SUM(CASE WHEN meal_type = 'dinner' AND guest_count > 0 THEN guest_count ELSE 0 END) as dinner_guest
      FROM meal_signups_v4
      WHERE activity_id IN (${ph}) AND signup_date = ?
    `).get(...ids, ts);

    res.write(`event: update\ndata: ${JSON.stringify(data)}\n\n`);
  };

  canteenEmitter.on('update', handler);

  // 清理
  req.on('close', () => {
    canteenEmitter.off('update', handler);
  });
});

// 获取用户ID
const getUserId = (req) => {
  return req.user.type === 'employee' ? req.user.id : req.user.userId;
};

// 验证Schema
const createActivitySchema = Joi.object({
  title: Joi.string().required().max(100),
  start_date: Joi.date().required(),
  end_date: Joi.date().required().min(Joi.ref('start_date')),
  lunch_enabled: Joi.number().integer().min(0).max(1).default(1),
  lunch_signup_start: Joi.string().pattern(/^([01]\d|2[0-3]):([0-5]\d)$/).default('09:00'),
  lunch_signup_end: Joi.string().pattern(/^([01]\d|2[0-3]):([0-5]\d)$/).default('10:30'),
  dinner_enabled: Joi.number().integer().min(0).max(1).default(1),
  dinner_signup_start: Joi.string().pattern(/^([01]\d|2[0-3]):([0-5]\d)$/).default('14:00'),
  dinner_signup_end: Joi.string().pattern(/^([01]\d|2[0-3]):([0-5]\d)$/).default('15:30'),
  is_temporary: Joi.number().integer().min(0).max(1).default(0),
  guest_lunch_enabled: Joi.number().integer().min(0).max(1).default(0),
  guest_lunch_start: Joi.string().pattern(/^([01]\d|2[0-3]):([0-5]\d)$/).default('09:00'),
  guest_lunch_end: Joi.string().pattern(/^([01]\d|2[0-3]):([0-5]\d)$/).default('10:30'),
  guest_dinner_enabled: Joi.number().integer().min(0).max(1).default(0),
  guest_dinner_start: Joi.string().pattern(/^([01]\d|2[0-3]):([0-5]\d)$/).default('14:00'),
  guest_dinner_end: Joi.string().pattern(/^([01]\d|2[0-3]):([0-5]\d)$/).default('15:30')
});

const signupSchema = Joi.object({
  date: Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/).required(),
  lunch_employee: Joi.number().integer().min(0).default(0),
  lunch_guest: Joi.number().integer().min(0).default(0),
  dinner_employee: Joi.number().integer().min(0).default(0),
  dinner_guest: Joi.number().integer().min(0).default(0),
  guest_reason: Joi.string().max(200).default('')
});

// 创建报餐活动
// POST /api/meal/create
router.post('/create', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { error, value } = createActivitySchema.validate(req.body);
    if (error) {
      return res.status(400).json({ code: -1, msg: error.details[0].message, data: null });
    }

    const { title, lunch_enabled, lunch_signup_start, lunch_signup_end,
            dinner_enabled, dinner_signup_start, dinner_signup_end, is_temporary,
            guest_lunch_enabled, guest_lunch_start, guest_lunch_end,
            guest_dinner_enabled, guest_dinner_start, guest_dinner_end } = value;

    // 使用原始字符串，不经过 Joi 日期转换
    const start_date = req.body.start_date;
    const end_date = req.body.end_date;

    // deadline 默认为结束日期的 23:59
    const deadline = end_date + ' 23:59:59';

    const stmt = db.prepare(`
      INSERT INTO meal_activities_v4 (title, start_date, end_date, lunch_enabled, lunch_signup_start, lunch_signup_end,
        dinner_enabled, dinner_signup_start, dinner_signup_end, deadline, created_by, is_temporary,
        guest_lunch_enabled, guest_lunch_start, guest_lunch_end, guest_dinner_enabled, guest_dinner_start, guest_dinner_end)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const result = stmt.run(title, start_date, end_date, lunch_enabled, lunch_signup_start, lunch_signup_end,
      dinner_enabled, dinner_signup_start, dinner_signup_end, deadline, req.user.userId, is_temporary || 0,
      guest_lunch_enabled || 0, guest_lunch_start || '09:00', guest_lunch_end || '10:30',
      guest_dinner_enabled || 0, guest_dinner_start || '14:00', guest_dinner_end || '15:30');

    res.json({
      code: 0,
      msg: '报餐活动创建成功',
      data: { id: result.lastInsertRowid, title, start_date, end_date }
    });
  } catch (err) {
    console.error('创建报餐活动失败:', err);
    res.status(500).json({ code: -1, msg: '服务器错误', data: null });
  }
});

// 获取报餐活动列表
// GET /api/meal/list
router.get('/list', authMiddleware, (req, res) => {
  try {
    const isAdmin = req.user.type !== 'employee';
    const userId = getUserId(req);

    // 获取当前用户的客餐权限
    let canGuestMeal = 0;
    if (!isAdmin) {
      const userPerm = db.prepare('SELECT guest_meal_permission FROM staff WHERE id = ?').get(userId);
      canGuestMeal = userPerm?.guest_meal_permission || 0;
    }

    let activities;
    if (isAdmin) {
      activities = db.prepare(`
        SELECT id, title, start_date, end_date, lunch_enabled, lunch_signup_start, lunch_signup_end,
          dinner_enabled, dinner_signup_start, dinner_signup_end, deadline, is_active, is_temporary, created_at,
          guest_lunch_enabled, guest_lunch_start, guest_lunch_end,
          guest_dinner_enabled, guest_dinner_start, guest_dinner_end
        FROM meal_activities_v4 ORDER BY is_temporary DESC, start_date DESC
      `).all();
    } else {
      // 只有今天在日期范围内的特殊报餐才优先
      // 未开始的特殊报餐不应该优先于常规报餐
      activities = db.prepare(`
        SELECT id, title, start_date, end_date, lunch_enabled, lunch_signup_start, lunch_signup_end,
          dinner_enabled, dinner_signup_start, dinner_signup_end, deadline, is_active, is_temporary, created_at,
          guest_lunch_enabled, guest_lunch_start, guest_lunch_end,
          guest_dinner_enabled, guest_dinner_start, guest_dinner_end
        FROM meal_activities_v4
        WHERE is_active = 1 AND datetime(end_date || ' 23:59:59') >= datetime('now')
        ORDER BY CASE WHEN is_temporary = 1 AND date('now') BETWEEN start_date AND end_date THEN 0 ELSE 1 END,
                 start_date ASC
      `).all();
    }

    const now = new Date();

    const result = activities.map(activity => {
      const deadline = new Date(activity.deadline);
      const endDate = new Date(activity.end_date + ' 23:59:59');
      const isExpired = now > deadline;

      // 检查当前是否在报餐时间段内（使用本地时间）
      // 统一使用 YYYY-MM-DD 格式
      const nowDateStr = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');

      // 将时间转换为分钟数进行比较（如 "08:30" -> 510）
      const timeToMinutes = (timeStr) => {
        const [h, m] = timeStr.split(':').map(Number);
        return h * 60 + m;
      };
      const nowMinutes = now.getHours() * 60 + now.getMinutes();
      const lunchStart = timeToMinutes(activity.lunch_signup_start);
      const lunchEnd = timeToMinutes(activity.lunch_signup_end);
      const dinnerStart = timeToMinutes(activity.dinner_signup_start);
      const dinnerEnd = timeToMinutes(activity.dinner_signup_end);

      const isInLunchWindow = activity.lunch_enabled === 1 &&
        nowDateStr >= activity.start_date && nowDateStr <= activity.end_date &&
        nowMinutes >= lunchStart && nowMinutes <= lunchEnd;

      const isInDinnerWindow = activity.dinner_enabled === 1 &&
        nowDateStr >= activity.start_date && nowDateStr <= activity.end_date &&
        nowMinutes >= dinnerStart && nowMinutes <= dinnerEnd;

      // 客餐时间窗口
      const guestLunchStart = timeToMinutes(activity.guest_lunch_start);
      const guestLunchEnd = timeToMinutes(activity.guest_lunch_end);
      const guestDinnerStart = timeToMinutes(activity.guest_dinner_start);
      const guestDinnerEnd = timeToMinutes(activity.guest_dinner_end);

      const isInGuestLunchWindow = activity.guest_lunch_enabled === 1 &&
        nowDateStr >= activity.start_date && nowDateStr <= activity.end_date &&
        nowMinutes >= guestLunchStart && nowMinutes <= guestLunchEnd;

      const isInGuestDinnerWindow = activity.guest_dinner_enabled === 1 &&
        nowDateStr >= activity.start_date && nowDateStr <= activity.end_date &&
        nowMinutes >= guestDinnerStart && nowMinutes <= guestDinnerEnd;

      // 检查用户是否有客餐权限（非管理员才需要检查）
      const userHasGuestPerm = isAdmin ? true : (canGuestMeal === 1);

      // canGuestLunch/Dinner 需要同时满足：用户有权限 + 时间窗口内
      const canGuestLunch = userHasGuestPerm && isInGuestLunchWindow;
      const canGuestDinner = userHasGuestPerm && isInGuestDinnerWindow;

      // 获取用户今天的报名（包含原由）- 使用本地时间
      // 统一使用 YYYY-MM-DD 格式
      const todayStr = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');
      const signups = db.prepare(`
        SELECT id, meal_type, employee_count, guest_count, reason FROM meal_signups_v4
        WHERE activity_id = ? AND user_id = ? AND signup_date = ?
      `).all(activity.id, userId, todayStr);

      // 分离员工餐和客餐记录（四种数据完全独立）
      // 员工午餐：meal_type='lunch' 且 employee_count > 0
      // 员工晚餐：meal_type='dinner' 且 employee_count > 0
      // 客餐午餐：meal_type='lunch' 且 guest_count > 0
      // 客餐晚餐：meal_type='dinner' 且 guest_count > 0
      const employeeLunch = signups.find(s => s.meal_type === 'lunch' && s.employee_count > 0);
      const employeeDinner = signups.find(s => s.meal_type === 'dinner' && s.employee_count > 0);
      const guestLunches = signups.filter(s => s.meal_type === 'lunch' && s.guest_count > 0);
      const guestDinners = signups.filter(s => s.meal_type === 'dinner' && s.guest_count > 0);

      return {
        ...activity,
        isExpired,
        canSignupLunch: isInLunchWindow && !isExpired,
        canSignupDinner: isInDinnerWindow && !isExpired,
        canGuestLunch: canGuestLunch && !isExpired,
        canGuestDinner: canGuestDinner && !isExpired,
        canGuestMeal,
        todayEmployeeLunch: employeeLunch || null,
        todayEmployeeDinner: employeeDinner || null,
        todayGuestLunches: guestLunches,
        todayGuestDinners: guestDinners
      };
    });

    res.json({ code: 0, msg: 'success', data: result });
  } catch (err) {
    console.error('获取报餐活动列表失败:', err);
    res.status(500).json({ code: -1, msg: '服务器错误', data: null });
  }
});

// 获取所有报餐活动统计（管理员）- 必须在 /:id 前面定义
// GET /api/meal/all/statistics
router.get('/all/statistics', authMiddleware, adminMiddleware, (req, res) => {
  try {
    const activities = db.prepare(`
      SELECT id, title, start_date, end_date, lunch_enabled, lunch_signup_start, lunch_signup_end,
        dinner_enabled, dinner_signup_start, dinner_signup_end, deadline, is_temporary,
        guest_lunch_enabled, guest_lunch_start, guest_lunch_end,
        guest_dinner_enabled, guest_dinner_start, guest_dinner_end
      FROM meal_activities_v4 ORDER BY is_temporary DESC, start_date DESC
    `).all();

    const today = new Date().toISOString().slice(0, 10);

    const result = activities.map(activity => {
      // 全部统计数据
      const stats = db.prepare(`
        SELECT meal_type,
          COUNT(DISTINCT user_id) as people,
          SUM(employee_count) as employee,
          SUM(guest_count) as guest,
          SUM(employee_count + guest_count) as total
        FROM meal_signups_v4 WHERE activity_id = ?
        GROUP BY meal_type
      `).all(activity.id);

      const lunchStats = stats.find(s => s.meal_type === 'lunch');
      const dinnerStats = stats.find(s => s.meal_type === 'dinner');

      // 当天统计数据
      const todayStats = db.prepare(`
        SELECT meal_type,
          SUM(employee_count) as employee,
          SUM(guest_count) as guest
        FROM meal_signups_v4
        WHERE activity_id = ? AND signup_date = ?
        GROUP BY meal_type
      `).all(activity.id, today);

      const todayLunch = todayStats.find(s => s.meal_type === 'lunch') || { employee: 0, guest: 0 };
      const todayDinner = todayStats.find(s => s.meal_type === 'dinner') || { employee: 0, guest: 0 };

      return {
        ...activity,
        statistics: {
          lunch: { people: lunchStats?.people || 0, employee: lunchStats?.employee || 0, guest: lunchStats?.guest || 0, total: lunchStats?.total || 0 },
          dinner: { people: dinnerStats?.people || 0, employee: dinnerStats?.employee || 0, guest: dinnerStats?.guest || 0, total: dinnerStats?.total || 0 },
          combined: {
            people: (lunchStats?.people || 0) + (dinnerStats?.people || 0),
            employee: (lunchStats?.employee || 0) + (dinnerStats?.employee || 0),
            guest: (lunchStats?.guest || 0) + (dinnerStats?.guest || 0),
            total: (lunchStats?.total || 0) + (dinnerStats?.total || 0)
          }
        },
        todayStats: {
          lunch_employee: todayLunch.employee || 0,
          lunch_guest: todayLunch.guest || 0,
          dinner_employee: todayDinner.employee || 0,
          dinner_guest: todayDinner.guest || 0
        }
      };
    });

    res.json({ code: 0, msg: 'success', data: result });
  } catch (err) {
    console.error('获取全部报餐统计失败:', err);
    res.status(500).json({ code: -1, msg: '服务器错误', data: null });
  }
});

// 获取我的报餐记录
// GET /api/meal/my-records
router.get('/my-records', authMiddleware, (req, res) => {
  try {
    const userId = getUserId(req);
    const limit = parseInt(req.query.limit) || 5;

    const records = db.prepare(`
      SELECT s.id, s.activity_id, s.signup_date, s.meal_type, s.employee_count, s.guest_count, s.reason, s.created_at,
        a.title, a.is_temporary
      FROM meal_signups_v4 s
      LEFT JOIN meal_activities_v4 a ON s.activity_id = a.id
      WHERE s.user_id = ?
      ORDER BY s.signup_date DESC, s.meal_type DESC
      LIMIT ?
    `).all(userId, limit);

    res.json({ code: 0, msg: 'success', data: records });
  } catch (err) {
    console.error('获取报餐记录失败:', err);
    res.status(500).json({ code: -1, msg: '服务器错误', data: null });
  }
});

// 获取客餐权限列表
// GET /api/meal/guest-permissions
router.get('/guest-permissions', authMiddleware, adminMiddleware, (req, res) => {
  try {
    const staff = db.prepare(`
      SELECT id, employee_id, name, department, team, position, guest_meal_permission
      FROM staff
      WHERE status = 'active'
      ORDER BY employee_id
    `).all();

    const total = staff.length;
    const withPermission = staff.filter(s => s.guest_meal_permission === 1).length;

    res.json({ code: 0, msg: 'success', data: { staff, total, withPermission } });
  } catch (err) {
    console.error('获取客餐权限失败:', err);
    res.status(500).json({ code: -1, msg: '服务器错误', data: null });
  }
});

// 更新客餐权限
// PUT /api/meal/guest-permissions
router.put('/guest-permissions', authMiddleware, adminMiddleware, (req, res) => {
  try {
    const { staff_ids, enabled } = req.body;

    if (!Array.isArray(staff_ids)) {
      return res.status(400).json({ code: -1, msg: '参数错误', data: null });
    }

    const transaction = db.transaction(() => {
      // 先清除所有权限
      db.prepare('UPDATE staff SET guest_meal_permission = 0').run();
      // 再给指定人员加权限
      if (enabled && staff_ids.length > 0) {
        const placeholders = staff_ids.map(() => '?').join(',');
        db.prepare(`UPDATE staff SET guest_meal_permission = 1 WHERE id IN (${placeholders})`).run(...staff_ids);
      }
    });

    transaction();

    res.json({ code: 0, msg: '更新成功', data: null });
  } catch (err) {
    console.error('更新客餐权限失败:', err);
    res.status(500).json({ code: -1, msg: '服务器错误', data: null });
  }
});

// 食堂端公开统计接口（无需登录）
// GET /api/meal/canteen-today
// 特殊报餐优先级高于常规报餐
router.get('/canteen-today', (req, res) => {
  try {
    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const day = String(today.getDate()).padStart(2, '0');
    const todayStr = `${year}-${month}-${day}`;

    // 优先获取特殊报餐活动（is_temporary=1），没有则获取常规活动
    const specialActivities = db.prepare(`
      SELECT id, title FROM meal_activities_v4
      WHERE is_active = 1 AND is_temporary = 1
      AND date('now') BETWEEN start_date AND end_date
      ORDER BY start_date DESC LIMIT 1
    `).all();

    let activities = specialActivities;
    let priorityType = 'special';

    // 如果没有特殊报餐，获取常规报餐
    if (activities.length === 0) {
      activities = db.prepare(`
        SELECT id, title FROM meal_activities_v4
        WHERE is_active = 1 AND (is_temporary = 0 OR is_temporary IS NULL)
        AND date('now') BETWEEN start_date AND end_date
        ORDER BY is_temporary DESC, start_date DESC LIMIT 1
      `).all();
      priorityType = 'regular';
    }

    if (activities.length === 0) {
      return res.json({ code: 0, msg: 'success', data: { ...emptyCanteenStats(), priority: 'none' } });
    }

    // 只统计优先级最高的活动（特殊优先于常规）
    const activityId = activities[0].id;

    const stats = db.prepare(`
      SELECT
        SUM(CASE WHEN meal_type = 'lunch' AND guest_count = 0 THEN employee_count ELSE 0 END) as lunch_employee,
        SUM(CASE WHEN meal_type = 'dinner' AND guest_count = 0 THEN employee_count ELSE 0 END) as dinner_employee,
        SUM(CASE WHEN meal_type = 'lunch' AND guest_count > 0 THEN guest_count ELSE 0 END) as lunch_guest,
        SUM(CASE WHEN meal_type = 'dinner' AND guest_count > 0 THEN guest_count ELSE 0 END) as dinner_guest
      FROM meal_signups_v4
      WHERE activity_id = ? AND signup_date = ?
    `).get(activityId, todayStr);

    // 获取客餐明细（只统计优先级最高的活动）
    const lunchGuestsRaw = db.prepare(`
      SELECT s.guest_count, s.reason,
        COALESCE(st.employee_id, stu.employee_id) as employee_id,
        COALESCE(st.name, stu.name) as name
      FROM meal_signups_v4 s
      LEFT JOIN staff st ON s.user_id = st.id
      LEFT JOIN student_roster stu ON s.user_id = stu.id
      WHERE s.activity_id = ? AND s.signup_date = ? AND s.guest_count > 0 AND s.meal_type = 'lunch'
      ORDER BY s.id
    `).all(activityId, todayStr);

    const dinnerGuestsRaw = db.prepare(`
      SELECT s.guest_count, s.reason,
        COALESCE(st.employee_id, stu.employee_id) as employee_id,
        COALESCE(st.name, stu.name) as name
      FROM meal_signups_v4 s
      LEFT JOIN staff st ON s.user_id = st.id
      LEFT JOIN student_roster stu ON s.user_id = stu.id
      WHERE s.activity_id = ? AND s.signup_date = ? AND s.guest_count > 0 AND s.meal_type = 'dinner'
      ORDER BY s.id
    `).all(activityId, todayStr);

    res.json({
      code: 0,
      msg: 'success',
      data: {
        lunch_employee: stats?.lunch_employee || 0,
        dinner_employee: stats?.dinner_employee || 0,
        lunch_guest: stats?.lunch_guest || 0,
        dinner_guest: stats?.dinner_guest || 0,
        lunch_guests: lunchGuestsRaw,
        dinner_guests: dinnerGuestsRaw,
        priority: priorityType,
        activity_title: activities[0].title
      }
    });
  } catch (err) {
    console.error('获取食堂统计失败:', err);
    res.status(500).json({ code: -1, msg: '服务器错误', data: null });
  }
});

// 获取今日报餐统计(dashboard 用)
// GET /api/meal/stats/today
router.get('/stats/today', authMiddleware, (req, res) => {
  try {
    // 用本地时间取今日(避免服务器 UTC 跨日问题)
    const row = db.prepare(`
      SELECT
        COALESCE(SUM(employee_count), 0) AS employee_total,
        COALESCE(SUM(guest_count), 0) AS guest_total,
        COALESCE(SUM(employee_count + guest_count), 0) AS total
      FROM meal_signups_v4
      WHERE signup_date = date('now', 'localtime')
    `).get();

    res.json({
      code: 0,
      msg: 'success',
      data: {
        employeeCount: Number(row?.employee_total || 0),
        guestCount: Number(row?.guest_total || 0),
        total: Number(row?.total || 0)
      }
    });
  } catch (err) {
    console.error('获取今日报餐统计失败:', err);
    res.status(500).json({ code: -1, msg: '服务器错误', data: null });
  }
});

router.get('/:id', authMiddleware, (req, res) => {
  try {
    const { id } = req.params;

    const activity = db.prepare(`
      SELECT id, title, start_date, end_date, lunch_enabled, lunch_signup_start, lunch_signup_end,
        dinner_enabled, dinner_signup_start, dinner_signup_end, deadline, is_active, created_at,
        guest_lunch_enabled, guest_lunch_start, guest_lunch_end,
        guest_dinner_enabled, guest_dinner_start, guest_dinner_end
      FROM meal_activities_v4 WHERE id = ?
    `).get(id);

    if (!activity) {
      return res.status(404).json({ code: -1, msg: '报餐活动不存在', data: null });
    }

    res.json({ code: 0, msg: 'success', data: activity });
  } catch (err) {
    console.error('获取报餐活动详情失败:', err);
    res.status(500).json({ code: -1, msg: '服务器错误', data: null });
  }
});

// 报餐报名（按日）
// POST /api/meal/:id/signup
router.post('/:id/signup', authMiddleware, (req, res) => {
  try {
    const { id } = req.params;
    const { error, value } = signupSchema.validate(req.body);
    if (error) {
      return res.status(400).json({ code: -1, msg: error.details[0].message, data: null });
    }

    const { date, lunch_employee, lunch_guest, dinner_employee, dinner_guest, guest_reason } = value;

    // 检查活动是否存在
    const activity = db.prepare('SELECT * FROM meal_activities_v4 WHERE id = ?').get(id);
    if (!activity) {
      return res.status(404).json({ code: -1, msg: '报餐活动不存在', data: null });
    }

    // 检查日期是否在活动范围内
    if (date < activity.start_date || date > activity.end_date) {
      return res.status(400).json({ code: -1, msg: '日期不在活动范围内', data: null });
    }

    // 检查是否在报名截止前
    const now = new Date();
    const deadline = new Date(activity.deadline);
    if (now > deadline) {
      return res.status(400).json({ code: -1, msg: '报名已截止', data: null });
    }

    // 检查报餐时间段
    const nowTimeStr = now.toTimeString().slice(0, 5);
    const nowMinutes = parseInt(nowTimeStr.slice(0, 2)) * 60 + parseInt(nowTimeStr.slice(3, 5));
    const lunchTotal = lunch_employee + lunch_guest;
    const dinnerTotal = dinner_employee + dinner_guest;

    if (lunchTotal > 0) {
      // 员工午餐必须 lunch_enabled 启用
      if (lunch_employee > 0 && !activity.lunch_enabled) {
        return res.status(400).json({ code: -1, msg: '中餐未启用', data: null });
      }
      // 客餐午餐必须 guest_lunch_enabled 启用
      if (lunch_guest > 0 && !activity.guest_lunch_enabled) {
        return res.status(400).json({ code: -1, msg: '客餐午餐未启用', data: null });
      }
      // 员工午餐时间窗口
      if (lunch_employee > 0) {
        const lunchStart = parseInt(activity.lunch_signup_start.slice(0, 2)) * 60 + parseInt(activity.lunch_signup_start.slice(3, 5));
        const lunchEnd = parseInt(activity.lunch_signup_end.slice(0, 2)) * 60 + parseInt(activity.lunch_signup_end.slice(3, 5));
        if (nowMinutes < lunchStart || nowMinutes > lunchEnd) {
          return res.status(400).json({ code: -1, msg: `中餐报餐时间 ${activity.lunch_signup_start} - ${activity.lunch_signup_end}`, data: null });
        }
      }
      // 客餐午餐时间窗口
      if (lunch_guest > 0) {
        const guestLunchStart = parseInt(activity.guest_lunch_start.slice(0, 2)) * 60 + parseInt(activity.guest_lunch_start.slice(3, 5));
        const guestLunchEnd = parseInt(activity.guest_lunch_end.slice(0, 2)) * 60 + parseInt(activity.guest_lunch_end.slice(3, 5));
        if (nowMinutes < guestLunchStart || nowMinutes > guestLunchEnd) {
          return res.status(400).json({ code: -1, msg: `客餐午餐报餐时间 ${activity.guest_lunch_start} - ${activity.guest_lunch_end}`, data: null });
        }
      }
    }

    if (dinnerTotal > 0) {
      // 员工晚餐必须 dinner_enabled 启用
      if (dinner_employee > 0 && !activity.dinner_enabled) {
        return res.status(400).json({ code: -1, msg: '晚餐未启用', data: null });
      }
      // 客餐晚餐必须 guest_dinner_enabled 启用
      if (dinner_guest > 0 && !activity.guest_dinner_enabled) {
        return res.status(400).json({ code: -1, msg: '客餐晚餐未启用', data: null });
      }
      // 员工晚餐时间窗口
      if (dinner_employee > 0) {
        const dinnerStart = parseInt(activity.dinner_signup_start.slice(0, 2)) * 60 + parseInt(activity.dinner_signup_start.slice(3, 5));
        const dinnerEnd = parseInt(activity.dinner_signup_end.slice(0, 2)) * 60 + parseInt(activity.dinner_signup_end.slice(3, 5));
        if (nowMinutes < dinnerStart || nowMinutes > dinnerEnd) {
          return res.status(400).json({ code: -1, msg: `晚餐报餐时间 ${activity.dinner_signup_start} - ${activity.dinner_signup_end}`, data: null });
        }
      }
      // 客餐晚餐时间窗口
      if (dinner_guest > 0) {
        const guestDinnerStart = parseInt(activity.guest_dinner_start.slice(0, 2)) * 60 + parseInt(activity.guest_dinner_start.slice(3, 5));
        const guestDinnerEnd = parseInt(activity.guest_dinner_end.slice(0, 2)) * 60 + parseInt(activity.guest_dinner_end.slice(3, 5));
        if (nowMinutes < guestDinnerStart || nowMinutes > guestDinnerEnd) {
          return res.status(400).json({ code: -1, msg: `客餐晚餐报餐时间 ${activity.guest_dinner_start} - ${activity.guest_dinner_end}`, data: null });
        }
      }
    }

    // 注意：lunchTotal/dinnerTotal 为 0 时会在下面事务中删除对应记录，这是正常的取消报名操作
    // 检查客餐权限
    let userId = getUserId(req);

    // 如果 user_id > 100000，自动修正（兼容旧 token）
    if (userId > 100000) {
      const correctedId = userId - 100000;
      const staffExists = db.prepare('SELECT id FROM staff WHERE id = ?').get(correctedId);
      const studentExists = db.prepare('SELECT id FROM student_roster WHERE id = ?').get(correctedId);

      if (staffExists || studentExists) {
        console.log(`[Meal] Corrected user_id from ${userId} to ${correctedId}`);
        userId = correctedId;
      }
    }

    const isAdmin = req.user.type !== 'employee';
    if (!isAdmin) {
      const userPerm = db.prepare('SELECT guest_meal_permission FROM staff WHERE id = ?').get(userId);
      const canGuest = userPerm?.guest_meal_permission || 0;

      if ((lunch_guest > 0 || dinner_guest > 0) && !canGuest) {
        return res.status(400).json({ code: -1, msg: '您没有客餐报餐权限', data: null });
      }
    }

    // 获取已存在的员工餐报名数据用于合并（客餐不需要检查，已改为每次新增）
    const existingEmployeeLunch = db.prepare(`SELECT id, employee_count, guest_count FROM meal_signups_v4 WHERE activity_id = ? AND user_id = ? AND signup_date = ? AND meal_type = 'lunch' AND employee_count > 0`).get(id, userId, date);
    const existingEmployeeDinner = db.prepare(`SELECT id, employee_count, guest_count FROM meal_signups_v4 WHERE activity_id = ? AND user_id = ? AND signup_date = ? AND meal_type = 'dinner' AND employee_count > 0`).get(id, userId, date);

    // 检查请求中是否包含这些字段（而不是依赖 Joi 默认值）
    const hasLunchEmployee = req.body.hasOwnProperty('lunch_employee');
    const hasLunchGuest = req.body.hasOwnProperty('lunch_guest');
    const hasDinnerEmployee = req.body.hasOwnProperty('dinner_employee');
    const hasDinnerGuest = req.body.hasOwnProperty('dinner_guest');

    // 客餐原由
    const guestReason = req.body.guest_reason || '';

    // 检查取消时间窗口（当设置为0时视为取消操作）
    if (hasLunchEmployee && lunch_employee === 0 && existingEmployeeLunch) {
      const lunchStart = parseInt(activity.lunch_signup_start.slice(0, 2)) * 60 + parseInt(activity.lunch_signup_start.slice(3, 5));
      const lunchEnd = parseInt(activity.lunch_signup_end.slice(0, 2)) * 60 + parseInt(activity.lunch_signup_end.slice(3, 5));
      if (nowMinutes < lunchStart || nowMinutes > lunchEnd) {
        return res.status(400).json({ code: -1, msg: '已超过午餐报餐时间，无法取消', data: null });
      }
    }
    if (hasDinnerEmployee && dinner_employee === 0 && existingEmployeeDinner) {
      const dinnerStart = parseInt(activity.dinner_signup_start.slice(0, 2)) * 60 + parseInt(activity.dinner_signup_start.slice(3, 5));
      const dinnerEnd = parseInt(activity.dinner_signup_end.slice(0, 2)) * 60 + parseInt(activity.dinner_signup_end.slice(3, 5));
      if (nowMinutes < dinnerStart || nowMinutes > dinnerEnd) {
        return res.status(400).json({ code: -1, msg: '已超过晚餐报餐时间，无法取消', data: null });
      }
    }

    // 员工餐：独立记录，只更新自己的count，不影响客餐
    const finalLunchEmployee = hasLunchEmployee ? lunch_employee : (existingEmployeeLunch?.employee_count || 0);
    const finalDinnerEmployee = hasDinnerEmployee ? dinner_employee : (existingEmployeeDinner?.employee_count || 0);

    // 事务处理：四种数据完全独立
    const transaction = db.transaction(() => {
      // 员工午餐：独立记录，只写employee_count，guest_count=0
      if (finalLunchEmployee > 0) {
        if (existingEmployeeLunch) {
          db.prepare(`UPDATE meal_signups_v4 SET employee_count = ?, guest_count = 0, reason = NULL WHERE id = ?`)
            .run(finalLunchEmployee, existingEmployeeLunch.id);
        } else {
          db.prepare(`INSERT INTO meal_signups_v4 (activity_id, user_id, signup_date, meal_type, employee_count, guest_count, reason) VALUES (?, ?, ?, 'lunch', ?, 0, NULL)`)
            .run(id, userId, date, finalLunchEmployee);
        }
      } else if (existingEmployeeLunch) {
        db.prepare(`DELETE FROM meal_signups_v4 WHERE id = ?`).run(existingEmployeeLunch.id);
      }

      // 员工晚餐：独立记录，只写employee_count，guest_count=0
      if (finalDinnerEmployee > 0) {
        if (existingEmployeeDinner) {
          db.prepare(`UPDATE meal_signups_v4 SET employee_count = ?, guest_count = 0, reason = NULL WHERE id = ?`)
            .run(finalDinnerEmployee, existingEmployeeDinner.id);
        } else {
          db.prepare(`INSERT INTO meal_signups_v4 (activity_id, user_id, signup_date, meal_type, employee_count, guest_count, reason) VALUES (?, ?, ?, 'dinner', ?, 0, NULL)`)
            .run(id, userId, date, finalDinnerEmployee);
        }
      } else if (existingEmployeeDinner) {
        db.prepare(`DELETE FROM meal_signups_v4 WHERE id = ?`).run(existingEmployeeDinner.id);
      }

      // 客餐午餐：独立记录，employee_count=0，每次报餐都新增记录，不覆盖之前的
      if (lunch_guest > 0 && guestReason) {
        db.prepare(`INSERT INTO meal_signups_v4 (activity_id, user_id, signup_date, meal_type, employee_count, guest_count, reason) VALUES (?, ?, ?, 'lunch', 0, ?, ?)`)
          .run(id, userId, date, lunch_guest, guestReason);
      }

      // 客餐晚餐：独立记录，employee_count=0，每次报餐都新增记录，不覆盖之前的
      if (dinner_guest > 0 && guestReason) {
        db.prepare(`INSERT INTO meal_signups_v4 (activity_id, user_id, signup_date, meal_type, employee_count, guest_count, reason) VALUES (?, ?, ?, 'dinner', 0, ?, ?)`)
          .run(id, userId, date, dinner_guest, guestReason);
      }
    });

    transaction();

    // 推送更新到食堂端
    notifyCanteenUpdate();

    res.json({
      code: 0,
      msg: '报餐成功',
      data: { lunch: { employee: lunch_employee, guest: lunch_guest }, dinner: { employee: dinner_employee, guest: dinner_guest } }
    });
  } catch (err) {
    console.error('报餐失败:', err);
    res.status(500).json({ code: -1, msg: '服务器错误', data: null });
  }
});

// 删除单条报餐记录
// DELETE /api/meal/:id/signup/:recordId
router.delete('/:id/signup/:recordId', authMiddleware, (req, res) => {
  try {
    const { id, recordId } = req.params;
    const userId = getUserId(req);

    // 检查记录是否存在且属于当前用户
    const record = db.prepare(`
      SELECT id, meal_type, employee_count, guest_count, signup_date FROM meal_signups_v4
      WHERE id = ? AND activity_id = ? AND user_id = ?
    `).get(recordId, id, userId);

    if (!record) {
      return res.status(404).json({ code: -1, msg: '记录不存在', data: null });
    }

    // 获取活动信息，检查取消时间限制
    const activity = db.prepare(`
      SELECT lunch_signup_start, lunch_signup_end, dinner_signup_start, dinner_signup_end,
             lunch_enabled, dinner_enabled, guest_lunch_start, guest_lunch_end,
             guest_dinner_start, guest_dinner_end, guest_lunch_enabled, guest_dinner_enabled
      FROM meal_activities_v4 WHERE id = ?
    `).get(id);

    if (activity) {
      const now = new Date();
      const nowMinutes = parseInt(now.toTimeString().slice(0, 2)) * 60 + parseInt(now.toTimeString().slice(3, 5));

      // 根据报餐类型检查是否在允许取消的时间窗口内
      if (record.meal_type === 'lunch') {
        // 午餐取消时间窗口
        const start = parseInt(activity.lunch_signup_start.slice(0, 2)) * 60 + parseInt(activity.lunch_signup_start.slice(3, 5));
        const end = parseInt(activity.lunch_signup_end.slice(0, 2)) * 60 + parseInt(activity.lunch_signup_end.slice(3, 5));
        if (nowMinutes < start || nowMinutes > end) {
          return res.status(400).json({ code: -1, msg: '已超过午餐报餐时间，无法取消', data: null });
        }
      } else if (record.meal_type === 'dinner') {
        // 晚餐取消时间窗口
        const start = parseInt(activity.dinner_signup_start.slice(0, 2)) * 60 + parseInt(activity.dinner_signup_start.slice(3, 5));
        const end = parseInt(activity.dinner_signup_end.slice(0, 2)) * 60 + parseInt(activity.dinner_signup_end.slice(3, 5));
        if (nowMinutes < start || nowMinutes > end) {
          return res.status(400).json({ code: -1, msg: '已超过晚餐报餐时间，无法取消', data: null });
        }
      }
    }

    db.prepare(`DELETE FROM meal_signups_v4 WHERE id = ?`).run(recordId);

    // 推送更新到食堂端
    notifyCanteenUpdate();

    res.json({ code: 0, msg: '已取消报餐', data: null });
  } catch (err) {
    console.error('取消报餐失败:', err);
    res.status(500).json({ code: -1, msg: '服务器错误', data: null });
  }
});

// 临时报餐权限：拥有报餐管理权限的用户
function temporaryMealAdminMiddleware(req, res, next) {
  if (!req.user.can_manage_meal) {
    return res.status(403).json({ code: -1, msg: '无临时报餐权限', data: null });
  }
  next();
}

// 临时报餐（管理员代填报，批量）
// POST /api/meal/temporary-signup
router.post('/temporary-signup', authMiddleware, temporaryMealAdminMiddleware, (req, res) => {
  try {
    const { applicants, meal_type, guest_count, reason } = req.body;

    // 参数验证
    if (!applicants || !Array.isArray(applicants) || applicants.length === 0) {
      return res.status(400).json({ code: -1, msg: '请添加申请人', data: null });
    }

    if (!meal_type || !['lunch', 'dinner'].includes(meal_type)) {
      return res.status(400).json({ code: -1, msg: '无效的餐别', data: null });
    }

    // 时间窗口验证
    const now = new Date();
    const hours = now.getHours();
    const minutes = now.getMinutes();
    const timeValue = hours + minutes / 60;

    let allowedMealType = null;
    if (meal_type === 'lunch' && timeValue < 11) {
      allowedMealType = 'lunch';
    } else if (meal_type === 'dinner' && timeValue >= 11 && timeValue < 16.5) {
      allowedMealType = 'dinner';
    }

    if (!allowedMealType) {
      return res.status(400).json({
        code: -1,
        msg: '已超过临时报餐时间（午餐11:00前，晚餐16:30前）',
        data: null
      });
    }

    // 获取当前进行中的活动（特殊报餐优先）
    const today = now.toISOString().slice(0, 10);
    let activity = db.prepare(`
      SELECT id FROM meal_activities_v4
      WHERE is_active = 1 AND is_temporary = 1 AND date('now') BETWEEN start_date AND end_date
      ORDER BY start_date DESC LIMIT 1
    `).get();

    if (!activity) {
      activity = db.prepare(`
        SELECT id FROM meal_activities_v4
        WHERE is_active = 1 AND (is_temporary = 0 OR is_temporary IS NULL)
        AND date('now') BETWEEN start_date AND end_date
        ORDER BY is_temporary DESC, start_date DESC LIMIT 1
      `).get();
    }

    if (!activity) {
      return res.status(400).json({ code: -1, msg: '当前没有进行中的报餐活动', data: null });
    }

    const isGuest = meal_type.startsWith('guest_');
    const actualMealType = isGuest ? meal_type.replace('guest_', '') : meal_type;

    // 客餐必须填写缘由
    if (isGuest && (!reason || reason.trim() === '')) {
      return res.status(400).json({ code: -1, msg: '客餐必须填写缘由', data: null });
    }

    // 事务处理：批量插入临时报餐记录
    const transaction = db.transaction(() => {
      applicants.forEach(applicant => {
        const { employee_id, employee_name } = applicant;
        if (!employee_id) return;

        // 先查员工表
        let staff = db.prepare('SELECT id FROM staff WHERE employee_id = ?').get(employee_id);
        let userId, isStudent = false;

        if (staff) {
          userId = staff.id;
        } else {
          // 查学生名册
          const student = db.prepare('SELECT id FROM student_roster WHERE employee_id = ?').get(employee_id);
          if (student) {
            userId = student.id;
            isStudent = true;
          } else {
            return; // 找不到跳过
          }
        }

        const empCount = isGuest ? 0 : 1;
        const guestCnt = isGuest ? (guest_count || 1) : 0;

        db.prepare(`
          INSERT INTO meal_signups_v4 (activity_id, user_id, signup_date, meal_type, employee_count, guest_count, reason, is_temporary)
          VALUES (?, ?, ?, ?, ?, ?, ?, 1)
        `).run(
          activity.id,
          userId,
          today,
          actualMealType,
          empCount,
          guestCnt,
          isGuest ? (reason || null) : null
        );
      });
    });

    transaction();

    // 推送更新到食堂端
    notifyCanteenUpdate();

    res.json({ code: 0, msg: '临时报餐成功', data: { count: applicants.length } });
  } catch (err) {
    console.error('临时报餐失败:', err);
    res.status(500).json({ code: -1, msg: '服务器错误', data: null });
  }
});

/**
 * GET /api/meal/temporary-signups/today
 * 获取今日临时报餐记录
 */
router.get('/temporary-signups/today', authMiddleware, (req, res) => {
  try {
    const today = new Date().toISOString().slice(0, 10);

    const records = db.prepare(`
      SELECT s.id, s.activity_id, s.user_id, s.signup_date, s.meal_type,
             s.employee_count, s.guest_count, s.reason, s.created_at,
             COALESCE(st.employee_id, stu.employee_id) as employee_id,
             COALESCE(st.name, stu.name) as name,
             COALESCE(st.department, stu.department) as department,
             COALESCE(st.team, stu.sub_department) as team,
             CASE WHEN stu.name IS NOT NULL THEN '实训生' ELSE COALESCE(st.position, '') END as position
      FROM meal_signups_v4 s
      LEFT JOIN staff st ON s.user_id = st.id
      LEFT JOIN student_roster stu ON s.user_id = stu.id
      WHERE s.signup_date = ? AND s.is_temporary = 1
      ORDER BY s.created_at DESC
    `).all(today);

    res.json({ code: 0, msg: 'success', data: records });
  } catch (err) {
    console.error('获取临时报餐记录失败:', err);
    res.status(500).json({ code: -1, msg: '服务器错误', data: null });
  }
});

/**
 * DELETE /api/meal/temporary-signups/:id
 * 删除临时报餐记录
 */
router.delete('/temporary-signups/:id', authMiddleware, (req, res) => {
  try {
    const { id } = req.params;

    const record = db.prepare('SELECT * FROM meal_signups_v4 WHERE id = ? AND is_temporary = 1').get(id);
    if (!record) {
      return res.status(404).json({ code: -1, msg: '临时报餐记录不存在', data: null });
    }

    // 获取活动信息，检查取消时间限制
    const activity = db.prepare(`
      SELECT lunch_signup_start, lunch_signup_end, dinner_signup_start, dinner_signup_end,
             lunch_enabled, dinner_enabled, guest_lunch_start, guest_lunch_end,
             guest_dinner_start, guest_dinner_end, guest_lunch_enabled, guest_dinner_enabled
      FROM meal_activities_v4 WHERE id = ?
    `).get(record.activity_id);

    if (activity) {
      const now = new Date();
      const nowMinutes = parseInt(now.toTimeString().slice(0, 2)) * 60 + parseInt(now.toTimeString().slice(3, 5));

      // 根据报餐类型检查是否在允许取消的时间窗口内
      if (record.meal_type === 'lunch') {
        // 午餐取消时间窗口
        const start = parseInt(activity.lunch_signup_start.slice(0, 2)) * 60 + parseInt(activity.lunch_signup_start.slice(3, 5));
        const end = parseInt(activity.lunch_signup_end.slice(0, 2)) * 60 + parseInt(activity.lunch_signup_end.slice(3, 5));
        if (nowMinutes < start || nowMinutes > end) {
          return res.status(400).json({ code: -1, msg: '已超过午餐报餐时间，无法取消', data: null });
        }
      } else if (record.meal_type === 'dinner') {
        // 晚餐取消时间窗口
        const start = parseInt(activity.dinner_signup_start.slice(0, 2)) * 60 + parseInt(activity.dinner_signup_start.slice(3, 5));
        const end = parseInt(activity.dinner_signup_end.slice(0, 2)) * 60 + parseInt(activity.dinner_signup_end.slice(3, 5));
        if (nowMinutes < start || nowMinutes > end) {
          return res.status(400).json({ code: -1, msg: '已超过晚餐报餐时间，无法取消', data: null });
        }
      }
    }

    db.prepare('DELETE FROM meal_signups_v4 WHERE id = ?').run(id);

    // 推送更新到食堂端
    notifyCanteenUpdate();

    res.json({ code: 0, msg: '已取消临时报餐', data: null });
  } catch (err) {
    console.error('取消临时报餐失败:', err);
    res.status(500).json({ code: -1, msg: '服务器错误', data: null });
  }
});

// 获取报餐统计
// GET /api/meal/:id/statistics
// query params: year (显示的年份), month (显示的月份)
router.get('/:id/statistics', authMiddleware, adminMiddleware, (req, res) => {
  try {
    const { id } = req.params;
    const year = parseInt(req.query.year) || new Date().getFullYear();
    const month = parseInt(req.query.month) || (new Date().getMonth() + 1);

    const activity = db.prepare(`
      SELECT id, title, start_date, end_date, lunch_enabled, lunch_signup_start, lunch_signup_end,
        dinner_enabled, dinner_signup_start, dinner_signup_end, deadline, is_active,
        guest_lunch_enabled, guest_lunch_start, guest_lunch_end,
        guest_dinner_enabled, guest_dinner_start, guest_dinner_end
      FROM meal_activities_v4 WHERE id = ?
    `).get(id);

    if (!activity) {
      return res.status(404).json({ code: -1, msg: '报餐活动不存在', data: null });
    }

    // 生成活动日期范围内、当月内的所有日期
    // 即：活动日期范围 与 当月日期范围 的交集
    const activityStart = new Date(activity.start_date);
    const activityEnd = new Date(activity.end_date);
    const monthFirstDay = new Date(year, month - 1, 1);
    const monthLastDay = new Date(year, month, 0);

    const dates = [];
    // 从 (活动开始, 当月1日) 的较晚者开始
    const startDate = activityStart > monthFirstDay ? activityStart : monthFirstDay;
    // 到 (活动结束, 当月末) 的较早者结束
    const endDate = activityEnd < monthLastDay ? activityEnd : monthLastDay;

    if (startDate <= endDate) {
      for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        dates.push(`${y}-${m}-${day}`);
      }
    }

    // 获取活动日期范围内、当月内的所有数据（用于totals统计）
    // 注意：totals 统计整个活动范围的数据，不是日历月
    const activityMonthStart = activityStart > monthFirstDay ? activityStart : monthFirstDay;
    const activityMonthEnd = activityEnd < monthLastDay ? activityEnd : monthLastDay;
    const actStartStr = activityMonthStart.toISOString().slice(0, 10);
    const actEndStr = activityMonthEnd.toISOString().slice(0, 10);

    // 构建当月日期范围用于SQL过滤（用于日历显示）
    const monthStart = `${year}-${String(month).padStart(2, '0')}-01`;
    const monthEnd = `${year}-${String(month).padStart(2, '0')}-${String(monthLastDay.getDate()).padStart(2, '0')}`;

    // 按日期和餐次统计（查询整个日历月所有活动的数据）
    const dailyStats = db.prepare(`
      SELECT signup_date, meal_type,
        COUNT(DISTINCT user_id) as people,
        SUM(employee_count) as employee,
        SUM(guest_count) as guest,
        SUM(employee_count + guest_count) as total
      FROM meal_signups_v4
      WHERE signup_date >= ? AND signup_date <= ?
      GROUP BY signup_date, meal_type
      ORDER BY signup_date
    `).all(monthStart, monthEnd);

    // 获取每日每餐的员工详情（包含学生，查询整个日历月所有活动的数据）
    const dailyDetails = db.prepare(`
      SELECT s.signup_date, s.meal_type, s.employee_count, s.guest_count, s.is_temporary,
        COALESCE(st.employee_id, stu.employee_id) as employee_id,
        COALESCE(st.name, stu.name) as name,
        COALESCE(st.department, stu.department) as department,
        COALESCE(st.team, stu.sub_department) as team,
        CASE WHEN stu.name IS NOT NULL THEN '实训生' ELSE COALESCE(st.position, '') END as position
      FROM meal_signups_v4 s
      LEFT JOIN staff st ON s.user_id = st.id
      LEFT JOIN student_roster stu ON s.user_id = stu.id
      WHERE s.employee_count > 0 AND s.signup_date >= ? AND s.signup_date <= ?
      ORDER BY s.signup_date, s.meal_type
    `).all(monthStart, monthEnd);

    // 获取每日每餐的客餐详情（查询整个日历月所有活动的数据）
    const guestDetailsRaw = db.prepare(`
      SELECT s.signup_date, s.meal_type, s.guest_count, s.reason, s.is_temporary,
        COALESCE(st.employee_id, stu.employee_id) as reporter_id,
        COALESCE(st.name, stu.name) as reporter_name
      FROM meal_signups_v4 s
      LEFT JOIN staff st ON s.user_id = st.id
      LEFT JOIN student_roster stu ON s.user_id = stu.id
      WHERE s.guest_count > 0 AND s.signup_date >= ? AND s.signup_date <= ?
      ORDER BY s.signup_date, s.meal_type
    `).all(monthStart, monthEnd);

    // totals 统计：整个日历月的数据（不限于活动日期范围）
    // 过滤条件：signup_date 在当月范围内
    const totalDailyStats = db.prepare(`
      SELECT meal_type,
        SUM(employee_count) as employee,
        SUM(guest_count) as guest
      FROM meal_signups_v4
      WHERE signup_date >= ? AND signup_date <= ?
      GROUP BY meal_type
    `).all(monthStart, monthEnd);

    // 按日期和餐次分组员工详情
    const detailsMap = {};
    dailyDetails.forEach(d => {
      const key = `${d.signup_date}_${d.meal_type}`;
      if (!detailsMap[key]) {
        detailsMap[key] = [];
      }
      if (d.employee_id) {
        detailsMap[key].push({
          employee_id: d.employee_id,
          name: d.name,
          department: d.department || '',
          team: d.team || '',
          position: d.position || '',
          count: d.employee_count,
          is_temporary: d.is_temporary || 0
        });
      }
    });

    // 按日期和餐次分组客餐详情
    const guestDetailsMap = {};
    guestDetailsRaw.forEach(d => {
      const key = `${d.signup_date}_${d.meal_type}`;
      if (!guestDetailsMap[key]) {
        guestDetailsMap[key] = [];
      }
      guestDetailsMap[key].push({
        count: d.guest_count,
        reason: d.reason || '',
        reporter_id: d.reporter_id || '',
        reporter_name: d.reporter_name || '',
        is_temporary: d.is_temporary || 0
      });
    });

    // 按日期分组
    const statsMap = {};
    dailyStats.forEach(s => {
      if (!statsMap[s.signup_date]) {
        statsMap[s.signup_date] = { lunch: null, dinner: null };
      }
      const key = `${s.signup_date}_${s.meal_type}`;
      statsMap[s.signup_date][s.meal_type] = {
        people: s.people,
        employee: s.employee || 0,
        guest: s.guest || 0,
        total: s.total || 0
      };
    });

    // 总计（四个字段完全独立）- 统计整个活动范围的数据
    const lunchStats = totalDailyStats.filter(s => s.meal_type === 'lunch');
    const dinnerStats = totalDailyStats.filter(s => s.meal_type === 'dinner');
    const totals = {
      lunch_employee: lunchStats.reduce((acc, s) => acc + (s.employee || 0), 0),
      lunch_guest: lunchStats.reduce((acc, s) => acc + (s.guest || 0), 0),
      dinner_employee: dinnerStats.reduce((acc, s) => acc + (s.employee || 0), 0),
      dinner_guest: dinnerStats.reduce((acc, s) => acc + (s.guest || 0), 0)
    };

    res.json({
      code: 0,
      msg: 'success',
      data: {
        activity,
        dates,
        dailyStats: statsMap,
        dailyDetails: detailsMap,
        guestDetails: guestDetailsMap,
        totals
      }
    });
  } catch (err) {
    console.error('获取报餐统计失败:', err);
    res.status(500).json({ code: -1, msg: '服务器错误', data: null });
  }
});

// 获取活动当天的统计数据
// GET /api/meal/:id/today-stats
router.get('/:id/today-stats', authMiddleware, adminMiddleware, (req, res) => {
  try {
    const { id } = req.params;
    const today = new Date().toISOString().slice(0, 10);

    const activity = db.prepare('SELECT * FROM meal_activities_v4 WHERE id = ?').get(id);
    if (!activity) {
      return res.status(404).json({ code: -1, msg: '报餐活动不存在', data: null });
    }

    // 统计当天的数据
    const stats = db.prepare(`
      SELECT meal_type,
        SUM(employee_count) as employee,
        SUM(guest_count) as guest
      FROM meal_signups_v4
      WHERE activity_id = ? AND signup_date = ?
      GROUP BY meal_type
    `).all(id, today);

    const lunchStats = stats.find(s => s.meal_type === 'lunch') || { employee: 0, guest: 0 };
    const dinnerStats = stats.find(s => s.meal_type === 'dinner') || { employee: 0, guest: 0 };

    res.json({
      code: 0,
      msg: 'success',
      data: {
        lunch_employee: lunchStats.employee || 0,
        lunch_guest: lunchStats.guest || 0,
        dinner_employee: dinnerStats.employee || 0,
        dinner_guest: dinnerStats.guest || 0
      }
    });
  } catch (err) {
    console.error('获取当天统计失败:', err);
    res.status(500).json({ code: -1, msg: '服务器错误', data: null });
  }
});

// 更新报餐活动（中餐/晚餐启用控制）
// PUT /api/meal/:id
router.put('/:id', authMiddleware, adminMiddleware, (req, res) => {
  try {
    const { id } = req.params;
    const { lunch_enabled, dinner_enabled, guest_lunch_enabled, guest_dinner_enabled,
            guest_lunch_start, guest_lunch_end, guest_dinner_start, guest_dinner_end } = req.body;

    const activity = db.prepare('SELECT * FROM meal_activities_v4 WHERE id = ?').get(id);
    if (!activity) {
      return res.status(404).json({ code: -1, msg: '报餐活动不存在', data: null });
    }

    if (lunch_enabled !== undefined) {
      db.prepare('UPDATE meal_activities_v4 SET lunch_enabled = ? WHERE id = ?').run(lunch_enabled ? 1 : 0, id);
    }
    if (dinner_enabled !== undefined) {
      db.prepare('UPDATE meal_activities_v4 SET dinner_enabled = ? WHERE id = ?').run(dinner_enabled ? 1 : 0, id);
    }
    if (guest_lunch_enabled !== undefined) {
      db.prepare('UPDATE meal_activities_v4 SET guest_lunch_enabled = ? WHERE id = ?').run(guest_lunch_enabled ? 1 : 0, id);
    }
    if (guest_dinner_enabled !== undefined) {
      db.prepare('UPDATE meal_activities_v4 SET guest_dinner_enabled = ? WHERE id = ?').run(guest_dinner_enabled ? 1 : 0, id);
    }
    if (guest_lunch_start !== undefined) {
      db.prepare('UPDATE meal_activities_v4 SET guest_lunch_start = ? WHERE id = ?').run(guest_lunch_start, id);
    }
    if (guest_lunch_end !== undefined) {
      db.prepare('UPDATE meal_activities_v4 SET guest_lunch_end = ? WHERE id = ?').run(guest_lunch_end, id);
    }
    if (guest_dinner_start !== undefined) {
      db.prepare('UPDATE meal_activities_v4 SET guest_dinner_start = ? WHERE id = ?').run(guest_dinner_start, id);
    }
    if (guest_dinner_end !== undefined) {
      db.prepare('UPDATE meal_activities_v4 SET guest_dinner_end = ? WHERE id = ?').run(guest_dinner_end, id);
    }

    res.json({ code: 0, msg: '更新成功', data: null });
  } catch (err) {
    console.error('更新报餐活动失败:', err);
    res.status(500).json({ code: -1, msg: '服务器错误', data: null });
  }
});

// 删除报餐活动
// DELETE /api/meal/:id
router.delete('/:id', authMiddleware, adminMiddleware, (req, res) => {
  try {
    const { id } = req.params;

    const activity = db.prepare('SELECT * FROM meal_activities_v4 WHERE id = ?').get(id);
    if (!activity) {
      return res.status(404).json({ code: -1, msg: '报餐活动不存在', data: null });
    }

    db.prepare('DELETE FROM meal_signups_v4 WHERE activity_id = ?').run(id);
    db.prepare('DELETE FROM meal_activities_v4 WHERE id = ?').run(id);

    res.json({ code: 0, msg: '删除成功', data: null });
  } catch (err) {
    console.error('删除报餐活动失败:', err);
    res.status(500).json({ code: -1, msg: '服务器错误', data: null });
  }
});

module.exports = router;
