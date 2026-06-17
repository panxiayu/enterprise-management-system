-- 报餐系统 v3 - 支持中餐/晚餐分类和时间段

-- 新的报餐活动表
CREATE TABLE IF NOT EXISTS meal_activities_v3 (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  description TEXT,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  lunch_start TIME NOT NULL DEFAULT '11:00',
  lunch_end TIME NOT NULL DEFAULT '13:00',
  dinner_start TIME NOT NULL DEFAULT '17:00',
  dinner_end TIME NOT NULL DEFAULT '19:00',
  deadline DATETIME NOT NULL,
  is_active INTEGER DEFAULT 1,
  created_by INTEGER,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (created_by) REFERENCES users(id)
);

-- 新的报餐报名表（按餐次分类）
CREATE TABLE IF NOT EXISTS meal_signups_v3 (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  activity_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  meal_type TEXT NOT NULL CHECK(meal_type IN ('lunch', 'dinner')),
  employee_count INTEGER DEFAULT 0,
  guest_count INTEGER DEFAULT 0,
  notes TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (activity_id) REFERENCES meal_activities_v3(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE(activity_id, user_id, meal_type)
);

-- 创建索引
CREATE INDEX IF NOT EXISTS idx_meal_activities_v3_start_date ON meal_activities_v3(start_date);
CREATE INDEX IF NOT EXISTS idx_meal_activities_v3_end_date ON meal_activities_v3(end_date);
CREATE INDEX IF NOT EXISTS idx_meal_signups_v3_activity_id ON meal_signups_v3(activity_id);
CREATE INDEX IF NOT EXISTS idx_meal_signups_v3_user_id ON meal_activities_v3(user_id);
