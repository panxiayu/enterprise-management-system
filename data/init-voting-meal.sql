-- 投票系统表
CREATE TABLE IF NOT EXISTS votings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  description TEXT,
  deadline DATETIME NOT NULL,
  multiple_choice INTEGER DEFAULT 0,
  created_by INTEGER NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (created_by) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS voting_options (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  voting_id INTEGER NOT NULL,
  option_text TEXT NOT NULL,
  votes INTEGER DEFAULT 0,
  FOREIGN KEY (voting_id) REFERENCES votings(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS voting_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  voting_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  option_ids TEXT NOT NULL, -- 逗号分隔的选项 ID
  voted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (voting_id) REFERENCES votings(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE(voting_id, user_id)
);

-- 报餐系统表
CREATE TABLE IF NOT EXISTS meal_activities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  description TEXT,
  deadline DATETIME NOT NULL,
  created_by INTEGER NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (created_by) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS meal_menus (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  activity_id INTEGER NOT NULL,
  menu_name TEXT NOT NULL,
  price REAL NOT NULL,
  description TEXT,
  FOREIGN KEY (activity_id) REFERENCES meal_activities(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS meal_orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  activity_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  menu_id INTEGER NOT NULL,
  quantity INTEGER DEFAULT 1,
  remarks TEXT,
  ordered_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (activity_id) REFERENCES meal_activities(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (menu_id) REFERENCES meal_menus(id) ON DELETE CASCADE,
  UNIQUE(activity_id, user_id)
);

-- 创建索引以提高查询性能
CREATE INDEX IF NOT EXISTS idx_votings_deadline ON votings(deadline);
CREATE INDEX IF NOT EXISTS idx_voting_records_voting_id ON voting_records(voting_id);
CREATE INDEX IF NOT EXISTS idx_voting_records_user_id ON voting_records(user_id);
CREATE INDEX IF NOT EXISTS idx_meal_activities_deadline ON meal_activities(deadline);
CREATE INDEX IF NOT EXISTS idx_meal_orders_activity_id ON meal_orders(activity_id);
CREATE INDEX IF NOT EXISTS idx_meal_orders_user_id ON meal_orders(user_id);
