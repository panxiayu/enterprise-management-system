# 兴利汽车模具企业管理系统

**仓库地址**: https://github.com/panxiayu/enterprise-management-system

---

## 项目简介

本系统是兴利汽车模具公司的企业内部管理系统，包含 6S 管理、报餐系统、投票系统、培训系统、问题反馈、人员管理等功能模块。

---

## 功能模块

### 1. 6S管理
- 曝光记录创建与拍照上传
- 责任人整改任务分配
- 整改提交与管理员审核
- 审核状态流转：待整改 → 待审核 → 已通过/已驳回

**移动端页面**：
| 页面 | 说明 |
|------|------|
| mobile-6s-add.html | 新增曝光 |
| mobile-6s-list.html | 管理员列表 |
| mobile-6s-detail.html | 曝光详情（含审核/整改操作） |
| mobile-6s-tasks.html | 责任人任务列表 |

**权限说明**：
- `staff.s6_permission = 1` 为 6S 管理员
- 管理员可创建曝光、审核、查看自己创建的记录
- 责任人通过 `assigned_to` 字段关联，可提交整改

---

### 2. 报餐系统
- 员工餐/客餐分开管理
- 特殊报餐（节假日等）与常规报餐
- 取消报餐时间窗口限制（午餐 08:00-10:00，晚餐 12:00-15:30）
- 月统计报表导出

**数据库表**：`meal_signups_v4`
- `user_id` 直接对应 `staff.id` 或 `student_roster.id`
- `employee_count` / `guest_count` 独立存储员工餐和客餐数据

---

### 3. 投票系统
- 支持匿名投票
- 公开链接分享（无需登录）
- 实时投票结果轮询

**API**：
- `/api/voting/anonymous/:token` - 匿名获取投票信息
- `/api/voting/anonymous/:token/vote` - 匿名投票提交

---

### 4. 培训系统
- 学习资料管理（视频上传、播放进度保存）
- 题库管理（选择题导入）
- 考试管理（答题计时、答题卡）
- 禁止快进功能（视频学习保护）

**移动端页面**：
| 页面 | 说明 |
|------|------|
| mobile-learning-materials-list.html | 学习资料列表 |
| mobile-learning-materials-detail.html | 视频播放详情 |
| mobile-exam-list.html | 考试列表 |
| mobile-exam-doing.html | 答题界面 |
| mobile-result.html | 考试成绩 |

---

### 5. 问题反馈
- 员工可提交问题反馈（含截图）
- 分类支持：功能异常、功能建议、界面问题、性能问题
- 管理员回复与状态管理

---

### 6. 人员管理
- 员工名册（从 Excel 同步）
- 学生名册（实训生，顶岗日期为空且未解约）
- 标签页切换独立管理

**同步机制**：通过 SMB 共享从 `1★员工花名册.xlsx` 自动同步
- 定时任务：每天 11:50 和 18:50

---

## 技术栈

| 类别 | 技术 |
|------|------|
| 后端 | Express.js + SQLite (better-sqlite3) |
| 认证 | JWT Token |
| 移动端 | 纯内联 CSS，蓝色主题 |
| PC端 | theme.css |
| 部署 | Docker |

---

## 目录结构

```
├── public/                 # 前端页面
│   ├── mobile-*.html      # 移动端页面
│   ├── js/                # JS 模块
│   ├── css/               # 样式文件
│   ├── icons/             # 图标
│   └── exam.html          # PC端培训管理
├── src/                   # 后端代码
│   ├── routes/            # API 路由
│   ├── models/            # 数据库模型
│   ├── middleware/        # 中间件
│   └── utils/             # 工具函数
├── scripts/               # 同步脚本
├── data/                  # 数据库和 SQL 文件
└── uploads/               # 上传文件
```

---

## API 概览

### 6S
- `GET /api/6s` - 列表
- `POST /api/6s` - 创建
- `PUT /api/6s/:id` - 更新
- `PUT /api/6s/:id/submit` - 提交整改
- `PUT /api/6s/:id/review` - 审核
- `GET /api/6s/stats/summary` - 统计

### 报餐
- `GET /api/meal/list` - 活动列表
- `POST /api/meal/:id/signup` - 报餐
- `DELETE /api/meal/:id/signup/:recordId` - 取消报餐

### 培训
- `GET /api/learning-materials` - 学习资料列表
- `GET /api/exam/list` - 考试列表
- `POST /api/exam/:id/start` - 开始考试

### 人员
- `GET /api/staff` - 员工列表
- `POST /api/staff/sync-from-smb` - 从 Excel 同步
- `GET /api/student-roster` - 学生名册

---

## 数据库

- **路径**: `/home/openclaw/apps/server/data/exam.db`
- **关键表**:
  - `staff` - 员工表（217人）
  - `student_roster` - 学生名册（8名实训生）
  - `six_s_records` - 6S 曝光记录
  - `meal_signups_v4` - 报餐记录

**注意**：重建 Docker 容器后需确保使用 bind mount 挂载数据库文件，否则可能使用镜像内嵌的旧数据。

---

## 移动端 CSS 变量

```css
--bg: #F0F7FF;           /* 背景色 */
--card: #fff;             /* 卡片背景 */
--border: #D6E9FF;       /* 边框色 */
--primary: #4A90E2;       /* 主色 */
--accent: #22C58D;        /* 强调色 */
--text: #1D2B5A;          /* 主文字 */
--text-soft: #5B72A9;    /* 次要文字 */
--radius: 22px;           /* 圆角 */
--orange: #ff9500;        /* 橙色 */
--red: #ff3b30;           /* 红色 */
```

---

## 响应式断点

| 屏幕宽度 | max-width |
|---------|-----------|
| < 768px | 480px |
| 768-1023px | 680px |
| ≥ 1024px | 800px |