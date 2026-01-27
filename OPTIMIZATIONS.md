# Optimizations

This file tracks refactor/optimization items and progress.

## Dedup / Abstraction
- [x] Consolidate FloatingIslandPrompt into a single shared implementation (add result handling + constrainHeight) and re-export from app.
- [x] Introduce shared storage context factory to avoid duplicated storage key boilerplate (app vs common).
- [x] Extract filesystem replace helpers from register-tools to reduce file size and improve reuse.

## Large File Split Candidates
- [x] packages/aide/cli-ui/src/compact.mjs (extract styles + DOM skeleton into modules)
- [x] packages/aide/mcp_servers/lsp-bridge-server.js (extract LspClient + protocol helpers)
- [ ] electron/chat/runner.js (split run lifecycle vs IO/logging)
- [ ] packages/aide/cli-ui/src/CliApp.jsx (split layout + hooks + panels)
- [x] packages/common/aide-ui/features/chat/hooks/useChatSessions.js (split data fetch vs derived state)
- [ ] apps/ui/src/features/chat/components/AgentEditorModal.jsx (split sections + validation)
