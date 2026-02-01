# Runtime DB Separation Fix Plan

## Goal
Keep configuration data (models, apiKey/secrets, MCP servers, prompts, subagents, land configs, settings) in the admin DB only, and keep runtime data (tasks, file changes, sessions, chat messages, subagent streams, shell sessions, runs) in the runtime DB only.

## Current Behavior (Observed)
- Admin config lives in `<stateDir>/chatos.db.sqlite` (records table: models, prompts, mcpServers, landConfigs, settings, subagents, secrets, etc.).
- Runtime data for chat lives in `<stateDir>/chatos_chat_runtime/runtime.db.sqlite` (records table: chatSessions, chatMessages, tasks_chat, subagentStreams, fileChanges, shellSessions, settings, etc.).
- A second DB exists at `<stateDir>/chatos_chat_runtime/chatos_chat_runtime.db.sqlite` containing config tables (models/prompts/mcpServers/landConfigs/subagents). This should not exist in the runtime area.

## Root Causes (Code)
1) Config host app fallback uses MODEL_CLI_HOST_APP when MODEL_CLI_CONFIG_HOST_APP is missing.
   - `packages/aide/src/config-source.js`:
     - `configHostApp = MODEL_CLI_CONFIG_HOST_APP || getHostApp() || 'chatos'`
     - If host app is `chatos_chat_runtime`, config DB becomes `chatos_chat_runtime.db.sqlite`.

2) Some subprocesses are spawned without explicitly carrying MODEL_CLI_CONFIG_HOST_APP, so they default to host app.
   - Example: `packages/aide/mcp_servers/subagent/async-jobs.js` uses `env = { ...process.env, ... }` but does not enforce/repair CONFIG_HOST_APP when missing.

3) Runtime DB uses the same generic `createDb` and record schema as admin DB, so accidental config writes are easy.

## Fix Plan

### Phase 1: Hard Guardrails for Config Host App
Goal: Ensure config always resolves to the admin host app ("chatos") and never to *_chat_runtime.

1. Add a resolver helper (recommended location: `packages/common/host-app.js` or `packages/aide/src/config-source.js`).
   - If `MODEL_CLI_CONFIG_HOST_APP` is set, use it.
   - Else if `MODEL_CLI_HOST_APP` ends with `_chat_runtime`, strip suffix (e.g. `chatos_chat_runtime` -> `chatos`).
   - Else fallback to `getHostApp()` or `chatos`.

2. Update `getAdminServices()` in `packages/aide/src/config-source.js` to use the new resolver.
   - Prevent config DB from ever targeting `*_chat_runtime`.

### Phase 2: Enforce Env Propagation for Subprocesses
Goal: Ensure any worker spawned from MCP/subagent/shell inherits config host app.

1. In `packages/aide/mcp_servers/subagent/async-jobs.js` (subagent worker fork):
   - Explicitly inject `MODEL_CLI_CONFIG_HOST_APP` into the child env if missing.
   - Example:
     - `MODEL_CLI_CONFIG_HOST_APP: process.env.MODEL_CLI_CONFIG_HOST_APP || 'chatos'`
     - Also pass `MODEL_CLI_HOST_APP` to avoid drift.

2. Audit other spawns that construct env blocks (shell session, code-maintainer, etc.) and apply the same rule.
   - Search for `fork(`, `spawn(`, or `new StdioClientTransport({ env })` with partial env sets.

### Phase 3: Migration / Cleanup for Existing Runtime Config DB
Goal: Remove config tables from runtime DB and keep one canonical admin DB.

1. Add a migration step at startup (Electron main or config-source init):
   - Detect if `<stateDir>/chatos_chat_runtime/chatos_chat_runtime.db.sqlite` exists.
   - If it contains config tables (models/prompts/mcpServers/landConfigs/subagents), merge into `chatos.db.sqlite`.
   - Favor existing admin records by ID; fill missing entries from runtime DB.
   - Rename the runtime config DB to `*.bak` after migration.

2. Add a marker file (e.g. `.runtime-config-migrated.json`) to avoid repeated merges.

### Phase 4: Runtime DB Schema Guard (Optional but recommended)
Goal: Prevent accidental config writes into runtime DB going forward.

1. Add a guard in `packages/common/admin-data/storage.js` or `createDb()` wrapper used for runtime DB:
   - When DB path ends with `runtime.db.sqlite`, reject writes to config tables.
   - Allow only runtime tables: `chatSessions`, `chatMessages`, `tasks_chat`, `subagentStreams`, `fileChanges`, `shellSessions`, `settings` (if runtime settings are allowed).

2. Alternatively, split runtime storage into a dedicated module with a whitelist of tables.

## Verification Checklist
- Starting the app does NOT create or modify `<stateDir>/chatos_chat_runtime/chatos_chat_runtime.db.sqlite`.
- Admin config changes (models/tools/MCP/land_config) always land in `<stateDir>/chatos.db.sqlite`.
- Runtime data (tasks_chat, chatSessions, chatMessages, fileChanges, subagentStreams) land in `<stateDir>/chatos_chat_runtime/runtime.db.sqlite` only.
- Running `run_sub_agent` shows progress timeline and task list once tools are enabled in the model config.

## Files to Touch (Expected)
- `packages/aide/src/config-source.js` (config host app resolver)
- `packages/common/host-app.js` or new helper module
- `packages/aide/mcp_servers/subagent/async-jobs.js` (env propagation)
- Electron startup (`electron/main.js` or a new migration helper) for migration
- Optional guard: `packages/common/admin-data/storage.js`

---
If you want, I can implement Phase 1-3 directly and verify with a quick DB scan.
