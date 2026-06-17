# 兴利汽车模具 6S管理系统

## 服务器信息
- IP: 112.16.178.98
- Port: 2222 (SSH)
- 用户: openclaw
- 密码: pan99612
- 项目路径: /home/openclaw/apps/server
- 本地挂载: S:\

## 技术栈
- Express.js + SQLite (better-sqlite3)
- JWT token认证
- 移动端: 纯内联CSS，蓝色主题
- PC端: theme.css

## 数据库
- 路径: `/home/openclaw/apps/server/data/exam.db`
- 注意：重建容器后需确保数据库是最新的（见下方"容器重建注意事项"）

### 关键表
- `staff` - 员工表，s6_permission字段表示6S管理员权限
- `student_roster` - 学生名册表（实训生）
- `six_s_records` - 6S曝光记录表
- `s6_review_logs` - 6S审核日志

### 员工登录（index.html）
- 工号+姓名登录，同时支持 `staff` 表和 `student_roster` 表
- 学生返回 `is_student: 1`，职位自动设为"实训生"
- 登录响应包含 `is_student` 字段用于区分学生/员工
- **注意**：`student_roster.id`（55-62）与 `staff.id`（216-432）不冲突，登录时直接使用 `student.id`，不需要加偏移

### 学生ID说明
- `student_roster.id` 范围：55-62（8名学生）
- `staff.id` 范围：216-432（217名员工）
- 报餐时 `user_id` 直接使用 `student_roster.id`，不再转换

### 区分学生与员工
- 学生：`is_student: 1` 或 `position: "实训生"`
- 员工：`is_student: 0` 或 `position != "实训生"`
- **各系统数据统计时需区分**：报餐、考试、培训、6S等统计数据应分开统计学生和员工

### 6S记录状态字段
- `review_status`: pending(待整改) → submitted(待审核) → approved(已通过)/rejected(已驳回)
- `assigned_to`: 责任人ID
- `assigned_name`: 责任人姓名
- `deadline`: 整改截止时间
- `reject_reason`: 驳回理由

## 6S权限系统
- `staff.s6_permission = 1` 表示6S管理员
- 登录时token中包含 s6_permission 字段
- 管理员: 可创建曝光、审核、查看自己创建的记录
- 责任人: assigned_to匹配当前用户ID，可提交整改

## 移动端页面
| 页面 | 说明 |
|------|------|
| mobile-6s-tasks.html | 责任人任务列表 |
| mobile-6s-detail.html | 曝光详情（包含审核/整改操作） |
| mobile-6s-add.html | 新增曝光 |
| mobile-6s-list.html | 管理员列表 |

## CSS变量 (移动端蓝色主题)
```css
--bg: #F0F7FF;
--card: #fff;
--border: #D6E9FF;
--primary: #4A90E2;
--accent: #22C58D;
--text: #1D2B5A;
--text-soft: #5B72A9;
--radius: 22px;
--orange: #ff9500;
--red: #ff3b30;
```

## 响应式断点
- <768px: max-width 480px
- 768px-1023px: max-width 680px
- ≥1024px: max-width 800px

## API端点
- GET /api/6s - 列表
- GET /api/6s/my-tasks - 责任人任务
- POST /api/6s - 创建
- PUT /api/6s/:id - 更新
- PUT /api/6s/:id/submit - 提交整改
- PUT /api/6s/:id/review - 审核
- GET /api/6s/stats/summary - 统计

## 服务运行
- Docker 容器名: `exam-system-api`
- 状态: healthy (运行中)
- 端口: 3000

## 容器重建注意事项

**重要**：Docker 镜像构建时会将 `data/exam.db` 打包进镜像，容器启动时若挂载方式不对可能导致使用旧数据。

### 正确的重建流程
```bash
# 1. 停止并删除旧容器
docker stop exam-system-api && docker rm exam-system-api

# 2. 构建新镜像
docker build -t staff-server:latest .

# 3. 重新创建容器（使用 bind mount 挂载数据库文件）
docker run -d \
  --name exam-system-api \
  --restart unless-stopped \
  -p 3000:3000 \
  -e NODE_ENV=production \
  -e PORT=3000 \
  -e TZ=Asia/Shanghai \
  -e JWT_SECRET=${JWT_SECRET:-change-this-secret-in-production} \
  -e SYNC_SECRET=${SYNC_SECRET:-sync-secret-change-me} \
  -e SMB_HOST=${SMB_HOST:-192.168.110.4} \
  -e SMB_SHARE=${SMB_SHARE:-办公部门数据盘\$} \
  -e SMB_SUBDIR=${SMB_SUBDIR:-行政部/行政部共享数据} \
  -e SMB_USER=${SMB_USER:-xlmould\\HMCTB} \
  -e SMB_PASS=${SMB_PASS:-HMCTB123} \
  -e EXCEL_PASSWORD=${EXCEL_PASSWORD:-1111} \
  --mount type=bind,source=$(pwd)/data/exam.db,destination=/app/data/exam.db,readonly=false \
  -v $(pwd)/src:/app/src \
  -v $(pwd)/public:/app/public \
  -v $(pwd)/uploads:/app/uploads \
  -v $(pwd)/scripts:/app/scripts \
  staff-server:latest
```

**注意**：
- 使用 `--mount type=bind` 直接挂载数据库文件，而不是 volume 挂载
- volume 挂载（`-v exam_data:/app/data`）可能读取旧数据
- 镜像内嵌的 `data/exam.db` 包含最新数据，构建时会覆盖本地旧文件

### 数据丢失恢复
如果容器重建后数据丢失，可从镜像提取正确数据库：
```bash
# 创建临时容器并复制镜像内嵌的数据库
docker create --name tmpexam staff-server:latest
docker cp tmpexam:/app/data/exam.db /tmp/镜像exam.db
docker rm tmpexam
# 覆盖本地数据库
cp /tmp/镜像exam.db data/exam.db
```

## 常用命令
```bash
# Docker 重启服务（推荐）
docker restart exam-system-api

# 查看 Docker 日志
docker logs exam-system-api

# 完整重建
docker-compose -f /home/openclaw/apps/server/docker-compose.yml up -d --force-recreate

# SQLite查询
sqlite3 /home/openclaw/apps/server/data.db "SELECT * FROM staff WHERE id=?"

# 查看文件
cat /home/openclaw/apps/server/public/mobile-6s-detail.html
```

## 6S区域选择器（2026-05-19）

### 分组下拉交互模式
- **默认状态**：显示4个分组头（生产区40个、仓库区40个、公共区28个、办公区46个），每个分组有颜色标识和区域数量
- **分组交互**：点击分组头 → 下拉展开显示三列卡片网格，展开的分组高亮显示（蓝色背景）
- **卡片选择**：选中区域后隐藏列表，显示已选区域卡片
- **清除恢复**：点击清除按钮 → 恢复显示所有分组头
- **搜索模式**：有搜索时显示所有匹配的卡片，按分组显示

### 数据结构
- 4个大区：生产区、仓库区、公共区、办公区
- 共154个区域分布在15个子分类中
- 数据文件：`public/js/6s-areas.js`
- 移动端：`public/mobile-6s-add.html`

### 修改文件
- `public/mobile-6s-add.html` - 区域选择器分组下拉交互
