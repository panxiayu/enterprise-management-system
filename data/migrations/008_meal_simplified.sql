-- 简化报餐系统表结构
-- 移除了菜单/菜谱，改为员工餐和客餐数量

-- 新的报餐活动表
CREATE TABLE IF NOT EXISTS meal_activities_v2 (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  description TEXT,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  deadline DATETIME NOT NULL,
  is_active INTEGER DEFAULT 1,
  created_by INTEGER,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (created_by) REFERENCES users(id)
);

-- 新的报餐报名表
CREATE TABLE IF NOT EXISTS meal_signups_v2 (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  activity_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  employee_meal_count INTEGER DEFAULT 0,
  guest_meal_count INTEGER DEFAULT 0,
  notes TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (activity_id) REFERENCES meal_activities_v2(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE(activity_id, user_id)
);

-- 创建索引
CREATE INDEX IF NOT EXISTS idx_meal_activities_v2_start_date ON meal_activities_v2(start_date);
CREATE INDEX IF NOT EXISTS idx_meal_activities_v2_end_date ON meal_activities_v2(end_date);
CREATE INDEX IF NOT EXISTS idx_meal_signups_v2_activity_id ON meal_signups_v2(activity_id);
CREATE INDEX IF NOT EXISTS idx_meal_signups_v2_user_id ON meal_signups_v2(user_id);
