# Desktop runtime separation plan (shared config)

Goal
- Fully separate *runtime/process* data between AIDE and Chat.
- Shared config across both: models, API keys, MCP servers, prompts, subagents, settings.
- No mixing of runtime data: tasks, file changes, events, runs, sessions, chat messages, subagent streams, ui prompts.

Current problem (from code)
- Desktop hard-codes MODEL_CLI_HOST_APP = "chatos" and builds a single defaultPaths/adminDb.
- Chat store + tasks + fileChanges all write into the same adminDb as config.
- Runtime files (events/runs/uiPrompts/fileChanges) are shared by defaultPaths.

Target design
- One *shared config context* (existing):
  - adminDb (models/prompts/mcp/subagents/settings)
  - models.yaml + subagents.json
  - hostApp remains "chatos"
- One *Chat runtime context* (new):
  - runtimeStateDir (separate directory)
  - runtimeDb (chat runtime tables only)
  - runtime files: events/runs/uiPrompts/fileChanges/sessionReport
- AIDE runtime stays in existing state dir (no change).

Recommended storage layout
- Shared config: ~/.deepseek_cli/chatos/
- Chat runtime: ~/.deepseek_cli/chatos_chat_runtime/
  (name can be adjusted, but must be distinct from chatos)

Implementation overview
1) Keep shared config as-is in electron/main.js
   - Keep MODEL_CLI_HOST_APP = "chatos"
   - Build adminDb + adminServices once (shared config)

2) Create Chat runtime context in electron/main.js
   - runtimeStateDir = ensureAppStateDir(sessionRoot, { hostApp: 'chatos_chat_runtime', fallbackHostApp: 'chatos' })
   - runtimeDbPath = path.join(runtimeStateDir, 'runtime.db.sqlite')
   - runtimeDb = createDb({ dbPath: runtimeDbPath })
   - chatRuntimePaths:
     - events: runtimeStateDir/events.jsonl
     - runs: runtimeStateDir/runs.jsonl
     - uiPrompts: runtimeStateDir/ui-prompts.jsonl
     - fileChanges: runtimeStateDir/file-changes.jsonl
     - sessionReport: runtimeStateDir/auth/session-report.html (or runtimeStateDir/session-report.html)

3) Route subsystems
   - AIDE UI / Session API / Terminal Manager / UI Apps:
     - continue using shared config + existing runtime paths (current behavior)
   - Chat API / Chat Runner:
     - use shared adminServices (for config)
     - use runtimeDb for chat store
     - use chatRuntimePaths for events/runs/uiPrompts/fileChanges

   Concrete changes:
   - electron/chat/index.js: accept { storeDb } and call createChatStore(storeDb)
   - electron/chat/runner.js: use chatRuntimePaths.events

4) MCP child process env isolation (critical)
   - Chat MCP subprocesses must write to Chat runtime DB and uiPrompts file.
   - Extend MCP runtime to accept an env override (do not read process.env directly).
   - For Chat runner MCP init, pass env:
     - MODEL_CLI_TASK_DB = runtimeDbPath
     - MODEL_CLI_UI_PROMPTS = chatRuntimePaths.uiPrompts
     - MODEL_CLI_HOST_APP = "chatos_chat_runtime"
     - MODEL_CLI_TASK_SCOPE = "chat" (optional but recommended)

   Files involved:
   - packages/aide/src/mcp/runtime.js
   - packages/aide/src/mcp/runtime/server-connection.js
   - electron/chat/runner.js

5) UI IPC separation for Chat runtime data
   ChatView currently reads from generic channels (config:read, fileChanges:read, uiPrompts:read)
   which point to shared adminDb / AIDE runtime.

   Add chat-specific IPC endpoints or scoping:
   - chat:config:read (returns tasksListChat from runtimeDb)
   - chat:fileChanges:read (from runtimeDb)
   - chat:uiPrompts:read (from chatRuntimePaths)
   - chat:runs:read, chat:events:read (from chatRuntimePaths)

   Update UI:
   - packages/common/aide-ui/features/chat/ChatView.jsx to call chat:* channels

6) Tasks + fileChanges storage split
   - MCP task server uses MODEL_CLI_TASK_DB -> runtimeDbPath, so tasks + fileChanges go to runtimeDb.
   - AIDE continues using shared adminDb for its own tasks + fileChanges.

Expected results
- Config data is shared across AIDE/Chat (models, prompts, MCP, subagents, keys).
- All runtime data for Chat is stored in chat runtime dir/DB, not in shared adminDb.
- AIDE UI never sees Chat runtime data.
- Chat UI reads only Chat runtime data.

Files to change (primary)
- electron/main.js (create chat runtime context)
- electron/chat/index.js (use runtimeDb for store)
- electron/chat/runner.js (use chatRuntimePaths + env overrides)
- electron/session-api.js + electron/session-api/payloads.js (add chat runtime readers)
- packages/common/aide-ui/features/chat/ChatView.jsx (use chat:* IPC)
- packages/aide/src/mcp/runtime.js (env override)
- packages/aide/src/mcp/runtime/server-connection.js (use provided env)

Notes
- This plan avoids changing shared config storage, so models/prompts/subagents remain consistent.
- Existing Chat runtime data in the shared adminDb (from old builds) will remain but can be ignored.

Definition of done
- Chat runtime DB/files exist only under ~/.deepseek_cli/chatos_chat_runtime/
- Shared adminDb stays under ~/.deepseek_cli/chatos/
- No cross-contamination of tasks/events/runs/fileChanges/sessions/chat messages between AIDE and Chat.
