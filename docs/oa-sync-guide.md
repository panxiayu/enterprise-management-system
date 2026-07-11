# 泛微OA考勤自动同步系统

## 功能概述

本系统可以自动从泛微OA下载考勤数据，并根据考勤记录自动提交请假申请。

### 主要功能

1. **自动下载考勤数据** - 从泛微OA下载每月考勤Excel
2. **智能分析缺勤** - 根据工作时间要求（上午8:00-11:30，下午13:00-17:30）检测缺勤
3. **自动提交请假** - 对缺勤记录自动填写并提交事假申请
4. **定时调度** - 每周二20:00和每周三08:00自动执行

## 配置步骤

### 1. 设置环境变量

在 `.env` 文件或Docker环境变量中添加：

```bash
# 泛微OA登录凭据
OA_USERNAME=你的工号
OA_PASSWORD=你的密码
```

### 2. 调整选择器配置

由于每个泛微OA系统的页面结构可能不同，需要根据实际情况调整以下脚本中的选择器：

#### `scripts/oa-attendance-sync.js`

```javascript
// 登录页面选择器
selectors: {
  login: {
    usernameInput: '#username',    // 用户名输入框的CSS选择器
    passwordInput: '#password',    // 密码输入框的CSS选择器
    submitButton: '#loginButton'   // 登录按钮的CSS选择器
  },
  attendance: {
    menuAttendance: 'a[href*="attendance"]',  // 考勤菜单链接
    exportButton: '#exportButton',            // 导出按钮
    monthPicker: '#monthPicker'               // 月份选择器
  }
}
```

#### `scripts/oa-leave-request.js`

```javascript
// 请假申请页面选择器
selectors: {
  leaveRequest: {
    menuLeave: 'a[href*="leave"]',          // 请假菜单
    newRequestButton: '#newLeaveRequest',    // 新建请假按钮
    leaveTypeSelect: '#leaveType',           // 假别类型下拉框
    startDateInput: '#startDate',            // 开始日期
    endDateInput: '#endDate',                // 结束日期
    startTimeInput: '#startTime',            // 开始时间
    endTimeInput: '#endTime',                // 结束时间
    reasonTextarea: '#reason',               // 请假事由
    submitButton: '#submitLeaveRequest'      // 提交按钮
  }
}
```

## 使用方法

### 手动触发

#### 通过API接口

```bash
# 仅下载考勤数据
curl -X POST http://localhost:3000/api/oa-sync/download

# 仅分析考勤（不提交请假）
curl -X POST http://localhost:3000/api/oa-sync/analyze

# 完整同步（下载 + 分析）
curl -X POST http://localhost:3000/api/oa-sync/run

# 完整同步 + 自动提交请假
curl -X POST http://localhost:3000/api/oa-sync/run \
  -H "Content-Type: application/json" \
  -d '{"submitLeave": true}'

# 查看同步状态
curl http://localhost:3000/api/oa-sync/status
```

#### 通过命令行

```bash
# 下载考勤数据
node scripts/oa-attendance-sync.js

# 分析考勤（不提交请假）
node scripts/oa-leave-request.js --dry-run

# 分析并提交请假
node scripts/oa-leave-request.js
```

### 自动调度

系统会在以下时间自动执行：

| 时间 | 操作 |
|------|------|
| 每周二 20:00 | 下载考勤数据 + 分析缺勤（不提交请假） |
| 每周三 08:00 | 下载考勤数据 + 自动提交请假 |

## 文件结构

```
server/
├── scripts/
│   ├── oa-attendance-sync.js    # 考勤下载脚本
│   └── oa-leave-request.js      # 请假提交脚本
├── src/
│   ├── services/
│   │   └── oa-sync-scheduler.js # 定时调度服务
│   └── routes/
│       └── oa-sync.js           # API路由
└── data/
    └── oa-export/               # 导出文件目录
        ├── attendance-YYYY-MM.xlsx  # 考勤数据文件
        └── leave-requests.log       # 请假申请日志
```

## 调试指南

### 1. 检查浏览器自动化

如果需要查看浏览器实际操作过程，可以临时关闭无头模式：

```javascript
// 在脚本中修改
headless: false, // 改为 false 可以看到浏览器界面
```

### 2. 查看日志

```bash
# 查看请假申请日志
cat data/oa-export/leave-requests.log

# 查看服务器日志（包含调度信息）
docker logs exam-system-api | grep OA_SYNC
```

### 3. 常见问题

**Q: 登录失败**
- 检查环境变量 `OA_USERNAME` 和 `OA_PASSWORD` 是否正确
- 确认OA系统地址是否可访问
- 检查登录页面选择器是否正确

**Q: 找不到考勤菜单**
- 检查 `selectors.attendance.menuAttendance` 选择器
- 泛微OA可能使用iframe结构，需要调整代码处理iframe

**Q: 请假表单填写失败**
- 检查 `selectors.leaveRequest` 中的所有选择器
- 确认假别类型值是否正确（事假、年假、调休）

**Q: 定时任务未执行**
- 检查服务器时区设置（应为 Asia/Shanghai）
- 查看服务器日志中是否有 OA_SYNC 相关输出
- 确认 OA_USERNAME 和 OA_PASSWORD 环境变量已设置

## 扩展功能

### 修改执行时间

编辑 `src/services/oa-sync-scheduler.js` 中的 `SCHEDULES` 数组：

```javascript
const SCHEDULES = [
  { day: 2, hour: 20, minute: 0, label: '周二20:00', submitLeave: false },
  { day: 3, hour: 8, minute: 0, label: '周三08:00', submitLeave: true },
  // 添加更多调度时间...
];
```

### 修改工作时间

编辑 `scripts/oa-leave-request.js` 中的 `CONFIG.workSchedule`：

```javascript
workSchedule: {
  morning: {
    start: '08:00',  // 上午上班时间
    end: '11:30'     // 上午下班时间
  },
  afternoon: {
    start: '13:00',  // 下午上班时间
    end: '17:30'     // 下午下班时间
  }
}
```

### 修改请假类型

编辑 `scripts/oa-leave-request.js` 中的 `CONFIG.leaveTypes`：

```javascript
leaveTypes: {
  personal: '事假',
  annual: '年假',
  compensatory: '调休'
}
```

## 安全注意事项

1. **环境变量安全** - 不要将OA密码硬编码在代码中，始终使用环境变量
2. **访问控制** - API接口应添加认证中间件，防止未授权访问
3. **日志脱敏** - 日志中不要记录敏感信息（如密码）
4. **定期检查** - 定期检查自动提交的请假申请是否正确

## 技术支持

如遇到问题，请检查：

1. 浏览器自动化是否正常（Puppeteer）
2. 网络连接是否正常（OA系统是否可访问）
3. 页面选择器是否正确（可能需要更新）
4. 环境变量是否正确设置
