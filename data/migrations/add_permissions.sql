-- 迁移脚本：添加学习任务和6S管理权限字段
-- 执行日期: 2026-04-04

-- 添加学习任务权限字段到 staff 表
-- 注意：如果字段已存在，忽略此操作
ALTER TABLE staff ADD COLUMN task_permission INTEGER DEFAULT 0;

-- 添加6S管理权限字段到 staff 表
ALTER TABLE staff ADD COLUMN 6s_permission INTEGER DEFAULT 0;

-- 如果 ALTER TABLE 不支持（SQLite 早期版本），使用以下方式：
-- CREATE TABLE IF NOT EXISTS staff_new (
--   id INTEGER PRIMARY KEY AUTOINCREMENT,
--   name TEXT NOT NULL,
--   employee_id TEXT UNIQUE,
--   phone TEXT,
--   department_id INTEGER,
--   position_id INTEGER,
--   exam_permission INTEGER DEFAULT 0,
--   meal_permission INTEGER DEFAULT 0,
--   voting_permission INTEGER DEFAULT 0,
--   task_permission INTEGER DEFAULT 0,
--   6s_permission INTEGER DEFAULT 0,
--   status TEXT DEFAULT 'active',
--   created_at DATETIME DEFAULT CURRENT_TIMESTAMP
-- );
-- INSERT INTO staff_new SELECT *, 0, 0 FROM staff;
-- DROP TABLE staff;
-- ALTER TABLE staff_new RENAME TO staff;

-- 同时确保 users 表有 can_manage_task 字段
-- (检查 init.sql 发现此字段已存在)

-- 验证字段已添加
-- SELECT name FROM pragma_table_info('staff');
