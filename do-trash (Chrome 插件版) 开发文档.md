# do-trash Chrome 插件版开发文档

## 1. 产品结论

- 建设一个本地自用 Chrome Manifest V3 扩展.
- 仅在 `https://linux.do/*` 页面运行.
- 自动把命中规则的帖子从首页, 列表页和搜索页隐藏, 默认放入页面悬浮垃圾桶.
- 使用 `chrome.storage.local` 保存配置, 不建设服务端, 不上传数据.
- 当前交付范围: 关键词, 类别, 标签, 作者规则, 页面垃圾桶, popup 快捷控制, options 完整设置, 配置导入导出.
- 默认不内置任何过滤关键词, 规则完全由用户自行填写.

## 2. 固定边界

- 只处理 LINUX.DO 页面内可见的帖子列表和搜索结果 DOM.
- 只根据页面可见信息匹配: 标题, 类别, 标签, 可见用户信息, 帖子链接, topic id.
- 不读取私信, 不发帖, 不回复, 不修改论坛账号数据.
- 不跨站运行, 不申请宽泛站点权限.
- 不依赖远程接口作为主流程.
- 不把隐藏结果永久写入论坛状态, 所有行为只发生在本地浏览器.
- 不维护长期白名单, 避免配置数据随浏览历史持续膨胀.

## 3. 页面与功能

### 3.1 LINUX.DO 页面内垃圾桶

- 在页面右侧创建悬浮垃圾桶按钮.
- 支持拖拽悬浮按钮.
- 拖拽松手后自动吸附到左右边缘.
- 使用 `chrome.storage.local` 记忆悬浮按钮位置.
- 默认悬浮图标大小为 `38px`.
- 支持通过 popup 关闭悬浮垃圾桶入口.
- 关闭悬浮垃圾桶后, 页面过滤继续生效, 但不展示悬浮按钮, 计数角标和垃圾桶面板.
- 在按钮上显示当前页面已隐藏数量.
- 角标使用浅色强调样式, 并根据左右贴边方向自动切换到内侧, 避免被屏幕边缘遮挡.
- 点击按钮展开当前页垃圾桶面板.
- 面板围绕悬浮按钮展开, 左侧贴边向右展开, 右侧贴边向左展开.
- 面板高度根据视口自适应, 桌面最多约 `620px`, 超出后仅列表区域滚动.
- 在面板中展示当前页已隐藏帖子列表.
- 每条隐藏记录展示标题, 命中原因, 操作按钮.
- 点击标题打开原帖.
- 点击还原时, 当前页面立即恢复该帖子.
- 点击恢复全部时, 恢复当前页面全部已隐藏帖子.
- 当前页面还原只在本次页面会话中生效, 刷新后仍按规则重新判断.

### 3.2 插件 popup

- 展示总开关.
- 展示当前页面最近一次统计: 已隐藏数量, 扫描帖子数量.
- 提供悬浮垃圾桶显示开关.
- 提供快速添加关键词输入框.
- 点击添加时追加关键词规则.
- 提供悬浮图标快捷调整入口.
- 悬浮图标快捷调整支持减小, 增大, 重置.
- 悬浮图标大小调整立即写入 storage, 已打开的 LINUX.DO 页面实时同步.
- 提供打开完整设置页入口.
- 不刷新页面, 通过 storage 变更触发页面重新扫描.

### 3.3 options 设置页

- 管理关键词规则.
- 管理类别规则.
- 管理标签规则.
- 管理作者规则.
- 支持单条规则启用和停用.
- 支持删除单条规则.
- 支持导出完整配置 JSON.
- 支持导入完整配置 JSON.
- 支持重置为默认配置.
- 不提供悬浮图标大小调整, 避免与 popup 快捷调整重复.

## 4. 规则模型

### 4.1 配置键

- 使用 `chrome.storage.local` 的 `doTrashConfig` 保存配置.
- 使用 `chrome.storage.local` 的 `doTrashStats` 保存最近一次页面统计.
- 使用 `chrome.storage.local` 的 `doTrashPosition` 保存悬浮垃圾桶位置.

### 4.2 配置结构

```json
{
  "schemaVersion": 1,
  "enabled": true,
  "ui": {
    "floatingSize": 38,
    "showFloating": true
  },
  "rules": {
    "keywords": [],
    "categories": [],
    "tags": [],
    "authors": []
  }
}
```

### 4.3 匹配规则

- 关键词匹配帖子标题.
- 类别匹配页面可见类别文本.
- 标签匹配页面可见标签文本.
- 作者匹配页面可见用户标识.
- 所有匹配默认忽略大小写.
- 任一启用规则命中即隐藏.
- 如果当前页用户手动还原某帖子, 本次页面会话内不再再次隐藏该帖子.

## 5. 技术方案

### 5.1 文件结构

```text
do-trash/
├── assets/
│   ├── icon-16.png
│   ├── icon-32.png
│   ├── icon-48.png
│   ├── icon-128.png
│   ├── icon-source-trimmed.png
│   └── floating-icon.png
├── manifest.json
├── content.js
├── popup.html
├── popup.js
├── options.html
├── options.js
├── README.md
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

- 读取并规范化 `doTrashConfig`.
- 根据 `ui.showFloating` 创建或移除页面悬浮垃圾桶.
- 使用 `assets/floating-icon.png` 作为页面悬浮按钮和面板品牌图标.
- 支持扩展重新加载后的 `Extension context invalidated` 保护, 旧实例自动停止并清理 UI.
- 扫描首页, 列表页和搜索页常见帖子容器.
- 支持 `tr.topic-list-item`, `.topic-list-item`, `.fps-result`, `.search-results .search-result`, `.search-results [data-topic-id]` 等选择器.
- 从帖子 DOM 提取 title, url, topic id, category, tag, author.
- 计算命中原因.
- 隐藏命中帖子并写入当前页面隐藏列表.
- 使用 `MutationObserver` 监听动态加载.
- 使用 debounce 限制重复扫描.
- 监听 `chrome.storage.onChanged`, 配置变化后重新扫描.
- 使用 DOM API 创建用户可见内容, 禁止把帖子标题直接拼进 `innerHTML`.

### 5.4 popup

- 读取 `doTrashConfig` 和 `doTrashStats`.
- 切换 `enabled`.
- 切换 `ui.showFloating`.
- 追加关键词规则.
- 快捷调整悬浮图标大小.
- 打开 options 设置页.
- 只写 storage, 不直接操作网页 DOM.

### 5.5 options

- 读取并规范化配置.
- 渲染关键词, 类别, 标签, 作者规则列表.
- 新增, 删除, 启停规则后立即保存.
- 导入配置前校验 JSON 结构.
- 重置配置时要求用户确认.

## 6. 验收标准

- 扩展能通过 Chrome 扩展页以开发者模式加载.
- 打开 LINUX.DO 首页, 列表页或搜索页后默认出现垃圾桶按钮.
- 关闭悬浮垃圾桶后, 页面不显示垃圾桶按钮, 但命中规则的帖子仍会被隐藏.
- 用户添加关键词后, 命中标题的帖子会被隐藏.
- 类别, 标签, 作者规则能按页面可见信息隐藏帖子.
- 已隐藏数量与面板列表一致.
- 还原操作能恢复当前页面帖子.
- 恢复全部操作能恢复当前页面全部已隐藏帖子.
- popup 总开关能即时启停过滤.
- popup 能追加关键词并触发页面重新扫描.
- popup 能快捷调整悬浮图标大小, 页面端实时同步.
- options 能新增, 删除, 启停各类规则.
- options 能导出和导入配置.
- options 能重置默认配置.
- 默认配置不内置过滤关键词.
- JS 文件通过语法检查.
- manifest JSON 通过解析检查.

## 7. 已知限制

- LINUX.DO 如果调整帖子列表或搜索页 DOM 结构, 需要更新选择器.
- 作者规则只匹配页面可见用户数据, 不保证等同于原帖作者.
- 当前页面还原只在本次页面会话中生效, 刷新后仍按规则重新判断.
- 垃圾桶记录只表示当前页面扫描结果, 不作为跨页面历史记录.
- 搜索页过滤基于页面渲染出的搜索结果 DOM, 不调用搜索接口.

## 8. 开发顺序

- 先实现 manifest 与 content script.
- 再实现 popup 快捷控制.
- 再实现 options 完整设置.
- 再补充图标, 拖拽吸附, 面板体验和搜索页适配.
- 最后执行 JSON 解析, JS 语法检查, 本地加载检查.
