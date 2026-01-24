# MCP Tool Response Spec (chatos)

本文档描述 MCP 工具统一的响应结构与状态/错误约定。目标是在不破坏现有工具返回字段的前提下，补充统一的元信息（`structuredContent.chatos`），便于日志、追踪与解析。

## 响应结构
工具应返回以下结构（MCP SDK 约定）：

```json
{
  "content": [
    {
      "type": "text",
      "text": "可读文本结果"
    }
  ],
  "structuredContent": {
    "...工具自有字段": "...",
    "chatos": {
      "status": "ok",
      "code": "optional_code",
      "error": {
        "message": "错误描述",
        "type": "ErrorType",
        "code": "optional_code",
        "details": {}
      },
      "server": "mcp_server_name",
      "tool": "tool_name",
      "trace": {
        "traceId": "trace_xxx",
        "spanId": "span_xxx",
        "parentSpanId": "span_xxx"
      },
      "ts": "2026-01-24T12:34:56.789Z"
    }
  }
}
```

说明：
- `content` 为可读文本；`structuredContent` 为结构化数据。
- `structuredContent` 中的工具自有字段保持原样（兼容旧逻辑）。
- `structuredContent.chatos` 为统一元信息；字段可选、可扩展。

## status 规范
建议使用以下状态值（小写）：
- `ok`
- `error`
- `canceled`
- `not_found`
- `invalid`
- `denied`
- `timeout`
- `partial`
- `noop`

如果工具已有 `structuredContent.status`，则 `chatos.status` 会跟随该值；否则默认 `ok`。

## error code 规范
推荐的 `code` 值（可按需扩展）：
- `invalid_argument`
- `not_found`
- `permission_denied`
- `timeout`
- `conflict`
- `internal`
- `not_supported`
- `rate_limited`

## 日志字段建议
日志/事件中建议统一携带：
- `runId` / `sessionId`
- `server` / `tool`
- `status` / `code`
- `trace`（traceId/spanId/parentSpanId）
- `elapsedMs`
- `size`（文本/结构体裁剪后大小）

## 实现约定
当前实现通过 `packages/aide/mcp_servers/shared/tool-helpers.js` 统一注入 `structuredContent.chatos` 元信息：
- `structuredResponse(text, payload)` 会自动补充 `chatos`。
- 保持 `payload` 原有字段，避免破坏现有 prompt/解析。

如需扩展错误语义，可在工具内部使用 `errorResponse(...)` 生成标准错误结构。
