import fs from 'fs';
import path from 'path';
import { syncAdminToFiles } from '../packages/aide/shared/data/sync.js';
import { clampNumber } from '../packages/common/number-utils.js';
import {
  ensureDir,
  resolveUiFlags,
  sanitizeAdminSnapshotForUi as sanitizeAdminSnapshotForUiHelper,
} from './session-api-helpers.js';
import { createSessionPayloadReaders } from './session-api/payloads.js';
import { createSessionWatchers } from './session-api/watchers.js';
import { createUiPromptHandlers } from './session-api/ui-prompts.js';

const promptLogMaxBytes = clampNumber(
  process.env.MODEL_CLI_UI_PROMPTS_MAX_BYTES,
  0,
  100 * 1024 * 1024,
  5 * 1024 * 1024
);
const promptLogMaxLines = clampNumber(process.env.MODEL_CLI_UI_PROMPTS_MAX_LINES, 0, 200_000, 5_000);
const promptLogLimits = { maxBytes: promptLogMaxBytes, maxLines: promptLogMaxLines };

export function createSessionApi({ defaultPaths, adminDb, adminServices, mainWindowGetter, sessions, uiFlags } = {}) {
  if (!defaultPaths) {
    throw new Error('defaultPaths is required');
  }
  if (!adminDb) {
    throw new Error('adminDb is required');
  }
  if (!adminServices) {
    throw new Error('adminServices is required');
  }
  const getMainWindow = typeof mainWindowGetter === 'function' ? mainWindowGetter : () => null;

  const { uiFlags: resolvedUiFlags, exposeSubagents } = resolveUiFlags(uiFlags);
  const sanitizeAdminSnapshotForUi = (snapshot) => sanitizeAdminSnapshotForUiHelper(snapshot, { exposeSubagents });

  const payloadReaders = createSessionPayloadReaders({
    defaultPaths,
    adminServices,
    exposeSubagents,
    resolvedUiFlags,
    sanitizeAdminSnapshotForUi,
  });
  const {
    readConfigPayload,
    readEventsPayload,
    readFileChangesPayload,
    readRunsPayload,
    readSessionPayload,
    readUiPromptsPayload,
  } = payloadReaders;

  const watchers = createSessionWatchers({
    defaultPaths,
    getMainWindow,
    readConfigPayload,
    readSessionPayload,
    readEventsPayload,
    readFileChangesPayload,
    readUiPromptsPayload,
    readRunsPayload,
  });
  const {
    startEventsWatcher,
    startFileChangesWatcher,
    startRunsWatcher,
    startSessionWatcher,
    startTasksWatcher,
    startUiPromptsWatcher,
    dispose: disposeWatchers,
  } = watchers;

  const uiPromptHandlers = createUiPromptHandlers({
    defaultPaths,
    promptLogLimits,
    startUiPromptsWatcher,
    readUiPromptsPayload,
    getMainWindow,
  });
  const { requestUiPrompt, respondUiPrompt } = uiPromptHandlers;

  async function clearAllCaches() {
    const summary = {
      tasksCleared: 0,
      eventsCleared: 0,
      fileChangesCleared: 0,
      uiPromptsCleared: 0,
      runsCleared: 0,
      filesCleared: [],
      sessionsKilled: 0,
      sessionsErrors: [],
    };

    try {
      const existingTasks = adminServices.tasks.list();
      adminDb.reset('tasks', []);
      summary.tasksCleared = existingTasks.length;
    } catch (err) {
      summary.tasksError = err?.message || String(err);
    }

    try {
      const existingEvents = adminServices.events.list();
      adminDb.reset('events', []);
      ensureDir(path.dirname(defaultPaths.events));
      fs.writeFileSync(defaultPaths.events, '', 'utf8');
      summary.eventsCleared = existingEvents.length;
      summary.filesCleared.push(defaultPaths.events);
    } catch (err) {
      summary.eventsError = err?.message || String(err);
    }

    try {
      ensureDir(path.dirname(defaultPaths.fileChanges));
      fs.writeFileSync(defaultPaths.fileChanges, '', 'utf8');
      summary.fileChangesCleared = 1;
      summary.filesCleared.push(defaultPaths.fileChanges);
    } catch (err) {
      summary.fileChangesError = err?.message || String(err);
    }

    try {
      ensureDir(path.dirname(defaultPaths.uiPrompts));
      fs.writeFileSync(defaultPaths.uiPrompts, '', 'utf8');
      summary.uiPromptsCleared = 1;
      summary.filesCleared.push(defaultPaths.uiPrompts);
    } catch (err) {
      summary.uiPromptsError = err?.message || String(err);
    }

    try {
      ensureDir(path.dirname(defaultPaths.runs));
      fs.writeFileSync(defaultPaths.runs, '', 'utf8');
      summary.runsCleared = 1;
      summary.filesCleared.push(defaultPaths.runs);
    } catch (err) {
      summary.runsError = err?.message || String(err);
    }

    try {
      ensureDir(path.dirname(defaultPaths.sessionReport));
      fs.writeFileSync(defaultPaths.sessionReport, '', 'utf8');
      summary.filesCleared.push(defaultPaths.sessionReport);
    } catch (err) {
      summary.sessionError = err?.message || String(err);
    }

    try {
      const killAllSessions = sessions?.killAllSessions;
      if (typeof killAllSessions === 'function') {
        const sessSummary = await killAllSessions();
        summary.sessionsKilled = Array.isArray(sessSummary.killed) ? sessSummary.killed.length : 0;
        if (!sessSummary.ok) {
          summary.sessionsError =
            sessSummary.reason || (Array.isArray(sessSummary.errors) ? sessSummary.errors.join('; ') : 'unknown');
        }
        if (Array.isArray(sessSummary.errors) && sessSummary.errors.length > 0) {
          summary.sessionsErrors.push(...sessSummary.errors);
        }
      } else {
        summary.sessionsError = 'session helper not available';
      }
    } catch (err) {
      summary.sessionsError = err?.message || String(err);
    }

    const snapshot = adminServices.snapshot();
    syncAdminToFiles(snapshot, {
      modelsPath: defaultPaths.models,
      mcpConfigPath: defaultPaths.mcpConfig,
      subagentsPath: defaultPaths.installedSubagents,
      promptsPath: defaultPaths.systemPrompt,
      systemDefaultPromptPath: defaultPaths.systemDefaultPrompt,
      systemUserPromptPath: defaultPaths.systemUserPrompt,
      subagentPromptsPath: defaultPaths.subagentSystemPrompt,
      subagentUserPromptPath: defaultPaths.subagentUserPrompt,
      tasksPath: defaultPaths.tasks,
    });

    const win = getMainWindow();
    if (win) {
      win.webContents.send('config:update', readConfigPayload());
      win.webContents.send('admin:update', { data: sanitizeAdminSnapshotForUi(snapshot), dbPath: adminServices.dbPath });
      win.webContents.send('session:update', readSessionPayload());
      win.webContents.send('events:update', readEventsPayload());
      win.webContents.send('fileChanges:update', readFileChangesPayload());
      win.webContents.send('uiPrompts:update', readUiPromptsPayload());
      win.webContents.send('runs:update', readRunsPayload());
    }

    const errors = ['tasksError', 'eventsError', 'sessionError', 'fileChangesError', 'uiPromptsError', 'runsError'].filter(
      (key) => summary[key]
    );
    return { ok: errors.length === 0, ...summary };
  }

  function dispose() {
    disposeWatchers();
  }

  return {
    clearAllCaches,
    dispose,
    readConfigPayload,
    readEventsPayload,
    readFileChangesPayload,
    readRunsPayload,
    readSessionPayload,
    readUiPromptsPayload,
    requestUiPrompt,
    respondUiPrompt,
    startEventsWatcher,
    startFileChangesWatcher,
    startRunsWatcher,
    startSessionWatcher,
    startTasksWatcher,
    startUiPromptsWatcher,
  };
}
