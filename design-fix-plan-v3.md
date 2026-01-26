# Design Fix Plan v3 (Chatos)

## Goals
- Remove remaining cross-layer duplication introduced by recent splits.
- Prefer shared reusable helpers before more file splitting.
- Keep behavior consistent across Electron, CLI, MCP servers, and UI.
- Avoid over-splitting: only extract when there is reuse or a clear interface.

## Latest Scan Findings (post-v2)
- `resolveBoolEnv` is duplicated in `electron/shared/env-utils.js` and `packages/aide/src/mcp/runtime/ui-app-utils.js`.
- `buildFinalTextFromChunks` exists in runtime stream tracking and in UI chat sessions (Map vs object data shape).
- `extractContentText` exists in runtime tool formatting and in `scripts/ui-prompt-concurrency.js` (rich vs text-only).
- Large modules still mixing responsibilities:
  - `electron/chat/runner.js`
  - `packages/aide/cli-ui/src/compact.mjs`
  - `packages/common/aide-ui/components/GlobalStyles.jsx`

## Plan
### Phase 1: Shared helpers for remaining duplicates
- Add `packages/common/env-utils.js`:
  - `resolveBoolEnv`.
  - Update `electron/shared/env-utils.js` to re-export from common to keep imports stable.
  - Update `packages/aide/src/mcp/runtime/ui-app-utils.js` to import from common.
- Add a shared stream text helper (either a new `packages/common/stream-text-utils.js` or extend `packages/common/chat-stream-utils.js`):
  - `buildFinalTextFromChunks` that accepts `Map` or `{ [index]: text }`.
  - Update runtime stream tracker and UI chat sessions to use it.
- Optional, if reuse is worthwhile:
  - Add `packages/common/mcp-content-utils.js`:
    - `extractContentText(blocks, { includeNonText })`
    - `approxSize(base64)`
  - Update runtime tool formatting and scripts to use it. If cross-layer coupling is unwanted, keep the script-local version and document why.

### Phase 2: Runtime overlap cleanup
- Review `packages/aide/src/mcp/runtime/*` for remaining overlaps (formatting, error extraction, result parsing).
- If overlaps exist, extract to a single helper module rather than adding more files.

### Phase 3: Reduce remaining monoliths (reuse-first)
- `electron/chat/runner.js`:
  - Extract context-length detection (shared with CLI recovery) if not already unified.
  - Move session trimming, summary building, and stream state handling into dedicated helpers.
- `packages/aide/cli-ui/src/compact.mjs`:
  - Split by responsibilities (formatters, reducers, key handlers), but only when a module can be reused or clearly isolated.
- `packages/common/aide-ui/components/GlobalStyles.jsx`:
  - Extract tokens, reset styles, and component overrides into smaller modules.

### Phase 4: Validation
- Add unit tests for new shared helpers (env, stream text, content extraction).
- Smoke tests: Electron chat flow, CLI prompt flow, MCP stream handling.

## Notes
- Favor shared helpers over further splitting.
- When sharing across layers, prefer `packages/common` plus re-exports to keep API surfaces stable.
- If a helper is intentionally duplicated (data shape differences), add a short comment to explain the divergence.
