/**
 * 模板下载路由
 * 提供各种导入模板的下载
 */

const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');

// 模板目录
const TEMPLATES_DIR = path.join(__dirname, '../../templates');

// 确保模板目录存在
if (!fs.existsSync(TEMPLATES_DIR)) {
  fs.mkdirSync(TEMPLATES_DIR, { recursive: true });
}

// 获取模板列表
router.get('/list', (req, res) => {
  try {
    const files = fs.readdirSync(TEMPLATES_DIR);
    const templates = files
      .filter(f => f.endsWith('.xlsx') || f.endsWith('.xls') || f.endsWith('.csv'))
      .map(f => {
        const stats = fs.statSync(path.join(TEMPLATES_DIR, f));
        return {
          name: f,
          size: stats.size,
          created: stats.birthtime
        };
      });

    res.json({
      code: 0,
      msg: 'success',
      data: templates
    });
  } catch (err) {
    res.status(500).json({
      code: -1,
      msg: '获取模板列表失败',
      data: null
    });
  }
});

// 下载模板
router.get('/download/:filename', (req, res) => {
  try {
    const { filename } = req.params;
    const filePath = path.join(TEMPLATES_DIR, filename);

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({
        code: -1,
        msg: '模板不存在',
        data: null
      });
    }

    res.download(filePath, filename);
  } catch (err) {
    res.status(500).json({
      code: -1,
      msg: '下载失败',
      data: null
    });
  }
});

// 上传模板
router.post('/upload', (req, res) => {
  // 这个功能可以通过 /api/upload 实现，这里只是预留
  res.json({
    code: 0,
    msg: '请使用 /api/upload 接口上传文件',
    data: null
  });
});

module.exports = router;
