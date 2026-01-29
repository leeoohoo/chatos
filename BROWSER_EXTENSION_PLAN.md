# Chatos 浏览器插件（Chrome / MV3）方案

## 可行性结论
可行。Chrome 扩展（Manifest V3）支持注入页面脚本、读取页面文本、与后台服务通信并调用远端 API。翻译与总结属于“页面内容处理 + 结果展示”类能力，技术成熟、实现成本可控。

> 说明：下面方案假设 Chatos 提供可用的 HTTP API（或内部网关）。如需对接现有服务，请在「对接接口」部分确认并补充字段。

---

## 目标与范围（v0.1）
**核心功能**
1. 翻译当前页面
2. 总结当前页面

**非目标（v0.1 不做）**
- 多文档批量处理
- 复杂的可视化编辑器
- 多用户协作 / 分享

---

## 用户流程（建议）
**翻译当前页面**
1. 用户点击插件图标 → 选择目标语言
2. 点击“翻译当前页面”
3. 插件提取可见文本 → 调用 Chatos → 回写翻译
4. 可切换“显示原文/翻译”、一键还原

**总结当前页面**
1. 用户点击插件图标 → 选择“总结当前页面”
2. 插件提取主内容（Readability）
3. 调用 Chatos → 在侧边栏或弹窗展示摘要
4. 支持摘要长度（短/中/长）与语言

---

## 架构设计（MV3）
**组件划分**
- `content script`：
  - 提取页面文本、过滤不可见元素、标记文本节点
  - 负责原文/译文切换与 DOM 回写
- `background service worker`：
  - 管理 API 调用、鉴权 token、请求队列与重试
  - 规避页面 CORS（统一从后台发起请求）
- `popup / side panel`：
  - 用户交互（按钮、目标语言、摘要长度）
  - 展示摘要结果、错误提示
- `storage`：
  - 保存用户配置（目标语言、摘要偏好、模型）

**数据流**
1. UI → background：下发任务
2. background → content script：请求页面内容
3. content script → background：返回文本 payload
4. background → Chatos API：翻译/总结
5. background → content script / UI：回写翻译/显示摘要

---

## 页面文本提取策略
**翻译**
- 遍历可见文本节点（过滤 `script/style/code/pre/input/textarea`）
- 按 DOM 顺序收集，避免跨段拼接破坏上下文
- 分块（建议每 2k–4k 字符一块）
- 为每个文本节点建立 `nodeId -> text` 映射，方便回写与还原

**总结**
- 优先使用 Readability 提取正文
- 无正文时退化为可见文本拼接
- 加入标题与 URL 作为上下文提示

---

## 与 Chatos 对接接口（建议）
> 如已有接口，请将下列建议映射到现有 API。

### 1) 翻译
**POST** `/api/translate`
```json
{
  "sourceLang": "auto",
  "targetLang": "zh-CN",
  "items": ["text chunk 1", "text chunk 2"]
}
```
**Response**
```json
{
  "translations": ["译文1", "译文2"],
  "meta": {"model": "xxx", "usage": {"tokens": 1234}}
}
```

### 2) 总结
**POST** `/api/summarize`
```json
{
  "language": "zh-CN",
  "length": "short|medium|long",
  "content": "full page text",
  "title": "page title",
  "url": "https://example.com"
}
```
**Response**
```json
{
  "summary": "...",
  "bullets": ["...", "..."],
  "meta": {"model": "xxx", "usage": {"tokens": 567}}
}
```

---

## Chrome 扩展清单（Manifest V3）
**权限建议**
- `activeTab`：当前页临时访问
- `scripting`：注入脚本
- `storage`：保存设置
- `sidePanel`：侧边栏展示摘要（可选）
- `host_permissions`: Chatos API 域名（如 `https://api.chatos.example/*`）

---

## 交互与 UI 方案
**Popup**（默认）
- 目标语言选择
- “翻译当前页面”按钮
- “总结当前页面”按钮
- 状态/进度/错误提示

**Side Panel**（可选）
- 展示摘要与历史
- 复制/分享/反馈

---

## 异常与边界处理
- **超长页面**：分块 + 并发限制（如 3~5 并发）
- **动态页面**：监听 DOM 变化，提示“页面内容已变化，是否重新翻译”
- **表单/输入框**：禁止修改，避免破坏交互
- **权限/鉴权失败**：提示登录或重新授权
- **请求失败**：展示错误码 + 重试按钮

---

## 安全与隐私
- 仅在用户触发时发送页面内容
- 默认不持久化原文与译文
- 提供“脱敏模式”（可选）：移除邮箱/手机号/身份证等敏感信息

---

## 里程碑与交付（建议）
**M1 - 原型（1–2 周）**
- 基础 UI + 总结功能（Readability + Chatos API）

**M2 - 翻译（1–2 周）**
- 可见文本提取 + 回写翻译

**M3 - 稳定性（1 周）**
- 分块、重试、缓存、性能优化

**M4 - 发布准备（1 周）**
- 文档 + Chrome Web Store 资料

---

## 验收标准（v0.1）
- 一键完成当前页翻译，支持还原
- 一键生成摘要，可在 UI 中查看/复制
- 错误信息清晰、可重试
- 对接 Chatos API 成功、性能可接受

---

## 需要你确认的信息
1. Chatos 的 API 基础地址与鉴权方式
2. 目标语言默认值（如：中文）
3. 是否需要在企业内网环境运行
4. UI 形态偏好：仅 popup 还是 side panel

