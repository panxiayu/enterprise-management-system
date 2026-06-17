const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(__dirname, '..', 'data', 'exam.db');
const db = new Database(dbPath);
const MARK = '【界面预览-DEMO】';

const rows = db.prepare(`
  SELECT id
  FROM tasks
  WHERE title LIKE ? OR description LIKE ?
`).all(`${MARK}%`, `%${MARK}%`);

const ids = rows.map(row => Number(row.id));
if (!ids.length) {
  console.log(`未找到标记为 ${MARK} 的演示任务`);
  process.exit(0);
}

const deleteChildren = db.prepare(`DELETE FROM tasks WHERE parent_task_id = ?`);
const deleteTask = db.prepare(`DELETE FROM tasks WHERE id = ?`);

db.transaction(() => {
  ids.forEach(id => deleteChildren.run(id));
  ids.forEach(id => deleteTask.run(id));
})();

console.log(`已删除 ${ids.length} 条标记为 ${MARK} 的演示任务`);
