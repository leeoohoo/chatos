# Design Fix Plan v2 (Chatos)

## Goals
- Reduce cross-layer duplication introduced by the recent splits.
- Prefer shared reusable helpers before further file splits.
- Keep behavior consistent between Electron, CLI, MCP servers, and UI.

## Scan Highlights (duplication + overgrown modules)
- ID normalization exists in multiple places: `electron/chat/normalize.js`, `electron/backend/registry-center.js`, `packages/common/aide-ui/features/chat/hooks/useChatSessions.js`.
- MCP progress/step normalization is duplicated between `electron/chat/mcp-notifications.js` and `packages/common/aide-ui/features/chat/hooks/useChatSessions.js`.
- Subagent step stream merge logic is duplicated between `electron/chat/store.js` and `packages/common/aide-ui/features/chat/hooks/useChatSessions.js`.
- Subagent meta normalization is duplicated between `packages/aide/mcp_servers/subagent/async-jobs.js` and `packages/aide/mcp_servers/subagent/progress.js`.
- UI prompt schema normalization is duplicated between `electron/session-api.js` and `packages/aide/mcp_servers/ui-prompt-server.js`.
- Admin snapshot to file sync builders are duplicated between `electron/backend/sync.js` and `packages/common/admin-data/sync.js`.
- Text helpers like `safeTrim`/`normalizeTags` are repeated across multiple MCP servers.
- Context-length error detection appears in both `electron/chat/runner.js` and `packages/aide/src/chat/context-recovery.js`.
- Large modules still mixing responsibilities:
  - `electron/chat/runner.js`
  - `packages/aide/src/mcp/runtime.js`
  - `packages/aide/mcp_servers/lsp-bridge-server.js`
  - `packages/aide/mcp_servers/shell/register-tools.js`
  - `packages/aide/cli-ui/src/compact.mjs`
  - `packages/common/aide-ui/components/GlobalStyles.jsx`

## Plan
### Phase 1: Shared normalization + stream helpers (low risk, high reuse)
- Add `packages/common/text-utils.js`:
  - `safeTrim`, `normalizeId`, `normalizeTextList` (string arrays), `normalizeText`.
  - Re-export from `electron/chat/normalize.js` where possible to keep callers stable.
- Add `packages/common/chat-stream-utils.js`:
  - `normalizeStepsPayload`, `normalizeStepKey`, `mergeSubagentSteps`, `pickToolCallId`, `normalizeProgressKind`, `resolveProgressDone`.
  - Adopt in `electron/chat/mcp-notifications.js`, `electron/chat/store.js`, `packages/common/aide-ui/features/chat/hooks/useChatSessions.js`.
- Add `packages/aide/mcp_servers/subagent/meta-utils.js`:
  - `normalizeMetaValue` + `normalizeText` (backed by `normalizeTraceValue` when available).
  - Adopt in `packages/aide/mcp_servers/subagent/async-jobs.js` and `packages/aide/mcp_servers/subagent/progress.js`.
- Add `packages/common/ui-prompt-utils.js`:
  - `normalizeKvFields`, `normalizeChoiceOptions`, `normalizeChoiceLimits`, `normalizeTaskConfirmTasks`, `normalizePromptBase`.
  - Adopt in `electron/session-api.js` and `packages/aide/mcp_servers/ui-prompt-server.js`.

### Phase 2: Admin sync builder abstraction
- Extract shared helpers to `packages/common/admin-data/sync-helpers.js`:
  - `ensureDir`, `writeYaml`, `writeJson`, `buildModelsYamlPayload`, `buildMcpConfig`, `buildSubagentsPayload`.
  - Support capability flags to allow the richer `packages/common/admin-data/sync.js` shape while keeping Electron usage minimal.
- Update `electron/backend/sync.js` to import shared helpers (avoid drift).

### Phase 3: Interface-driven splits for the remaining monoliths
- `packages/aide/src/mcp/runtime.js`:
  - Split into `runtime/transports`, `runtime/tool-exec`, `runtime/stream`, `runtime/async-tools`, `runtime/ui-prompts`.
  - Define a `ToolExecutionAdapter` interface to keep transport/tool execution boundaries stable.
- `electron/chat/runner.js`:
  - Extract `context-length` detection into a shared util used by CLI `context-recovery`.
  - Move session trimming, summary building, and stream state handling into dedicated modules.
- `packages/aide/mcp_servers/shell/register-tools.js`:
  - Extract `shell-invocation`, `prompt-detection`, `buffer-management` into `shell/utils` modules.
- `packages/aide/mcp_servers/lsp-bridge-server.js`:
  - Split text edit normalization and workspace resolution into separate helpers.
- `packages/aide/cli-ui/src/compact.mjs` and `packages/common/aide-ui/components/GlobalStyles.jsx`:
  - Break into smaller modules to reduce the single-file surface area.

### Phase 4: Validation
- Add unit tests for the shared normalization modules.
- Smoke-test: Electron chat, CLI prompt flow, MCP subagent progress stream, task and UI prompt tools.

## Notes
- Favor reuse over more splits; only split when it yields a shared helper or clear interface.
- Keep API shape unchanged by re-exporting new helpers from existing modules.
