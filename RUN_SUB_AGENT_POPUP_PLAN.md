# run_sub_agent 弹窗与全屏展示方案（ui-prompt-server / shell-server）

> 目标：当对话界面里的 `run_sub_agent` 触发 MCP 工具时，提供一致、可扩展的弹窗体验；对 `shell-server` 的长会话（如 `npm run dev`）提供可持续的可视化与控制能力，并支持“全屏化”展示。

## 1. 覆盖范围

- MCP server：
  - `ui-prompt-server.js`（工具：`prompt_key_values`, `prompt_choices`）
  - `shell-server.js`（工具：`run_shell_command`, `session_run`, `session_capture_output`, `session_send_input`, `session_send_signal`, `session_kill`, `session_list`）
- 触发点：对话界面的 `run_sub_agent` 调用上述 MCP 工具。
- 展示目标：
  - 弹窗提示（轻量、可忽略）
  - 全屏或大面板（可持续交互、长时间停留）

## 2. 现有数据/事件来源（作为设计约束）

### 2.1 UI Prompt（ui-prompt-server）
- Prompt 请求会写入 `ui-prompts.jsonl`：
  - 路径由 `resolveUiPromptsPath(sessionRoot)` 决定（默认在 state dir）。
- UI 已有基础能力：`UiPromptsSmileHub` + `FloatingIslandPrompt`。
- 事件通道：`uiPrompts:read`, `uiPrompts:update`, `uiPrompts:respond`（Electron IPC 已有）。

### 2.2 Shell Session（shell-server）
- `session_run` 创建/复用“持久会话”，并落盘：
  - `sessions/<session>.output.log`
  - `sessions/<session>.status.json`
  - `sessions/<session>.control.jsonl`
- `session_capture_output` 读取日志 tail，适合 UI 拉取。
- `session_list` 可列出所有会话及运行状态。

> 结论：UI Prompt 已有事件与 UI；Shell Session 需要“可视化/流式/控制”的 UI，并建议新增一个“会话面板 + 全屏终端”。

## 3. 交互总体模型

### 3.1 弹窗分层
- **轻量弹窗（Toast / Small Card）**：
  - 用于提示“有待处理的 UI Prompt”或“新建/更新了 shell session”。
  - 不打断聊天流，右下/右上角堆叠。
- **交互弹窗（Floating / Drawer）**：
  - UI Prompt 使用右侧抽屉或浮岛（已有）。
  - Shell session 提供侧边“终端面板”入口。
- **全屏展示**：
  - UI Prompt：全屏抽屉/模态，左侧列表 + 右侧详细表单。
  - Shell session：全屏“终端视图”，支持持续输出与输入。

### 3.2 触发优先级
1) UI Prompt（阻塞类：确认/填写）优先于 Shell Session提示。
2) Shell Session 若为 `session_run`，优先提示“已启动会话 + 打开终端”。
3) `run_shell_command` 仅在失败或超长输出时弹出“查看详情”。

## 4. UI Prompt 弹窗/全屏方案

### 4.1 轻量弹窗（提示）
- 触发：`uiPrompts:update` 事件新增未完成 prompt。
- 展示内容：
  - 标题（prompt.title 或默认文案）
  - 类型标签（kv / choice / file_change_confirm / task_confirm）
  - 关联 runId / source（若有）
  - CTA：`立即处理` / `稍后`

### 4.2 交互弹窗（默认）
- 使用现有 `UiPromptsSmileHub` Drawer：
  - 左：待办列表
  - 右：`FloatingIslandPrompt` 内容
- 在对话界面中添加“提示入口按钮”（角标）。

### 4.3 全屏模式（建议新增）
- 打开方式：
  - Drawer 顶部 “全屏”按钮
  - 或快捷键（如 `Cmd/Ctrl + Shift + P`）
- 布局：
  - 左侧：prompt 列表（可折叠）
  - 右侧：表单主体（占 70%~100% 宽度）
- 行为：
  - `Esc` 退出全屏
  - 支持键盘提交（Enter/Shift+Enter）

## 5. Shell Session 弹窗/全屏方案（重点）

### 5.1 会话卡片（轻量提示）
- 触发：
  - 发现 `mcp_shell_tasks_session_run` 结果（tool_result）。
- 展示内容：
  - Session 名称（sessionName）
  - 命令与 cwd
  - 状态（running / exited / reused）
  - CTA：`打开终端` / `查看日志`

### 5.2 侧边终端面板（默认交互）
- 形态：右侧 Drawer 或 Bottom Sheet。
- 内容区：
  - 终端日志窗口（只读，自动尾随）
  - 输入框 + “发送”(session_send_input)
  - 控制区：`Stop(SIGINT)` / `Kill(SIGTERM)` / `Restart(session_run)`
- 数据更新策略：
  - 优先：轮询 `session_capture_output`（1~2s）
  - 进阶：新增 IPC watcher 直接读取 output.log（低延迟）
- 关键功能：
  - Follow Tail（自动滚动）
  - 暂停滚动（Scroll lock）
  - 清屏（仅 UI，不影响实际输出）

### 5.3 全屏终端（长会话推荐）
- 触发：
  - “打开终端”按钮
  - `session_run` 若命令为 dev/server/watch 类，可直接打开全屏。
- 布局：
  - 顶部：会话信息栏（session/cwd/命令/状态）
  - 主体：终端输出（高可读字体、支持复制）
  - 底部：输入区 + 控制按钮
- 控制动作映射：
  - `Ctrl+C` → `session_send_signal(SIGINT)`
  - `Stop` → `session_send_signal(SIGTERM)`
  - `Kill` → `session_send_signal(SIGKILL)`
  - `Send` → `session_send_input`（enter=true）

### 5.4 会话生命周期与异常处理
- Session 不存在：提示“会话已结束/不存在”，可提供 `重新启动`。
- Session 退出：
  - 顶部状态变为 exited，并显示 exitCode。
  - 提供“清理面板”或“重新运行”。
- output.log 过大：
  - UI 仅保留最近 N 行（默认 500~2000）
  - 可手动 “加载更多”（继续拉 `session_capture_output`）

## 6. 对话流中的呈现原则

- **工具调用结果**默认继续以“工具消息”形式展示在对话流中（简洁摘要）。
- 若结果为 `session_run`：
  - 在对话内显示简短摘要 + “打开终端”按钮。
- 若结果为 `run_shell_command` 且输出过长：
  - 展示首尾摘要 + “查看完整输出”链接，打开终端面板。

## 7. 事件与数据流（建议实现）

### 7.1 UI Prompt
1) MCP tool 触发 → ui-prompts.jsonl 写入 request
2) Electron watcher → `uiPrompts:update`
3) UI 展示弹窗 + 待办列表
4) 用户提交 → `uiPrompts:respond` 写入 response

### 7.2 Shell Session（建议新增 IPC）
- 新增 channel（可选）：
  - `shellSessions:list` → 内部调用 `session_list`
  - `shellSessions:tail` → 内部调用 `session_capture_output`
  - `shellSessions:send` → `session_send_input`
  - `shellSessions:signal` → `session_send_signal`
  - `shellSessions:kill` → `session_kill`
- 或复用现有工具调用链，让 UI 通过 tool result 再触发 MCP 工具请求。

## 8. UI 组件建议

- `PromptToast`：轻量提示
- `ShellSessionCard`：对话流内摘要
- `ShellTerminalDrawer`：侧边终端
- `ShellTerminalFullscreen`：全屏终端

## 9. 体验优化建议

- 自动识别长会话命令（dev/server/watch）→ 自动打开终端或提示。
- 当 UI Prompt 与 Shell Session 同时出现：
  - Prompt 优先浮出，终端提示弱化但保留入口。
- 日志中检测 “端口信息” 可显示访问链接（仅提示，不强依赖）。

## 10. 落地顺序建议

1) UI Prompt：仅补全“全屏按钮/模式”（基于现有 Drawer）。
2) Shell Session：先实现侧边终端面板（轮询 capture_output）。
3) Shell Session：追加全屏终端 + 控制区。
4) Shell Session：优化日志流（IPC watcher）。

---

该方案以当前代码结构为基础（ui-prompt 已有基础能力，shell session 有落盘日志），优先补齐“长会话可视化与可控”的体验，并保持对话流最小打断。若需要，我可以进一步给出具体的组件结构或 IPC 接口草图。
