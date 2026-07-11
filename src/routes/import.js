// src/routes/import.js - 导入功能 API
const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const db = require('../models/database');
const wordParser = require('../utils/wordParser');
const { authMiddleware, adminMiddleware } = require('../middleware/auth');
const mammoth = require('mammoth');
const { getNamePinyin } = require('../utils/name-pinyin');

// 配置文件上传
const upload = multer({
  dest: path.join(__dirname, '../../uploads/'),
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB
});

// POST /api/import/upload
// 上传并导入 Word 题目（支持文件上传或文本直接导入）
router.post('/upload', authMiddleware, adminMiddleware, upload.single('file'), async (req, res) => {
  try {
    let text = '';
    let paperId = '';

    // 判断是文件上传还是文本直接上传
    if (req.body.text && req.body.paperId) {
      // 文本直接上传
      text = req.body.text;
      paperId = req.body.paperId;
    } else if (req.file) {
      // 文件上传
      paperId = req.body.paperId;
      if (!paperId) {
        return res.status(400).json({ code: -1, msg: '请指定试卷ID', data: null });
      }

      const ext = path.extname(req.file.originalname).toLowerCase();

      if (ext === '.docx') {
        // 使用 HTML 提取再转文本，更好地处理中文编码
        const result = await mammoth.convertToHtml({ path: req.file.path });
        // 把 </p> 和 </h1> 等替换为换行，去除其他HTML标签，保留纯文本
        text = result.value.replace(/<\/?(p|h1|h2|h3|h4|h5|h6)[^>]*>/gi, '\n').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/\n{3,}/g, '\n\n').trim();
        console.log('处理后 text length:', text.length);
      } else if (ext === '.doc') {
        // 使用 antiword 解析 .doc 文件
        try {
          const { spawnSync } = require('child_process');
          const result = spawnSync('antiword', ['-m', 'UTF-8', req.file.path]);
          if (result.error) {
            throw result.error;
          }
          text = result.stdout.toString('utf-8');
        } catch (e) {
          // fallback: 尝试直接读取
          text = fs.readFileSync(req.file.path, 'utf-8');
        }
      } else {
        text = fs.readFileSync(req.file.path, 'utf-8');
      }

      // 清理上传文件
      try { fs.unlinkSync(req.file.path); } catch(e) {}
    } else {
      return res.status(400).json({ code: -1, msg: '请上传文件或输入题目文本', data: null });
    }

    if (!paperId) {
      return res.status(400).json({ code: -1, msg: '请指定试卷ID', data: null });
    }

    const parseResult = wordParser.parse(text);
    const questions = parseResult.questions;

    if (questions.length === 0) {
      return res.status(400).json({ code: -1, msg: '未识别到题目', data: null });
    }

    // 插入数据库
    let successCount = 0;
    for (const q of questions) {
      try {
        db.prepare(
          `INSERT INTO questions (exam_id, type, content, options, answer, score, sort_order)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        ).run(paperId, q.type, q.content, JSON.stringify(q.options), q.answer, q.score, q.sort_order || 0);
        successCount++;
      } catch (err) {
        console.error('插入题目失败:', err);
      }
    }

    res.json({
      code: 0,
      msg: '导入成功',
      data: { questionCount: successCount }
    });
  } catch (err) {
    console.error('导入失败:', err);
    res.status(500).json({ code: -1, msg: '导入失败：' + err.message, data: null });
  }
});

// POST /api/import/parse-text
// 解析文本格式的题目（直接粘贴文本）
router.post('/parse-text', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { text } = req.body;

    if (!text || !text.trim()) {
      return res.status(400).json({ code: -1, msg: '请输入题目内容', data: null });
    }

    const result = wordParser.parse(text);

    res.json({
      code: 0,
      msg: '解析成功',
      data: {
        questions: result.questions,
        total: result.total,
        paperTitle: result.paperTitle
      }
    });
  } catch (err) {
    console.error('解析失败:', err);
    res.status(500).json({ code: -1, msg: '解析失败：' + err.message, data: null });
  }
});

// POST /api/import/parse-file
// 上传并解析文件（不导入，返回解析结果预览）
router.post('/parse-file', authMiddleware, adminMiddleware, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ code: -1, msg: '请上传文件', data: null });
    }

    let text = '';
    const ext = path.extname(req.file.originalname).toLowerCase();

    if (ext === '.docx') {
      // 直接提取纯文本，更好地处理中文编码
      const result = await mammoth.extractRawText({ path: req.file.path });
      // mammoth用空格连接段落，改为换行符以便解析
      text = result.value.replace(/ /g, '\n').trim();
    } else if (ext === '.doc') {
      // 使用 antiword 解析 .doc 文件
      try {
        const { spawnSync } = require('child_process');
        const result = spawnSync('antiword', ['-m', 'UTF-8', req.file.path]);
        if (result.error) {
          throw result.error;
        }
        text = result.stdout.toString('utf-8');
      } catch (e) {
        // fallback: 尝试直接读取
        text = fs.readFileSync(req.file.path, 'utf-8');
      }
    } else {
      text = fs.readFileSync(req.file.path, 'utf-8');
    }

    const result = wordParser.parse(text);

    // 清理上传文件
    try { fs.unlinkSync(req.file.path); } catch(e) {}

    res.json({
      code: 0,
      msg: '解析成功',
      data: {
        text: text,
        questions: result.questions,
        total: result.total,
        paperTitle: result.paperTitle
      }
    });
  } catch (err) {
    console.error('解析文件失败:', err);
    res.status(500).json({ code: -1, msg: '解析失败：' + err.message, data: null });
  }
});

// POST /api/import/staff
// 上传并导入员工数据（工号、姓名）
const ExcelJS = require('exceljs');
const fastCsv = require('fast-csv');

router.post('/staff', authMiddleware, adminMiddleware, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ code: -1, msg: '请上传文件', data: null });
    }

    const filePath = req.file.path;
    const ext = path.extname(req.file.originalname).toLowerCase();
    const employees = [];

    // 解析文件
    if (ext === '.xlsx' || ext === '.xls') {
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.readFile(filePath);
      const worksheet = workbook.getWorksheet(1);
      const headers = [];
      
      worksheet.getRow(1).eachCell({ includeEmpty: true }, (cell, colNumber) => {
        headers[colNumber] = cell.text ? cell.text.trim() : '';
      });

      const empIdIndex = headers.findIndex(h => h.includes('工号'));
      const nameIndex = headers.findIndex(h => h.includes('姓名'));

      if (empIdIndex === -1 || nameIndex === -1) {
        fs.unlinkSync(filePath);
        return res.status(400).json({ code: -1, msg: '文件必须包含"工号"和"姓名"列', data: null });
      }

      worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
        if (rowNumber === 1) return; // 跳过表头
        const empId = String(row.getCell(empIdIndex + 1).value || '').trim();
        const name = String(row.getCell(nameIndex + 1).value || '').trim();
        if (empId && name) {
          employees.push({ employee_id: empId, name: name });
        }
      });
    } else if (ext === '.csv') {
      await new Promise((resolve, reject) => {
        fastCsv.parseFile(filePath, { headers: true, skipLines: 1 })
          .on('data', (row) => {
            const empId = String(row['工号'] || row['employee_id'] || '').trim();
            const name = String(row['姓名'] || row['name'] || '').trim();
            if (empId && name) {
              employees.push({ employee_id: empId, name: name });
            }
          })
          .on('end', resolve)
          .on('error', reject);
      });
    } else {
      fs.unlinkSync(filePath);
      return res.status(400).json({ code: -1, msg: '仅支持 xlsx/xls/csv 格式', data: null });
    }

    fs.unlinkSync(filePath);

    if (employees.length === 0) {
      return res.status(400).json({ code: -1, msg: '未识别到有效员工数据', data: null });
    }

    // 导入/更新员工
    const insertStmt = db.prepare(`
      INSERT INTO staff (name, name_pinyin, employee_id, status, created_at, updated_at)
      VALUES (?, ?, ?, 'active', datetime('now'), datetime('now'))
      ON CONFLICT(employee_id) DO UPDATE SET 
        name = excluded.name,
        name_pinyin = excluded.name_pinyin,
        updated_at = datetime('now')
    `);

    let successCount = 0;
    const errors = [];

    for (const emp of employees) {
      try {
        insertStmt.run(emp.name, getNamePinyin(emp.name), emp.employee_id);
        successCount++;
      } catch (err) {
        errors.push(`${emp.employee_id}: ${err.message}`);
      }
    }

    res.json({
      code: 0,
      msg: `成功导入 ${successCount} 名员工`,
      data: { successCount, errors: errors.slice(0, 10) }
    });
  } catch (err) {
    console.error('员工导入失败:', err);
    res.status(500).json({ code: -1, msg: '导入失败：' + err.message, data: null });
  }
});

module.exports = router;
