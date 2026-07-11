# 差旅费用管理模块实施方案

## 1. 模块定位

这个模块不是员工个人报销系统，而是公司专职差旅管理人帮员工代订票务、住宿并做费用归集的台账系统。

核心目标：

- 给差旅管理人提供手机端快速录入能力
- 给员工提供只读查看自己的差旅安排能力
- 给 PC 端提供查询、统计、导出、报销跟踪能力
- 保存人员组织信息快照，避免后续调岗调部门影响历史单据

当前预览页：

- 员工端：[public/mobile-travel-my-trip.html](/home/openclaw/apps/server/public/mobile-travel-my-trip.html)
- 管理人手机录入端：[public/mobile-travel-entry.html](/home/openclaw/apps/server/public/mobile-travel-entry.html)
- 管理人移动列表：[public/mobile-travel.html](/home/openclaw/apps/server/public/mobile-travel.html)
- PC 工作台：[public/travel-expense-management.html](/home/openclaw/apps/server/public/travel-expense-management.html)

## 2. 角色划分

### 2.1 差旅管理人

负责：

- 为员工代订车票、机票、酒店
- 录入票务、住宿、其他费用
- 更新发票状态、报销状态、报销单号
- 导出明细台账和报销台账

### 2.2 员工

仅在具备差旅查看权限时显示入口。

员工端能力建议限制为：

- 查看自己的差旅单
- 查看已订票务和住宿
- 查看报销状态

员工端不开放：

- 金额编辑
- 删除单据
- 修改报销状态

### 2.3 管理员 / 权限管理员

负责：

- 配置差旅查看权限
- 配置差旅管理权限
- 查看所有差旅数据

## 3. 页面结构

### 3.1 员工端页面

页面建议名称：

- `mobile-travel-my-trip.html`

页面功能：

- 展示当前/最近差旅单
- 展示票务和住宿明细
- 展示费用汇总
- 展示报销状态

入口控制：

- 无权限时，首页不显示差旅入口
- 有权限时，显示“我的差旅安排”

### 3.2 差旅管理人手机端

页面建议名称：

- `mobile-travel-entry.html`

页面功能：

- 创建差旅主单
- 录入票务明细
- 录入住宿明细
- 录入其他费用
- 补录发票状态、报销状态、报销单号
- 预留票据图片字段和接口位置，当前版本可不启用上传

设计原则：

- 单手快速录入
- 主单信息和费用明细分区清晰
- 一张票一条明细
- 改签/退票不要覆盖原记录，建议新增差额明细

### 3.3 PC 工作台

页面建议名称：

- `travel-expense-management.html`

页面功能：

- 差旅单列表
- 多条件筛选
- 汇总统计
- 导出明细
- 导出报销台账
- 查看 / 编辑 / 去报销

## 4. 数据结构建议

建议采用“主单 + 明细项”结构，不要把所有字段都平铺在一张表里。

### 4.1 主表：`travel_orders`

建议字段：

- `id`
- `order_no` 差旅单号
- `staff_id` 出差人 staff.id
- `staff_name_snapshot`
- `employee_id_snapshot`
- `company_snapshot`
- `department_snapshot`
- `position_snapshot`
- `trip_type` 出差类型，如出差/培训/接待/驻厂
- `start_time`
- `end_time`
- `destination`
- `trip_reason`
- `status` 建议值：`draft` / `upcoming` / `completed` / `cancelled`
- `reimbursement_status` 建议值：`pending` / `processing` / `reimbursed`
- `reimbursement_no`
- `invoice_status` 建议值：`not_received` / `partial` / `complete`
- `created_by_staff_id`
- `created_by_name`
- `remark`
- `created_at`
- `updated_at`

说明：

- `company_snapshot / department_snapshot / position_snapshot` 必须保留
- `status` 管理行程生命周期
- `reimbursement_status` 单独管理财务生命周期

### 4.2 明细表：`travel_order_items`

建议字段：

- `id`
- `order_id`
- `item_type` 建议值：`ticket` / `hotel` / `other`
- `item_subtype` 如火车票/机票/酒店/打车/餐补/改签差额
- `title`
- `from_location`
- `to_location`
- `start_time`
- `end_time`
- `vendor_name` 平台/供应商
- `order_ref_no` 订单号
- `payment_method` 建议值：`company_paid` / `personal_paid`
- `amount`
- `quantity`
- `unit_price`
- `nights`
- `item_status` 例如已出票/已预订/已退票
- `invoice_status`
- `receipt_image` / `receipt_images` 票据图片预留字段，可空
- `remark`
- `sort_index`
- `created_at`
- `updated_at`

说明：

- 票务、住宿、其他费用统一用明细表管理
- 改签和退票建议记录为单独明细，避免覆盖原始数据

### 4.3 日志表：`travel_order_logs`

建议字段：

- `id`
- `order_id`
- `action_type`
- `action_desc`
- `operator_staff_id`
- `operator_name`
- `created_at`

用途：

- 追踪谁创建、编辑、作废、更新报销状态

## 5. 权限设计建议

结合当前系统已有权限体系，建议增加两类权限：

### 5.1 staff 表新增字段

- `travel_view_permission INTEGER DEFAULT 0`
- `travel_manage_permission INTEGER DEFAULT 0`

含义：

- `travel_view_permission = 1`：员工端可见“我的差旅安排”
- `travel_manage_permission = 1`：可使用差旅管理端、PC 工作台

### 5.2 权限管理页面接入

建议在现有 [public/permission-list.html](/home/openclaw/apps/server/public/permission-list.html) 中新增“差旅权限”标签：

- 查看权限
- 管理权限

表现方式建议参考：

- 6S 权限
- 工服权限

## 6. API 设计建议

建议新增路由：

- `src/routes/travel.js`

并在 `src/index.js` 中挂载：

- `app.use('/api/travel', travelRoutes)`

### 6.1 主单接口

- `GET /api/travel/orders`
  - PC 列表查询
- `GET /api/travel/orders/:id`
  - 获取详情
- `POST /api/travel/orders`
  - 创建主单 + 明细
- `PUT /api/travel/orders/:id`
  - 编辑主单 + 明细
- `PUT /api/travel/orders/:id/status`
  - 更新行程状态
- `PUT /api/travel/orders/:id/reimbursement`
  - 更新报销状态

### 6.2 员工端接口

- `GET /api/travel/my/orders`
  - 当前员工查看自己的差旅单
- `GET /api/travel/my/has-permission`
  - 检查是否显示入口

### 6.3 导出接口

- `GET /api/travel/export/orders`
  - 导出差旅单明细
- `GET /api/travel/export/reimbursements`
  - 导出报销台账

## 7. 导出口径建议

至少做两种导出：

### 7.1 差旅单明细导出

适合行政、业务核对。

建议字段：

- 单号
- 出差人
- 工号
- 所属公司快照
- 部门快照
- 岗位快照
- 出发时间
- 返程时间
- 目的地
- 事由
- 明细类型
- 平台
- 订单号
- 金额
- 发票状态
- 报销状态

### 7.2 报销台账导出

适合财务使用。

建议字段：

- 单号
- 出差人
- 所属公司快照
- 部门快照
- 票务金额
- 住宿金额
- 其他金额
- 合计金额
- 报销状态
- 报销单号
- 发票状态

## 8. 状态设计建议

### 8.1 行程状态

- `draft` 草稿
- `upcoming` 待出行
- `completed` 已完成
- `cancelled` 已作废

### 8.2 报销状态

- `pending` 待报销
- `processing` 报销中
- `reimbursed` 已报销

### 8.3 发票状态

- `not_received` 未收到
- `partial` 部分已收齐
- `complete` 已收齐

## 9. 推荐开发顺序

### 第一阶段：数据和权限

- 新增表结构
- 新增权限字段
- 新增权限页入口

### 第二阶段：基础接口

- 差旅主单 CRUD
- 员工端我的差旅接口
- 导出接口基础版

### 第三阶段：页面正式化

- 员工端正式页面
- 管理人手机录入页
- PC 工作台

### 第四阶段：增强能力

- 改签 / 退票差额记录
- 操作日志
- 批量导出
- 发票归档追踪

## 10. 当前建议

如果按现阶段继续往下推进，最合理的下一步是：

1. 先在数据库初始化逻辑里加入差旅表和权限字段
2. 再补 `src/routes/travel.js` 基础接口
3. 最后把预览页替换为正式页面并接入入口

这样改动路径和现有工服、6S 模块最接近，后续你说“这里再调一下”也最好改。
