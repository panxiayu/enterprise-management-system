-- 报餐系统 v4.1 - 添加客餐原由字段，支持客餐多次申请

-- 添加 reason 字段
ALTER TABLE meal_signups_v4 ADD COLUMN reason TEXT;

-- 重建 meal_signups_v4 表，移除 UNIQUE 约束中的 meal_type，允许同一用户同一餐次有多条记录
-- 注意：SQLite 不支持直接删除 UNIQUE 约束，需要重建表
-- 创建临时表
CREATE TABLE IF NOT EXISTS meal_signups_v4_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  activity_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  signup_date DATE NOT NULL,
  meal_type TEXT NOT NULL CHECK(meal_type IN ('lunch', 'dinner')),
  employee_count INTEGER DEFAULT 0,
  guest_count INTEGER DEFAULT 0,
  reason TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (activity_id) REFERENCES meal_activities_v4(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- 复制数据
INSERT INTO meal_signups_v4_new (id, activity_id, user_id, signup_date, meal_type, employee_count, guest_count, created_at)
SELECT id, activity_id, user_id, signup_date, meal_type, employee_count, guest_count, created_at FROM meal_signups_v4;

-- 删除旧表
DROP TABLE meal_signups_v4;

-- 重命名新表
ALTER TABLE meal_signups_v4_new RENAME TO meal_signups_v4;

-- 重建索引
CREATE INDEX IF NOT EXISTS idx_meal_signups_v4_activity_id ON meal_signups_v4(activity_id);
CREATE INDEX IF NOT EXISTS idx_meal_signups_v4_user_id ON meal_signups_v4(user_id);
CREATE INDEX IF NOT EXISTS idx_meal_signups_v4_signup_date ON meal_signups_v4(signup_date);
CREATE INDEX IF NOT EXISTS idx_meal_signups_v4_meal_type ON meal_signups_v4(meal_type);
