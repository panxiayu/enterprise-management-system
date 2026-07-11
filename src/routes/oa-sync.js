/**
 * 泛微OA考勤同步API路由
 * 
 * 提供手动触发考勤下载和请假提交的接口
 */

const express = require('express');
const router = express.Router();
const { manualSync, runAttendanceScript, runLeaveScript } = require('../services/oa-sync-scheduler');

/**
 * 手动触发完整同步（下载考勤 + 分析/提交请假）
 * POST /api/oa-sync/run
 * Body: { submitLeave: boolean }
 */
router.post('/run', async (req, res) => {
  try {
    const { submitLeave = false } = req.body;
    
    console.log(`[OA_SYNC_API] 手动触发同步 (提交请假: ${submitLeave})`);
    
    const result = await manualSync(submitLeave);
    
    if (result.success) {
      res.json({
        code: 0,
        msg: '同步完成',
        data: {
          submitLeave,
          timestamp: new Date().toISOString()
        }
      });
    } else {
      res.json({
        code: -1,
        msg: `同步失败: ${result.error}`,
        data: null
      });
    }
  } catch (error) {
    console.error('[OA_SYNC_API] 同步异常:', error);
    res.status(500).json({
      code: -1,
      msg: `同步异常: ${error.message}`,
      data: null
    });
  }
});

/**
 * 仅下载考勤数据
 * POST /api/oa-sync/download
 */
router.post('/download', async (req, res) => {
  try {
    console.log('[OA_SYNC_API] 手动下载考勤数据');
    
    const result = await runAttendanceScript();
    
    res.json({
      code: 0,
      msg: '考勤数据下载完成',
      data: {
        timestamp: new Date().toISOString()
      }
    });
  } catch (error) {
    console.error('[OA_SYNC_API] 下载异常:', error);
    res.status(500).json({
      code: -1,
      msg: `下载异常: ${error.message}`,
      data: null
    });
  }
});

/**
 * 仅分析考勤（不提交请假）
 * POST /api/oa-sync/analyze
 */
router.post('/analyze', async (req, res) => {
  try {
    console.log('[OA_SYNC_API] 分析考勤数据');
    
    const result = await runLeaveScript(true);
    
    res.json({
      code: 0,
      msg: '考勤分析完成',
      data: {
        timestamp: new Date().toISOString(),
        output: result.output
      }
    });
  } catch (error) {
    console.error('[OA_SYNC_API] 分析异常:', error);
    res.status(500).json({
      code: -1,
      msg: `分析异常: ${error.message}`,
      data: null
    });
  }
});

/**
 * 查看同步状态
 * GET /api/oa-sync/status
 */
router.get('/status', (req, res) => {
  const fs = require('fs');
  const path = require('path');
  
  const exportDir = path.join(__dirname, '../../data/oa-export');
  const logFile = path.join(exportDir, 'leave-requests.log');
  
  let lastSync = null;
  let logContent = null;
  
  // 获取最后修改时间
  try {
    const files = fs.readdirSync(exportDir)
      .filter(f => f.startsWith('attendance-') && f.endsWith('.xlsx'))
      .sort()
      .reverse();
    
    if (files.length > 0) {
      const stat = fs.statSync(path.join(exportDir, files[0]));
      lastSync = {
        file: files[0],
        modified: stat.mtime.toISOString()
      };
    }
  } catch (e) {
    // 目录不存在或其他错误
  }
  
  // 读取最近的日志
  try {
    if (fs.existsSync(logFile)) {
      const content = fs.readFileSync(logFile, 'utf8');
      const lines = content.trim().split('\n');
      logContent = lines.slice(-10).join('\n'); // 最后10行
    }
  } catch (e) {
    // 日志文件不存在
  }
  
  res.json({
    code: 0,
    msg: 'ok',
    data: {
      lastSync,
      recentLog: logContent,
      schedule: [
        { day: '周二', time: '20:00', action: '下载考勤 + 分析缺勤' },
        { day: '周三', time: '08:00', action: '下载考勤 + 提交请假' }
      ]
    }
  });
});

module.exports = router;
