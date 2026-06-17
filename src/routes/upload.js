// src/routes/upload.js - 文件上传相关接口
const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const mammoth = require('mammoth');
const { spawnSync } = require('child_process');
const db = require('../models/database');

// 配置 multer 存储
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, '../../uploads');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${uuidv4()}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ext === '.txt' || ext === '.docx' || ext === '.doc') {
      cb(null, true);
    } else {
      cb(new Error('只支持 .txt, .docx, .doc 文件'));
    }
  }
});

// 学习任务文件上传配置
const learningStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, '../../uploads/learning');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${uuidv4()}${ext}`);
  }
});

const learningUpload = multer({
  storage: learningStorage,
  limits: { fileSize: 100 * 1024 * 1024 }, // 100MB
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ext === '.ppt' || ext === '.pptx' || ext === '.mp4') {
      cb(null, true);
    } else {
      cb(new Error('只支持 .ppt, .pptx, .mp4 文件'));
    }
  }
});

const { authMiddleware, adminMiddleware } = require('../middleware/auth');

// POST /api/import/upload
// 上传文件并导入题目到题库（支持文件上传或文本直接导入）
router.post('/upload', authMiddleware, adminMiddleware, upload.single('file'), async (req, res) => {
  try {
    let text = '';
    let paperId = req.body.paperId || '';
    const paperTitle = req.body.paperTitle;

    // 文件上传模式
    if (req.file) {
      const filePath = req.file.path;
      const ext = path.extname(req.file.originalname).toLowerCase();

      if (ext === '.txt') {
        text = fs.readFileSync(filePath, 'utf-8');
      } else if (ext === '.docx' || ext === '.doc') {
        try {
          if (ext === '.docx') {
            const result = await mammoth.extractRawText({ path: filePath });
            text = result.value;
          } else if (ext === '.doc') {
            const result = spawnSync('antiword', ['-m', 'UTF-8', filePath]);
            if (result.error) throw result.error;
            if (result.status !== 0) throw new Error(result.stderr ? result.stderr.toString() : 'antiword 解析失败');
            text = result.stdout.toString('utf-8');
          }
        } catch (err) {
          console.error('解析失败:', err);
          try { fs.unlinkSync(filePath); } catch(e) {}
          return res.status(400).json({ code: -1, msg: '解析文件失败：' + err.message, data: null });
        }
      }
      try { fs.unlinkSync(filePath); } catch(e) {}
    }
    // 文本直接上传模式
    else if (req.body.text) {
      text = req.body.text;
    }
    else {
      return res.status(400).json({ code: -1, msg: '请上传文件或输入题目文本', data: null });
    }

    if (!text.trim()) {
      return res.status(400).json({ code: -1, msg: '题目内容为空', data: null });
    }

    // 如果没有指定 paperId，但有 paperTitle，则创建新题库
    if (!paperId && paperTitle) {
      const result = db.prepare(`
        INSERT INTO exam_banks (title, description, created_by)
        VALUES (?, ?, ?)
      `).run(paperTitle, '', req.user.userId);
      paperId = result.lastInsertRowid;
    }

    if (!paperId) {
      return res.status(400).json({ code: -1, msg: '请指定题库ID', data: null });
    }

    // 验证题库存在
    const bank = db.prepare('SELECT id FROM exam_banks WHERE id = ?').get(paperId);
    if (!bank) {
      return res.status(400).json({ code: -1, msg: '题库不存在', data: null });
    }

    // 解析并导入题目
    const wordParser = require('../utils/wordParser');
    const parseResult = wordParser.parse(text);
    const questions = parseResult.questions;

    if (questions.length === 0) {
      return res.status(400).json({ code: -1, msg: '未识别到题目', data: null });
    }

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
      data: { questionCount: successCount, paperId: paperId }
    });
  } catch (err) {
    console.error('导入失败:', err);
    res.status(500).json({ code: -1, msg: '导入失败：' + err.message, data: null });
  }
});

// POST /api/learning/upload
// 上传学习任务文件（MP4），自动转码为 H.264 兼容格式
router.post('/learning/upload', authMiddleware, adminMiddleware, learningUpload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        code: -1,
        msg: '未上传文件',
        data: null
      });
    }

    const filePath = req.file.path;
    const ext = path.extname(req.file.originalname).toLowerCase();
    let finalFileType = 'mp4';
    let finalFilePath = filePath;
    let finalFilename = req.file.filename;

    // 不再支持 PPT，只接受 MP4
    if (ext === '.ppt' || ext === '.pptx') {
      fs.unlinkSync(filePath);
      return res.status(400).json({
        code: -1,
        msg: '请上传 MP4 格式视频文件，PPT 转换功能已停用',
        data: null
      });
    }

    // 检查视频编码，如果不是 H.264 则自动转码
    let needTranscode = false;
    try {
      const ffprobeResult = spawnSync('ffprobe', [
        '-v', 'error',
        '-select_streams', 'v:0',
        '-show_entries', 'stream=codec_name',
        '-of', 'csv=p=0',
        finalFilePath
      ]);
      const codecName = ffprobeResult.stdout.toString().trim().toLowerCase();
      // 移动端不支持 mpeg4(DivX/Xvid)、vp8/vp9、theora 等格式
      const unsupportedCodecs = ['mpeg4', 'vp8', 'vp9', 'theora', 'av1', 'svq1', 'svq3'];
      if (unsupportedCodecs.includes(codecName)) {
        needTranscode = true;
        console.log('检测到视频编码为', codecName, '，需要进行转码');
      }
    } catch (e) {
      console.log('检测视频编码失败，继续上传:', e.message);
    }

    let transcodeError = null;
    if (needTranscode) {
      const tempOutput = path.join(__dirname, '../../uploads/learning', `transcoded_${req.file.filename}`);
      try {
        // 使用 libx264 转码为 H.264 格式，兼容移动端
        const transcodeProcess = spawnSync('ffmpeg', [
          '-y',                    // 覆盖输出文件
          '-i', finalFilePath,     // 输入文件
          '-c:v', 'libx264',      // H.264 编码
          '-crf', '23',           // 质量因子（值越小质量越高，23是平衡值）
          '-preset', 'fast',      // 编码速度
          '-c:a', 'aac',          // AAC 音频编码
          '-b:a', '128k',         // 音频比特率
          '-movflags', '+faststart', // 优化 Web 播放
          '-vf', 'scale=-2:720',  // 限制高度720p，宽度等比缩放
          tempOutput
        ], { stdio: 'pipe' });

        if (transcodeProcess.error) {
          throw transcodeProcess.error;
        }
        if (transcodeProcess.status !== 0) {
          const stderr = transcodeProcess.stderr ? transcodeProcess.stderr.toString() : '';
          throw new Error('转码失败: ' + (stderr.slice(-200) || '未知错误'));
        }

        // 转码成功，删除原文件，替换为转码后的文件
        fs.unlinkSync(finalFilePath);
        finalFilePath = tempOutput;
        finalFilename = path.basename(tempOutput);
        finalFileType = 'mp4';
        console.log('视频转码成功');
      } catch (e) {
        console.error('视频转码失败:', e.message);
        transcodeError = e.message;
        // 转码失败时使用原文件，不阻断上传
      }
    }

    // 提取视频时长
    let duration = null;
    try {
      const ffprobeResult = spawnSync('ffprobe', [
        '-v', 'error',
        '-show_entries', 'format=duration',
        '-of', 'default=noprint_wrappers=1:nokey=1',
        finalFilePath
      ]);
      if (!ffprobeResult.error) {
        const durationStr = ffprobeResult.stdout.toString().trim();
        duration = parseInt(parseFloat(durationStr));
        if (isNaN(duration)) duration = null;
      }
    } catch (e) {
      console.error('提取视频时长失败:', e);
    }

    // 上传到移动云对象存储
    let fileUrl;
    try {
      const { uploadToCloud } = require('../utils/cloud-storage');
      fileUrl = await uploadToCloud(finalFilePath, req.file.originalname, 'learning/');
      console.log('文件已上传到移动云:', fileUrl);
    } catch (cloudErr) {
      console.error('上传到云存储失败，保留本地文件:', cloudErr.message);
      fileUrl = `/uploads/learning/${finalFilename}`;
    }

    // 生成安全的显示文件名
    const safeOriginalName = req.file.originalname.replace(/[^\w\s.-]/g, '_');

    // 清理本地转码文件
    if (needTranscode && finalFilePath.includes('transcoded_')) {
      try { fs.unlinkSync(finalFilePath); } catch(e) {}
    }

    let msg = '文件上传成功';
    let status = 'uploaded';
    if (needTranscode && !transcodeError) {
      msg = '文件上传成功，视频已转码为H.264格式';
      status = 'transcoded';
    } else if (transcodeError) {
      msg = '文件上传成功，但转码失败：' + transcodeError;
      status = 'transcode_failed';
    }

    res.json({
      code: 0,
      msg: msg,
      data: {
        file_url: fileUrl,
        filename: finalFilename,
        original_name: safeOriginalName,
        size: req.file.size,
        file_type: finalFileType,
        converted: needTranscode && !transcodeError,
        transcoding: needTranscode && !transcodeError,
        transcodeError: transcodeError,
        duration: duration,
        storage: fileUrl.startsWith('http') ? 'cloud' : 'local',
        status: status
      }
    });
  } catch (err) {
    console.error('学习任务文件上传失败:', err);
    res.status(500).json({
      code: -1,
      msg: '文件上传失败：' + err.message,
      data: null
    });
  }
});

// Multer 错误处理中间件
router.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({
        code: -1,
        msg: '文件太大，最大支持 100MB',
        data: null
      });
    }
    return res.status(400).json({
      code: -1,
      msg: '文件上传失败：' + err.message,
      data: null
    });
  } else if (err) {
    return res.status(400).json({
      code: -1,
      msg: err.message,
      data: null
    });
  }
  next();
});

module.exports = router;
