# 微信小程序混合接入方案

## 目标

当前方案保留现有 H5 页面 UI，只在微信小程序侧增加：

- `web-view` 承载现有移动页面
- 原生下拉刷新
- 原生订阅消息授权
- 服务端待发送队列

## 已落地的服务端能力

### 1. H5 页面自动注入桥接脚本

以下页面会自动注入：

- `index.html`
- `employee.html`
- `mobile-*.html`

自动注入文件：

- `/js/auth-guard.js`
- `/js/miniapp-bridge.js`

H5 内可直接使用：

```js
window.MiniAppBridge.isMiniProgram();
window.MiniAppBridge.requestSubscription(['s6_task_assigned']);
window.MiniAppBridge.syncNotificationSummary();
```

### 2. 小程序绑定与订阅接口

接口前缀：`/api/miniapp`

- `GET /api/miniapp/config`
- `GET /api/miniapp/session`
- `POST /api/miniapp/bind`
- `GET /api/miniapp/subscriptions`
- `POST /api/miniapp/subscriptions`
- `GET /api/miniapp/push-queue`
- `POST /api/miniapp/push-queue/:id/status`

### 3. 站内通知自动入小程序待发送队列

当以下通知创建时，如果用户已绑定小程序且已订阅对应模板，系统会自动写入 `miniapp_push_queue`：

- `s6_assigned`
- `s6_review`
- `s6_submitted`
- `task_assigned`
- `task_reassigned`
- `task_progress`

当前是“待发送队列”模式，方便后续接真正的微信订阅消息发送器。

## 新增数据表

- `miniapp_user_bindings`
- `miniapp_template_subscriptions`
- `miniapp_push_queue`

## 推荐的小程序页面结构

### `pages/webview/webview`

职责：

- 接收要打开的 H5 路径
- 渲染 `web-view`
- 处理下拉刷新
- 接收 H5 的 `postMessage`
- 请求订阅消息授权

建议参数：

- `path=/mobile-6s-tasks.html`

## 小程序端建议实现

### 页面逻辑

```js
Page({
  data: {
    src: ''
  },
  onLoad(query) {
    this.refreshWebview(query.path || '/miniapp-entry.html');
  },
  onPullDownRefresh() {
    this.refreshWebview(this.currentPath);
    setTimeout(() => wx.stopPullDownRefresh(), 600);
  },
  refreshWebview(path) {
    this.currentPath = path;
    const origin = 'https://www.xlmould.work';
    const joiner = path.includes('?') ? '&' : '?';
    this.setData({
      src: `${origin}${path}${joiner}miniapp=1&t=${Date.now()}`
    });
  },
  onMessage(event) {
    const messages = event.detail.data || [];
    messages.forEach((message) => {
      if (message.type === 'request-subscription') {
        const keys = message.payload?.template_keys || [];
        this.requestSubscription(keys);
      }
      if (message.type === 'notification-summary') {
        // 可以同步到 tabBar 红点
      }
    });
  },
  requestSubscription(templateKeys) {
    // 在这里把 templateKeys 映射到真正的模板 ID，再调用 wx.requestSubscribeMessage
  }
});
```

### 页面配置

```json
{
  "navigationBarTitleText": "兴利 6S",
  "enablePullDownRefresh": true
}
```

## 模板 ID 配置位置

请在 [request.js](/home/openclaw/apps/server/miniprogram/utils/request.js) 的 `TEMPLATE_MAP` 中填写真实模板 ID：

```js
const TEMPLATE_MAP = {
  s6_task_assigned: "这里填模板ID",
  s6_task_result: "这里填模板ID",
  s6_admin_review: "这里填模板ID",
  task_assigned: "这里填模板ID",
  task_progress: "这里填模板ID",
};
```

## 服务端环境变量

至少需要配置：

- `WECHAT_MINIAPP_APP_SECRET`
- `WECHAT_MINIAPP_APP_ID`：可选，未配置时小程序端会回传当前 `appid`
- `MINIAPP_WEBVIEW_ORIGIN`：可选，默认 `https://www.xlmould.work`

## 推荐的 H5 路径

- 默认首页：`/miniapp-entry.html`
- 员工首页：`/employee.html`
- 6S任务：`/mobile-6s-tasks.html`
- 6S管理：`/mobile-6s-list.html`
- 6S新增：`/mobile-6s-add.html`

## 绑定流程建议

1. 小程序登录后拿到 `openid`
2. H5 员工登录成功后拿到 `employee_token`
3. 小程序壳调用 `POST /api/miniapp/bind`
4. 小程序壳调用 `POST /api/miniapp/subscriptions`
5. 后端后续写通知时自动进入 `miniapp_push_queue`

## 订阅模板键

- `s6_task_assigned`
- `s6_task_result`
- `s6_admin_review`
- `task_assigned`
- `task_progress`

## 后续还差的一步

当前仓库已经把“谁该收消息、消息内容、待发送记录”准备好了。

还需要在小程序侧或单独 worker 中补一段真正的微信发送逻辑：

1. 读取 `miniapp_push_queue` 的 `pending` 记录
2. 按 `template_id + openid + page_path + payload_json` 调微信订阅消息接口
3. 成功后回写 `sent`
4. 失败后回写 `failed`
