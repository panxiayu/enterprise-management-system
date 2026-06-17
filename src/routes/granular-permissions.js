// src/routes/granular-permissions.js - 粒化权限管理 API
const express = require('express');
const router = express.Router();
const db = require('../models/database');
const { authMiddleware, adminMiddleware } = require('../middleware/auth');

// ============ 考试权限 API ============

// GET /api/permissions/exams - 获取所有培训及其权限状态
router.get('/exams', authMiddleware, (req, res) => {
    try {
        const trainings = db.prepare(`
            SELECT et.*,
                (SELECT COUNT(*) FROM exam_permissions ep WHERE ep.exam_id = et.id AND ep.can_take = 1) as perm_count
            FROM exam_trainings et
            ORDER BY et.created_at DESC
        `).all();

        res.json({ code: 0, data: trainings });
    } catch (err) {
        console.error('获取培训列表失败:', err);
        res.status(500).json({ code: -1, msg: '服务器错误' });
    }
});

// GET /api/permissions/exams/my-perm - 检查当前用户是否有培训权限
router.get('/exams/my-perm', authMiddleware, (req, res) => {
    try {
        const uid = req.user.type === 'employee' ? req.user.id : req.user.userId;

        // 检查用户是否在任何考试的权限列表中
        const perm = db.prepare(`
            SELECT COUNT(*) as cnt FROM exam_permissions
            WHERE staff_id = ? AND can_take = 1
        `).get(uid);

        res.json({ code: 0, data: { has_perm: perm.cnt > 0 } });
    } catch (err) {
        console.error('检查培训权限失败:', err);
        res.status(500).json({ code: -1, msg: '服务器错误' });
    }
});

// GET /api/permissions/exams/:id/staff - 获取某考试的权限员工列表
router.get('/exams/:id/staff', authMiddleware, (req, res) => {
    try {
        const { id } = req.params;
        const staff = db.prepare(`
            SELECT s.id, s.employee_id, s.name, s.department,
                CASE WHEN ep.id IS NOT NULL THEN 1 ELSE 0 END as has_perm
            FROM staff s
            LEFT JOIN exam_permissions ep ON s.id = ep.staff_id AND ep.exam_id = ? AND ep.can_take = 1
            WHERE s.status = 'active'
            ORDER BY s.employee_id
        `).all(id);

        res.json({ code: 0, data: staff });
    } catch (err) {
        console.error('获取考试权限员工失败:', err);
        res.status(500).json({ code: -1, msg: '服务器错误' });
    }
});

// PUT /api/permissions/exams/:id/staff - 批量更新考试权限
router.put('/exams/:id/staff', authMiddleware, adminMiddleware, (req, res) => {
    try {
        const { id } = req.params;
        const { staff_ids } = req.body;

        if (!Array.isArray(staff_ids)) {
            return res.status(400).json({ code: -1, msg: '参数错误' });
        }

        // 先删除该考试的所有权限
        db.prepare('DELETE FROM exam_permissions WHERE exam_id = ?').run(id);

        // 重新插入
        const insertStmt = db.prepare('INSERT INTO exam_permissions (exam_id, staff_id, can_take) VALUES (?, ?, 1)');
        for (const staffId of staff_ids) {
            try {
                insertStmt.run(id, staffId);
                // 同时更新 staff 表的旧版权限字段，确保兼容
                db.prepare('UPDATE staff SET exam_permission = 1 WHERE id = ?').run(staffId);
            } catch (e) {}
        }

        res.json({ code: 0, msg: '更新成功', data: { count: staff_ids.length } });
    } catch (err) {
        console.error('更新考试权限失败:', err);
        res.status(500).json({ code: -1, msg: '服务器错误' });
    }
});

// POST /api/permissions/exams/batch - 批量导入考试权限（给员工分配所有考试权限）
router.post('/exams/batch', authMiddleware, adminMiddleware, (req, res) => {
    try {
        const { data } = req.body;

        if (!Array.isArray(data)) {
            return res.status(400).json({ code: -1, msg: '参数错误' });
        }

        // 获取所有培训
        const trainings = db.prepare('SELECT id FROM exam_trainings').all();
        if (trainings.length === 0) {
            return res.json({ code: 0, msg: '没有培训', data: { success: 0, fail: data.length, errors: [] } });
        }

        // 获取所有有效员工工号
        const validStaff = db.prepare('SELECT employee_id FROM staff WHERE status = "active"').all();
        const validIds = new Set(validStaff.map(s => s.employee_id));

        let success = 0, fail = 0;
        const errors = [];

        const insertStmt = db.prepare(`
            INSERT INTO exam_permissions (exam_id, staff_id, can_take)
            VALUES (?, (SELECT id FROM staff WHERE employee_id = ?), 1)
        `);

        for (const item of data) {
            if (!item.employee_id) {
                fail++;
                errors.push({ employee_id: item.employee_id || '', name: item.name || '', error: '工号为空' });
                continue;
            }

            // 检查工号是否存在
            if (!validIds.has(item.employee_id)) {
                fail++;
                errors.push({ employee_id: item.employee_id, name: item.name || '', error: '工号不存在' });
                continue;
            }

            // 给该员工分配所有培训权限
            for (const training of trainings) {
                try {
                    insertStmt.run(training.id, item.employee_id);
                    success++;
                } catch (e) {
                    // 忽略重复插入错误
                }
            }

            // 同时更新 staff 表的旧版权限字段，确保兼容
            db.prepare('UPDATE staff SET exam_permission = 1 WHERE employee_id = ?').run(item.employee_id);
        }

        res.json({ code: 0, msg: `成功 ${success} 条${fail > 0 ? `，失败 ${fail} 条` : ''}`, data: { success, fail, errors: errors.slice(0, 20) } });
    } catch (err) {
        console.error('批量导入考试权限失败:', err);
        res.status(500).json({ code: -1, msg: '服务器错误' });
    }
});

// ============ 报餐权限 API ============

// GET /api/permissions/meals - 获取所有报餐活动及其权限状态
router.get('/meals', authMiddleware, (req, res) => {
    try {
        // signup_count: 真实报名人数（排除权限标记记录）
        // perm_count: 有权限人数（用假日期 '2099-12-31' 标记的权限记录）
        const activities = db.prepare(`
            SELECT ma.*,
                (SELECT COUNT(DISTINCT user_id) FROM meal_signups_v4 msv WHERE msv.activity_id = ma.id AND msv.signup_date != '2099-12-31') as signup_count,
                (SELECT COUNT(DISTINCT user_id) FROM meal_signups_v4 msv WHERE msv.activity_id = ma.id AND msv.signup_date = '2099-12-31') as perm_count
            FROM meal_activities_v4 ma
            ORDER BY ma.created_at DESC
        `).all();

        res.json({ code: 0, data: activities });
    } catch (err) {
        console.error('获取报餐活动列表失败:', err);
        res.status(500).json({ code: -1, msg: '服务器错误' });
    }
});

// GET /api/permissions/meals/types - 获取报餐类型
router.get('/meals/types', authMiddleware, (req, res) => {
    try {
        // 返回固定的中餐/晚餐类型
        res.json({ code: 0, data: [{ id: 1, name: '中餐' }, { id: 2, name: '晚餐' }] });
    } catch (err) {
        res.status(500).json({ code: -1, msg: '服务器错误' });
    }
});

// GET /api/permissions/meals/:id/staff - 获取某报餐活动的权限员工列表
router.get('/meals/:id/staff', authMiddleware, (req, res) => {
    try {
        const { id } = req.params;
        // 权限记录用假日期 '2099-12-31' 标记
        // 报名记录用真实日期
        const staff = db.prepare(`
            SELECT s.id, s.employee_id, s.name, s.department, s.guest_meal_permission,
                (SELECT COUNT(*) FROM meal_signups_v4 msv2 WHERE msv2.user_id = s.id AND msv2.activity_id = ? AND msv2.meal_type = 'lunch' AND msv2.signup_date = '2099-12-31' AND msv2.employee_count > 0) as has_lunch_perm,
                (SELECT COUNT(*) FROM meal_signups_v4 msv2 WHERE msv2.user_id = s.id AND msv2.activity_id = ? AND msv2.meal_type = 'dinner' AND msv2.signup_date = '2099-12-31' AND msv2.employee_count > 0) as has_dinner_perm,
                (SELECT COUNT(*) FROM meal_signups_v4 msv2 WHERE msv2.user_id = s.id AND msv2.activity_id = ? AND msv2.meal_type = 'lunch' AND msv2.signup_date = '2099-12-31' AND msv2.guest_count > 0) as has_guest_lunch_perm,
                (SELECT COUNT(*) FROM meal_signups_v4 msv2 WHERE msv2.user_id = s.id AND msv2.activity_id = ? AND msv2.meal_type = 'dinner' AND msv2.signup_date = '2099-12-31' AND msv2.guest_count > 0) as has_guest_dinner_perm
            FROM staff s
            WHERE s.status = 'active'
            ORDER BY s.employee_id
        `).all(id, id, id, id);

        // has_perm: 只要有任一权限就算有权限
        const result = staff.map(s => ({
            id: s.id,
            employee_id: s.employee_id,
            name: s.name,
            department: s.department,
            guest_meal_permission: s.guest_meal_permission,
            has_perm: (s.has_lunch_perm > 0 || s.has_dinner_perm > 0 || s.has_guest_lunch_perm > 0 || s.has_guest_dinner_perm > 0) ? 1 : 0,
            // 兼容旧字段名
            employee_meal_lunch: s.has_lunch_perm,
            employee_meal_dinner: s.has_dinner_perm,
            guest_meal_lunch: s.has_guest_lunch_perm,
            guest_meal_dinner: s.has_guest_dinner_perm
        }));

        res.json({ code: 0, data: result });
    } catch (err) {
        console.error('获取报餐权限员工失败:', err);
        res.status(500).json({ code: -1, msg: '服务器错误' });
    }
});

// PUT /api/permissions/meals/:id/staff - 批量更新报餐权限
// staff_ids = 员工餐权限（默认全员，勾选即开通）
// guest_staff_ids = 客餐权限（需要单独勾选）
// 注意：权限记录用假日期 '2099-12-31' 标记，不影响真实报名数据
router.put('/meals/:id/staff', authMiddleware, adminMiddleware, (req, res) => {
    try {
        const { id } = req.params;
        const { staff_ids, guest_staff_ids } = req.body;

        const employeeIds = Array.isArray(staff_ids) ? staff_ids : [];
        const guestIds = Array.isArray(guest_staff_ids) ? guest_staff_ids : [];

        // 用假日期 '2099-12-31' 标记权限记录，不删除真实报名数据
        const permDate = '2099-12-31';

        // 先删除该活动的旧权限记录（用假日期标记的）
        db.prepare(`DELETE FROM meal_signups_v4 WHERE activity_id = ? AND signup_date = ?`).run(id, permDate);

        // 插入员工餐权限记录（勾选了就有权限，默认全员）
        const insertEmployeeLunch = db.prepare(`
            INSERT INTO meal_signups_v4 (activity_id, user_id, signup_date, meal_type, employee_count, guest_count)
            VALUES (?, ?, ?, 'lunch', 1, 0)
        `);
        const insertEmployeeDinner = db.prepare(`
            INSERT INTO meal_signups_v4 (activity_id, user_id, signup_date, meal_type, employee_count, guest_count)
            VALUES (?, ?, ?, 'dinner', 1, 0)
        `);

        // 插入客餐权限记录（需要单独勾选）
        const insertGuestLunch = db.prepare(`
            INSERT INTO meal_signups_v4 (activity_id, user_id, signup_date, meal_type, employee_count, guest_count)
            VALUES (?, ?, ?, 'lunch', 0, 1)
        `);
        const insertGuestDinner = db.prepare(`
            INSERT INTO meal_signups_v4 (activity_id, user_id, signup_date, meal_type, employee_count, guest_count)
            VALUES (?, ?, ?, 'dinner', 0, 1)
        `);

        // 插入员工餐权限
        for (const staffId of employeeIds) {
            try {
                insertEmployeeLunch.run(id, staffId, permDate);
                insertEmployeeDinner.run(id, staffId, permDate);
            } catch (e) {}
        }

        // 插入客餐权限（不重复插入，已在员工餐里的不处理）
        for (const staffId of guestIds) {
            try {
                // 检查是否已在员工餐中
                if (!employeeIds.includes(staffId)) {
                    insertGuestLunch.run(id, staffId, permDate);
                    insertGuestDinner.run(id, staffId, permDate);
                }
            } catch (e) {}
        }

        res.json({ code: 0, msg: '更新成功', data: { employee_count: employeeIds.length, guest_count: guestIds.length } });
    } catch (err) {
        console.error('更新报餐权限失败:', err);
        res.status(500).json({ code: -1, msg: '服务器错误' });
    }
});

// POST /api/permissions/meals/batch - 批量更新客餐权限
router.post('/meals/batch', authMiddleware, adminMiddleware, (req, res) => {
    try {
        const { staff_ids, enabled } = req.body;
        if (!Array.isArray(staff_ids)) {
            return res.status(400).json({ code: -1, msg: '参数错误' });
        }
        // 先清除所有权限
        db.prepare('UPDATE staff SET guest_meal_permission = 0').run();
        // 再给指定人员加权限
        if (enabled && staff_ids.length > 0) {
            const placeholders = staff_ids.map(() => '?').join(',');
            db.prepare(`UPDATE staff SET guest_meal_permission = 1 WHERE id IN (${placeholders})`).run(...staff_ids);
        }
        res.json({ code: 0, msg: '更新成功', data: { count: staff_ids.length } });
    } catch (err) {
        res.status(500).json({ code: -1, msg: '服务器错误' });
    }
});

// ============ 6S权限 API ============

// GET /api/permissions/s6 - 获取6S权限列表
router.get('/s6', authMiddleware, (req, res) => {
    try {
        const staff = db.prepare(`
            SELECT s.id, s.employee_id, s.name, s.department,
                s.s6_permission as has_perm
            FROM staff s
            WHERE s.status = 'active'
            ORDER BY s.employee_id
        `).all();

        res.json({ code: 0, data: staff });
    } catch (err) {
        console.error('获取6S权限失败:', err);
        res.status(500).json({ code: -1, msg: '服务器错误' });
    }
});

// PUT /api/permissions/s6 - 批量更新6S权限
router.put('/s6', authMiddleware, adminMiddleware, (req, res) => {
    try {
        const { staff_ids } = req.body;

        if (!Array.isArray(staff_ids)) {
            return res.status(400).json({ code: -1, msg: '参数错误' });
        }

        // 先清除所有员工的6S权限
        db.prepare('UPDATE staff SET s6_permission = 0').run();

        // 再给指定人员加权限
        if (staff_ids.length > 0) {
            const placeholders = staff_ids.map(() => '?').join(',');
            db.prepare(`UPDATE staff SET s6_permission = 1 WHERE id IN (${placeholders})`).run(...staff_ids);
        }

        res.json({ code: 0, msg: '更新成功', data: { count: staff_ids.length } });
    } catch (err) {
        console.error('更新6S权限失败:', err);
        res.status(500).json({ code: -1, msg: '服务器错误' });
    }
});

// POST /api/permissions/s6 - 添加单个员工6S权限（不清除其他权限）
router.post('/s6', authMiddleware, adminMiddleware, (req, res) => {
    try {
        const { staff_id } = req.body;

        if (!staff_id) {
            return res.status(400).json({ code: -1, msg: '参数错误' });
        }

        db.prepare('UPDATE staff SET s6_permission = 1 WHERE id = ?').run(staff_id);

        res.json({ code: 0, msg: '添加成功', data: null });
    } catch (err) {
        console.error('添加6S权限失败:', err);
        res.status(500).json({ code: -1, msg: '服务器错误' });
    }
});

// POST /api/permissions/s6/batch - 批量导入6S权限
router.post('/s6/batch', authMiddleware, adminMiddleware, (req, res) => {
    try {
        const { employee_ids } = req.body;
        if (!Array.isArray(employee_ids)) {
            return res.status(400).json({ code: -1, msg: '参数错误' });
        }
        // 获取所有有效员工工号
        const validStaff = db.prepare('SELECT employee_id FROM staff WHERE status = "active"').all();
        const validIds = new Set(validStaff.map(s => s.employee_id));

        // 先清空所有6S权限
        db.prepare('UPDATE staff SET s6_permission = 0').run();
        let success = 0, fail = 0;
        const errors = [];
        for (const empId of employee_ids) {
            if (!empId) {
                fail++;
                errors.push({ employee_id: empId || '', error: '工号为空' });
                continue;
            }
            if (!validIds.has(empId)) {
                fail++;
                errors.push({ employee_id: empId, error: '工号不存在' });
                continue;
            }
            try {
                db.prepare('UPDATE staff SET s6_permission = 1 WHERE employee_id = ?').run(empId);
                success++;
            } catch (e) { fail++; }
        }
        res.json({ code: 0, msg: `成功 ${success} 条${fail > 0 ? `，失败 ${fail} 条` : ''}`, data: { success, fail, errors: errors.slice(0, 20) } });
    } catch (err) {
        res.status(500).json({ code: -1, msg: '服务器错误' });
    }
});

// ============ 文件权限 API ============

// GET /api/permissions/files/public - 获取公共文件权限列表
router.get('/files/public', authMiddleware, (req, res) => {
    try {
        const staff = db.prepare(`
            SELECT s.id, s.employee_id, s.name, s.department,
                COALESCE(fp.can_read, 0) as can_read,
                COALESCE(fp.can_write, 0) as can_write,
                COALESCE(fp.can_download, 0) as can_download
            FROM staff s
            LEFT JOIN file_public_permissions fp ON s.id = fp.staff_id
            WHERE s.status = 'active'
            ORDER BY s.employee_id
        `).all();

        res.json({ code: 0, data: staff });
    } catch (err) {
        console.error('获取文件公共权限失败:', err);
        res.status(500).json({ code: -1, msg: '服务器错误' });
    }
});

// PUT /api/permissions/files/public - 批量更新公共文件权限
router.put('/files/public', authMiddleware, adminMiddleware, (req, res) => {
    try {
        const { permissions } = req.body;

        if (!Array.isArray(permissions)) {
            return res.status(400).json({ code: -1, msg: '参数错误' });
        }

        const upsertStmt = db.prepare(`
            INSERT INTO file_public_permissions (staff_id, can_read, can_write, can_download)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(staff_id) DO UPDATE SET
                can_read = excluded.can_read,
                can_write = excluded.can_write,
                can_download = excluded.can_download
        `);

        for (const p of permissions) {
            upsertStmt.run(p.staff_id, p.can_read || 0, p.can_write || 0, p.can_download || 0);
        }

        res.json({ code: 0, msg: '更新成功', data: { count: permissions.length } });
    } catch (err) {
        console.error('更新文件公共权限失败:', err);
        res.status(500).json({ code: -1, msg: '服务器错误' });
    }
});

// POST /api/permissions/files/public/batch - 批量导入公共文件权限
router.post('/files/public/batch', authMiddleware, adminMiddleware, (req, res) => {
    try {
        const { permissions } = req.body;
        if (!Array.isArray(permissions)) {
            return res.status(400).json({ code: -1, msg: '参数错误' });
        }
        // 获取所有有效员工工号
        const validStaff = db.prepare('SELECT employee_id FROM staff WHERE status = "active"').all();
        const validIds = new Set(validStaff.map(s => s.employee_id));

        const upsertStmt = db.prepare(`
            INSERT INTO file_public_permissions (staff_id, can_read, can_write, can_download)
            VALUES ((SELECT id FROM staff WHERE employee_id = ?), ?, ?, ?)
            ON CONFLICT(staff_id) DO UPDATE SET
                can_read = excluded.can_read,
                can_write = excluded.can_write,
                can_download = excluded.can_download
        `);
        let success = 0, fail = 0;
        const errors = [];
        for (const p of permissions) {
            if (!p.employee_id) {
                fail++;
                errors.push({ employee_id: p.employee_id || '', name: p.name || '', error: '工号为空' });
                continue;
            }
            if (!validIds.has(p.employee_id)) {
                fail++;
                errors.push({ employee_id: p.employee_id, name: p.name || '', error: '工号不存在' });
                continue;
            }
            try {
                upsertStmt.run(p.employee_id, p.can_read || 0, p.can_write || 0, p.can_download || 0);
                success++;
            } catch (e) { fail++; }
        }
        res.json({ code: 0, msg: `成功 ${success} 条${fail > 0 ? `，失败 ${fail} 条` : ''}`, data: { success, fail, errors: errors.slice(0, 20) } });
    } catch (err) {
        res.status(500).json({ code: -1, msg: '服务器错误' });
    }
});

// GET /api/permissions/files/personal - 获取个人文件权限列表
router.get('/files/personal', authMiddleware, (req, res) => {
    try {
        const staff = db.prepare(`
            SELECT s.id, s.employee_id, s.name, s.department,
                COALESCE(fpp.can_read, 1) as can_read,
                COALESCE(fpp.can_write, 1) as can_write,
                COALESCE(fpp.can_download, 1) as can_download
            FROM staff s
            LEFT JOIN file_personal_permissions fpp ON s.id = fpp.staff_id
            WHERE s.status = 'active'
            ORDER BY s.employee_id
        `).all();

        res.json({ code: 0, data: staff });
    } catch (err) {
        console.error('获取文件个人权限失败:', err);
        res.status(500).json({ code: -1, msg: '服务器错误' });
    }
});

// PUT /api/permissions/files/personal - 批量更新个人文件权限
router.put('/files/personal', authMiddleware, adminMiddleware, (req, res) => {
    try {
        const { permissions } = req.body;

        if (!Array.isArray(permissions)) {
            return res.status(400).json({ code: -1, msg: '参数错误' });
        }

        const upsertStmt = db.prepare(`
            INSERT INTO file_personal_permissions (staff_id, can_read, can_write, can_download)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(staff_id) DO UPDATE SET
                can_read = excluded.can_read,
                can_write = excluded.can_write,
                can_download = excluded.can_download
        `);

        for (const p of permissions) {
            upsertStmt.run(p.staff_id, p.can_read !== undefined ? p.can_read : 1,
                         p.can_write !== undefined ? p.can_write : 1,
                         p.can_download !== undefined ? p.can_download : 1);
        }

        res.json({ code: 0, msg: '更新成功', data: { count: permissions.length } });
    } catch (err) {
        console.error('更新文件个人权限失败:', err);
        res.status(500).json({ code: -1, msg: '服务器错误' });
    }
});

// POST /api/permissions/files/personal/batch - 批量导入个人文件权限
router.post('/files/personal/batch', authMiddleware, adminMiddleware, (req, res) => {
    try {
        const { permissions } = req.body;
        if (!Array.isArray(permissions)) {
            return res.status(400).json({ code: -1, msg: '参数错误' });
        }
        // 获取所有有效员工工号
        const validStaff = db.prepare('SELECT employee_id FROM staff WHERE status = "active"').all();
        const validIds = new Set(validStaff.map(s => s.employee_id));

        const upsertStmt = db.prepare(`
            INSERT INTO file_personal_permissions (staff_id, can_read, can_write, can_download)
            VALUES ((SELECT id FROM staff WHERE employee_id = ?), ?, ?, ?)
            ON CONFLICT(staff_id) DO UPDATE SET
                can_read = excluded.can_read,
                can_write = excluded.can_write,
                can_download = excluded.can_download
        `);
        let success = 0, fail = 0;
        const errors = [];
        for (const p of permissions) {
            if (!p.employee_id) {
                fail++;
                errors.push({ employee_id: p.employee_id || '', name: p.name || '', error: '工号为空' });
                continue;
            }
            if (!validIds.has(p.employee_id)) {
                fail++;
                errors.push({ employee_id: p.employee_id, name: p.name || '', error: '工号不存在' });
                continue;
            }
            try {
                upsertStmt.run(p.employee_id,
                    p.can_read !== undefined ? p.can_read : 1,
                    p.can_write !== undefined ? p.can_write : 1,
                    p.can_download !== undefined ? p.can_download : 1);
                success++;
            } catch (e) { fail++; }
        }
        res.json({ code: 0, msg: `成功 ${success} 条${fail > 0 ? `，失败 ${fail} 条` : ''}`, data: { success, fail, errors: errors.slice(0, 20) } });
    } catch (err) {
        res.status(500).json({ code: -1, msg: '服务器错误' });
    }
});

// ============ 学习资料权限 API ============

// GET /api/permissions/learning-materials - 获取学习资料及其绑定的考试权限状态
router.get('/learning-materials', authMiddleware, (req, res) => {
    try {
        const staffId = req.user.type === 'employee' ? req.user.id : req.user.userId;

        // 获取所有学习资料及其绑定的考试
        const tasks = db.prepare(`
            SELECT lt.id, lt.title, lt.start_time, lt.end_time,
                e.id as exam_id, e.title as exam_title,
                CASE WHEN ep.id IS NOT NULL THEN 1 ELSE 0 END as has_perm
            FROM learning_tasks lt
            LEFT JOIN exam_trainings e ON e.learning_task_id = lt.id
            LEFT JOIN exam_permissions ep ON e.id = ep.exam_id AND ep.staff_id = ? AND ep.can_take = 1
            ORDER BY lt.created_at DESC
        `).all(staffId);

        res.json({ code: 0, data: tasks });
    } catch (err) {
        console.error('获取学习资料权限失败:', err);
        res.status(500).json({ code: -1, msg: '服务器错误' });
    }
});

// ============ 员工查询 API ============

// GET /api/permissions/staff - 获取所有员工(用于权限分配)
router.get('/staff', authMiddleware, (req, res) => {
    try {
        const staff = db.prepare(`
            SELECT id, employee_id, name, department, status
            FROM staff
            WHERE status = 'active'
            ORDER BY employee_id
        `).all();

        res.json({ code: 0, data: staff });
    } catch (err) {
        console.error('获取员工列表失败:', err);
        res.status(500).json({ code: -1, msg: '服务器错误' });
    }
});

module.exports = router;