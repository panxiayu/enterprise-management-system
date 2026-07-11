// scripts/seed-workwear-demo.js
// 工服管理示例数据初始化脚本

const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.resolve(__dirname, '../data/exam.db');
const db = new Database(dbPath);

console.log('🔧 开始初始化工服管理示例数据...');

try {
  // 示例领用记录
  const sampleRecords = [
    { staff_name: '潘夏煜', department: '模具设计部', position: '设计工程师', issue_date: '2025-05-20', item_name: '春秋工服上衣', model: 'XL', quantity: 1, unit_price: 65.00, deduction: 32.50 },
    { staff_name: '潘夏煜', department: '模具设计部', position: '设计工程师', issue_date: '2025-05-20', item_name: '春秋工服裤子', model: 'XL', quantity: 1, unit_price: 55.00, deduction: 27.50 },
    { staff_name: '董涛涛', department: '模具制造部', position: 'CNC编程', issue_date: '2025-05-19', item_name: '安全鞋', model: '42码', quantity: 1, unit_price: 120.00, deduction: 60.00 },
    { staff_name: '董涛涛', department: '模具制造部', position: 'CNC编程', issue_date: '2025-05-19', item_name: '夏季工服上衣', model: 'L', quantity: 1, unit_price: 60.00, deduction: 30.00 },
    { staff_name: '金晶晶', department: '品质部', position: '检验员', issue_date: '2025-05-19', item_name: '夏季工服上衣', model: 'M', quantity: 1, unit_price: 60.00, deduction: 30.00 },
    { staff_name: '李明宇', department: '装配车间', position: '装配工', issue_date: '2025-05-18', item_name: '安全鞋', model: '43码', quantity: 1, unit_price: 120.00, deduction: 60.00, remark: '脚码偏大' },
    { staff_name: '王建国', department: '模具制造部', position: '钳工', issue_date: '2025-05-18', item_name: '春秋工服上衣', model: 'L', quantity: 1, unit_price: 65.00, deduction: 32.50 },
    { staff_name: '陈思雨', department: '财务部', position: '会计', issue_date: '2025-05-17', item_name: '夏季工服上衣', model: 'S', quantity: 1, unit_price: 60.00, deduction: 30.00 },
    { staff_name: '赵大明', department: '模具制造部', position: 'CNC操作', issue_date: '2025-05-16', item_name: '夏季工服上衣', model: 'XL', quantity: 1, unit_price: 60.00, deduction: 30.00 },
    { staff_name: '刘晓华', department: '品质部', position: '质检员', issue_date: '2025-05-16', item_name: '夏季工服裤子', model: 'M', quantity: 1, unit_price: 50.00, deduction: 25.00 },
    { staff_name: '张伟', department: '装配车间', position: '装配工', issue_date: '2025-05-15', item_name: '安全鞋', model: '44码', quantity: 1, unit_price: 120.00, deduction: 60.00 },
    { staff_name: '王丽', department: '行政部', position: '行政专员', issue_date: '2025-05-15', item_name: '夏季工服上衣', model: 'S', quantity: 1, unit_price: 60.00, deduction: 30.00 },
    { staff_name: '孙强', department: '模具设计部', position: '设计工程师', issue_date: '2025-05-14', item_name: '春秋工服上衣', model: 'XXL', quantity: 1, unit_price: 65.00, deduction: 32.50 },
    { staff_name: '周燕', department: '品质部', position: '检验员', issue_date: '2025-05-14', item_name: '夏季工服裤子', model: 'S', quantity: 1, unit_price: 50.00, deduction: 25.00 },
    { staff_name: '吴刚', department: '模具制造部', position: '钳工', issue_date: '2025-05-13', item_name: '安全鞋', model: '43码', quantity: 1, unit_price: 120.00, deduction: 60.00 },
    { staff_name: '郑华', department: '装配车间', position: '装配工', issue_date: '2025-05-13', item_name: '夏季工服上衣', model: 'L', quantity: 1, unit_price: 60.00, deduction: 30.00 },
    { staff_name: '钱磊', department: '模具设计部', position: '设计工程师', issue_date: '2025-05-12', item_name: '春秋工服裤子', model: 'L', quantity: 1, unit_price: 55.00, deduction: 27.50 },
    { staff_name: '冯丹', department: '财务部', position: '出纳', issue_date: '2025-05-12', item_name: '夏季工服上衣', model: 'M', quantity: 1, unit_price: 60.00, deduction: 30.00 },
    { staff_name: '杨帆', department: '模具制造部', position: 'CNC编程', issue_date: '2025-05-11', item_name: '夏季工服裤子', model: 'L', quantity: 1, unit_price: 50.00, deduction: 25.00 },
    { staff_name: '何静', department: '行政部', position: '前台', issue_date: '2025-05-11', item_name: '夏季工服上衣', model: 'S', quantity: 1, unit_price: 60.00, deduction: 30.00, self_purchase: 30.00 },
    { staff_name: '朱伟', department: '装配车间', position: '装配工', issue_date: '2025-05-10', item_name: '安全鞋', model: '42码', quantity: 1, unit_price: 120.00, deduction: 60.00 },
    { staff_name: '秦峰', department: '模具制造部', position: 'CNC操作', issue_date: '2025-05-10', item_name: '夏季工服上衣', model: 'XL', quantity: 1, unit_price: 60.00, deduction: 30.00 },
    { staff_name: '许慧', department: '品质部', position: '检验员', issue_date: '2025-05-09', item_name: '夏季工服上衣', model: 'M', quantity: 1, unit_price: 60.00, deduction: 30.00 },
    { staff_name: '何静', department: '行政部', position: '前台', issue_date: '2025-05-09', item_name: '夏季工服裤子', model: 'S', quantity: 1, unit_price: 50.00, deduction: 25.00 },
  ];

  // 插入领用记录
  const insertRecord = db.prepare(`
    INSERT INTO workwear_records (
      staff_name, department, position, issue_date, item_name, 
      item_type, model, quantity, unit_price, deduction, 
      self_purchase, deduction_ratio, remark, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')
  `);

  // 检查是否已有数据
  const count = db.prepare('SELECT COUNT(*) as c FROM workwear_records').get().c;
  if (count === 0) {
    const insertMany = db.transaction((records) => {
      for (const r of records) {
        const itemType = r.item_name.includes('鞋') ? '工鞋' : '工服';
        insertRecord.run(
          r.staff_name, r.department, r.position, r.issue_date,
          r.item_name, itemType, r.model, r.quantity || 1,
          r.unit_price || 0, r.deduction || 0, r.self_purchase || 0,
          50, r.remark || null
        );
      }
    });
    insertMany(sampleRecords);
    console.log(`✅ 已插入 ${sampleRecords.length} 条示例领用记录`);
  } else {
    console.log(`ℹ️  workwear_records 已有 ${count} 条记录，跳过插入`);
  }

  // 示例库存数据
  const inventoryItems = [
    { item_name: '春秋工服上衣', model: 'S', quantity: 15, unit_price: 65.00 },
    { item_name: '春秋工服上衣', model: 'M', quantity: 20, unit_price: 65.00 },
    { item_name: '春秋工服上衣', model: 'L', quantity: 18, unit_price: 65.00 },
    { item_name: '春秋工服上衣', model: 'XL', quantity: 6, unit_price: 65.00 },
    { item_name: '春秋工服上衣', model: 'XXL', quantity: 8, unit_price: 65.00 },
    { item_name: '春秋工服裤子', model: 'S', quantity: 12, unit_price: 55.00 },
    { item_name: '春秋工服裤子', model: 'M', quantity: 16, unit_price: 55.00 },
    { item_name: '春秋工服裤子', model: 'L', quantity: 7, unit_price: 55.00 },
    { item_name: '春秋工服裤子', model: 'XL', quantity: 10, unit_price: 55.00 },
    { item_name: '夏季工服上衣', model: 'S', quantity: 10, unit_price: 60.00 },
    { item_name: '夏季工服上衣', model: 'M', quantity: 14, unit_price: 60.00 },
    { item_name: '夏季工服上衣', model: 'L', quantity: 11, unit_price: 60.00 },
    { item_name: '夏季工服上衣', model: 'XL', quantity: 9, unit_price: 60.00 },
    { item_name: '夏季工服裤子', model: 'S', quantity: 8, unit_price: 50.00 },
    { item_name: '夏季工服裤子', model: 'M', quantity: 5, unit_price: 50.00 },
    { item_name: '夏季工服裤子', model: 'L', quantity: 12, unit_price: 50.00 },
    { item_name: '安全鞋', model: '40码', quantity: 10, unit_price: 120.00 },
    { item_name: '安全鞋', model: '41码', quantity: 12, unit_price: 120.00 },
    { item_name: '安全鞋', model: '42码', quantity: 3, unit_price: 120.00 },
    { item_name: '安全鞋', model: '43码', quantity: 4, unit_price: 120.00 },
    { item_name: '安全鞋', model: '44码', quantity: 6, unit_price: 120.00 },
  ];

  const insertInventory = db.prepare(`
    INSERT OR REPLACE INTO workwear_inventory (item_name, item_type, model, quantity, min_stock, unit_price)
    VALUES (?, ?, ?, ?, 5, ?)
  `);

  const invCount = db.prepare('SELECT COUNT(*) as c FROM workwear_inventory').get().c;
  if (invCount === 0) {
    const insertManyInv = db.transaction((items) => {
      for (const item of items) {
        const itemType = item.item_name.includes('鞋') ? '工鞋' : '工服';
        insertInventory.run(item.item_name, itemType, item.model, item.quantity, item.unit_price);
      }
    });
    insertManyInv(inventoryItems);
    console.log(`✅ 已插入 ${inventoryItems.length} 条库存记录`);
  } else {
    console.log(`ℹ️  workwear_inventory 已有 ${invCount} 条记录，跳过插入`);
  }

  console.log('✅ 工服管理示例数据初始化完成！');
} catch (err) {
  console.error('❌ 初始化失败:', err.message);
} finally {
  db.close();
}
