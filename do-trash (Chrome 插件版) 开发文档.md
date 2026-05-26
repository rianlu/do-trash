# do-trash Chrome 插件版开发文档

## 1. 产品结论

- 建设一个本地自用 Chrome Manifest V3 扩展.
- 仅在 `https://linux.do/*` 页面运行.
- 自动把命中规则的帖子从列表页隐藏, 并放入页面右侧垃圾桶.
- 使用 `chrome.storage.local` 保存配置, 不建设服务端, 不上传数据.
- 第一版交付关键词, 类别, 标签, 作者, 白名单, 页面垃圾桶, popup 快捷控制, options 完整设置.

## 2. 固定边界

- 只处理 LINUX.DO 的帖子列表页 DOM.
- 只根据列表页可见信息匹配: 标题, 类别, 标签, 可见用户信息, 帖子链接, topic id.
- 不读取私信, 不发帖, 不回复, 不修改论坛账号数据.
- 不跨站运行, 不申请宽泛站点权限.
- 不依赖远程接口作为主流程.
- 不把收纳结果永久隐藏为论坛状态, 所有行为只发生在本地浏览器.

## 3. 页面与功能

### 3.1 LINUX.DO 页面内垃圾桶

- 在页面右侧创建固定悬浮按钮.
- 支持拖拽悬浮按钮并记忆当前位置.
- 支持在 options 中调整悬浮按钮大小.
- 在按钮上显示当前页面已收纳数量.
- 点击按钮展开垃圾桶面板.
- 在面板中展示已收纳帖子列表.
- 每条收纳记录展示标题, 命中原因, 操作按钮.
- 点击标题打开原帖.
- 点击还原时, 当前页面立即恢复该帖子.
- 点击白名单时, 将该帖子写入白名单并恢复显示.
- 点击清空当前页时, 恢复当前页面全部已收纳帖子.

### 3.2 插件 popup

- 展示总开关.
- 展示当前页面最近一次统计: 已收纳数量, 扫描帖子数量.
- 提供快速添加关键词输入框.
- 点击保存时追加关键词规则.
- 提供打开完整设置页入口.
- 不刷新页面, 通过 storage 变更触发页面重新扫描.

### 3.3 options 设置页

- 管理关键词规则.
- 管理类别规则.
- 管理标签规则.
- 管理作者规则.
- 管理白名单.
- 支持单条规则启用和停用.
- 支持删除单条规则.
- 支持导出完整配置 JSON.
- 支持导入完整配置 JSON.
- 支持重置为默认配置.

## 4. 规则模型

### 4.1 配置键

- 使用 `chrome.storage.local` 的 `doTrashConfig` 保存配置.
- 使用 `chrome.storage.local` 的 `doTrashStats` 保存最近一次页面统计.

### 4.2 配置结构

```json
{
  "enabled": true,
  "ui": {
    "floatingSize": 42
  },
  "rules": {
    "keywords": [{ "value": "引流", "enabled": true }],
    "categories": [],
    "tags": [],
    "authors": []
  },
  "whitelist": {
    "topics": []
  }
}
```

### 4.3 匹配规则

- 关键词匹配标题.
- 类别匹配列表页可见类别文本.
- 标签匹配列表页可见标签文本.
- 作者匹配列表页可见用户标识.
- 白名单匹配 topic id, 帖子链接, 标题.
- 所有匹配默认忽略大小写.
- 任一启用规则命中即收纳.
- 白名单优先级高于收纳规则.

## 5. 技术方案

### 5.1 文件结构

```text
do-trash/
├── assets/
│   ├── icon-16.png
│   ├── icon-32.png
│   ├── icon-48.png
│   ├── icon-128.png
│   └── floating-icon.png
├── manifest.json
├── content.js
├── popup.html
├── popup.js
├── options.html
├── options.js
└── do-trash (Chrome 插件版) 开发文档.md
```

### 5.2 manifest

- 使用 Manifest V3.
- 声明 `storage` 权限.
- 声明 `https://linux.do/*` host permission.
- 声明 `content.js` 注入到 LINUX.DO.
- 声明 `popup.html` 作为 action popup.
- 声明 `options.html` 作为设置页.
- 声明 `assets/icon-*.png` 作为扩展图标.
- 声明 `assets/floating-icon.png` 作为 content script 可访问资源.
- 不声明 `tabs` 权限.

### 5.3 content script

- 读取 `doTrashConfig`.
- 创建页面悬浮垃圾桶.
- 使用 `assets/floating-icon.png` 作为页面悬浮按钮和面板品牌图标.
- 扫描 `tr.topic-list-item` 及兼容选择器.
- 从帖子 DOM 提取 title, url, topic id, category, tag, author.
- 计算命中原因.
- 隐藏命中帖子并写入当前页面收纳列表.
- 使用 `MutationObserver` 监听动态加载.
- 使用 debounce 限制重复扫描.
- 监听 `chrome.storage.onChanged`, 配置变化后重新扫描.
- 使用 DOM API 创建用户可见内容, 禁止把帖子标题直接拼进 `innerHTML`.

### 5.4 popup

- 读取 `doTrashConfig` 和 `doTrashStats`.
- 切换 `enabled`.
- 追加关键词规则.
- 打开 options 设置页.
- 只写 storage, 不直接操作网页 DOM.

### 5.5 options

- 读取并规范化配置.
- 渲染各规则列表.
- 新增, 删除, 启停规则后立即保存.
- 导入配置前校验 JSON 结构.
- 重置配置时要求用户确认.

## 6. 验收标准

- 扩展能通过 Chrome 扩展页以开发者模式加载.
- 打开 LINUX.DO 列表页后出现垃圾桶按钮.
- 默认关键词能隐藏命中标题的帖子.
- 收纳数量与面板列表一致.
- 还原操作能恢复当前页面帖子.
- 白名单操作能恢复当前页面帖子, 并在重新扫描后保持不收纳.
- popup 总开关能即时启停过滤.
- popup 能追加关键词并触发页面重新扫描.
- options 能新增, 删除, 启停各类规则.
- options 能导出和导入配置.
- options 能重置默认配置.
- JS 文件通过语法检查.
- manifest JSON 通过解析检查.

## 7. 已知限制

- LINUX.DO 如果调整帖子列表 DOM 结构, 需要更新选择器.
- 作者规则只匹配列表页可见用户数据, 不保证等同于原帖作者.
- 当前页面还原只在本次页面会话中生效, 刷新后仍按规则重新判断.
- 垃圾桶记录只表示当前页面扫描结果, 不作为跨页面历史记录.

## 8. 开发顺序

- 先实现 manifest 与 content script.
- 再实现 popup 快捷控制.
- 再实现 options 完整设置.
- 最后执行 JSON 解析, JS 语法检查, 本地加载检查.
