// src/routes/settings.js - 系统设置 API
const express = require('express');
const router = express.Router();
const db = require('../models/database');
const { authMiddleware, adminMiddleware } = require('../middleware/auth');

// 获取系统设置
// GET /api/settings
router.get('/', authMiddleware, (req, res) => {
  try {
    const settings = db.prepare('SELECT * FROM settings').all();
    
    // 转换为对象格式
    const settingsObj = {};
    settings.forEach(s => {
      settingsObj[s.key] = s.value;
    });

    res.json({
      code: 0,
      msg: 'success',
      data: {
        // 考试系统设置
        exam_enabled: settingsObj.exam_enabled === 'true',
        exam_max_duration: parseInt(settingsObj.exam_max_duration || '120'),
        exam_pass_score: parseInt(settingsObj.exam_pass_score || '60'),
        exam_show_answers: settingsObj.exam_show_answers === 'true',
        
        // 报餐系统设置
        meal_enabled: settingsObj.meal_enabled === 'true',
        meal_max_quantity: parseInt(settingsObj.meal_max_quantity || '5'),
        meal_allow_remarks: settingsObj.meal_allow_remarks === 'true',
        
        // 投票系统设置
        voting_enabled: settingsObj.voting_enabled === 'true',
        voting_allow_multiple: settingsObj.voting_allow_multiple === 'true',
        
        // 公司信息
        company_name: settingsObj.company_name || '兴利汽车模具',
        company_logo: settingsObj.company_logo || '',
        company_description: settingsObj.company_description || ''
      }
    });
  } catch (err) {
    console.error('获取系统设置失败:', err);
    res.status(500).json({
      code: -1,
      msg: '服务器错误',
      data: null
    });
  }
});

// 更新系统设置
// PUT /api/settings
router.put('/', authMiddleware, adminMiddleware, (req, res) => {
  try {
    const settings = req.body;

    // 更新或插入设置
    const stmt = db.prepare(`
      INSERT OR REPLACE INTO settings (key, value, updated_at)
      VALUES (?, ?, datetime('now'))
    `);

    Object.entries(settings).forEach(([key, value]) => {
      stmt.run(key, String(value));
    });

    res.json({
      code: 0,
      msg: '设置更新成功',
      data: null
    });
  } catch (err) {
    console.error('更新系统设置失败:', err);
    res.status(500).json({
      code: -1,
      msg: '服务器错误',
      data: null
    });
  }
});

// 获取考试设置
// GET /api/settings/exam
router.get('/exam', authMiddleware, (req, res) => {
  try {
    const examSettings = db.prepare(`
      SELECT * FROM settings 
      WHERE key LIKE 'exam_%'
    `).all();

    const settings = {};
    examSettings.forEach(s => {
      settings[s.key] = s.value;
    });

    res.json({
      code: 0,
      msg: 'success',
      data: {
        enabled: settings.exam_enabled === 'true',
        max_duration: parseInt(settings.exam_max_duration || '120'),
        pass_score: parseInt(settings.exam_pass_score || '60'),
        show_answers: settings.exam_show_answers === 'true'
      }
    });
  } catch (err) {
    console.error('获取考试设置失败:', err);
    res.status(500).json({
      code: -1,
      msg: '服务器错误',
      data: null
    });
  }
});

// 获取报餐设置
// GET /api/settings/meal
router.get('/meal', authMiddleware, (req, res) => {
  try {
    const mealSettings = db.prepare(`
      SELECT * FROM settings 
      WHERE key LIKE 'meal_%'
    `).all();

    const settings = {};
    mealSettings.forEach(s => {
      settings[s.key] = s.value;
    });

    res.json({
      code: 0,
      msg: 'success',
      data: {
        enabled: settings.meal_enabled === 'true',
        max_quantity: parseInt(settings.meal_max_quantity || '5'),
        allow_remarks: settings.meal_allow_remarks === 'true'
      }
    });
  } catch (err) {
    console.error('获取报餐设置失败:', err);
    res.status(500).json({
      code: -1,
      msg: '服务器错误',
      data: null
    });
  }
});

module.exports = router;
