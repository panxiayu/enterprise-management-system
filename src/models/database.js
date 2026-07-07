// src/models/database.js
const Database = require('better-sqlite3');
const path = require('path');
const { getNamePinyin } = require('../utils/name-pinyin');
const fs = require('fs');

// 数据文件路径 - 使用绝对路径，基于当前文件位置
const dbPath = path.resolve(__dirname, '../../data/exam.db');

// 确保数据目录存在
const dataDir = path.dirname(dbPath);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

console.log('📁 数据库路径:', dbPath, 'CWD:', process.cwd());

// 连接数据库
let db;
try {
  db = new Database(dbPath);
  console.log('✅ 数据库连接成功');
} catch (err) {
  console.error('❌ 数据库连接失败:', err.message);
  process.exit(1);
}

// 启用外键约束
db.pragma('foreign_keys = ON');

// 初始化数据库（如果不存在则创建表）
function initDatabase() {
  try {
    console.log('🔧 初始化数据库...');

    // 检查是否已初始化
    const tables = db.prepare(`
      SELECT name FROM sqlite_master
      WHERE type='table' AND name NOT LIKE 'sqlite_%'
    `).all();

    if (tables.length > 0) {
      console.log('✅ 数据库已初始化，表数:', tables.length);
      // 初始化后续检查（如新增字段/表）
      initUsersColumns();
      initMealActivitiesColumns();
      initMealSignupsColumns();
      initVotingTables();
      initPermissionLogsTable();
      initFeedbackTable();
      initStaffNamePinyin();
      initStudentRoster();
      initSixSRecords();
      initTaskWorkbench();
      initNotificationCenter();
      initMiniAppIntegration();
      initWorkwearTables();
      migrateTimestampsToLocaltime();
      return;
    }

    // 读取 SQL 初始化脚本
    const sqlPath = path.join(__dirname, '../../data/init.sql');
    if (fs.existsSync(sqlPath)) {
      console.log(`📄 执行初始化脚本: init.sql`);
      const sql = fs.readFileSync(sqlPath, 'utf-8');
      db.exec(sql);
      console.log('✅ 数据库初始化完成');
      // 初始化后续检查
      initUsersColumns();
      initMealActivitiesColumns();
      initVotingTables();
      initPermissionLogsTable();
      initFeedbackTable();
      initStaffNamePinyin();
      initStudentRoster();
      initSixSRecords();
      initTaskWorkbench();
      initNotificationCenter();
      initMiniAppIntegration();
      initWorkwearTables();
      migrateTimestampsToLocaltime();
    } else {
      console.error('❌ 未找到 init.sql');
      throw new Error('初始化脚本不存在');
    }
  } catch (err) {
    console.error('❌ 数据库初始化失败:', err.message);
    throw err;
  }
}

// 初始化 users 表缺失的列
function initUsersColumns() {
  try {
    const columns = db.prepare("PRAGMA table_info(users)").all();
    const columnNames = columns.map(c => c.name);

    if (!columnNames.includes('status')) {
      db.exec("ALTER TABLE users ADD COLUMN status TEXT DEFAULT 'active'");
      console.log('✅ users 表新增 status 字段');
    }
    if (!columnNames.includes('can_manage_file')) {
      db.exec("ALTER TABLE users ADD COLUMN can_manage_file INTEGER DEFAULT 0");
      console.log('✅ users 表新增 can_manage_file 字段');
    }
    if (!columnNames.includes('can_manage_training')) {
      db.exec("ALTER TABLE users ADD COLUMN can_manage_training INTEGER DEFAULT 0");
      console.log('✅ users 表新增 can_manage_training 字段');
    }
    if (!columnNames.includes('can_manage_6s')) {
      db.exec("ALTER TABLE users ADD COLUMN can_manage_6s INTEGER DEFAULT 0");
      console.log('✅ users 表新增 can_manage_6s 字段');
    }
    if (!columnNames.includes('can_manage_permission')) {
      db.exec("ALTER TABLE users ADD COLUMN can_manage_permission INTEGER DEFAULT 0");
      console.log('✅ users 表新增 can_manage_permission 字段');
    }
    if (!columnNames.includes('can_manage_feedback')) {
      db.exec("ALTER TABLE users ADD COLUMN can_manage_feedback INTEGER DEFAULT 0");
      console.log('✅ users 表新增 can_manage_feedback 字段');
    }
  } catch (err) {
    console.error('❌ initUsersColumns 失败:', err.message);
  }
}

// 初始化 meal_signups_v4 表缺失的列
function initMealSignupsColumns() {
  try {
    const columns = db.prepare("PRAGMA table_info(meal_signups_v4)").all();
    const columnNames = columns.map(c => c.name);

    if (!columnNames.includes('is_temporary')) {
      db.exec("ALTER TABLE meal_signups_v4 ADD COLUMN is_temporary INTEGER DEFAULT 0");
      console.log('✅ meal_signups_v4 表新增 is_temporary 字段');
    }

    // 检查触发器是否已存在
    const triggers = db.prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND name='fix_meal_signup_user_id'").get();
    if (!triggers) {
      console.log('✅ meal_signups_v4 触发器已创建');
    }
  } catch (err) {
    console.error('❌ initMealSignupsColumns 失败:', err.message);
  }
}

// 初始化 meal_activities_v4 表缺失的列
function initMealActivitiesColumns() {
  try {
    const columns = db.prepare("PRAGMA table_info(meal_activities_v4)").all();
    const columnNames = columns.map(c => c.name);

    if (!columnNames.includes('is_temporary')) {
      db.exec("ALTER TABLE meal_activities_v4 ADD COLUMN is_temporary INTEGER DEFAULT 0");
      console.log('✅ meal_activities_v4 表新增 is_temporary 字段');
    }
    if (!columnNames.includes('guest_lunch_enabled')) {
      db.exec("ALTER TABLE meal_activities_v4 ADD COLUMN guest_lunch_enabled INTEGER DEFAULT 0");
      console.log('✅ meal_activities_v4 表新增 guest_lunch_enabled 字段');
    }
    if (!columnNames.includes('guest_lunch_start')) {
      db.exec("ALTER TABLE meal_activities_v4 ADD COLUMN guest_lunch_start TEXT DEFAULT '09:00'");
      console.log('✅ meal_activities_v4 表新增 guest_lunch_start 字段');
    }
    if (!columnNames.includes('guest_lunch_end')) {
      db.exec("ALTER TABLE meal_activities_v4 ADD COLUMN guest_lunch_end TEXT DEFAULT '10:30'");
      console.log('✅ meal_activities_v4 表新增 guest_lunch_end 字段');
    }
    if (!columnNames.includes('guest_dinner_enabled')) {
      db.exec("ALTER TABLE meal_activities_v4 ADD COLUMN guest_dinner_enabled INTEGER DEFAULT 0");
      console.log('✅ meal_activities_v4 表新增 guest_dinner_enabled 字段');
    }
    if (!columnNames.includes('guest_dinner_start')) {
      db.exec("ALTER TABLE meal_activities_v4 ADD COLUMN guest_dinner_start TEXT DEFAULT '14:00'");
      console.log('✅ meal_activities_v4 表新增 guest_dinner_start 字段');
    }
    if (!columnNames.includes('guest_dinner_end')) {
      db.exec("ALTER TABLE meal_activities_v4 ADD COLUMN guest_dinner_end TEXT DEFAULT '15:30'");
      console.log('✅ meal_activities_v4 表新增 guest_dinner_end 字段');
    }
  } catch (err) {
    console.error('❌ initMealActivitiesColumns 失败:', err.message);
  }
}

// 初始化 staff 表缺失的 name_pinyin 字段
function initStaffNamePinyin() {
  try {
    const columns = db.prepare("PRAGMA table_info(staff)").all();
    const columnNames = columns.map(c => c.name);

    if (!columnNames.includes('name_pinyin')) {
      db.exec("ALTER TABLE staff ADD COLUMN name_pinyin TEXT");
      console.log('✅ staff 表新增 name_pinyin 字段');
    }
    if (!columnNames.includes('leave_type')) {
      db.exec("ALTER TABLE staff ADD COLUMN leave_type TEXT");
      console.log('✅ staff 表新增 leave_type 字段');
    }
    if (!columnNames.includes('workwear_leave_date')) {
      db.exec("ALTER TABLE staff ADD COLUMN workwear_leave_date TEXT");
      console.log('✅ staff 表新增 workwear_leave_date 字段');
    }
    if (!columnNames.includes('workwear_leave_confirmed_at')) {
      db.exec("ALTER TABLE staff ADD COLUMN workwear_leave_confirmed_at TEXT");
      console.log('✅ staff 表新增 workwear_leave_confirmed_at 字段');
    }
    db.exec(`
      CREATE TABLE IF NOT EXISTS staff_leave_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        staff_id INTEGER,
        employee_id TEXT NOT NULL,
        staff_name TEXT NOT NULL,
        department TEXT,
        team TEXT,
        position TEXT,
        hire_date TEXT,
        leave_date TEXT NOT NULL,
        leave_type TEXT,
        source TEXT DEFAULT 'excel_sync',
        source_sheet TEXT,
        is_rehire INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(employee_id, leave_date, leave_type, source_sheet)
      )
    `);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_staff_leave_history_employee ON staff_leave_history(employee_id, leave_date DESC)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_staff_leave_history_rehire ON staff_leave_history(is_rehire, leave_date DESC)`);

    const staffList = db.prepare(`
      SELECT id, name
      FROM staff
      WHERE name IS NOT NULL
        AND TRIM(name) != ''
        AND (name_pinyin IS NULL OR TRIM(name_pinyin) = '')
    `).all();
    if (!staffList.length) return;

    const updateStmt = db.prepare('UPDATE staff SET name_pinyin = ? WHERE id = ?');
    staffList.forEach((staff) => {
      updateStmt.run(getNamePinyin(staff.name), staff.id);
    });
    console.log(`✅ 已补齐 ${staffList.length} 名员工的姓名拼音`);
  } catch (err) {
    console.error('❌ initStaffNamePinyin 失败:', err.message);
  }
}

// 初始化投票相关表和字段
function initVotingTables() {
  try {
    // 检查 votings 表是否有 anonymous_token 字段
    const votingsColumns = db.prepare("PRAGMA table_info(votings)").all();
    const hasAnonymousToken = votingsColumns.some(col => col.name === 'anonymous_token');
    if (!hasAnonymousToken) {
      // SQLite不支持ALTER TABLE ADD COLUMN添加UNIQUE列，需要重建表
      // 这里先用不带UNIQUE的方式添加列，然后单独创建索引
      db.exec("ALTER TABLE votings ADD COLUMN anonymous_token TEXT");
      console.log('✅ votings 表新增 anonymous_token 字段');
      // 创建唯一索引
      db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_votings_anonymous_token ON votings(anonymous_token)");
      console.log('✅ anonymous_token 唯一索引已创建');
    }

    // 检查 votings 表是否有 allowed_staff_ids 字段
    const votingsCols = db.prepare("PRAGMA table_info(votings)").all();
    const hasAllowedStaffIds = votingsCols.some(col => col.name === 'allowed_staff_ids');
    if (!hasAllowedStaffIds) {
      db.exec("ALTER TABLE votings ADD COLUMN allowed_staff_ids TEXT");
      console.log('✅ votings 表新增 allowed_staff_ids 字段');
    }

    // 检查 voting_records 表结构，移除阻止匿名投票的UNIQUE约束
    const recordsInfo = db.prepare("PRAGMA index_list(voting_records)").all();
    const hasUniqueConstraint = recordsInfo.some(idx => idx.unique === 1);
    if (hasUniqueConstraint) {
      // 重建 voting_records 表，移除 UNIQUE 约束
      // 先备份数据
      const records = db.prepare("SELECT * FROM voting_records").all();
      // 删除旧表
      db.exec("DROP TABLE voting_records");
      // 用不带 UNIQUE 约束的方式重建表
      db.exec(`
        CREATE TABLE IF NOT EXISTS voting_records (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          voting_id INTEGER NOT NULL,
          user_id INTEGER NOT NULL,
          option_id INTEGER,
          device_token TEXT,
          employee_id TEXT,
          employee_name TEXT,
          voted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (voting_id) REFERENCES votings(id) ON DELETE CASCADE,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )
      `);
      // 恢复数据（注意：旧数据的 option_ids 需要拆分，这里简化处理只保留第一条记录的 option_id）
      const insertStmt = db.prepare(`
        INSERT INTO voting_records (id, voting_id, user_id, option_id, device_token, employee_id, employee_name, voted_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);
      records.forEach(r => {
        // 旧数据 option_ids 是逗号分隔，取第一个作为 option_id
        const firstOptId = r.option_ids ? parseInt(r.option_ids.split(',')[0]) : null;
        insertStmt.run(r.id, r.voting_id, r.user_id, firstOptId, r.device_token, r.employee_id, r.employee_name, r.voted_at);
      });
      // 重建索引
      db.exec("CREATE INDEX IF NOT EXISTS idx_voting_records_voting_id ON voting_records(voting_id)");
      db.exec("CREATE INDEX IF NOT EXISTS idx_voting_records_user_id ON voting_records(user_id)");
      console.log('✅ voting_records 表已重建，移除了阻止匿名投票的 UNIQUE 约束');
    }

    // 检查 voting_records 表是否有新字段
    const recordsColumns = db.prepare("PRAGMA table_info(voting_records)").all();
    if (!recordsColumns.some(col => col.name === 'device_token')) {
      db.exec("ALTER TABLE voting_records ADD COLUMN device_token TEXT");
      console.log('✅ voting_records 表新增 device_token 字段');
    }
    if (!recordsColumns.some(col => col.name === 'employee_id')) {
      db.exec("ALTER TABLE voting_records ADD COLUMN employee_id TEXT");
      console.log('✅ voting_records 表新增 employee_id 字段');
    }
    if (!recordsColumns.some(col => col.name === 'employee_name')) {
      db.exec("ALTER TABLE voting_records ADD COLUMN employee_name TEXT");
      console.log('✅ voting_records 表新增 employee_name 字段');
    }

    // 创建匿名投票设备记录表
    db.exec(`
      CREATE TABLE IF NOT EXISTS voting_device_tokens (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        voting_id INTEGER NOT NULL,
        device_token TEXT NOT NULL,
        employee_id TEXT,
        employee_name TEXT,
        voted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(voting_id, device_token)
      )
    `);
    console.log('✅ voting_device_tokens 表已创建/存在');
  } catch (err) {
    console.error('❌ 初始化投票表失败:', err.message);
  }
}

// 初始化权限操作日志表
function initPermissionLogsTable() {
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS permission_action_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        username TEXT,
        tab TEXT,
        action TEXT,
        status TEXT DEFAULT 'success',
        created_at DATETIME DEFAULT (datetime('now', 'localtime'))
      )
    `);
    // 检查是否需要添加 status 列
    const columns = db.prepare("PRAGMA table_info(permission_action_logs)").all();
    const columnNames = columns.map(c => c.name);
    if (!columnNames.includes('status')) {
      db.exec("ALTER TABLE permission_action_logs ADD COLUMN status TEXT DEFAULT 'success'");
      console.log('✅ permission_action_logs 表新增 status 字段');
    }
    console.log('✅ permission_action_logs 表已创建/存在');
  } catch (err) {
    console.error('❌ 初始化权限日志表失败:', err.message);
  }
}

function initFeedbackTable() {
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS feedback (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        staff_id INTEGER,
        staff_name TEXT,
        employee_id TEXT,
        category TEXT NOT NULL DEFAULT 'other',
        description TEXT NOT NULL,
        screenshots TEXT,
        page_url TEXT,
        user_agent TEXT,
        status TEXT DEFAULT 'pending',
        admin_reply TEXT,
        resolved_at DATETIME,
        created_at DATETIME DEFAULT (datetime('now', 'localtime')),
        updated_at DATETIME DEFAULT (datetime('now', 'localtime'))
      )
    `);
    console.log('✅ feedback 表已创建/存在');
  } catch (err) {
    console.error('❌ 初始化反馈表失败:', err.message);
  }
}

// 初始化学生名册表
function initStudentRoster() {
  try {
    db.exec(`
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
      )
    `);
    console.log('✅ student_roster 表已创建/存在');
  } catch (err) {
    console.error('❌ 初始化学生名册表失败:', err.message);
  }
}

// 初始化6S记录表缺失的字段和区域分级表
function initSixSRecords() {
  try {
    // 1. 创建区域分级表
    db.exec(`
      CREATE TABLE IF NOT EXISTS s6_areas (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        parent_id INTEGER DEFAULT 0,
        area_code INTEGER,
        floor TEXT,
        responsible TEXT,
        responsible_employee_id TEXT,
        py TEXT,
        py_person TEXT,
        sort_order INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT (datetime('now', 'localtime'))
      )
    `);
    console.log('✅ s6_areas 区域分级表已创建/存在');

    const areaColumns = db.prepare("PRAGMA table_info(s6_areas)").all();
    const areaColumnNames = areaColumns.map(c => c.name);
    if (!areaColumnNames.includes('area_code')) {
      db.exec("ALTER TABLE s6_areas ADD COLUMN area_code INTEGER");
      console.log('✅ s6_areas 表新增 area_code 字段');
    }
    if (!areaColumnNames.includes('floor')) {
      db.exec("ALTER TABLE s6_areas ADD COLUMN floor TEXT");
      console.log('✅ s6_areas 表新增 floor 字段');
    }
    if (!areaColumnNames.includes('responsible')) {
      db.exec("ALTER TABLE s6_areas ADD COLUMN responsible TEXT");
      console.log('✅ s6_areas 表新增 responsible 字段');
    }
    if (!areaColumnNames.includes('responsible_employee_id')) {
      db.exec("ALTER TABLE s6_areas ADD COLUMN responsible_employee_id TEXT");
      console.log('✅ s6_areas 表新增 responsible_employee_id 字段');
    }
    if (!areaColumnNames.includes('py')) {
      db.exec("ALTER TABLE s6_areas ADD COLUMN py TEXT");
      console.log('✅ s6_areas 表新增 py 字段');
    }
    if (!areaColumnNames.includes('py_person')) {
      db.exec("ALTER TABLE s6_areas ADD COLUMN py_person TEXT");
      console.log('✅ s6_areas 表新增 py_person 字段');
    }

    // 2. 创建区域与责任人关联表
    db.exec(`
      CREATE TABLE IF NOT EXISTS s6_area_responsibles (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        area_id INTEGER NOT NULL,
        staff_id INTEGER NOT NULL,
        created_at DATETIME DEFAULT (datetime('now', 'localtime')),
        UNIQUE(area_id, staff_id)
      )
    `);
    console.log('✅ s6_area_responsibles 区域责任人关联表已创建/存在');

    // 3. 检查 six_s_records 表字段
    const columns = db.prepare("PRAGMA table_info(six_s_records)").all();
    const columnNames = columns.map(c => c.name);

    // 添加 before_image_time 字段
    if (!columnNames.includes('before_image_time')) {
      db.exec("ALTER TABLE six_s_records ADD COLUMN before_image_time DATETIME");
      console.log('✅ six_s_records 表新增 before_image_time 字段');
    }

    if (!columnNames.includes('before_images')) {
      db.exec("ALTER TABLE six_s_records ADD COLUMN before_images TEXT");
      console.log('✅ six_s_records 表新增 before_images 字段');
    }

    // 添加 after_image_time 字段
    if (!columnNames.includes('after_image_time')) {
      db.exec("ALTER TABLE six_s_records ADD COLUMN after_image_time DATETIME");
      console.log('✅ six_s_records 表新增 after_image_time 字段');
    }

    if (!columnNames.includes('after_images')) {
      db.exec("ALTER TABLE six_s_records ADD COLUMN after_images TEXT");
      console.log('✅ six_s_records 表新增 after_images 字段');
    }

    // 添加 created_by_username 字段（创建人登录账号）
    if (!columnNames.includes('created_by_username')) {
      db.exec("ALTER TABLE six_s_records ADD COLUMN created_by_username TEXT");
      console.log('✅ six_s_records 表新增 created_by_username 字段');
    }

    // 添加 default_deadline_days 字段（默认截止天数）
    if (!columnNames.includes('default_deadline_days')) {
      db.exec("ALTER TABLE six_s_records ADD COLUMN default_deadline_days INTEGER DEFAULT 3");
      console.log('✅ six_s_records 表新增 default_deadline_days 字段');
    }

    db.exec(`
      CREATE TABLE IF NOT EXISTS s6_review_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        record_id INTEGER NOT NULL,
        action TEXT NOT NULL,
        comment TEXT,
        operator_id INTEGER,
        operator_name TEXT,
        image TEXT,
        images TEXT,
        image_time DATETIME,
        created_at DATETIME DEFAULT (datetime('now', 'localtime'))
      )
    `);
    const logColumns = db.prepare("PRAGMA table_info(s6_review_logs)").all();
    const logColumnNames = logColumns.map(c => c.name);
    if (!logColumnNames.includes('image')) {
      db.exec("ALTER TABLE s6_review_logs ADD COLUMN image TEXT");
      console.log('✅ s6_review_logs 表新增 image 字段');
    }
    if (!logColumnNames.includes('images')) {
      db.exec("ALTER TABLE s6_review_logs ADD COLUMN images TEXT");
      console.log('✅ s6_review_logs 表新增 images 字段');
    }
    if (!logColumnNames.includes('image_time')) {
      db.exec("ALTER TABLE s6_review_logs ADD COLUMN image_time DATETIME");
      console.log('✅ s6_review_logs 表新增 image_time 字段');
    }

    db.exec(`
      CREATE TABLE IF NOT EXISTS s6_cloud_sync_queue (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        target_table TEXT NOT NULL,
        target_id INTEGER NOT NULL,
        primary_field TEXT NOT NULL,
        list_field TEXT,
        local_urls TEXT NOT NULL,
        status TEXT DEFAULT 'pending',
        retry_count INTEGER DEFAULT 0,
        last_error TEXT,
        next_retry_at DATETIME DEFAULT (datetime('now', 'localtime')),
        created_at DATETIME DEFAULT (datetime('now', 'localtime')),
        updated_at DATETIME DEFAULT (datetime('now', 'localtime'))
      )
    `);
    console.log('✅ s6_cloud_sync_queue 队列表已创建/存在');

    // 初始化默认区域数据
    const areaCount = db.prepare("SELECT COUNT(*) as c FROM s6_areas").get().c;
    if (areaCount === 0) {
      const insertArea = db.prepare("INSERT INTO s6_areas (name, parent_id, sort_order) VALUES (?, ?, ?)");
      // 一级区域
      insertArea.run('生产区', 0, 1);
      insertArea.run('办公区', 0, 2);
      insertArea.run('后勤区', 0, 3);
      // 二级区域 - 生产区
      insertArea.run('生产车间', 1, 1);
      insertArea.run('仓库', 1, 2);
      insertArea.run('质检区', 1, 3);
      // 二级区域 - 办公区
      insertArea.run('办公室', 2, 1);
      insertArea.run('会议室', 2, 2);
      insertArea.run('休息室', 2, 3);
      // 二级区域 - 后勤区
      insertArea.run('卫生间', 3, 1);
      insertArea.run('食堂', 3, 2);
      insertArea.run('宿舍', 3, 3);
      console.log('✅ 默认区域数据已初始化');
    }
  } catch (err) {
    console.error('❌ initSixSRecords 失败:', err.message);
  }
}

function ensureColumn(table, name, definition) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!columns.some(column => column.name === name)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`);
    console.log(`✅ ${table} 表新增 ${name} 字段`);
  }
}

const TASK_POSITION_EXACT_LEVELS = new Map([
  ['总经理', 10],
  ['财务总监', 9],
  ['技术总工程师', 8],
  ['白班保安', 1],
  ['夜班保安', 1]
]);

const TASK_POSITION_KEYWORD_LEVELS = [
  { level: 9, keywords: ['副总经理', '总监'] },
  { level: 8, keywords: ['总工程师', '部长'] },
  { level: 7, keywords: ['科长'] },
  { level: 6, keywords: ['组长', '主管', '领班'] },
  { level: 4, keywords: ['助理工程师', '中级', '专员', '文员', '计划员', '报价专员', '采购员', '仓管员', '管理员'] },
  { level: 3, keywords: ['助理', '出纳', '单证员', '调机'] },
  { level: 2, keywords: ['师傅', '普师', '作业员', '测量员', '质检员', '抛光员', '注塑工', '电工', '驾驶员'] },
  { level: 1, keywords: ['学徒', '杂工', '保洁', '保安'] },
  { level: 5, keywords: ['高级', '工程师', '设计师', '编程', '运维', '会计'] }
];

function resolveTaskPositionLevel(positionName) {
  const position = String(positionName || '').trim();
  if (!position) return { level: 1, company_wide: 0 };
  if (TASK_POSITION_EXACT_LEVELS.has(position)) {
    const level = TASK_POSITION_EXACT_LEVELS.get(position);
    return { level, company_wide: level >= 9 ? 1 : 0 };
  }

  for (const rule of TASK_POSITION_KEYWORD_LEVELS) {
    if (rule.keywords.some(keyword => position.includes(keyword))) {
      return { level: rule.level, company_wide: rule.level >= 9 ? 1 : 0 };
    }
  }

  return { level: 1, company_wide: 0 };
}

function syncTaskPositionLevels() {
  const positions = db.prepare(`
    SELECT DISTINCT TRIM(position) AS position_name
    FROM staff
    WHERE position IS NOT NULL AND TRIM(position) <> ''
  `).all();

  if (!positions.length) return;

  const insert = db.prepare(`
    INSERT OR IGNORE INTO task_position_levels (position_name, level, company_wide, updated_at)
    VALUES (?, ?, ?, datetime('now', 'localtime'))
  `);

  db.transaction(items => {
    items.forEach(({ position_name }) => {
      const { level, company_wide } = resolveTaskPositionLevel(position_name);
      insert.run(position_name, level, company_wide);
    });
  })(positions);

  console.log(`✅ 任务岗位级别规则已补齐: ${positions.length} 个岗位`);
}

function initNotificationCenter() {
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS notifications (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        recipient_type TEXT NOT NULL,
        recipient_id INTEGER NOT NULL,
        category TEXT NOT NULL DEFAULT 'notice',
        module TEXT NOT NULL DEFAULT 'system',
        source_id INTEGER,
        title TEXT NOT NULL,
        content TEXT NOT NULL DEFAULT '',
        link TEXT,
        level TEXT NOT NULL DEFAULT 'info',
        is_read INTEGER NOT NULL DEFAULT 0,
        created_by_type TEXT,
        created_by_id INTEGER,
        created_by_name TEXT,
        read_at DATETIME,
        created_at DATETIME DEFAULT (datetime('now', 'localtime'))
      );

      CREATE INDEX IF NOT EXISTS idx_notifications_recipient
      ON notifications(recipient_type, recipient_id, is_read, created_at DESC);

      CREATE INDEX IF NOT EXISTS idx_notifications_module
      ON notifications(module, source_id, created_at DESC);
    `);
    console.log('✅ 通知中心数据结构已初始化');
  } catch (err) {
    console.error('❌ initNotificationCenter 失败:', err.message);
    throw err;
  }
}

function initMiniAppIntegration() {
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS miniapp_user_bindings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        recipient_type TEXT NOT NULL,
        recipient_id INTEGER NOT NULL,
        app_id TEXT NOT NULL DEFAULT '',
        openid TEXT NOT NULL,
        unionid TEXT,
        nickname TEXT,
        avatar_url TEXT,
        status TEXT NOT NULL DEFAULT 'active',
        last_seen_at DATETIME DEFAULT (datetime('now', 'localtime')),
        created_at DATETIME DEFAULT (datetime('now', 'localtime')),
        updated_at DATETIME DEFAULT (datetime('now', 'localtime')),
        UNIQUE(recipient_type, recipient_id, app_id)
      );

      CREATE INDEX IF NOT EXISTS idx_miniapp_bindings_openid
      ON miniapp_user_bindings(openid, status);

      CREATE TABLE IF NOT EXISTS miniapp_template_subscriptions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        recipient_type TEXT NOT NULL,
        recipient_id INTEGER NOT NULL,
        app_id TEXT NOT NULL DEFAULT '',
        template_key TEXT NOT NULL,
        template_id TEXT,
        page_path TEXT,
        scene TEXT NOT NULL DEFAULT '',
        subscribed INTEGER NOT NULL DEFAULT 1,
        updated_at DATETIME DEFAULT (datetime('now', 'localtime')),
        last_subscribed_at DATETIME,
        UNIQUE(recipient_type, recipient_id, app_id, template_key)
      );

      CREATE INDEX IF NOT EXISTS idx_miniapp_subscriptions_lookup
      ON miniapp_template_subscriptions(recipient_type, recipient_id, app_id, subscribed);

      CREATE TABLE IF NOT EXISTS miniapp_push_queue (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        notification_id INTEGER,
        recipient_type TEXT NOT NULL,
        recipient_id INTEGER NOT NULL,
        app_id TEXT NOT NULL DEFAULT '',
        openid TEXT NOT NULL,
        template_key TEXT NOT NULL,
        template_id TEXT,
        page_path TEXT,
        title TEXT NOT NULL,
        content TEXT NOT NULL DEFAULT '',
        payload_json TEXT NOT NULL DEFAULT '{}',
        status TEXT NOT NULL DEFAULT 'pending',
        source_module TEXT NOT NULL DEFAULT 'system',
        source_category TEXT NOT NULL DEFAULT 'notice',
        source_id INTEGER,
        error_message TEXT,
        sent_at DATETIME,
        created_at DATETIME DEFAULT (datetime('now', 'localtime'))
      );

      CREATE INDEX IF NOT EXISTS idx_miniapp_push_queue_status
      ON miniapp_push_queue(status, created_at DESC);

      CREATE INDEX IF NOT EXISTS idx_miniapp_push_queue_recipient
      ON miniapp_push_queue(recipient_type, recipient_id, created_at DESC);
    `);
    console.log('✅ 小程序混合接入数据结构已初始化');
  } catch (err) {
    console.error('❌ initMiniAppIntegration 失败:', err.message);
    throw err;
  }
}

// 初始化个人待办与团队任务工作台
function initTaskWorkbench() {
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name TEXT PRIMARY KEY,
        applied_at DATETIME DEFAULT (datetime('now', 'localtime'))
      );

      CREATE TABLE IF NOT EXISTS task_position_levels (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        position_name TEXT NOT NULL UNIQUE,
        level INTEGER NOT NULL DEFAULT 1,
        company_wide INTEGER NOT NULL DEFAULT 0,
        updated_at DATETIME DEFAULT (datetime('now', 'localtime'))
      );
    `);

    ensureColumn('users', 'staff_id', 'INTEGER');
    ensureColumn('tasks', 'scope', "TEXT DEFAULT 'legacy'");
    ensureColumn('tasks', 'category', "TEXT DEFAULT 'other'");
    ensureColumn('tasks', 'owner_user_id', 'INTEGER');
    ensureColumn('tasks', 'assigned_staff_id', 'INTEGER');
    ensureColumn('tasks', 'created_by_user_id', 'INTEGER');
    ensureColumn('tasks', 'due_at', 'DATETIME');
    ensureColumn('tasks', 'remind_at', 'DATETIME');
    ensureColumn('tasks', 'source_label', "TEXT DEFAULT 'manual'");
    ensureColumn('tasks', 'completed_at', 'DATETIME');
    ensureColumn('tasks', 'updated_at', "DATETIME DEFAULT (datetime('now', 'localtime'))");
    ensureColumn('tasks', 'parent_task_id', 'INTEGER');
    ensureColumn('tasks', 'task_kind', "TEXT DEFAULT 'task'");

    db.exec(`
      UPDATE tasks
      SET scope = COALESCE(NULLIF(scope, ''), 'legacy'),
          category = COALESCE(NULLIF(category, ''), CASE WHEN type IN ('exam', 'meal') THEN type ELSE 'other' END),
          created_by_user_id = COALESCE(created_by_user_id, assigned_by),
          due_at = COALESCE(due_at, due_date)
      WHERE scope IS NULL OR scope = '' OR category IS NULL OR category = ''
         OR created_by_user_id IS NULL OR due_at IS NULL;

      INSERT OR IGNORE INTO task_position_levels (position_name)
      SELECT DISTINCT TRIM(position)
      FROM staff
      WHERE position IS NOT NULL AND TRIM(position) <> '';

      UPDATE users
      SET staff_id = (
        SELECT staff.id FROM staff WHERE staff.employee_id = users.username LIMIT 1
      )
      WHERE staff_id IS NULL
        AND EXISTS (SELECT 1 FROM staff WHERE staff.employee_id = users.username);

      CREATE INDEX IF NOT EXISTS idx_tasks_scope_owner ON tasks(scope, owner_user_id);
      CREATE INDEX IF NOT EXISTS idx_tasks_assigned_staff ON tasks(assigned_staff_id);
      CREATE INDEX IF NOT EXISTS idx_tasks_creator ON tasks(created_by_user_id);
      CREATE INDEX IF NOT EXISTS idx_tasks_due_at ON tasks(due_at);
      CREATE INDEX IF NOT EXISTS idx_tasks_parent_task ON tasks(parent_task_id);
    `);

    syncTaskPositionLevels();

    db.prepare(`
      INSERT OR IGNORE INTO schema_migrations (name) VALUES (?)
    `).run('20260601_task_workbench');
    db.prepare(`
      INSERT OR IGNORE INTO schema_migrations (name) VALUES (?)
    `).run('20260601_task_position_level_bootstrap');
    console.log('✅ 个人待办工作台数据结构已初始化');
  } catch (err) {
    console.error('❌ initTaskWorkbench 失败:', err.message);
    throw err;
  }
}

// 旧版本会在每次启动时重建多张表，容易破坏索引和 WAL。
// 保留迁移标记，不再对已有业务表做启动期重建。
function migrateTimestampsToLocaltime() {
  db.prepare(`
    INSERT OR IGNORE INTO schema_migrations (name) VALUES (?)
  `).run('legacy_timestamp_rebuild_disabled');
}

// 初始化工服管理表
function initWorkwearTables() {
  try {
    ensureColumn('staff', 'workwear_permission', 'INTEGER DEFAULT 0');
    ensureColumn('staff', 'workwear_special_permission', 'INTEGER DEFAULT 0');
    ensureColumn('staff', 'workwear_leave_date', 'TEXT');
    ensureColumn('staff', 'workwear_leave_confirmed_at', 'TEXT');

    // 工服领用记录表
    db.exec(`
      CREATE TABLE IF NOT EXISTS workwear_records (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        staff_id INTEGER,
        staff_name TEXT NOT NULL,
        department TEXT,
        position TEXT,
        hire_date TEXT,
        leave_date TEXT,
        issue_date TEXT NOT NULL,
        item_name TEXT NOT NULL,
        item_type TEXT DEFAULT '工服',
        model TEXT,
        quantity INTEGER DEFAULT 1,
        unit_price REAL DEFAULT 0,
        deduction REAL DEFAULT 0,
        self_purchase REAL DEFAULT 0,
        deduction_ratio REAL DEFAULT 50,
        remark TEXT,
        status TEXT DEFAULT 'active',
        created_by INTEGER,
        created_by_name TEXT,
        created_at DATETIME DEFAULT (datetime('now', 'localtime')),
        updated_at DATETIME DEFAULT (datetime('now', 'localtime'))
      )
    `);
    console.log('✅ workwear_records 工服领用记录表已创建/存在');
    ensureColumn('workwear_records', 'hire_date', 'TEXT');
    ensureColumn('workwear_records', 'leave_date', 'TEXT');
    ensureColumn('workwear_records', 'deduction_status', 'TEXT');
    ensureColumn('workwear_records', 'final_leave_date', 'TEXT');
    ensureColumn('workwear_records', 'final_deduction_ratio', 'REAL');
    ensureColumn('workwear_records', 'final_deduction', 'REAL');
    ensureColumn('workwear_records', 'deduction_reviewed_at', 'TEXT');
    ensureColumn('workwear_records', 'seq_no', 'INTEGER');
    db.exec(`
      CREATE TABLE IF NOT EXISTS workwear_record_remark_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        record_id INTEGER NOT NULL,
        old_remark TEXT,
        new_remark TEXT,
        changed_by INTEGER,
        changed_by_name TEXT,
        changed_at DATETIME DEFAULT (datetime('now', 'localtime'))
      )
    `);
    console.log('✅ workwear_record_remark_history 备注历史表已创建/存在');
    db.exec(`CREATE INDEX IF NOT EXISTS idx_remark_history_record_id ON workwear_record_remark_history(record_id, changed_at DESC)`);
    db.exec(`
      CREATE TABLE IF NOT EXISTS workwear_deduction_adjustments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        staff_id INTEGER,
        employee_id TEXT,
        staff_name TEXT NOT NULL,
        record_id INTEGER,
        item_name TEXT,
        model TEXT,
        quantity INTEGER DEFAULT 0,
        unit_price REAL DEFAULT 0,
        provisional_leave_date TEXT,
        official_leave_date TEXT,
        original_deduction_ratio REAL DEFAULT 0,
        official_deduction_ratio REAL DEFAULT 0,
        original_deduction REAL DEFAULT 0,
        official_deduction REAL DEFAULT 0,
        diff_amount REAL DEFAULT 0,
        source TEXT DEFAULT 'excel_sync',
        status TEXT DEFAULT 'pending',
        created_at DATETIME DEFAULT (datetime('now', 'localtime')),
        updated_at DATETIME DEFAULT (datetime('now', 'localtime')),
        UNIQUE(record_id, official_leave_date)
      );
      CREATE INDEX IF NOT EXISTS idx_workwear_deduction_adjustments_staff ON workwear_deduction_adjustments(staff_id);
      CREATE INDEX IF NOT EXISTS idx_workwear_deduction_adjustments_status ON workwear_deduction_adjustments(status);
    `);

    // 工服库存表
    db.exec(`
      CREATE TABLE IF NOT EXISTS workwear_inventory (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        item_name TEXT NOT NULL,
        item_type TEXT DEFAULT '工服',
        model TEXT,
        quantity INTEGER DEFAULT 0,
        min_stock INTEGER DEFAULT 5,
        unit_price REAL DEFAULT 0,
        remark TEXT,
        updated_at DATETIME DEFAULT (datetime('now', 'localtime')),
        UNIQUE(item_name, model)
      )
    `);
    console.log('✅ workwear_inventory 工服库存表已创建/存在');

    db.exec(`
      CREATE TABLE IF NOT EXISTS workwear_inventory_sheet_cache (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sheet_name TEXT NOT NULL UNIQUE,
        sheet_title TEXT,
        columns_json TEXT NOT NULL,
        rows_json TEXT NOT NULL,
        source_file TEXT,
        imported_at DATETIME DEFAULT (datetime('now', 'localtime')),
        updated_at DATETIME DEFAULT (datetime('now', 'localtime'))
      )
    `);
    console.log('✅ workwear_inventory_sheet_cache 盘存缓存表已创建/存在');

    db.exec(`
      CREATE TABLE IF NOT EXISTS workwear_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source_no INTEGER,
        category TEXT NOT NULL,
        model TEXT NOT NULL DEFAULT '',
        unit TEXT NOT NULL,
        unit_price REAL DEFAULT 0,
        item_type TEXT DEFAULT '工服',
        remark TEXT,
        is_active INTEGER DEFAULT 1,
        min_stock INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT (datetime('now', 'localtime')),
        updated_at DATETIME DEFAULT (datetime('now', 'localtime')),
        UNIQUE(category, model)
      )
    `);
    console.log('✅ workwear_items 基础物品主数据表已创建/存在');

    db.exec(`
      CREATE TABLE IF NOT EXISTS workwear_purchase_entries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source_ref TEXT UNIQUE,
        purchase_date TEXT NOT NULL,
        default_purchaser TEXT,
        purchaser TEXT,
        item_id INTEGER,
        item_name TEXT NOT NULL,
        category TEXT,
        model TEXT NOT NULL DEFAULT '',
        unit TEXT,
        unit_price REAL DEFAULT 0,
        quantity INTEGER DEFAULT 0,
        amount REAL DEFAULT 0,
        remark TEXT,
        item_type TEXT DEFAULT '工服',
        created_at DATETIME DEFAULT (datetime('now', 'localtime')),
        updated_at DATETIME DEFAULT (datetime('now', 'localtime'))
      )
    `);
    console.log('✅ workwear_purchase_entries 采购入库记录表已创建/存在');

    const purchaseEntryColumns = db.prepare(`PRAGMA table_info(workwear_purchase_entries)`).all().map((column) => column.name);
    if (!purchaseEntryColumns.includes('default_purchaser')) {
      db.exec(`ALTER TABLE workwear_purchase_entries ADD COLUMN default_purchaser TEXT`);
      db.exec(`
        UPDATE workwear_purchase_entries
        SET default_purchaser = purchaser
        WHERE COALESCE(TRIM(default_purchaser), '') = ''
      `);
      console.log('✅ workwear_purchase_entries 新增 default_purchaser 字段');
    }

    db.exec(`
      CREATE TABLE IF NOT EXISTS workwear_purchase_adjustments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        adjustment_group_id TEXT,
        purchase_date TEXT NOT NULL,
        item_id INTEGER,
        item_name TEXT NOT NULL,
        category TEXT,
        model TEXT NOT NULL DEFAULT '',
        unit TEXT,
        unit_price REAL DEFAULT 0,
        original_qty INTEGER DEFAULT 0,
        adjusted_qty INTEGER DEFAULT 0,
        diff_qty INTEGER DEFAULT 0,
        remark TEXT NOT NULL,
        status TEXT DEFAULT 'pending',
        requested_by INTEGER,
        requested_by_name TEXT,
        approver_staff_id INTEGER,
        approver_name TEXT,
        requested_at DATETIME DEFAULT (datetime('now', 'localtime')),
        reviewed_by INTEGER,
        reviewed_by_name TEXT,
        reviewed_at DATETIME,
        review_comment TEXT,
        applied_entry_id INTEGER,
        created_at DATETIME DEFAULT (datetime('now', 'localtime')),
        updated_at DATETIME DEFAULT (datetime('now', 'localtime'))
      )
    `);
    console.log('✅ workwear_purchase_adjustments 采购更改追溯表已创建/存在');

    db.exec(`
      CREATE TABLE IF NOT EXISTS workwear_inventory_opening (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        year_month TEXT NOT NULL,
        item_id INTEGER NOT NULL,
        opening_qty INTEGER DEFAULT 0,
        source_type TEXT DEFAULT 'excel_opening',
        remark TEXT,
        created_at DATETIME DEFAULT (datetime('now', 'localtime')),
        updated_at DATETIME DEFAULT (datetime('now', 'localtime')),
        UNIQUE(year_month, item_id)
      )
    `);
    console.log('✅ workwear_inventory_opening 月度期初表已创建/存在');

    db.exec(`
      CREATE TABLE IF NOT EXISTS workwear_inventory_monthly (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        year_month TEXT NOT NULL,
        item_id INTEGER NOT NULL,
        opening_qty INTEGER DEFAULT 0,
        in_qty INTEGER DEFAULT 0,
        out_qty INTEGER DEFAULT 0,
        closing_qty INTEGER DEFAULT 0,
        computed_at DATETIME DEFAULT (datetime('now', 'localtime')),
        remark TEXT,
        UNIQUE(year_month, item_id)
      )
    `);
    console.log('✅ workwear_inventory_monthly 月度真实库存表已创建/存在');

    db.exec(`
      CREATE TABLE IF NOT EXISTS workwear_inventory_exceptions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        year_month TEXT NOT NULL,
        source_type TEXT NOT NULL,
        source_id TEXT,
        raw_category TEXT,
        raw_model TEXT,
        raw_name TEXT,
        quantity INTEGER DEFAULT 0,
        reason TEXT,
        created_at DATETIME DEFAULT (datetime('now', 'localtime'))
      )
    `);
    console.log('✅ workwear_inventory_exceptions 库存异常表已创建/存在');

    db.exec(`
      CREATE TABLE IF NOT EXISTS workwear_department_approvers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        department_name TEXT NOT NULL UNIQUE,
        approver_staff_id INTEGER,
        approver_name TEXT,
        is_active INTEGER DEFAULT 1,
        created_at DATETIME DEFAULT (datetime('now', 'localtime')),
        updated_at DATETIME DEFAULT (datetime('now', 'localtime'))
      )
    `);
    console.log('✅ workwear_department_approvers 部门审核人表已创建/存在');

    db.exec(`
      CREATE TABLE IF NOT EXISTS workwear_inventory_count_sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        closing_month TEXT NOT NULL UNIQUE,
        opening_month TEXT NOT NULL,
        created_by INTEGER,
        created_by_name TEXT,
        created_by_department TEXT,
        status TEXT DEFAULT 'counting',
        completed_by INTEGER,
        completed_at DATETIME,
        created_at DATETIME DEFAULT (datetime('now', 'localtime')),
        updated_at DATETIME DEFAULT (datetime('now', 'localtime'))
      )
    `);
    console.log('✅ workwear_inventory_count_sessions 盘点会话表已创建/存在');

    db.exec(`
      CREATE TABLE IF NOT EXISTS workwear_inventory_count_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id INTEGER NOT NULL,
        item_id INTEGER NOT NULL,
        department_name TEXT,
        system_closing_qty INTEGER DEFAULT 0,
        manual_total_qty INTEGER DEFAULT 0,
        difference_qty INTEGER DEFAULT 0,
        remark TEXT,
        status TEXT DEFAULT 'draft',
        approver_staff_id INTEGER,
        approver_name TEXT,
        submitted_by INTEGER,
        submitted_at DATETIME,
        reviewed_by INTEGER,
        reviewed_at DATETIME,
        review_result TEXT,
        review_comment TEXT,
        confirmed_at DATETIME,
        created_at DATETIME DEFAULT (datetime('now', 'localtime')),
        updated_at DATETIME DEFAULT (datetime('now', 'localtime')),
        UNIQUE(session_id, item_id)
      )
    `);
    console.log('✅ workwear_inventory_count_items 盘点明细表已创建/存在');

    db.exec(`
      CREATE TABLE IF NOT EXISTS workwear_inventory_count_adjustments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id INTEGER NOT NULL,
        count_item_id INTEGER NOT NULL,
        closing_month TEXT NOT NULL,
        opening_month TEXT NOT NULL,
        item_id INTEGER NOT NULL,
        system_closing_qty INTEGER DEFAULT 0,
        manual_total_qty INTEGER DEFAULT 0,
        difference_qty INTEGER DEFAULT 0,
        remark TEXT,
        status TEXT DEFAULT 'approved',
        submitted_by INTEGER,
        approver_staff_id INTEGER,
        approver_name TEXT,
        reviewed_by INTEGER,
        reviewed_at DATETIME,
        review_comment TEXT,
        created_at DATETIME DEFAULT (datetime('now', 'localtime')),
        updated_at DATETIME DEFAULT (datetime('now', 'localtime')),
        UNIQUE(count_item_id)
      )
    `);
    console.log('✅ workwear_inventory_count_adjustments 盘点差异调整表已创建/存在');

    db.exec(`
      CREATE TABLE IF NOT EXISTS workwear_inventory_count_locations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        count_item_id INTEGER NOT NULL,
        location_code TEXT NOT NULL,
        location_name TEXT NOT NULL,
        quantity INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT (datetime('now', 'localtime')),
        updated_at DATETIME DEFAULT (datetime('now', 'localtime')),
        UNIQUE(count_item_id, location_code)
      )
    `);
    console.log('✅ workwear_inventory_count_locations 盘点地点表已创建/存在');

    // 创建索引
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_workwear_records_staff ON workwear_records(staff_name);
      CREATE INDEX IF NOT EXISTS idx_workwear_records_date ON workwear_records(issue_date);
      CREATE INDEX IF NOT EXISTS idx_workwear_records_dept ON workwear_records(department);
      CREATE INDEX IF NOT EXISTS idx_workwear_inventory_sheet_cache_name ON workwear_inventory_sheet_cache(sheet_name);
      CREATE INDEX IF NOT EXISTS idx_workwear_items_category_model ON workwear_items(category, model);
      CREATE INDEX IF NOT EXISTS idx_workwear_purchase_entries_date ON workwear_purchase_entries(purchase_date);
      CREATE INDEX IF NOT EXISTS idx_workwear_purchase_entries_item ON workwear_purchase_entries(item_id);
      CREATE INDEX IF NOT EXISTS idx_workwear_purchase_adjustments_date ON workwear_purchase_adjustments(purchase_date);
      CREATE INDEX IF NOT EXISTS idx_workwear_purchase_adjustments_status ON workwear_purchase_adjustments(status);
      CREATE INDEX IF NOT EXISTS idx_workwear_inventory_opening_month ON workwear_inventory_opening(year_month);
      CREATE INDEX IF NOT EXISTS idx_workwear_inventory_monthly_month ON workwear_inventory_monthly(year_month);
      CREATE INDEX IF NOT EXISTS idx_workwear_inventory_exceptions_month ON workwear_inventory_exceptions(year_month);
      CREATE INDEX IF NOT EXISTS idx_workwear_inventory_count_sessions_month ON workwear_inventory_count_sessions(closing_month);
      CREATE INDEX IF NOT EXISTS idx_workwear_inventory_count_items_session ON workwear_inventory_count_items(session_id);
      CREATE INDEX IF NOT EXISTS idx_workwear_inventory_count_items_status ON workwear_inventory_count_items(status);
      CREATE INDEX IF NOT EXISTS idx_workwear_inventory_count_items_approver ON workwear_inventory_count_items(approver_staff_id);
      CREATE INDEX IF NOT EXISTS idx_workwear_inventory_count_adjustments_month ON workwear_inventory_count_adjustments(closing_month);
      CREATE INDEX IF NOT EXISTS idx_workwear_inventory_count_adjustments_item ON workwear_inventory_count_adjustments(item_id);
      CREATE INDEX IF NOT EXISTS idx_workwear_inventory_count_locations_item ON workwear_inventory_count_locations(count_item_id);
    `);
    console.log('✅ 工服管理索引已创建');
  } catch (err) {
    console.error('❌ initWorkwearTables 失败:', err.message);
  }
}

// 执行初始化
try {
  initDatabase();
  // 设置 WAL 模式提高性能
  db.pragma('journal_mode = WAL');
  console.log('✅ 数据库配置完成');
} catch (err) {
  console.error('❌ 初始化失败，退出程序');
  process.exit(1);
}

module.exports = db;
