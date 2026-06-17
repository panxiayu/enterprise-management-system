// src/routes/file-manager.js - 文件管理 API
const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { authMiddleware } = require('../middleware/auth');

// 文件存储目录 - 支持环境变量配置
const UPLOAD_DIR = process.env.FILE_MANAGER_UPLOAD_DIR || path.join(__dirname, '../../uploads/file-manager');
if (!fs.existsSync(UPLOAD_DIR)) {
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

// 元数据存储
const META_FILE = path.join(UPLOAD_DIR, '.metadata.json');
function loadMeta() {
    try {
        if (fs.existsSync(META_FILE)) {
            return JSON.parse(fs.readFileSync(META_FILE, 'utf8'));
        }
    } catch (e) {}
    return {};
}
function saveMeta(meta) {
    fs.writeFileSync(META_FILE, JSON.stringify(meta, null, 2));
}

// 配置文件上传 - 保留原始文件名
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, UPLOAD_DIR);
    },
    filename: (req, file, cb) => {
        // 使用时间戳确保唯一性，保留原始文件名
        const timestamp = Date.now();
        const safeName = file.originalname.replace(/[^a-zA-Z0-9\u4e00-\u9fa5.-]/g, '_');
        cb(null, timestamp + '-' + safeName);
    }
});

const upload = multer({ storage });

// 获取文件列表
router.get('/list', authMiddleware, (req, res) => {
    try {
        const meta = loadMeta();
        const files = fs.readdirSync(UPLOAD_DIR)
            .filter(f => f !== '.metadata.json')
            .map(f => {
                const stats = fs.statSync(path.join(UPLOAD_DIR, f));
                const metaInfo = meta[f] || {};
                return {
                    filename: f,
                    originalName: metaInfo.originalName || f,
                    size: stats.size,
                    date: stats.mtime.toISOString()
                };
            }).reverse();
        res.json({ code: 0, data: files });
    } catch (err) {
        res.status(500).json({ code: -1, msg: err.message });
    }
});

// 上传文件
router.post('/upload', authMiddleware, upload.single('file'), (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ code: -1, msg: '请选择文件' });
        }
        // 保存元数据
        const meta = loadMeta();
        meta[req.file.filename] = {
            originalName: req.file.originalname,
            uploadTime: new Date().toISOString()
        };
        saveMeta(meta);

        res.json({
            code: 0,
            msg: '上传成功',
            data: {
                filename: req.file.filename,
                originalName: req.file.originalname,
                size: req.file.size
            }
        });
    } catch (err) {
        console.error('文件上传失败:', err);
        res.status(500).json({ code: -1, msg: '上传失败' });
    }
});

// 下载文件
router.get('/download/:filename', authMiddleware, (req, res) => {
    try {
        const filename = path.basename(req.params.filename);
        const filePath = path.join(UPLOAD_DIR, filename);
        const meta = loadMeta();
        const downloadName = meta[filename]?.originalName || filename;

        if (!fs.existsSync(filePath)) {
            return res.status(404).json({ code: -1, msg: '文件不存在' });
        }

        // 使用 Stream 避免中文文件名问题
        res.setHeader('Content-Disposition', 'attachment; filename*=UTF-8\'\'' + encodeURIComponent(downloadName));
        res.setHeader('Content-Type', 'application/octet-stream');
        const stream = fs.createReadStream(filePath);
        stream.on('error', (err) => {
            console.error('文件读取失败:', err);
            if (!res.headersSent) {
                res.status(500).json({ code: -1, msg: '下载失败' });
            }
        });
        stream.pipe(res);
    } catch (err) {
        console.error('文件下载失败:', err);
        if (!res.headersSent) {
            res.status(500).json({ code: -1, msg: '下载失败' });
        }
    }
});

// 删除文件
router.delete('/delete/:filename', authMiddleware, (req, res) => {
    try {
        const filename = path.basename(req.params.filename);
        const filePath = path.join(UPLOAD_DIR, filename);
        if (!fs.existsSync(filePath)) {
            return res.status(404).json({ code: -1, msg: '文件不存在' });
        }

        fs.unlinkSync(filePath);
        // 删除元数据
        const meta = loadMeta();
        delete meta[filename];
        saveMeta(meta);
        res.json({ code: 0, msg: '删除成功' });
    } catch (err) {
        console.error('文件删除失败:', err);
        res.status(500).json({ code: -1, msg: '删除失败' });
    }
});

module.exports = router;
