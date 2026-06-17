// src/index.js
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');

// 导入路由
const authRoutes = require('./routes/auth');
const importRoutes = require('./routes/import');
const uploadRoutes = require('./routes/upload');
const votingRoutes = require('./routes/voting');
const mealRoutes = require('./routes/meal');
const staffRoutes = require('./routes/staff');
const studentRosterRoutes = require('./routes/student-roster');
const taskRoutes = require('./routes/task');
const learningMaterialRoutes = require('./routes/learning-material');
const settingsRoutes = require('./routes/settings');
const templatesRoutes = require('./routes/templates');
const adminRoutes = require('./routes/admin');
const examRoutes = require('./routes/exam');
const questionBanksRoutes = require('./routes/question-banks');
const examTrainingsRoutes = require('./routes/exam-trainings');
const permissionsRoutes = require('./routes/permissions');
const sixSRoutes = require('./routes/6s');
const homeworkTimerRoutes = require('./routes/homework-timer');
const feedbackRoutes = require('./routes/feedback');
const notificationRoutes = require('./routes/notifications');
const { feedbackInjectMiddleware, employeeRedirectMiddleware } = require('./middleware/feedback-inject');
const { ensureS6UploadDirs } = require('./utils/s6-storage');
const { startS6CloudSyncWorker } = require('./services/s6-cloud-sync');
const { startStaffSyncScheduler } = require('./services/staff-sync');

const app = express();
const PORT = process.env.PORT || 3000;
ensureS6UploadDirs();
startS6CloudSyncWorker();
startStaffSyncScheduler();

// 中间件
app.use(cors({
  origin: [
    'http://112.16.178.98',
    'https://112.16.178.98',
    'http://112.16.178.98:3000',
    'https://112.16.178.98:3000',
    'https://xlmould.panxy.online'
  ],
  credentials: true
}));
app.use(bodyParser.json({ limit: '10mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '10mb' }));

// 问题反馈注入中间件（必须在 express.static 之前）
app.use(feedbackInjectMiddleware);

// employee.html 重定向中间件（确保带时间戳）
app.use(employeeRedirectMiddleware);

// 静态文件服务（托管 H5 前端） - 禁用默认 index.html，禁用缓存
const publicPath = path.join(__dirname, '../public');
app.use(express.static(publicPath, {
  index: false,
  maxAge: 0,
  etag: false,
  lastModified: false
}));

// 上傳文件服务
const uploadsPath = path.join(__dirname, '../uploads');
app.use('/uploads', express.static(uploadsPath));

// 根路径：返回 index.html（考生入口），添加时间戳参数防止微信缓存
app.get('/', (req, res) => {
  const timestamp = Date.now();
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.sendFile(path.join(publicPath, 'index.html'), (err) => {
    if (err && err.code === 'ENOENT') {
      // 如果 index.html 不存在，使用完整路径
      res.status(404).send('Not Found');
    }
  });
});

// 处理带时间戳参数的访问（强制刷新缓存）
app.get('/index.html', (req, res) => {
  const timestamp = Date.now();
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.sendFile(path.join(publicPath, 'index.html'));
});

// API 路由 (特定路由必须在通配符路由之前注册)
app.use('/api/auth', authRoutes);
app.use('/api/voting', votingRoutes); // 投票系统
app.use('/api/meal', mealRoutes); // 报餐系统
app.use('/api/staff', staffRoutes); // 人员管理
app.use('/api/student-roster', studentRosterRoutes); // 学生名册
app.use('/api/task', taskRoutes); // 工作任务
app.use('/api/notifications', notificationRoutes); // 站内通知
app.use('/api/learning-materials', learningMaterialRoutes); // 学习资料
app.use('/api', uploadRoutes); // 文件上传
app.use('/api/settings', settingsRoutes); // 系统设置
app.use('/api/templates', templatesRoutes); // 模板下载
app.use('/api/admin', adminRoutes); // 管理员管理
app.use('/api/admin/permissions', permissionsRoutes); // 权限管理
app.use('/api/permissions', require('./routes/granular-permissions')); // 粒化权限管理
app.use('/api/exam', examRoutes); // 考试相关 API
app.use('/api/question-banks', questionBanksRoutes); // 题库管理
app.use('/api/exam-trainings', examTrainingsRoutes); // 培训管理
app.use('/api/files', require('./routes/file-manager')); // 文件管理
app.use('/api/import', importRoutes); // import 路由
app.use('/api', importRoutes); // import 路由（备用）
app.use('/api/6s', sixSRoutes); // 6S曝光管理
app.use('/api/homework-timer', homeworkTimerRoutes); // 作业计时器
app.use('/api/feedback', feedbackRoutes); // 问题反馈
app.use('/api', importRoutes); // import 通配符路由（必须在最后）

// 健康检查
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// 404 处理
app.use((req, res) => {
  // 如果请求的是 HTML 文件，返回 404
  if (req.path.endsWith('.html')) {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    return res.status(404).send('Not Found');
  }
  res.status(404).json({
    code: -1,
    msg: '接口不存在',
    data: null
  });
});

// 错误处理中间件
app.use((err, req, res, next) => {
  console.error('服务器错误:', err);
  res.status(500).json({
    code: -1,
    msg: '服务器内部错误',
    error: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

// 启动服务器
app.listen(PORT, () => {
  console.log(`🚀 考试系统 API 服务已启动`);
  console.log(`📍 服务地址: http://localhost:${PORT}`);
  console.log(`📝 API 文档: http://localhost:${PORT}/health`);
  console.log(`🔧 环境: ${process.env.NODE_ENV || 'development'}`);
});

module.exports = app;
