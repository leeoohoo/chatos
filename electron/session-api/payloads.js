import path from 'path';

import {
  parseEvents,
  parseInstalledPlugins,
  parseJsonSafe,
  parseMcpServers,
  parseModels,
  parsePrompts,
  safeRead,
} from '../../packages/aide/shared/data/legacy.js';
import { parseJsonLines, readTasksFromDbFile } from '../session-api-helpers.js';

export function createSessionPayloadReaders({
  defaultPaths,
  adminServices,
  exposeSubagents,
  resolvedUiFlags,
  sanitizeAdminSnapshotForUi,
} = {}) {
  const sanitize =
    typeof sanitizeAdminSnapshotForUi === 'function' ? sanitizeAdminSnapshotForUi : (snapshot) => snapshot;

  const readConfigPayload = () => {
    const snapshot = adminServices.snapshot();
    const modelsList = snapshot.models || parseModels(safeRead(defaultPaths.models));
    const systemPromptMainInternal = safeRead(defaultPaths.systemPrompt);
    const systemDefaultPrompt = safeRead(defaultPaths.systemDefaultPrompt);
    const systemUserPrompt = safeRead(defaultPaths.systemUserPrompt);
    const subagentSystemPromptInternal = safeRead(defaultPaths.subagentSystemPrompt);
    const subagentUserPrompt = safeRead(defaultPaths.subagentUserPrompt);
    const promptsMainInternal = parsePrompts(systemPromptMainInternal);
    const promptsDefault = parsePrompts(systemDefaultPrompt);
    const promptsUser = parsePrompts(systemUserPrompt);
    const promptsSubInternal = parsePrompts(subagentSystemPromptInternal);
    const promptsSubUser = parsePrompts(subagentUserPrompt);
    const prompts = {
      internal_main: promptsMainInternal.internal_main || '',
      default:
        systemDefaultPrompt && systemDefaultPrompt.trim()
          ? promptsDefault.default || ''
          : promptsMainInternal.default || '',
      user_prompt:
        systemUserPrompt && systemUserPrompt.trim()
          ? promptsUser.user_prompt || ''
          : promptsMainInternal.user_prompt || '',
      internal_subagent:
        subagentSystemPromptInternal && subagentSystemPromptInternal.trim()
          ? promptsSubInternal.internal_subagent || ''
          : promptsMainInternal.internal_subagent || '',
      subagent_user_prompt:
        subagentUserPrompt && subagentUserPrompt.trim()
          ? promptsSubUser.subagent_user_prompt || ''
          : promptsSubInternal.subagent_user_prompt ||
            promptsMainInternal.subagent_user_prompt ||
            '',
    };
    const mcpServers = snapshot.mcpServers || parseMcpServers(safeRead(defaultPaths.mcpConfig));
    const marketplacePaths = [defaultPaths.marketplace, defaultPaths.marketplaceUser].filter(Boolean);
    const marketplace = exposeSubagents
      ? (() => {
          const merged = new Map();
          marketplacePaths.forEach((mp) => {
            const list = parseJsonSafe(safeRead(mp), []);
            if (!Array.isArray(list)) return;
            list.forEach((entry) => {
              if (entry?.id) {
                merged.set(entry.id, entry);
              }
            });
          });
          return Array.from(merged.values());
        })()
      : [];
    const defaultSubagentsList = exposeSubagents
      ? parseJsonSafe(
          safeRead(path.join(path.resolve(defaultPaths.defaultsRoot || ''), 'shared', 'defaults', 'subagents.json')),
          {}
        )?.plugins || []
      : [];
    const installedPlugins = exposeSubagents
      ? parseInstalledPlugins(safeRead(defaultPaths.installedSubagents), {
          pluginsDir: [defaultPaths.pluginsDirUser, defaultPaths.pluginsDir].filter(Boolean),
          marketplacePath: marketplacePaths,
          defaultList: Array.isArray(defaultSubagentsList) ? defaultSubagentsList : [],
        })
      : [];
    const tasksList = readTasksFromDbFile(defaultPaths.adminDb);
    const eventsList = parseEvents(safeRead(defaultPaths.events));
    const adminState = sanitize(snapshot);
    const runtimeSettings = Array.isArray(snapshot.settings) ? snapshot.settings : [];
    const tasksJson = JSON.stringify({ tasks: tasksList || [] }, null, 2);
    const eventsContent = eventsList.map((e) => JSON.stringify(e)).join('\n');
    return {
      modelsPath: defaultPaths.models,
      models: safeRead(defaultPaths.models),
      modelsList,
      systemPromptPath: defaultPaths.systemPrompt,
      systemPrompt: systemPromptMainInternal,
      systemDefaultPromptPath: defaultPaths.systemDefaultPrompt,
      systemDefaultPrompt,
      systemUserPromptPath: defaultPaths.systemUserPrompt,
      systemUserPrompt,
      subagentSystemPromptPath: defaultPaths.subagentSystemPrompt,
      subagentSystemPrompt: subagentSystemPromptInternal,
      subagentUserPromptPath: defaultPaths.subagentUserPrompt,
      subagentUserPrompt,
      prompts,
      mcpConfigPath: defaultPaths.mcpConfig,
      mcpConfig: safeRead(defaultPaths.mcpConfig),
      mcpServers,
      marketplace,
      installedPlugins,
      sessionReportPath: defaultPaths.sessionReport,
      tasksPath: defaultPaths.tasks,
      tasks: tasksJson,
      tasksList,
      eventsPath: defaultPaths.events,
      eventsList,
      eventsContent,
      fileChangesPath: defaultPaths.fileChanges,
      adminDbPath: defaultPaths.adminDb,
      adminState,
      uiFlags: resolvedUiFlags,
      runtimeSettings,
    };
  };

  const readSessionPayload = () => ({
    path: defaultPaths.sessionReport,
    html: safeRead(defaultPaths.sessionReport),
  });

  const readEventsPayload = () => {
    const eventsList = parseEvents(safeRead(defaultPaths.events));
    return {
      path: defaultPaths.events,
      content: eventsList.map((e) => JSON.stringify(e)).join('\n'),
      eventsList,
    };
  };

  const readFileChangesPayload = () => {
    const entries = parseJsonLines(safeRead(defaultPaths.fileChanges));
    return {
      path: defaultPaths.fileChanges,
      entries,
    };
  };

  const readUiPromptsPayload = () => {
    const entries = parseJsonLines(safeRead(defaultPaths.uiPrompts));
    return {
      path: defaultPaths.uiPrompts,
      entries,
    };
  };

  const readRunsPayload = () => {
    const entries = parseJsonLines(safeRead(defaultPaths.runs));
    return {
      path: defaultPaths.runs,
      entries,
    };
  };

  return {
    readConfigPayload,
    readEventsPayload,
    readFileChangesPayload,
    readRunsPayload,
    readSessionPayload,
    readUiPromptsPayload,
  };
}
