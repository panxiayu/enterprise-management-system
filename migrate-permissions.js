// 迁移脚本：添加学习任务和6S管理权限字段
const Database = require("better-sqlite3");
const db = new Database("./data/exam.db");

console.log("开始迁移: 添加 task_permission 和 6s_permission 字段...");

try {
    // 检查字段是否已存在
    const columns = db.prepare("PRAGMA table_info(staff)").all();
    const columnNames = columns.map(c => c.name);

    // 添加 task_permission
    if (!columnNames.includes('task_permission')) {
        db.exec("ALTER TABLE staff ADD COLUMN task_permission INTEGER DEFAULT 0");
        console.log("✅ 添加 task_permission 字段成功");
    } else {
        console.log("⚠️ task_permission 字段已存在");
    }

    // 添加 6s_permission (注意：SQLite 列名不能以数字开头，这里使用 s6_permission)
    if (!columnNames.includes('6s_permission') && !columnNames.includes('s6_permission')) {
        db.exec("ALTER TABLE staff ADD COLUMN s6_permission INTEGER DEFAULT 0");
        console.log("✅ 添加 s6_permission 字段成功");
    } else if (columnNames.includes('6s_permission')) {
        console.log("⚠️ 6s_permission 字段已存在");
    } else {
        console.log("⚠️ s6_permission 字段已存在");
    }

    // 验证迁移结果
    const newColumns = db.prepare("PRAGMA table_info(staff)").all();
    console.log("\n迁移后 staff 表字段:");
    newColumns.forEach(col => {
        console.log(`  ${col.name}: ${col.type || 'N/A'}`);
    });

    console.log("\n✅ 迁移完成!");
} catch (e) {
    console.error("❌ 迁移失败:", e.message);
    process.exit(1);
}

db.close();
