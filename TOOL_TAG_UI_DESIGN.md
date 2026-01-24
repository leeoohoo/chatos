# 对话页工具标签与弹层 UI 设计方案

## 背景与现状
- 目前对话页的工具调用展示在 `AssistantTurnCard` 中，通过 `PopoverTag`(AntD Tag + Popover) 展示。
- 标签样式较基础，弹层内容仅分“参数/结果”，缺少工具类型识别、状态感知与结构化展示。

## 目标
- 让工具标签“可扫读”：一眼知道工具类别、状态（成功/失败/等待/取消）和重要信息。
- 让弹层“可理解”：不同工具有对应布局与字段，减少纯文本堆叠。
- 不破坏现有数据流，兼容无结构化数据的情况，允许渐进式增强。
- 主题适配：浅色/深色均有清晰对比与层次。

## 设计总览
### 1) 统一的工具标签（ToolBadge）
- 视觉：圆角胶囊 + 渐变细描边 + 轻微阴影 + 状态点。
- 内容：`图标 + 工具简称 + 可选副标题`
- 状态点颜色：
  - ok/partial: 绿色
  - error/timeout: 红色
  - canceled/denied: 橙色
  - unknown: 灰色
- 工具类别颜色（示例）：
  - Shell: 蓝
  - Filesystem: 青
  - LSP: 紫
  - Tasks: 橙
  - Subagent: 靛
  - Prompt/UI: 粉
  - Browser/DevTools: 绿

### 2) 弹层结构（ToolPopover / ToolPanel）
- 顶部 Header：
  - 工具名 + 类别 Icon
  - 状态徽标（OK/ERROR/…）
  - 关键摘要（如路径/命令/URL）
  - 操作：复制、展开为 Drawer（长内容）
- 主体区域分区：
  - **摘要区**：关键字段卡片化展示
  - **参数区**：JSON/键值表视图，支持折叠
  - **结果区**：工具专属视图（详见下表）
  - **附加区**：structuredContent、trace、耗时等（可折叠）

### 3) 长内容的展示策略
- 默认 Popover 高度 360px，超过阈值显示“展开详情”按钮。
- 点击后使用 Drawer/Modal 展示完整内容（带目录/锚点）。

## 工具类型与对应界面
> 通过 `server/tool` 或 `toolName` 映射到类别，先做主类，再细分具体工具。

| 工具类别 | 典型工具 | 标签副标题 | 弹层要点 | 结果视图建议 |
| --- | --- | --- | --- | --- |
| Shell | run_shell_command, session_* | `cmd` 或 `session` | 显示 cwd、exitCode、耗时、stdout/stderr 统计 | Tab：stdout / stderr；命令高亮块；错误行红色标注 |
| Filesystem | read_file, write_file, edit_file, apply_patch, delete_path, list_directory, search_text | `path` | 显示目标路径、模式（overwrite/append） | 文件内容用代码块/带行号；diff 用统一 diff 视图；搜索结果用列表 |
| LSP | lsp_* | `symbol`/`file` | 显示文件、范围、语言 | 诊断列表/跳转位置表格 |
| Tasks | add_task, update_task, list_tasks | `task`/`batch` | 显示任务数量、优先级统计 | 任务卡片列表（标题/状态/优先级/标签） |
| Subagent | subagent_* | `agent` | 显示 agent 名称、执行阶段 | 子流程步骤时间线 + 关键输出摘要 |
| Prompt/UI | ui_prompt_* | `prompt` | 显示表单字段/选择项 | 表单结果回显（字段/选择） |
| Code maintainer | code_maintainer_* | `patch` | 影响文件数、diff 行数 | 文件变更列表 + diff 预览 |
| Project journal | project_journal_* | `entry` | 记录类型、时间 | 元信息表 + 内容摘要 |
| Browser/DevTools | chrome_* | `url` | URL、动作类型 | 截图预览 + DOM/console 摘要 |

## 数据与解析策略
- **优先使用 structuredContent**：已有 `structuredContent.chatos` 元信息，可直接提取 status/server/tool/trace。
- 若缺少结构化字段：
  - 从 `toolCall` 的 arguments 中提取 path/command 等关键字段作为摘要。
  - 从文本结果中解析常见格式（如 `exitCode:`、`Session:`、`diff --git`）。
- 增量改造建议：在消息数据层保留 `structuredContent` 进入 UI（字段名可为 `toolStructuredContent`）。

## 组件拆分建议
- `ToolBadge`：负责标签视觉与状态。
- `ToolPopover`：基础弹层容器（Header + Summary + Tabs）。
- `ToolRendererRegistry`：toolName -> renderer 映射。
- `renderers/`：
  - `ShellResultView`
  - `FilesystemResultView`
  - `LspResultView`
  - `TasksResultView`
  - `SubagentResultView`
  - `PromptResultView`
  - `CodeMaintainerResultView`
  - `DefaultResultView`

## 视觉细节（与现有主题变量对齐）
- 背景：使用 `--ds-panel-bg` / `--ds-panel-border` / `--ds-panel-shadow`。
- 标签：
  - 背景色透明度 0.12 ~ 0.18
  - 边框用渐变（主色 -> 辅色）
  - 状态点使用 `box-shadow: 0 0 0 3px` 增加识别度
- 内容区：
  - Card/Segmented 组件保持圆角 10-12px
  - 代码块背景使用 `--ds-code-bg`

## 交互与易用性
- 点击标签打开；再次点击关闭。
- 支持复制：命令/路径/输出。
- ToolPanel 内部滚动，避免遮挡对话流。

## 渐进式落地路径
1. 用 `ToolBadge + ToolPopover` 替换现有 `PopoverTag`，引入统一 Header + 状态。
2. 实现 Shell / Filesystem 两类 renderer（最常用）。
3. 接入 structuredContent，渲染状态/耗时/trace。
4. 扩展到 LSP/Tasks/Subagent 等类别。

## 风险与兼容
- 若数据不足，使用 `DefaultResultView` 回退到“参数 + 结果”文本展示。
- 对旧记录兼容：允许无 status/structuredContent 的纯文本工具调用。

