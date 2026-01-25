# Design Fix Plan (Chatos)

## Goals
- Reduce duplicated logic across Electron, CLI, and MCP servers.
- Isolate responsibilities in large modules.
- Introduce shared abstractions to keep behavior consistent.

## Hotspots (evidence)
- Duplicate chat attachment normalization in `electron/chat/index.js:86`, `electron/chat/runner-helpers.js:36`, `electron/chat/runner.js:223`.
- Duplicate MCP prompt name normalization in `packages/common/host-app.js:17`, `packages/aide/src/mcp/prompt-binding.js:3`, `electron/chat/runner-helpers.js:21`, `electron/chat/runner.js:208`, `electron/main-helpers.js:110`, `electron/ui-apps/ai.js:131`.
- Duplicate prompt concatenation in `cli/src/index.js:263`, `electron/chat/runner.js:288`, `packages/aide/mcp_servers/subagent-server.js:95`.
- Duplicate engine-module resolving logic in `electron/main.js:65`, `electron/chat/runner.js:20`, `electron/chat/tool-selection.js:15`, `packages/aide/mcp_servers/subagent-server.js:27`.
- Duplicate trace meta normalization in `electron/chat/runner.js:178`, `packages/aide/src/tools/builtin.js:556`, `packages/aide/src/mcp/runtime.js:1625`, `packages/aide/mcp_servers/subagent-server.js:123`.
- Duplicate token estimation for summaries in `packages/aide/src/chat/summary.js:194` and `packages/aide/src/tools/builtin.js:659`.
- Very large files with mixed responsibilities: `electron/chat/runner.js:1`, `packages/aide/src/mcp/runtime.js:1`, `packages/aide/mcp_servers/lsp-bridge-server.js:1`, `packages/aide/mcp_servers/subagent-server.js:1`, `packages/aide/mcp_servers/task-server.js:1`, `packages/common/aide-ui/components/GlobalStyles.jsx:1`, `packages/common/aide-ui/components/MarkdownBlock.jsx:1`.

## Plan
### Phase 1: Consolidate shared utilities (low risk)
- Create `packages/common/mcp-utils.js` (or extend `packages/common/host-app.js`) with:
  - `normalizeMcpServerName`, `normalizePromptLanguage`, `getMcpPromptNameForServer`.
  - Update `electron/chat/runner.js`, `electron/chat/runner-helpers.js`, `electron/main-helpers.js`, `electron/ui-apps/ai.js`, `packages/aide/src/mcp/prompt-binding.js` to import from the shared module.
- Create `packages/common/chat-utils.js` (or move into `electron/chat/runner-helpers.js`) with:
  - `normalizeImageAttachments`, `buildUserMessageContent`.
  - Replace duplicate implementations in `electron/chat/index.js`, `electron/chat/runner.js`.
- Create `packages/common/trace-utils.js` with `normalizeTraceValue` + `extractTraceMeta`.
  - Replace duplicates in `packages/aide/src/tools/builtin.js`, `packages/aide/src/mcp/runtime.js`, `packages/aide/mcp_servers/subagent-server.js`, `electron/chat/runner.js`.

### Phase 2: Shared engine-module resolver
- Add `src/engine-loader.js` or extend `src/engine-paths.js` to export `resolveEngineModule` + `importEngine`.
- Update `electron/main.js`, `electron/chat/runner.js`, `electron/chat/tool-selection.js`, `packages/aide/mcp_servers/subagent-server.js` to use it.

### Phase 3: MCP server bootstrap abstraction
- Introduce `packages/aide/mcp_servers/shared/server-bootstrap.js`:
  - Parses args, resolves session root, sets up logging, dedupe store, common env defaults.
  - Exposes `createMcpServer({ name, version, registerTools })`.
- Refactor `task-server.js`, `subagent-server.js`, `project-journal-server.js`, `ui-prompt-server.js`, `filesystem-server.js`, `shell-server.js`, `lsp-bridge-server.js` to use the bootstrap and isolate tool registration into separate modules.
- Consolidate duplicated FS helpers (e.g., `ensureDir`, `clampNumber`) into `shared/fs-utils.js` used by servers.

### Phase 4: Break up monoliths
- `electron/chat/runner.js`: split into `engine-loader`, `prompt-utils`, `message-utils`, `error-utils`, and `runner-core` modules.
- `packages/aide/src/mcp/runtime.js`: split into `registry`, `transport`, `tool-exec`, `logging`, `timeouts` modules (some already exist).
- `packages/common/aide-ui/components/GlobalStyles.jsx` and `MarkdownBlock.jsx`: split into smaller modules (`theme-tokens`, `markdown-renderer`, `code-highlight`) to improve reuse and testability.

### Phase 5: Validation
- Add unit tests for shared utils (prompt naming, trace meta, image attachments).
- Smoke-test CLI + Electron flows to ensure no regression in prompt selection and tool logging.

## Rollout
- Prioritize Phase 1-2 first (low risk, high dedupe).
- Tackle MCP server bootstrap (Phase 3) next.
- Finish with large module splits (Phase 4), which likely need deeper QA.
