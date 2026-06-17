-- 报餐系统 v4 - 报餐时间段控制、中餐/晚餐启用控制

CREATE TABLE IF NOT EXISTS meal_activities_v4 (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  -- 中餐报餐时间窗口
  lunch_enabled INTEGER DEFAULT 1,
  lunch_signup_start TIME DEFAULT '09:00',
  lunch_signup_end TIME DEFAULT '10:30',
  -- 晚餐报餐时间窗口
  dinner_enabled INTEGER DEFAULT 1,
  dinner_signup_start TIME DEFAULT '14:00',
  dinner_signup_end TIME DEFAULT '15:30',
  -- 报名截止时间
  deadline DATETIME NOT NULL,
  is_active INTEGER DEFAULT 1,
  created_by INTEGER,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (created_by) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS meal_signups_v4 (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  activity_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  signup_date DATE NOT NULL,
  meal_type TEXT NOT NULL CHECK(meal_type IN ('lunch', 'dinner')),
  employee_count INTEGER DEFAULT 0,
  guest_count INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (activity_id) REFERENCES meal_activities_v4(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE(activity_id, user_id, signup_date, meal_type)
);

CREATE INDEX IF NOT EXISTS idx_meal_activities_v4_start_date ON meal_activities_v4(start_date);
CREATE INDEX IF NOT EXISTS idx_meal_signups_v4_activity_id ON meal_signups_v4(activity_id);
CREATE INDEX IF NOT EXISTS idx_meal_signups_v4_user_id ON meal_signups_v4(user_id);
CREATE INDEX IF NOT EXISTS idx_meal_signups_v4_signup_date ON meal_signups_v4(signup_date);
