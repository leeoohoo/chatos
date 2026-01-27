# 内部 MCP 调用卡顿排查与修复方案

## 现象
- 调用内部 MCP 工具时偶发长时间无响应（卡住数十秒到数分钟甚至更久）。

## 初步定位（代码层面）
- 连接与工具发现没有超时保护：`packages/aide/src/mcp/runtime.js` 中 `client.connect` 与 `fetchAllTools` 是无超时等待，若 MCP 进程启动或握手异常会一直卡住。
- 默认超时过长 + 个别工具禁用超时：`packages/aide/src/mcp/runtime/timeouts.js` 默认 1h/2h，且 `ui_prompter`/`code_writer`/`shell_tasks` 等被禁用超时，服务端卡死时会长时间等待。
- UI prompt 异步等待超时上限过长：`waitForUiPromptResult` 默认沿用 `maxTotalTimeout`，UI 未响应会一直等待。

## 方案
1. 观测与定位
   - 打开 MCP 工具日志（设置 `MODEL_CLI_MCP_TOOL_LOG` + `MODEL_CLI_MCP_LOG_LEVEL=info`），记录每次 tool 调用的耗时与错误。
   - 结合 `MODEL_CLI_EVENT_LOG`/`session-report.html` 统计卡顿发生在哪个 server/tool、发生在 connect/listTools 还是 callTool 阶段。

2. 连接/注册阶段防卡死
   - 为 `client.connect` 与 `listTools` 加超时封装（例如 10~30s），超时后主动关闭 transport 并记录错误。
   - 连接超时后触发一次可控重连；多次失败则降级为“该 MCP server 暂不可用”。

3. 调用超时策略收敛
   - 将默认 `MODEL_CLI_MCP_TIMEOUT_MS`/`MODEL_CLI_MCP_MAX_TIMEOUT_MS` 调整到合理区间（例如 60s/5m 或与文档一致）。
   - 在 admin.db 的 `mcpServers` 或 land_config 中对内部 server 显式设置 `timeout_ms`/`max_timeout_ms`，避免单个调用无限等待。
   - 复核 `shouldDisableToolTimeout`，只保留必须无限等待的工具，其他加上上限。

4. UI prompt 导致的等待
   - UI 未运行或用户未响应时，提前失败并给出提示；不要让 tool 调用无限等待。
   - 对需要确认的操作，提供“自动取消/回退”的兜底路径。

5. 慢调用告警与降级
   - 增加“慢调用”统计（例如 >10s 记录 warn），便于发现具体工具。
   - 对长耗时场景建议使用异步/会话式工具（如 shell session）。

## 验证
- 模拟 MCP 进程卡住或不返回（sleep / 不响应），确认 connect/listTools 会超时且记录日志。
- 对超时禁用工具做压力测试，确认超时策略与降级提示生效。
- 线上复测：连续调用内部 MCP 100 次，统计卡顿率与超时分布。
