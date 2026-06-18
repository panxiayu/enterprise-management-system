# 小程序混合方案记忆

## 用途

这个文件用于给后续大模型/协作模型快速恢复当前项目的“小程序 + H5 混合接入”约定，避免重复摸索。

## 当前结论

- 小程序**沿用现有 H5 页面 UI**，不重写业务页面为原生小程序。
- 小程序主要提供：
  - `web-view` 壳
  - 下拉刷新
  - 小程序身份绑定
  - 订阅消息能力
  - 与 H5 的桥接通信

## 当前默认入口

- 小程序默认 H5 入口页：`/miniapp-entry.html`
- 入口文件：[/home/openclaw/apps/server/public/miniapp-entry.html](/home/openclaw/apps/server/public/miniapp-entry.html)

### 入口逻辑

- 如果小程序传入了 `miniapp_token` 和 `miniapp_staff`
  - 写入 `localStorage`
  - 跳转到 `/employee.html`
- 如果没有登录态
  - 跳转到 `/index.html`

## 小程序工程位置

- 小程序工程目录：[/home/openclaw/apps/server/miniprogram](/home/openclaw/apps/server/miniprogram)

### 关键文件

- 小程序 `web-view` 页：
  [/home/openclaw/apps/server/miniprogram/pages/webview/webview.js](/home/openclaw/apps/server/miniprogram/pages/webview/webview.js)
- 小程序请求工具：
  [/home/openclaw/apps/server/miniprogram/utils/request.js](/home/openclaw/apps/server/miniprogram/utils/request.js)
- 小程序登录页：
  [/home/openclaw/apps/server/miniprogram/pages/login/index.js](/home/openclaw/apps/server/miniprogram/pages/login/index.js)

## H5 与小程序桥接

### 桥接脚本

- 文件：
  [/home/openclaw/apps/server/public/js/miniapp-bridge.js](/home/openclaw/apps/server/public/js/miniapp-bridge.js)

### 作用

- 识别是否在小程序中打开
- 自动加环境类名
- 自动加页面类名
- 接收小程序传入的登录态
- 向小程序发送订阅消息/刷新请求

### 页面环境类名

- 小程序环境：`env-miniapp`
- 浏览器环境：`env-browser`

### 页面级类名规则

- 会自动根据路径生成 `page-xxx`
- 例如：
  - `/index.html` -> `page-index`
  - `/employee.html` -> `page-employee`
  - `/mobile-6s-list.html` -> `page-mobile-6s-list`

## 小程序专版样式体系

### 总样式文件

- 文件：
  [/home/openclaw/apps/server/public/css/miniapp-overrides.css](/home/openclaw/apps/server/public/css/miniapp-overrides.css)

### 注入方式

- 由服务端中间件自动注入到：
  - `index.html`
  - `employee.html`
  - `mobile-*.html`

- 注入逻辑文件：
  [/home/openclaw/apps/server/src/middleware/feedback-inject.js](/home/openclaw/apps/server/src/middleware/feedback-inject.js)

### 设计规则

- 不复制两份页面
- 共用一份 HTML
- 通过类名切换小程序专版样式

### 推荐写法

```css
body.env-miniapp.page-mobile-6s-list .header {
  /* 小程序专版 */
}

body.env-browser.page-mobile-6s-list .header {
  /* 浏览器版 */
}
```

## 已经做过专版分流的页面

- [/home/openclaw/apps/server/public/index.html](/home/openclaw/apps/server/public/index.html)
- [/home/openclaw/apps/server/public/employee.html](/home/openclaw/apps/server/public/employee.html)

## 后端小程序接入能力

### 路由

- 文件：
  [/home/openclaw/apps/server/src/routes/miniapp.js](/home/openclaw/apps/server/src/routes/miniapp.js)

### 服务

- 文件：
  [/home/openclaw/apps/server/src/services/miniapp-service.js](/home/openclaw/apps/server/src/services/miniapp-service.js)

### 数据表

- `miniapp_user_bindings`
- `miniapp_template_subscriptions`
- `miniapp_push_queue`

## 当前重要约定

- 不要再默认把小程序入口直接指到 `/`
- 优先走 `/miniapp-entry.html`
- `miniapp-test.html` 用于测试 `web-view` 域名链路是否正常

## 如果后续模型接手，优先先读

1. [/home/openclaw/apps/server/docs/miniapp-agent-memory.md](/home/openclaw/apps/server/docs/miniapp-agent-memory.md)
2. [/home/openclaw/apps/server/docs/miniapp-hybrid-integration.md](/home/openclaw/apps/server/docs/miniapp-hybrid-integration.md)
3. [/home/openclaw/apps/server/public/js/miniapp-bridge.js](/home/openclaw/apps/server/public/js/miniapp-bridge.js)
4. [/home/openclaw/apps/server/public/css/miniapp-overrides.css](/home/openclaw/apps/server/public/css/miniapp-overrides.css)
