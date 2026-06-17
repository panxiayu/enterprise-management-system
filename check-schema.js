const Database = require("better-sqlite3");
const db = new Database("./data/exam.db");

// Get staff table schema
try {
    const schema = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='staff'").get();
    console.log("Staff table schema:");
    console.log(schema ? schema.sql : "Table not found");
} catch (e) {
    console.error("Error:", e.message);
}

// Get all columns from staff table
try {
    const columns = db.prepare("PRAGMA table_info(staff)").all();
    console.log("\nStaff table columns:");
    columns.forEach(col => {
        console.log(`  ${col.name}: ${col.type}`);
    });
} catch (e) {
    console.error("Error:", e.message);
}

db.close();
