# MCP Server 优化方案（草案）

## 背景与参考
当前仓库未发现 `doc/` 目录或 `doc/tools` 包；以下方案基于现有实现与约定：
- `packages/aide/src/tools/*` 的工具注册/元数据模型（name/description/parameters/handler）。
- 各 MCP server 的 `register-tools.js` 结构与 `textResponse/structuredResponse` 输出约定。
- 现有 runtime/settings 机制与日志工具（JSONL 记录）。

如有独立的 `doc/tools` 资料，请补充路径，我会按文档再校准细节。

## 目标
- 统一 MCP 工具的元数据、输入校验、输出结构与错误语义。
- 提升安全性与可控性（路径、权限、资源上限、敏感信息处理）。
- 提升可观测性（可追踪、可分析、可回放）。
- 提升性能与稳定性（并发控制、缓存、超时与取消）。

## 总体方案
### 1. 通用层（对齐 tools 包方法）
- 抽象公共工具注册包装：统一 tool 元信息、输入 schema、标准化 structuredContent（status/code/data/error）。
- 统一错误映射与错误码（zod 校验失败、权限拒绝、超时、资源超限、执行异常）。
- 统一日志字段：runId/sessionId/toolName/elapsedMs/size，日志写入前做脱敏与大小裁剪。

### 2. 核心 MCP servers 优化
- `shell-server`：
  - 增加“严格模式/宽松模式”配置，明确扩展语法策略与用户提示。
  - 增强命令预检查（常见危险参数、输出大小预估、pipe/redirect 指示）。
  - 输出分段与截断规则统一，保留退出码/信号/耗时元信息。

- `filesystem-server` / `code-maintainer-server`：
  - 统一读写大小上限、二进制探测、行数/字符数截断策略。
  - 强化路径与符号链接策略（可选禁止跨根目录 symlink 跳转）。
  - 统一 diff 生成与日志写入格式，减少重复实现。

- `task-server` / `project-journal-server`：
  - 明确幂等策略与去重键（避免重复任务/事件写入）。
  - 引入简单并发限制/批量写入，避免高频调用写放大。

- `ui-prompt-server`：
  - 统一请求/响应记录格式与清理策略（含超时与清理未响应 request）。
  - 提供“最小化日志模式”配置（只记录 prompt 元信息）。

- `subagent-server`：
  - 引入 agent 配置“类型/模式”：
    - **自定义模式（Custom）**：可手动选择 MCP / 应用 / Prompt；与当前逻辑一致。
    - **Flow 模式（Land Config）**：仅选择一个 `land_config`；不再提供 agent 层面的 MCP/应用/Prompt 配置入口，完全按该 flow 执行。
  - Flow 模式下只读取 `land_config` 授权（主流程=main，子流程=sub）。
  - Custom 模式下，工具授权仍需有 `land_config` 作为基础授权（或按产品决策是否允许“无 land_config 的纯自定义”）。
  - 增加调用链 trace（主 agent -> 子 agent -> 工具），并统一写入日志与事件流。

- `lsp-bridge-server`：
  - 加入连接缓存与自动重连策略（避免频繁启动 LSP）。
  - 强化超时/取消控制，避免阻塞。

### 3. 运行时配置与文档
- 将关键开关落到 runtime settings（或 env）并在 UI 暴露：
  - 安全模式、日志级别、输出上限、文件大小上限、并发上限。
- 补充一份 MCP 工具约定文档（tool definition / response schema / error codes）。
- 明确工具授权来源优先级（建议）：`land_config` > agent/tool 配置 > 默认安全集（缺省禁用）。

### 4. 工具白名单/黑名单与调用链追踪（按 land_config 重设计）
- **授权来源**：根据 agent 配置模式决定：
  - Flow 模式：仅使用 land_config 的 main/sub 授权。
  - Custom 模式：在 land_config 基础上做收敛（取交集）。
- **主/子流程规则**：
  - main agent 仅能使用 main 流程允许的 MCP/tool。
  - sub agent 仅能使用 sub 流程允许的 MCP/tool（默认不允许递归 subagent router）。
- **缺省策略**：
  - Flow 模式：必须选择 land_config，否则拒绝派发并提示选择。
  - Custom 模式：建议仍要求 land_config 作为基础授权；如放行“无 land_config 自定义”，需明确风险与默认禁用策略。
- **trace 设计**：在 tool call `_meta` 注入 `traceId/spanId/parentSpanId`，并记录 `rootAgentId/agentId/subAgentId/toolName/runId/sessionId`，日志与事件流保持一致字段。

## 交付物（建议）
- `packages/aide/mcp_servers/shared/tool-helpers.js`（统一注册与响应封装）。
- `packages/aide/mcp_servers/shared/logging.js`（日志与脱敏/裁剪）。
- 各 server 对应的配置项与说明文档。
- 根目录 `MCP_SERVER_TOOL_SPEC.md`（工具协议/错误码/日志字段）。

## 推进顺序（可拆分提交）
1. 通用层抽象与文档规范。
2. 先覆盖 `shell/filesystem/task/ui-prompt` 四个核心 server。
3. 再覆盖 `subagent/lsp/project-journal/code-maintainer`。
4. 补充配置 UI 与示例。

## 风险与注意
- 某些行为变更会影响既有调用方，需要明确默认值与兼容策略。
- 统一结构化响应可能需要同步调整调用端解析逻辑。

