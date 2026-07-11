const XLSX = require('xlsx');
const path = require('path');

const filePath = path.join(__dirname, '..', 'data', 'oa-export', '202606考勤汇总（06.15-06.21）.xlsx');

console.log('读取考勤文件:', filePath);

const workbook = XLSX.readFile(filePath);
console.log('\n工作表名称:', workbook.SheetNames);

// 读取第一个工作表
const sheetName = workbook.SheetNames[0];
const worksheet = workbook.Sheets[sheetName];

// 转换为JSON
const data = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

console.log(`\n工作表 "${sheetName}" 共 ${data.length} 行`);

// 显示前5行（表头）
console.log('\n表头:');
for (let i = 0; i < Math.min(5, data.length); i++) {
  console.log(`行${i}:`, data[i]?.slice(0, 10));
}

// 查找潘夏煜的行
console.log('\n查找潘夏煜...');
let headerRowIndex = -1;
let nameColIndex = -1;

// 找到表头行和姓名列
for (let i = 0; i < Math.min(10, data.length); i++) {
  const row = data[i];
  if (row) {
    for (let j = 0; j < row.length; j++) {
      const cell = row[j]?.toString() || '';
      if (cell.includes('姓名') || cell.includes('员工')) {
        headerRowIndex = i;
        nameColIndex = j;
        console.log(`找到表头在第${i}行，姓名在第${j}列`);
        break;
      }
    }
    if (headerRowIndex !== -1) break;
  }
}

// 打印表头
if (headerRowIndex !== -1) {
  console.log('\n表头列:');
  data[headerRowIndex].forEach((col, i) => {
    if (col) console.log(`  列${i}: ${col}`);
  });
}

// 查找潘夏煜的数据
let pyyRow = null;
for (let i = (headerRowIndex + 1); i < data.length; i++) {
  const row = data[i];
  if (row && row[nameColIndex]?.toString().includes('潘夏煜')) {
    pyyRow = row;
    console.log(`\n找到潘夏煜在第${i}行`);
    break;
  }
}

if (pyyRow) {
  console.log('\n潘夏煜的考勤数据:');
  const headers = data[headerRowIndex];
  for (let j = 0; j < pyyRow.length; j++) {
    if (pyyRow[j] !== undefined && pyyRow[j] !== null && pyyRow[j] !== '') {
      console.log(`  ${headers[j] || '列' + j}: ${pyyRow[j]}`);
    }
  }
} else {
  console.log('\n未找到潘夏煜，列出所有姓名:');
  for (let i = (headerRowIndex + 1); i < data.length; i++) {
    if (data[i] && data[i][nameColIndex]) {
      console.log(`  行${i}: ${data[i][nameColIndex]}`);
    }
  }
}
