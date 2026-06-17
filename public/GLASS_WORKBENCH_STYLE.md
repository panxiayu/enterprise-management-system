# Glass Workbench Style（复用规范）

这份规范用于复用 `dashboard.html` 当前视觉风格。后续你说“用玻璃工作台风格”，我就按这套接入。

## 主题文件

- CSS: [glass-workbench-theme.css](/home/openclaw/apps/server/public/css/glass-workbench-theme.css)

## 页面接入步骤

1. 在页面 `<head>` 引入：

```html
<link rel="stylesheet" href="css/glass-workbench-theme.css">
```

2. 在 `<body>` 添加类名：

```html
<body class="theme-glass-workbench">
```

3. 页面主容器使用：

```html
<div class="glass-workbench">...</div>
```

4. 常用组件类：
- `gw-glass-panel`: 玻璃卡片
- `gw-title` / `gw-subtitle`: 主标题与副标题
- `gw-kpi-label` / `gw-kpi-value`: 指标文字
- `gw-link`: 操作链接
- `gw-card-interactive`: 悬停浮起
- `gw-reminder-title` / `gw-reminder-text`: 提醒区文案

## 适配原则

- 桌面端优先双栏或三栏：主内容优先，提醒区次之。
- 保持浅色玻璃：不要切成深色风格。
- 页面级布局差异（列数、间距、模块区高度）在目标页面本地 CSS 调整，不改主题基线。
- 手机端保留可用性：可减少卡片数量和信息密度，但保留同一视觉语言。

## 当前基线来源

- 页面: [dashboard.html](/home/openclaw/apps/server/public/dashboard.html)
- 版本目标: 大屏无滚动、居中铺满、浅色玻璃工作台
