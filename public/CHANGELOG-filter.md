# 员工管理表格筛选功能修改日志

## 2026-04-03

### 修改背景
用户反馈 Excel 风格筛选功能与实际 Excel 行为不一致，主要问题：
1. 只有部分列能筛选，应该所有列都能筛选
2. 搜索不是即时生效
3. 全选 indeterminate 状态计算错误
4. 搜索与复选框筛选互斥
5. 下拉框可能被遮挡

### 修改内容

---

#### 1. 蓝框问题：恢复显示列下拉菜单里的 ☰ 拖拽图标 ✅
- **文件**: staff-list.html
- **位置**: updateColumnCheckboxes() 函数 (Line ~524)
- **修改**: 恢复 `<span style="color:var(--text-muted); font-size:11px; flex-shrink:0; line-height:1;">☰</span>`
- **原因**: 用户确认 ☰ 图标是有用的功能

---

#### 2. 行高统一 ✅
- **文件**: staff-list.html
- **位置**: CSS th/td 样式 (Line ~62-63)
- **修改**: 为 th 和 td 添加 `height: 36px; box-sizing: border-box;`

---

#### 3. 隐藏列边框问题 ✅
- **文件**: staff-list.html
- **位置**: CSS (Line ~66)
- **修改**: 添加 `th[data-key="status"], td[data-key="status"] { display: none; }`

---

#### 4. 家庭住址列表内容一行显示 ✅
- **文件**: staff-list.html
- **位置**: .th-item-text 样式 (Line ~203)
- **修改**: 添加 `white-space: nowrap; overflow: hidden; text-overflow: ellipsis;`

---

#### 5. 下拉框定位修复 ✅
- **文件**: staff-list.html
- **位置**: .th-filter-wrapper 样式 (Line ~184)
- **修改**: `width: auto; min-width: 100%;`

---

#### 6. 动态获取可筛选列 ✅
- **文件**: staff-list.html
- **位置**: renderTableHeader() 的 isFilterable 判断
- **修改**: `const isFilterable = col.key !== 'checkbox' && col.key !== 'status';`
- **效果**: 所有数据列都可以筛选

---

#### 7. 搜索即时生效 ✅
- **文件**: staff-list.html
- **位置**: populateHeaderFilterOptions() 的搜索逻辑
- **修改**: input 事件即时保存搜索关键词并应用筛选，移除回车确认逻辑

---

#### 8. updateFilterState 修正 ✅
- **文件**: staff-list.html
- **位置**: populateHeaderFilterOptions() 的 updateFilterState 函数
- **修改**: 只计算可见 checkbox 的选中状态
- **新增**: 添加 `updateVisibleSelectAllState()` 函数用于更新可见项的全选状态

---

#### 9. 搜索与复选框同时生效 ✅
- **文件**: staff-list.html
- **位置**: loadStaff() 的 Excel 风格客户端筛选逻辑
- **修改**:
  - 移除 if-else 互斥逻辑
  - 改为 AND 条件同时应用搜索和复选框筛选
  - 动态获取所有可筛选列 `COLUMNS.filter(c => c.key !== 'checkbox' && c.key !== 'status')`

---

#### 10. 筛选计数 badge 实时更新 ✅
- **文件**: staff-list.html
- **位置**: loadStaff() 筛选后更新
- **修改**: 筛选后对所有 filterableKeys 执行 updateExcelFilterCount()

---

#### 11. 下拉框被裁剪问题 ✅
- **文件**: staff-list.html
- **位置**: CSS .th-dropdown 样式
- **修改**: 添加 `overflow: visible` 到下拉框，并设置 `table`, `thead`, `tr` 的 `overflow: visible !important`
- **原因**: `.table-scroll-inner` 的 `overflow: auto` 导致下拉框被裁剪

---

#### 12. 动态收集所有列的唯一值 ✅
- **文件**: staff-list.html
- **位置**: loadStaff() 中 fieldValues 收集逻辑
- **修改**: 从硬编码 5 个列改为动态获取所有非系统字段
- **原因**: 新添加的列也需要能显示下拉选项

---

#### 13. 同步列配置在筛选之前 ✅
- **文件**: staff-list.html
- **位置**: loadStaff() 筛选逻辑顺序
- **修改**: 将 `syncColumnsFromData()` 移到筛选循环之前
- **原因**: 确保新添加的列也能被筛选

---

#### 14. updateFilterState 全选判断逻辑修正 ✅
- **文件**: staff-list.html
- **位置**: populateHeaderFilterOptions() 中的 updateFilterState()
- **修改**:
  - `allSame` 改为基于可见项计算：`checkedValues.length === visibleItems.length`
  - indeterminate 判断改为：`checkedValues.length > 0 && checkedValues.length < visibleItems.length`
- **原因**: 原逻辑比较可见项和所有项，导致 indeterminate 状态错误

---

#### 15. updateVisibleSelectAllState indeterminate 判断修正 ✅
- **文件**: staff-list.html
- **位置**: populateHeaderFilterOptions() 中的 updateVisibleSelectAllState()
- **修改**: indeterminate 判断改为 `visibleChecked.length > 0 && visibleChecked.length < visibleItems.length`
- **原因**: 只有部分选中时才显示 indeterminate

---

#### 16. 下拉框定位改回 position:absolute ✅
- **文件**: staff-list.html
- **位置**: CSS .th-dropdown 和 JS 下拉打开逻辑
- **修改**:
  - CSS: `position: fixed` → `position: absolute`
  - JS: 移除手动位置计算，使用 `top: 100%; left: 0;` 自动定位
- **原因**: `position: fixed` 的视口坐标在表格滚动时会不准确，改回 `position: absolute` 相对 `.th-filter-wrapper` 定位

---

#### 17. 日期筛选改为客户端筛选 ✅
- **文件**: staff-list.html
- **位置**: loadStaff() 筛选逻辑
- **修改**:
  - 移除 URL 参数中的 `hire_date_from` 和 `hire_date_to`
  - 在客户端筛选循环中添加日期范围判断
  - 使用 `new Date()` 进行日期比较，而不是字符串比较
- **原因**: 所有筛选都用客户端一致，体验更好；字符串比较会导致日期格式不一致时出错

---

#### 18. 修复日期为空时被错误过滤 ✅
- **文件**: staff-list.html
- **位置**: loadStaff() 筛选逻辑
- **修改**: `if (!s.hire_date) return false;` → `if (!s.hire_date) return true;`
- **原因**: 没有日期的员工不应该被日期筛选过滤掉

---

#### 19. 修复字段为空时被错误过滤 ✅
- **文件**: staff-list.html
- **位置**: loadStaff() 筛选逻辑
- **修改**: 添加字段存在性检查 `if (s[key] !== undefined && s[key] !== null && s[key] !== '')`
- **原因**: 如果数据中没有某个字段，不应该被筛选过滤掉

---

#### 20. 新添加的字段默认显示 ✅
- **文件**: staff-list.html
- **位置**: syncColumnsFromData() 函数
- **修改**: `savedVisible` 默认值从 `false` 改为 `true`
- **原因**: 用户要求新字段默认全部显示，不能隐藏

---

#### 21. 简化全选复选框逻辑（根据材料优化） ✅
- **文件**: staff-list.html
- **位置**: populateHeaderFilterOptions() 中的 updateFilterState() 和 updateVisibleSelectAllState()
- **修改**:
  - 使用 `Array.from(allCheckboxes).every(cb => cb.checked)` 简化全选判断
  - 使用 `Array.from(allCheckboxes).filter(cb => cb.checked)` 获取已选项
  - 修复全选复选框事件中 `allValues` 未定义的 bug
- **原因**: 参考材料中的更简洁清晰的写法

---

#### 22. td 单元格内容一行显示 ✅
- **文件**: staff-list.html
- **位置**: CSS td 样式
- **修改**: 添加 `white-space: nowrap; overflow: hidden; text-overflow: ellipsis;`
- **原因**: 用户要求所有列表数据只用一行

---

#### 23. 筛选下拉样式优化为 Excel 风格 ✅
- **文件**: staff-list.html
- **位置**: CSS .th-dropdown 相关样式
- **修改**:
  - 移除重复的 `.th-dropdown.open` 规则
  - 全选按钮使用独立的 `.th-select-all` 样式
  - 使用具体的颜色值（#3b82f6 蓝色主题，#374151 文字色等）
  - 搜索框和列表项样式微调
  - 整体背景白色，边框灰色，更接近 Excel
- **原因**: 用户要求筛选下拉样式和 Excel 一致

---

#### 25. 表头和数据居中对齐 ✅
- **文件**: staff-list.html
- **位置**: renderStaffTable() 中所有 td 的渲染
- **修改**: 为所有 td 添加内联样式 `text-align:center`
- **原因**: 确保所有列的数据都居中对齐

---

#### 28. 表头文字居中，箭头不影响对齐 ✅
- **文件**: staff-list.html
- **位置**: CSS .th-filter-btn 和 renderTableHeader()
- **修改**: 
  - 添加 `.th-filter-btn-text { display: inline-block; text-align: center; }`
  - 表头渲染时用 span 包裹文字和计数badge，箭头单独放置
- **原因**: 下拉箭头不算字符，文字应该居中对齐
- **文件**: staff-list.html
- **位置**: 全选复选框事件处理函数
- **修改**: 添加 `const allCheckboxes = listContainer.querySelectorAll(...)` 定义
- **原因**: 之前 `allCheckboxes` 未定义，导致全选/取消全选功能失效
- **文件**: staff-list.html
- **位置**: CSS .th-filter-wrapper 样式
- **修改**: 
  - `.th-filter-wrapper` 从 `display: inline-block` 改为 `display: block; width: 100%; text-align: center`
  - `.th-filter-btn` 从 `display: flex` 改为 `display: inline-flex`
- **原因**: 表头文字偏左，改用块级布局占满单元格并居中内容
- **文件**: staff-list.html
- **位置**: CSS th/td 样式
- **修改**: 添加 `!important` 确保 `text-align: center` 和 `vertical-align: middle` 生效
- **原因**: 确保表头和相应数据居中对齐
- **文件**: staff-list.html
- **位置**: populateHeaderFilterOptions() 和 CSS
- **修改**:
  - 添加确定/取消按钮到下拉底部
  - 搜索只过滤下拉列表，不即时触发数据筛选
  - 全选/单选复选框只保存状态，不触发筛选
  - 点确定才调用 `onHeaderFilterChange()` 应用筛选
  - 点取消或外部关闭时恢复原始状态
- **原因**: 用户要求像 Excel 一样，点击确定才应用筛选
- **文件**: staff-list.html
- **位置**: CSS td 样式
- **修改**: 添加 `white-space: nowrap; overflow: hidden; text-overflow: ellipsis;`
- **原因**: 用户要求所有列表数据只用一行
- **文件**: staff-list.html
- **位置**: syncColumnsFromData() 函数
- **修改**: `savedVisible` 默认值从 `false` 改为 `true`
- **原因**: 用户要求新字段默认全部显示，不能隐藏
