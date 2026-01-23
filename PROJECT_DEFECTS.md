# Project Defects (Initial Review)

Scope: quick review of core runtime, shell server, UI prompt logging, and secret handling.

## Findings (ordered by severity)

1. [High] Secret prompt responses are logged to disk in plaintext
   - The UI/TTY prompt server appends every request/response to `ui-prompts.jsonl`. Fields marked `secret` are only used to mask input in the UI, but the logged JSON still contains the raw values.
   - Evidence: request logging includes full field definitions and response values; `appendPromptEntry` writes entries unredacted. (packages/aide/mcp_servers/ui-prompt-server.js:79, packages/aide/mcp_servers/ui-prompt-server.js:164, packages/aide/mcp_servers/ui-prompt-server.js:462)
   - Impact: tokens/keys collected via prompts are persisted and can be read by any local process with access to the session root, or end up in backups.
   - Suggested direction: redact `response.values` for `secret` fields before logging, or store only a masked value.
   - Status: fixed by redacting secret fields before logging, masking secret values, and scrubbing logged responses after consumption; added prompt log size caps.

2. [High] Secrets are stored in plaintext and injected into process environment globally
   - Secret records include raw `value` and are described as injected into process env at runtime.
   - Evidence: schema defines `secrets.value` as a required string and says it is injected into env. (packages/common/admin-data/schema.js:24)
   - Environment injection is unconditional and applies to the whole process, so any plugin/tool/subprocess can read them. (packages/common/secrets-env.js:1)
   - Impact: local compromise or untrusted plugins/shell commands can access all keys; no at-rest encryption or least-privilege separation.
   - Status: fixed by encrypting secrets at rest (AES-256-GCM) and gating env injection behind the `injectSecretsToEnv` runtime setting (with env override).

3. [High] Shell workspace path enforcement is heuristic and bypassable
   - `assertCommandPathsWithinRoot` only tokenizes the raw command text and resolves static-looking path tokens; it does not evaluate shell expansions or variable substitutions.
   - Evidence: tokenization and path detection are purely string-based. (packages/aide/mcp_servers/shell-server.js:131, packages/aide/mcp_servers/shell-server.js:182, packages/aide/mcp_servers/shell-server.js:234)
   - Impact: commands like `cat $(pwd)/../../secret`, `$HOME/...`, or `python -c "open('/etc/passwd')"` can escape the workspace restriction despite the "paths must stay inside this directory" guarantee.
   - Status: mitigated by rejecting shell expansions/variable substitutions by default and improving token splitting; path checks now apply to session_run too. Not a full sandbox for interpreter-level access. Override with `MODEL_CLI_ALLOW_UNSAFE_SHELL=1` or `--allow-unsafe-shell` if needed.

4. [Medium] Runtime logs and prompt logs grow without bounds
   - Runtime logging appends to a JSONL file without rotation or size caps. (packages/common/state-core/runtime-log.js:68)
   - Prompt logging also appends without rotation. (packages/aide/mcp_servers/ui-prompt-server.js:462)
   - Impact: long-running sessions can accumulate large log files and consume disk space, and (combined with #1) preserve sensitive data longer than intended.
   - Status: fixed with size caps for prompt logs and runtime logs (env: `MODEL_CLI_UI_PROMPTS_MAX_BYTES`/`MODEL_CLI_UI_PROMPTS_MAX_LINES`, `MODEL_CLI_RUNTIME_LOG_MAX_BYTES`/`MODEL_CLI_RUNTIME_LOG_MAX_LINES`).

## Assumptions / Gaps

- I focused on runtime, prompt/logging, shell-server, and secret handling. UI rendering, subagent marketplace, and MCP server implementations were not exhaustively audited.

## Tests Run

- None.
