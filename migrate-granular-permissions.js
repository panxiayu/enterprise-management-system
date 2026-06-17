// migrate-granular-permissions.js - 粒化权限迁移脚本
const Database = require("better-sqlite3");
const db = new Database("./data/exam.db");

console.log("开始迁移: 创建粒化权限表...\n");

try {
    // 1. 创建考试权限表 (exam_permissions)
    db.exec(`
        CREATE TABLE IF NOT EXISTS exam_permissions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            exam_id INTEGER NOT NULL,
            staff_id INTEGER NOT NULL,
            can_take INTEGER DEFAULT 1,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (exam_id) REFERENCES exams(id),
            FOREIGN KEY (staff_id) REFERENCES staff(id),
            UNIQUE(exam_id, staff_id)
        )
    `);
    console.log("✅ 创建 exam_permissions 表成功");

    // 2. 创建报餐活动类型表 (meal_types: customer/employee)
    db.exec(`
        CREATE TABLE IF NOT EXISTS meal_types (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL UNIQUE,
            description TEXT
        )
    `);
    console.log("✅ 创建 meal_types 表成功");

    // 3. 插入默认报餐类型
    const existingTypes = db.prepare("SELECT COUNT(*) as count FROM meal_types").get();
    if (existingTypes.count === 0) {
        db.prepare("INSERT INTO meal_types (name, description) VALUES ('客餐', '客户用餐')").run();
        db.prepare("INSERT INTO meal_types (name, description) VALUES ('员工餐', '内部员工用餐')").run();
        console.log("✅ 插入默认报餐类型: 客餐, 员工餐");
    }

    // 4. 修改 meal_activities 表添加 meal_type
    const mealActivitiesColumns = db.prepare("PRAGMA table_info(meal_activities)").all().map(c => c.name);
    if (!mealActivitiesColumns.includes('meal_type')) {
        db.exec("ALTER TABLE meal_activities ADD COLUMN meal_type TEXT DEFAULT 'employee'");
        console.log("✅ 添加 meal_activities.meal_type 字段");
    }

    // 5. 创建报餐权限表 (meal_permissions)
    db.exec(`
        CREATE TABLE IF NOT EXISTS meal_permissions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            activity_id INTEGER NOT NULL,
            staff_id INTEGER NOT NULL,
            can_order INTEGER DEFAULT 1,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (activity_id) REFERENCES meal_activities(id),
            FOREIGN KEY (staff_id) REFERENCES staff(id),
            UNIQUE(activity_id, staff_id)
        )
    `);
    console.log("✅ 创建 meal_permissions 表成功");

    // 6. 创建文件公共权限表 (file_public_permissions)
    db.exec(`
        CREATE TABLE IF NOT EXISTS file_public_permissions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            staff_id INTEGER NOT NULL UNIQUE,
            can_read INTEGER DEFAULT 0,
            can_write INTEGER DEFAULT 0,
            can_download INTEGER DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (staff_id) REFERENCES staff(id)
        )
    `);
    console.log("✅ 创建 file_public_permissions 表成功");

    // 7. 创建文件个人权限表 (file_personal_permissions)
    db.exec(`
        CREATE TABLE IF NOT EXISTS file_personal_permissions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            staff_id INTEGER NOT NULL UNIQUE,
            can_read INTEGER DEFAULT 1,
            can_write INTEGER DEFAULT 1,
            can_download INTEGER DEFAULT 1,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (staff_id) REFERENCES staff(id)
        )
    `);
    console.log("✅ 创建 file_personal_permissions 表成功");

    // 8. 创建6S权限表 (s6_permissions)
    db.exec(`
        CREATE TABLE IF NOT EXISTS s6_permissions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            staff_id INTEGER NOT NULL UNIQUE,
            can_manage INTEGER DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (staff_id) REFERENCES staff(id)
        )
    `);
    console.log("✅ 创建 s6_permissions 表成功");

    // 9. 给 learning_tasks 表添加 exam_id 字段（绑定学习任务到考试）
    const learningTasksColumns = db.prepare("PRAGMA table_info(learning_tasks)").all().map(c => c.name);
    if (!learningTasksColumns.includes('exam_id')) {
        db.exec("ALTER TABLE learning_tasks ADD COLUMN exam_id INTEGER REFERENCES exams(id)");
        console.log("✅ 添加 learning_tasks.exam_id 字段");
    }

    // 迁移现有数据: 为所有有 s6_permission=1 的员工创建 s6_permissions 记录
    const staffWithS6 = db.prepare("SELECT id FROM staff WHERE s6_permission = 1").all();
    for (const staff of staffWithS6) {
        try {
            db.prepare("INSERT OR IGNORE INTO s6_permissions (staff_id, can_manage) VALUES (?, 1)").run(staff.id);
        } catch (e) {}
    }
    console.log(`✅ 迁移 ${staffWithS6.length} 名员工的6S权限`);

    // 迁移现有数据: 为所有有 exam_permission=1 的员工创建 exam_permissions 记录(所有考试)
    const staffWithExam = db.prepare("SELECT id FROM staff WHERE exam_permission = 1").all();
    const exams = db.prepare("SELECT id FROM exams").all();
    let examPermCount = 0;
    for (const staff of staffWithExam) {
        for (const exam of exams) {
            try {
                db.prepare("INSERT OR IGNORE INTO exam_permissions (exam_id, staff_id, can_take) VALUES (?, ?, 1)").run(exam.id, staff.id);
                examPermCount++;
            } catch (e) {}
        }
    }
    console.log(`✅ 迁移 ${examPermCount} 条考试权限记录`);

    // 迁移现有数据: 为所有有 meal_permission=1 的员工创建 meal_permissions 记录(所有活动)
    const staffWithMeal = db.prepare("SELECT id FROM staff WHERE meal_permission = 1").all();
    const mealActivities = db.prepare("SELECT id FROM meal_activities").all();
    let mealPermCount = 0;
    for (const staff of staffWithMeal) {
        for (const activity of mealActivities) {
            try {
                db.prepare("INSERT OR IGNORE INTO meal_permissions (activity_id, staff_id, can_order) VALUES (?, ?, 1)").run(activity.id, staff.id);
                mealPermCount++;
            } catch (e) {}
        }
    }
    console.log(`✅ 迁移 ${mealPermCount} 条报餐权限记录`);

    console.log("\n✅ 所有粒化权限表创建完成!");
} catch (e) {
    console.error("❌ 迁移失败:", e.message);
    process.exit(1);
}

db.close();