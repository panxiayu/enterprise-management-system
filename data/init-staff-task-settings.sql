-- 人员管理表
CREATE TABLE IF NOT EXISTS staff (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  phone TEXT,
  department_id INTEGER,
  position_id INTEGER,
  hire_date DATE,
  status TEXT DEFAULT 'active',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 部门表
CREATE TABLE IF NOT EXISTS departments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 职位表
CREATE TABLE IF NOT EXISTS positions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 工作任务表
CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  description TEXT,
  type TEXT NOT NULL, -- exam 或 meal
  assigned_to INTEGER NOT NULL,
  assigned_by INTEGER NOT NULL,
  due_date DATE,
  priority TEXT DEFAULT 'medium', -- low, medium, high
  status TEXT DEFAULT 'pending', -- pending, in_progress, completed
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (assigned_to) REFERENCES users(id),
  FOREIGN KEY (assigned_by) REFERENCES users(id)
);

-- 系统设置表
CREATE TABLE IF NOT EXISTS settings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key TEXT NOT NULL UNIQUE,
  value TEXT,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 创建索引
CREATE INDEX IF NOT EXISTS idx_staff_email ON staff(email);
CREATE INDEX IF NOT EXISTS idx_staff_status ON staff(status);
CREATE INDEX IF NOT EXISTS idx_tasks_assigned_to ON tasks(assigned_to);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_type ON tasks(type);
CREATE INDEX IF NOT EXISTS idx_settings_key ON settings(key);

-- 插入默认设置
INSERT OR IGNORE INTO settings (key, value) VALUES
  ('exam_enabled', 'true'),
  ('exam_max_duration', '120'),
  ('exam_pass_score', '60'),
  ('exam_show_answers', 'false'),
  ('meal_enabled', 'true'),
  ('meal_max_quantity', '5'),
  ('meal_allow_remarks', 'true'),
  ('voting_enabled', 'true'),
  ('voting_allow_multiple', 'true'),
  ('company_name', '兴利汽车模具'),
  ('company_logo', ''),
  ('company_description', '');

-- 插入示例部门
INSERT OR IGNORE INTO departments (name, description) VALUES
  ('技术部', '负责产品开发和技术支持'),
  ('销售部', '负责市场销售和客户关系'),
  ('人力资源部', '负责人员招聘和管理'),
  ('财务部', '负责财务管理和报表'),
  ('生产部', '负责产品生产和质量控制');

-- 插入示例职位
INSERT OR IGNORE INTO positions (name, description) VALUES
  ('经理', '部门经理'),
  ('工程师', '技术工程师'),
  ('销售代表', '销售代表'),
  ('行政', '行政人员'),
  ('操作员', '生产操作员');
