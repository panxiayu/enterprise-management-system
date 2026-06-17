# 兴利汽车模具 - 完整系统开发计划

## 📋 系统分析

### 现有系统
1. ✅ 考试系统 - 员工培训考试
2. ✅ 投票系统 - 民主决策投票
3. ✅ 报餐系统 - 员工食堂报餐

### 缺失的核心功能

#### 1. 人员管理系统
- [ ] 员工列表
- [ ] 员工详情
- [ ] 员工添加/编辑/删除
- [ ] 部门管理
- [ ] 职位管理
- [ ] 权限管理

#### 2. 公告通知系统
- [ ] 公告列表
- [ ] 公告详情
- [ ] 公告发布
- [ ] 公告分类
- [ ] 已读/未读标记

#### 3. 工作任务系统
- [ ] 任务列表
- [ ] 任务详情
- [ ] 任务分配
- [ ] 任务进度跟踪
- [ ] 任务完成

#### 4. 考勤系统
- [ ] 打卡记录
- [ ] 考勤统计
- [ ] 请假申请
- [ ] 加班申请

#### 5. 文件管理系统
- [ ] 文件上传
- [ ] 文件下载
- [ ] 文件分类
- [ ] 文件共享

#### 6. 统计报表系统
- [ ] 考试成绩统计
- [ ] 投票结果统计
- [ ] 报餐统计
- [ ] 考勤统计
- [ ] 任务完成率统计

#### 7. 系统设置
- [ ] 公司信息设置
- [ ] 用户管理
- [ ] 权限设置
- [ ] 系统日志

#### 8. 首页仪表板
- [ ] 待办任务
- [ ] 最新公告
- [ ] 考试提醒
- [ ] 统计数据
- [ ] 快速导航

---

## 🎯 开发优先级

### 第一阶段（核心功能）
1. 首页仪表板 - 统一入口
2. 人员管理 - 基础数据
3. 公告通知 - 信息发布
4. 工作任务 - 任务管理

### 第二阶段（扩展功能）
5. 考勤系统 - 员工管理
6. 文件管理 - 资料共享
7. 统计报表 - 数据分析

### 第三阶段（优化）
8. 系统设置 - 配置管理
9. 权限控制 - 安全管理
10. 性能优化 - 系统优化

---

## 📁 新增页面清单

### 首页和导航
- [ ] index.html - 首页仪表板
- [ ] nav.html - 导航栏（公共组件）
- [ ] sidebar.html - 侧边栏（公共组件）

### 人员管理
- [ ] staff-list.html - 员工列表
- [ ] staff-detail.html - 员工详情
- [ ] staff-add.html - 添加员工
- [ ] department-list.html - 部门列表
- [ ] position-list.html - 职位列表

### 公告通知
- [ ] notice-list.html - 公告列表
- [ ] notice-detail.html - 公告详情
- [ ] notice-publish.html - 发布公告

### 工作任务
- [ ] task-list.html - 任务列表
- [ ] task-detail.html - 任务详情
- [ ] task-assign.html - 分配任务

### 考勤系统
- [ ] attendance-list.html - 考勤记录
- [ ] attendance-stats.html - 考勤统计
- [ ] leave-apply.html - 请假申请
- [ ] overtime-apply.html - 加班申请

### 文件管理
- [ ] file-list.html - 文件列表
- [ ] file-upload.html - 文件上传

### 统计报表
- [ ] report-exam.html - 考试统计
- [ ] report-voting.html - 投票统计
- [ ] report-meal.html - 报餐统计
- [ ] report-attendance.html - 考勤统计

### 系统设置
- [ ] settings-company.html - 公司设置
- [ ] settings-user.html - 用户管理
- [ ] settings-permission.html - 权限设置
- [ ] settings-log.html - 系统日志

---

## 🔧 后端 API 补充

### 人员管理 API
- POST /api/staff - 添加员工
- GET /api/staff - 获取员工列表
- GET /api/staff/:id - 获取员工详情
- PUT /api/staff/:id - 编辑员工
- DELETE /api/staff/:id - 删除员工
- GET /api/department - 获取部门列表
- GET /api/position - 获取职位列表

### 公告通知 API
- POST /api/notice - 发布公告
- GET /api/notice - 获取公告列表
- GET /api/notice/:id - 获取公告详情
- PUT /api/notice/:id - 编辑公告
- DELETE /api/notice/:id - 删除公告
- POST /api/notice/:id/read - 标记已读

### 工作任务 API
- POST /api/task - 创建任务
- GET /api/task - 获取任务列表
- GET /api/task/:id - 获取任务详情
- PUT /api/task/:id - 编辑任务
- DELETE /api/task/:id - 删除任务
- POST /api/task/:id/complete - 完成任务

### 考勤系统 API
- POST /api/attendance/checkin - 打卡
- GET /api/attendance - 获取考勤记录
- GET /api/attendance/stats - 获取考勤统计
- POST /api/leave - 申请请假
- POST /api/overtime - 申请加班

### 文件管理 API
- POST /api/file/upload - 上传文件
- GET /api/file - 获取文件列表
- DELETE /api/file/:id - 删除文件
- GET /api/file/:id/download - 下载文件

### 统计报表 API
- GET /api/report/exam - 考试统计
- GET /api/report/voting - 投票统计
- GET /api/report/meal - 报餐统计
- GET /api/report/attendance - 考勤统计

---

## 📊 数据库表补充

### 员工表
```sql
CREATE TABLE staff (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT UNIQUE,
  phone TEXT,
  department_id INTEGER,
  position_id INTEGER,
  hire_date DATE,
  status TEXT,
  created_at DATETIME
);
```

### 部门表
```sql
CREATE TABLE departments (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  created_at DATETIME
);
```

### 职位表
```sql
CREATE TABLE positions (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  created_at DATETIME
);
```

### 公告表
```sql
CREATE TABLE notices (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  content TEXT,
  category TEXT,
  author_id INTEGER,
  created_at DATETIME,
  updated_at DATETIME
);
```

### 任务表
```sql
CREATE TABLE tasks (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  assigned_to INTEGER,
  assigned_by INTEGER,
  status TEXT,
  priority TEXT,
  due_date DATE,
  created_at DATETIME
);
```

### 考勤表
```sql
CREATE TABLE attendance (
  id INTEGER PRIMARY KEY,
  user_id INTEGER,
  check_in_time DATETIME,
  check_out_time DATETIME,
  status TEXT,
  created_at DATETIME
);
```

### 请假表
```sql
CREATE TABLE leave_requests (
  id INTEGER PRIMARY KEY,
  user_id INTEGER,
  start_date DATE,
  end_date DATE,
  reason TEXT,
  status TEXT,
  created_at DATETIME
);
```

### 文件表
```sql
CREATE TABLE files (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  path TEXT,
  size INTEGER,
  type TEXT,
  uploaded_by INTEGER,
  created_at DATETIME
);
```

### 公告已读表
```sql
CREATE TABLE notice_reads (
  id INTEGER PRIMARY KEY,
  notice_id INTEGER,
  user_id INTEGER,
  read_at DATETIME,
  UNIQUE(notice_id, user_id)
);
```

---

## ✅ 完成状态

- [ ] 首页仪表板
- [ ] 人员管理系统
- [ ] 公告通知系统
- [ ] 工作任务系统
- [ ] 考勤系统
- [ ] 文件管理系统
- [ ] 统计报表系统
- [ ] 系统设置
- [ ] 权限控制
- [ ] 集成测试

---

**预计工作量**: 完整系统开发
**目标**: 生产级别的企业应用
**时间**: 集中开发完成
