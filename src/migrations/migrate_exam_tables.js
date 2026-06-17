// src/migrations/migrate_exam_tables.js
// 迁移脚本：将 exams 表数据迁移到 exam_banks 和 exam_trainings 表
// 运行方式: node src/migrations/migrate_exam_tables.js

const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.resolve(__dirname, '../../data/exam.db');
const db = new Database(dbPath);

console.log('开始迁移 exams 表数据...');

// 先创建表（如果不存在）
try {
  db.exec(`
    CREATE TABLE IF NOT EXISTS exam_banks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      description TEXT DEFAULT '',
      duration INTEGER DEFAULT 60,
      pass_score INTEGER DEFAULT 60,
      is_active INTEGER DEFAULT 0,
      created_by INTEGER,
      created_at DATETIME DEFAULT (datetime('now', 'localtime')),
      updated_at DATETIME DEFAULT (datetime('now', 'localtime'))
    )
  `);
  console.log('exam_banks 表已创建/存在');
} catch (e) {
  console.log('exam_banks 表创建:', e.message);
}

try {
  db.exec(`
    CREATE TABLE IF NOT EXISTS exam_trainings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      description TEXT DEFAULT '',
      duration INTEGER DEFAULT 60,
      pass_score INTEGER DEFAULT 60,
      is_active INTEGER DEFAULT 0,
      learning_task_id INTEGER,
      question_bank_id INTEGER,
      created_by INTEGER,
      created_at DATETIME DEFAULT (datetime('now', 'localtime')),
      updated_at DATETIME DEFAULT (datetime('now', 'localtime'))
    )
  `);
  console.log('exam_trainings 表已创建/存在');
} catch (e) {
  console.log('exam_trainings 表创建:', e.message);
}

try {
  // 检查 exam_banks 表是否已有数据
  const banksCount = db.prepare('SELECT COUNT(*) as count FROM exam_banks').get();
  if (banksCount.count > 0) {
    console.log('exam_banks 表已有数据，跳过迁移');
    process.exit(0);
  }

  // 获取所有现有 exams
  const exams = db.prepare('SELECT * FROM exams').all();
  console.log(`找到 ${exams.length} 条 exams 记录`);

  // 迁移策略：
  // 1. 有 source_exam_id 的 exam（从其他题库复制）→ 作为题库迁移到 exam_banks
  // 2. 没有 source_exam_id 的 exam：
  //    - 如果有 learning_task_id 或 perm_count > 0 → 作为培训迁移到 exam_trainings
  //    - 否则 → 作为题库迁移到 exam_banks

  let banksMigrated = 0;
  let trainingsMigrated = 0;

  const insertBank = db.prepare(`
    INSERT INTO exam_banks (id, title, description, duration, pass_score, is_active, created_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertTraining = db.prepare(`
    INSERT INTO exam_trainings (id, title, description, duration, pass_score, is_active, learning_task_id, question_bank_id, created_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  // 获取每个 exam 的 perm_count
  const getPermCount = db.prepare('SELECT COUNT(*) as count FROM exam_permissions WHERE exam_id = ?');

  for (const exam of exams) {
    const permCount = getPermCount.get(exam.id).count;
    const hasLearningTask = exam.learning_task_id !== null;
    const isFromCopy = exam.source_exam_id !== null;

    // 判断是题库还是培训
    const isBank = isFromCopy || (!hasLearningTask && permCount === 0);
    // 有 source_exam_id 说明是从题库复制的（题库）
    // 没有 learning_task_id 且没有权限的是题库
    // 有 learning_task_id 或有权限的是培训

    if (isBank) {
      // 迁移到 exam_banks
      insertBank.run(
        exam.id,
        exam.title,
        exam.description || '',
        exam.duration || 60,
        exam.pass_score || 60,
        exam.is_active ? 1 : 0,
        exam.created_by,
        exam.created_at,
        exam.updated_at
      );
      banksMigrated++;
    } else {
      // 迁移到 exam_trainings
      // 如果是从其他题库复制的，保留 source_exam_id 作为 question_bank_id
      insertTraining.run(
        exam.id,
        exam.title,
        exam.description || '',
        exam.duration || 60,
        exam.pass_score || 60,
        exam.is_active ? 1 : 0,
        exam.learning_task_id,
        exam.source_exam_id, // 作为 question_bank_id
        exam.created_by,
        exam.created_at,
        exam.updated_at
      );
      trainingsMigrated++;
    }
  }

  console.log(`迁移完成：`);
  console.log(`  - 题库(exam_banks): ${banksMigrated} 条`);
  console.log(`  - 培训(exam_trainings): ${trainingsMigrated} 条`);

  // 验证数据
  const finalBanks = db.prepare('SELECT COUNT(*) as count FROM exam_banks').get();
  const finalTrainings = db.prepare('SELECT COUNT(*) as count FROM exam_trainings').get();
  console.log(`验证：exam_banks=${finalBanks.count}, exam_trainings=${finalTrainings.count}`);

} catch (err) {
  console.error('迁移失败:', err);
  process.exit(1);
} finally {
  db.close();
}
