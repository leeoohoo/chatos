# Refactor Cleanup Log

## Dedupe Targets
- [x] createWriteQueue duplication (project-journal/task)
- [x] Dedupe key builders (buildJournalDedupeKey/buildTaskDedupeKey)
- [x] parseArgs duplication (cli-utils vs subagent/utils)
- [x] clampNumber duplication (mcp servers, common runtime-log, electron)
- [x] appendRunPid duplication (terminal, runtime/tool, subagent, filesystem server)
- [x] run inbox listener duplication (builtin vs subagent)
- [x] formatBytes/hashContent duplication in mcp servers
- [x] isBinaryBuffer null-byte check duplication (code-maintainer vs filesystem)

## Notes
- Shell buffer binary heuristic stays separate (different behavior).
- UI formatBytes stays separate (different output formatting).
