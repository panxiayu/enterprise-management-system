-- 初始化数据库
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password TEXT NOT NULL,
  nickname TEXT,
  role TEXT DEFAULT 'user',
  status TEXT DEFAULT 'active',
  can_manage_voting INTEGER DEFAULT 0,
  can_manage_exam INTEGER DEFAULT 0,
  can_manage_meal INTEGER DEFAULT 0,
  can_manage_staff INTEGER DEFAULT 0,
  can_manage_task INTEGER DEFAULT 0,
  can_manage_file INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS staff (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  employee_id TEXT UNIQUE,
  phone TEXT,
  department_id INTEGER,
  position_id INTEGER,
  exam_permission INTEGER DEFAULT 0,
  meal_permission INTEGER DEFAULT 0,
  voting_permission INTEGER DEFAULT 0,
  task_permission INTEGER DEFAULT 0,
  status TEXT DEFAULT 'active',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS departments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS positions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS exams (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  description TEXT,
  duration INTEGER DEFAULT 60,
  pass_score INTEGER DEFAULT 60,
  is_active INTEGER DEFAULT 0,
  learning_task_id INTEGER,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (learning_task_id) REFERENCES learning_tasks(id)
);

CREATE TABLE IF NOT EXISTS questions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  exam_id INTEGER NOT NULL,
  type TEXT NOT NULL,
  content TEXT NOT NULL,
  options TEXT,
  answer TEXT NOT NULL,
  score INTEGER DEFAULT 10,
  sort_order INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (exam_id) REFERENCES exams(id)
);

CREATE TABLE IF NOT EXISTS exam_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  exam_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  answers TEXT DEFAULT '{}',
  total_score INTEGER DEFAULT 0,
  is_passed INTEGER DEFAULT 0,
  started_at DATETIME,
  submitted_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (exam_id) REFERENCES exams(id)
);

CREATE TABLE IF NOT EXISTS voting_activities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  description TEXT,
  start_time DATETIME,
  end_time DATETIME,
  is_active INTEGER DEFAULT 1,
  allow_multiple INTEGER DEFAULT 0,
  show_results INTEGER DEFAULT 1,
  created_by INTEGER,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS voting_options (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  activity_id INTEGER NOT NULL,
  content TEXT NOT NULL,
  vote_count INTEGER DEFAULT 0,
  sort_order INTEGER DEFAULT 0,
  FOREIGN KEY (activity_id) REFERENCES voting_activities(id)
);

CREATE TABLE IF NOT EXISTS voting_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  activity_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  option_ids TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (activity_id) REFERENCES voting_activities(id)
);

CREATE TABLE IF NOT EXISTS meal_activities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  description TEXT,
  deadline DATETIME,
  is_active INTEGER DEFAULT 1,
  created_by INTEGER,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS meal_options (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  activity_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  price REAL DEFAULT 0,
  description TEXT,
  FOREIGN KEY (activity_id) REFERENCES meal_activities(id)
);

CREATE TABLE IF NOT EXISTS meal_signups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  activity_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  option_id INTEGER NOT NULL,
  quantity INTEGER DEFAULT 1,
  notes TEXT,
  status TEXT DEFAULT 'pending',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (activity_id) REFERENCES meal_activities(id)
);

CREATE TABLE IF NOT EXISTS learning_tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  description TEXT,
  file_type TEXT,
  file_url TEXT,
  start_time DATETIME,
  end_time DATETIME,
  created_by INTEGER,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME
);

CREATE TABLE IF NOT EXISTS learning_permissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  FOREIGN KEY (task_id) REFERENCES learning_tasks(id)
);

CREATE TABLE IF NOT EXISTS learning_progress (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  status TEXT DEFAULT 'not_started',
  progress_percent INTEGER DEFAULT 0,
  last_position REAL DEFAULT 0,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (task_id) REFERENCES learning_tasks(id)
);

-- 6S曝光记录表
CREATE TABLE IF NOT EXISTS six_s_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_code TEXT NOT NULL,        -- 项目编号
  description TEXT,                  -- 问题描述
  person_charge TEXT,                 -- 责任人
  area TEXT,                          -- 区域
  status TEXT DEFAULT 'pending',      -- 状态: pending=待整改, fixed=已达标
  before_image TEXT,                  -- 整改前图片路径
  after_image TEXT,                   -- 整改后图片路径
  check_date DATETIME,                -- 检查日期
  created_by INTEGER,                 -- 创建人
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME
);

-- 考试权限表（粒化权限）
CREATE TABLE IF NOT EXISTS exam_permissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  exam_id INTEGER NOT NULL,
  staff_id INTEGER NOT NULL,
  can_take INTEGER DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(exam_id, staff_id)
);

-- 学生名册表
CREATE TABLE IF NOT EXISTS student_roster (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  employee_id TEXT UNIQUE,
  school TEXT,
  department TEXT,
  sub_department TEXT,
  position TEXT,
  training_date TEXT,
  dinggang_date TEXT,
  phone TEXT,
  id_card TEXT,
  home_address TEXT,
  education TEXT,
  major TEXT,
  emergency_contact TEXT,
  emergency_relation TEXT,
  emergency_phone TEXT,
  source_employee_id TEXT,
  synced_at DATETIME DEFAULT (datetime('now', 'localtime')),
  created_at DATETIME DEFAULT (datetime('now', 'localtime'))
);

-- 插入默认管理员（拥有所有系统权限）
INSERT OR IGNORE INTO users (username, password, nickname, role, can_manage_voting, can_manage_exam, can_manage_meal, can_manage_staff, can_manage_task, can_manage_file, can_manage_training, can_manage_6s, can_manage_permission, can_manage_feedback)
VALUES ('admin', 'admin123', '管理员', 'admin', 1, 1, 1, 1, 1, 1, 1, 1, 1, 1);

-- 插入默认部门
INSERT OR IGNORE INTO departments (id, name) VALUES (1, '默认部门');

-- 插入默认职位
INSERT OR IGNORE INTO positions (id, name) VALUES (1, '员工');
