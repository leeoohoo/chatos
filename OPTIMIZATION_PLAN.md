# Optimization Plan

## Findings (2026-01-29)

### Large files (non-node_modules)
- apps/ui/dist/bundle.js.map (~20.81 MB)
- ui_apps/plugins/aide-builtin/cli/dist/index.mjs.map (~20.06 MB)
- apps/ui/dist/bundle.js (~12.9 MB)
- ui_apps/plugins/aide-builtin/cli/dist/index.mjs (~12.43 MB)
- build_resources/icon.icns (~1.67 MB)
- build_resources/icon.png (~0.87 MB)
- image copy 2.png (~0.48 MB)

### Duplicate subagent prompts (identical content)
- backend-architect.md (6 copies)
- code-reviewer.md (6 copies)
- test-automator.md (4 copies)
- performance-engineer.md (4 copies)
- security-auditor.md (4 copies)
- cloud-architect.md (4 copies)
- frontend-developer.md (4 copies)
- debugger.md (4 copies)
- database-optimizer.md (3 copies)

## Implementation plan

1) De-duplicate subagent prompts
- Create shared location: packages/aide/subagents/shared/agents/
- Move one canonical copy of each duplicate prompt to shared
- Update plugin.json systemPromptPath entries to point to ../../shared/agents/<name>.md
- Remove duplicate files from plugin agent folders

2) Reduce build artifacts tracked in repo
- Add gitignore entries for apps/ui/dist/ (and optional *.map) to avoid re-checkin
- Keep existing files for now; optional follow-up: untrack dist assets or move to LFS

3) Small UI abstractions
- Extract common ui-prompt kind predicate to lib (avoid repeating checks)
- Reuse common normalizeText from packages/common/text-utils.js where it is duplicated

## Order of execution
1) Deduplicate subagent prompts
2) Update gitignore for dist artifacts
3) UI abstractions

## Removed duplicate prompt files (now referenced from shared)

- C:\project\my_project\chatos\packages\aide\subagents\plugins\agent-orchestration\agents\context-manager.md
- C:\project\my_project\chatos\packages\aide\subagents\plugins\api-scaffolding\agents\backend-architect.md
- C:\project\my_project\chatos\packages\aide\subagents\plugins\api-scaffolding\agents\django-pro.md
- C:\project\my_project\chatos\packages\aide\subagents\plugins\api-scaffolding\agents\fastapi-pro.md
- C:\project\my_project\chatos\packages\aide\subagents\plugins\api-scaffolding\agents\graphql-architect.md
- C:\project\my_project\chatos\packages\aide\subagents\plugins\api-testing-observability\agents\api-documenter.md
- C:\project\my_project\chatos\packages\aide\subagents\plugins\application-performance\agents\frontend-developer.md
- C:\project\my_project\chatos\packages\aide\subagents\plugins\application-performance\agents\observability-engineer.md
- C:\project\my_project\chatos\packages\aide\subagents\plugins\application-performance\agents\performance-engineer.md
- C:\project\my_project\chatos\packages\aide\subagents\plugins\backend-api-security\agents\backend-architect.md
- C:\project\my_project\chatos\packages\aide\subagents\plugins\backend-api-security\agents\backend-security-coder.md
- C:\project\my_project\chatos\packages\aide\subagents\plugins\backend-development\agents\backend-architect.md
- C:\project\my_project\chatos\packages\aide\subagents\plugins\backend-development\agents\graphql-architect.md
- C:\project\my_project\chatos\packages\aide\subagents\plugins\backend-development\agents\tdd-orchestrator.md
- C:\project\my_project\chatos\packages\aide\subagents\plugins\cicd-automation\agents\cloud-architect.md
- C:\project\my_project\chatos\packages\aide\subagents\plugins\cicd-automation\agents\deployment-engineer.md
- C:\project\my_project\chatos\packages\aide\subagents\plugins\cicd-automation\agents\devops-troubleshooter.md
- C:\project\my_project\chatos\packages\aide\subagents\plugins\cicd-automation\agents\kubernetes-architect.md
- C:\project\my_project\chatos\packages\aide\subagents\plugins\cicd-automation\agents\terraform-specialist.md
- C:\project\my_project\chatos\packages\aide\subagents\plugins\cloud-infrastructure\agents\cloud-architect.md
- C:\project\my_project\chatos\packages\aide\subagents\plugins\cloud-infrastructure\agents\deployment-engineer.md
- C:\project\my_project\chatos\packages\aide\subagents\plugins\cloud-infrastructure\agents\kubernetes-architect.md
- C:\project\my_project\chatos\packages\aide\subagents\plugins\cloud-infrastructure\agents\network-engineer.md
- C:\project\my_project\chatos\packages\aide\subagents\plugins\cloud-infrastructure\agents\terraform-specialist.md
- C:\project\my_project\chatos\packages\aide\subagents\plugins\codebase-cleanup\agents\code-reviewer.md
- C:\project\my_project\chatos\packages\aide\subagents\plugins\codebase-cleanup\agents\test-automator.md
- C:\project\my_project\chatos\packages\aide\subagents\plugins\code-documentation\agents\code-reviewer.md
- C:\project\my_project\chatos\packages\aide\subagents\plugins\code-documentation\agents\docs-architect.md
- C:\project\my_project\chatos\packages\aide\subagents\plugins\code-documentation\agents\tutorial-engineer.md
- C:\project\my_project\chatos\packages\aide\subagents\plugins\code-refactoring\agents\code-reviewer.md
- C:\project\my_project\chatos\packages\aide\subagents\plugins\code-refactoring\agents\legacy-modernizer.md
- C:\project\my_project\chatos\packages\aide\subagents\plugins\code-review-ai\agents\architect-review.md
- C:\project\my_project\chatos\packages\aide\subagents\plugins\comprehensive-review\agents\architect-review.md
- C:\project\my_project\chatos\packages\aide\subagents\plugins\comprehensive-review\agents\code-reviewer.md
- C:\project\my_project\chatos\packages\aide\subagents\plugins\comprehensive-review\agents\security-auditor.md
- C:\project\my_project\chatos\packages\aide\subagents\plugins\context-management\agents\context-manager.md
- C:\project\my_project\chatos\packages\aide\subagents\plugins\database-cloud-optimization\agents\backend-architect.md
- C:\project\my_project\chatos\packages\aide\subagents\plugins\database-cloud-optimization\agents\cloud-architect.md
- C:\project\my_project\chatos\packages\aide\subagents\plugins\database-cloud-optimization\agents\database-architect.md
- C:\project\my_project\chatos\packages\aide\subagents\plugins\database-cloud-optimization\agents\database-optimizer.md
- C:\project\my_project\chatos\packages\aide\subagents\plugins\database-design\agents\database-architect.md
- C:\project\my_project\chatos\packages\aide\subagents\plugins\database-migrations\agents\database-optimizer.md
- C:\project\my_project\chatos\packages\aide\subagents\plugins\data-engineering\agents\backend-architect.md
- C:\project\my_project\chatos\packages\aide\subagents\plugins\data-validation-suite\agents\backend-security-coder.md
- C:\project\my_project\chatos\packages\aide\subagents\plugins\debugging-toolkit\agents\debugger.md
- C:\project\my_project\chatos\packages\aide\subagents\plugins\debugging-toolkit\agents\dx-optimizer.md
- C:\project\my_project\chatos\packages\aide\subagents\plugins\dependency-management\agents\legacy-modernizer.md
- C:\project\my_project\chatos\packages\aide\subagents\plugins\deployment-strategies\agents\deployment-engineer.md
- C:\project\my_project\chatos\packages\aide\subagents\plugins\deployment-strategies\agents\terraform-specialist.md
- C:\project\my_project\chatos\packages\aide\subagents\plugins\deployment-validation\agents\cloud-architect.md
- C:\project\my_project\chatos\packages\aide\subagents\plugins\distributed-debugging\agents\devops-troubleshooter.md
- C:\project\my_project\chatos\packages\aide\subagents\plugins\distributed-debugging\agents\error-detective.md
- C:\project\my_project\chatos\packages\aide\subagents\plugins\documentation-generation\agents\api-documenter.md
- C:\project\my_project\chatos\packages\aide\subagents\plugins\documentation-generation\agents\docs-architect.md
- C:\project\my_project\chatos\packages\aide\subagents\plugins\documentation-generation\agents\tutorial-engineer.md
- C:\project\my_project\chatos\packages\aide\subagents\plugins\error-debugging\agents\debugger.md
- C:\project\my_project\chatos\packages\aide\subagents\plugins\error-debugging\agents\error-detective.md
- C:\project\my_project\chatos\packages\aide\subagents\plugins\error-diagnostics\agents\debugger.md
- C:\project\my_project\chatos\packages\aide\subagents\plugins\error-diagnostics\agents\error-detective.md
- C:\project\my_project\chatos\packages\aide\subagents\plugins\framework-migration\agents\architect-review.md
- C:\project\my_project\chatos\packages\aide\subagents\plugins\framework-migration\agents\legacy-modernizer.md
- C:\project\my_project\chatos\packages\aide\subagents\plugins\frontend-mobile-development\agents\frontend-developer.md
- C:\project\my_project\chatos\packages\aide\subagents\plugins\frontend-mobile-development\agents\mobile-developer.md
- C:\project\my_project\chatos\packages\aide\subagents\plugins\frontend-mobile-security\agents\frontend-developer.md
- C:\project\my_project\chatos\packages\aide\subagents\plugins\full-stack-orchestration\agents\deployment-engineer.md
- C:\project\my_project\chatos\packages\aide\subagents\plugins\full-stack-orchestration\agents\performance-engineer.md
- C:\project\my_project\chatos\packages\aide\subagents\plugins\full-stack-orchestration\agents\security-auditor.md
- C:\project\my_project\chatos\packages\aide\subagents\plugins\full-stack-orchestration\agents\test-automator.md
- C:\project\my_project\chatos\packages\aide\subagents\plugins\git-pr-workflows\agents\code-reviewer.md
- C:\project\my_project\chatos\packages\aide\subagents\plugins\incident-response\agents\devops-troubleshooter.md
- C:\project\my_project\chatos\packages\aide\subagents\plugins\kubernetes-operations\agents\kubernetes-architect.md
- C:\project\my_project\chatos\packages\aide\subagents\plugins\multi-platform-apps\agents\backend-architect.md
- C:\project\my_project\chatos\packages\aide\subagents\plugins\multi-platform-apps\agents\frontend-developer.md
- C:\project\my_project\chatos\packages\aide\subagents\plugins\multi-platform-apps\agents\mobile-developer.md
- C:\project\my_project\chatos\packages\aide\subagents\plugins\observability-monitoring\agents\database-optimizer.md
- C:\project\my_project\chatos\packages\aide\subagents\plugins\observability-monitoring\agents\network-engineer.md
- C:\project\my_project\chatos\packages\aide\subagents\plugins\observability-monitoring\agents\observability-engineer.md
- C:\project\my_project\chatos\packages\aide\subagents\plugins\observability-monitoring\agents\performance-engineer.md
- C:\project\my_project\chatos\packages\aide\subagents\plugins\performance-testing-review\agents\performance-engineer.md
- C:\project\my_project\chatos\packages\aide\subagents\plugins\performance-testing-review\agents\test-automator.md
- C:\project\my_project\chatos\packages\aide\subagents\plugins\python-development\agents\django-pro.md
- C:\project\my_project\chatos\packages\aide\subagents\plugins\python-development\agents\fastapi-pro.md
- C:\project\my_project\chatos\packages\aide\subagents\plugins\security-compliance\agents\security-auditor.md
- C:\project\my_project\chatos\packages\aide\subagents\plugins\security-scanning\agents\security-auditor.md
- C:\project\my_project\chatos\packages\aide\subagents\plugins\tdd-workflows\agents\code-reviewer.md
- C:\project\my_project\chatos\packages\aide\subagents\plugins\tdd-workflows\agents\tdd-orchestrator.md
- C:\project\my_project\chatos\packages\aide\subagents\plugins\team-collaboration\agents\dx-optimizer.md
- C:\project\my_project\chatos\packages\aide\subagents\plugins\unit-testing\agents\debugger.md
- C:\project\my_project\chatos\packages\aide\subagents\plugins\unit-testing\agents\test-automator.md

## Build artifacts cleanup
- Untracked apps/ui/dist/* (kept on disk; now ignored by .gitignore)

## Repo cleanup
- Removed unused tracked file: image copy 2.png
- Remaining tracked large assets: build_resources/icon.icns + build_resources/icon.png (kept; required for desktop builds)

## Duplicate code scan (apps/ui vs packages/aide/cli-ui)
- Report: DUPLICATE_REPORT.txt (now shows no duplicate tracked sources after cleanup)
- Removed the duplicate wrapper files and updated imports to reference `aide-ui/*` directly


## Additional optimizations
- Workbar now uses shared parseTimestampMs from lib/runs.js (removed local copy)
- No duplicate command/skill files found across plugins (hash scan)
- detail-utils now re-exports normalizeText from common/text-utils.js
- Removed remaining thin wrapper re-exports in apps/ui + cli-ui and rewired imports to use `aide-ui/*` directly

## Validation
- npm run ui:build (post wrapper cleanup)
- npm run ui:build:release (post wrapper cleanup)
