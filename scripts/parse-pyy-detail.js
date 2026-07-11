const XLSX = require('xlsx');
const path = require('path');

const filePath = path.join(__dirname, '..', 'data', 'oa-export', '202606考勤汇总（06.15-06.21）.xlsx');
const workbook = XLSX.readFile(filePath);
const sheetName = workbook.SheetNames[0];
const worksheet = workbook.Sheets[sheetName];
const data = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

// Excel日期转JS日期
function excelDateToDate(serial) {
  const utc_days = Math.floor(serial - 25569);
  const utc_value = utc_days * 86400;
  const date_info = new Date(utc_value * 1000);
  return date_info.toISOString().split('T')[0];
}

// 查找潘夏煜的所有行
const pyyRows = [];
let headerRow = null;

for (let i = 0; i < data.length; i++) {
  const row = data[i];
  if (!row) continue;
  
  // 找表头
  if (row[4]?.toString() === '姓名' || row[4]?.toString() === '姓名') {
    headerRow = row;
    console.log('表头:', row.slice(0, 32));
    continue;
  }
  
  // 找潘夏煜的行
  if (row[4]?.toString().includes('潘夏煜')) {
    pyyRows.push({ rowIndex: i, data: row });
  }
}

console.log(`\n找到 ${pyyRows.length} 条潘夏煜的记录`);

// 显示每日详细数据
console.log('\n潘夏煜每日考勤详情:');
console.log('='.repeat(120));
console.log(`${'日期'.padEnd(12)} | ${'打卡记录'.padEnd(20)} | ${'应出勤'.padEnd(8)} | ${'请假'.padEnd(8)} | ${'旷工'.padEnd(8)} | ${'实际出勤'.padEnd(8)} | ${'迟到/早退'.padEnd(8)}`);
console.log('='.repeat(120));

pyyRows.forEach(({ rowIndex, data: row }) => {
  const dateStr = row[5] ? excelDateToDate(row[5]) : 'N/A';
  const clockRecord = row[7] || '无';
  const shouldWork = row[14] || 0;
  const leave = row[16] || 0;
  const absent = row[17] || 0;
  const actualWork = row[19] || 0;
  const lateEarly = row[24] || 0;
  
  console.log(`${dateStr.padEnd(12)} | ${String(clockRecord).padEnd(20)} | ${String(shouldWork).padEnd(8)} | ${String(leave).padEnd(8)} | ${String(absent).padEnd(8)} | ${String(actualWork).padEnd(8)} | ${String(lateEarly).padEnd(8)}`);
});

// 计算汇总
const summary = pyyRows.reduce((acc, { data: row }) => {
  acc.shouldWork += (row[14] || 0);
  acc.leave += (row[16] || 0);
  acc.absent += (row[17] || 0);
  acc.actualWork += (row[19] || 0);
  acc.lateEarly += (row[24] || 0);
  return acc;
}, { shouldWork: 0, leave: 0, absent: 0, actualWork: 0, lateEarly: 0 });

console.log('='.repeat(120));
console.log(`${'合计'.padEnd(12)} | ${''.padEnd(20)} | ${String(summary.shouldWork).padEnd(8)} | ${String(summary.leave).padEnd(8)} | ${String(summary.absent).padEnd(8)} | ${String(summary.actualWork).padEnd(8)} | ${String(summary.lateEarly).padEnd(8)}`);

// 找出有缺勤的日期
console.log('\n\n缺勤分析:');
console.log('='.repeat(80));

pyyRows.forEach(({ data: row }) => {
  const dateStr = row[5] ? excelDateToDate(row[5]) : 'N/A';
  const clockRecord = row[7] || '';
  const absent = row[17] || 0;
  const leave = row[16] || 0;
  
  // 检查是否有旷工或请假
  if (absent < 0 || leave < 0) {
    console.log(`${dateStr}: 打卡="${clockRecord}" 请假=${leave} 旷工=${absent}`);
    
    // 解析打卡时间
    if (clockRecord) {
      const match = clockRecord.match(/(\d{1,2}:\d{2})进.*?(\d{1,2}:\d{2})出/);
      if (match) {
        const clockIn = match[1];
        const clockOut = match[2];
        console.log(`  上班打卡: ${clockIn}, 下班打卡: ${clockOut}`);
        
        // 检查上午 (8:00-11:30)
        const inMinutes = parseInt(clockIn.split(':')[0]) * 60 + parseInt(clockIn.split(':')[1]);
        const outMinutes = parseInt(clockOut.split(':')[0]) * 60 + parseInt(clockOut.split(':')[1]);
        
        if (inMinutes > 8 * 60) {
          console.log(`  ⚠️ 上班迟到: 应8:00, 实际${clockIn}`);
        }
        if (outMinutes < 17 * 60 + 30) {
          console.log(`  ⚠️ 下班早退: 应17:30, 实际${clockOut}`);
        }
      } else {
        console.log(`  ⚠️ 打卡记录格式异常`);
      }
    } else {
      console.log(`  ⚠️ 无打卡记录`);
    }
  }
});
