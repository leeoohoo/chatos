import path from 'path';

import {
  parseEvents,
  parseInstalledPlugins,
  parseJsonSafe,
  parseModels,
  safeRead,
} from '../../packages/aide/shared/data/legacy.js';
import { createDb } from '../../packages/aide/shared/data/storage.js';
import { loadSystemPromptFromDb } from '../../packages/aide/src/prompts.js';
import { parseJsonLines, readTasksFromDbFile } from '../session-api-helpers.js';
import { TASK_TABLES } from '../../packages/common/admin-data/task-tables.js';

export function createSessionPayloadReaders({
  defaultPaths,
  adminServices,
  exposeSubagents,
  resolvedUiFlags,
  sanitizeAdminSnapshotForUi,
  chatRuntimePaths,
  chatRuntimeDb,
  chatRuntimeDbPath,
} = {}) {
  const sanitize =
    typeof sanitizeAdminSnapshotForUi === 'function' ? sanitizeAdminSnapshotForUi : (snapshot) => snapshot;
  const resolveChatDbPath = () => {
    if (typeof chatRuntimeDbPath === 'string' && chatRuntimeDbPath.trim()) {
      return chatRuntimeDbPath.trim();
    }
    if (chatRuntimeDb && typeof chatRuntimeDb.path === 'string' && chatRuntimeDb.path.trim()) {
      return chatRuntimeDb.path.trim();
    }
    return '';
  };
  const listChatDb = (table) => {
    if (chatRuntimeDb && typeof chatRuntimeDb.list === 'function') {
      return chatRuntimeDb.list(table) || [];
    }
    const dbPath = resolveChatDbPath();
    if (!dbPath) return [];
    try {
      const db = createDb({ dbPath });
      return db.list(table) || [];
    } catch {
      return [];
    }
  };

  const readConfigPayload = () => {
    const snapshot = adminServices.snapshot();
    const modelsList = snapshot.models || parseModels(safeRead(defaultPaths.models));
    const runtimeConfig = adminServices.settings?.getRuntimeConfig
      ? adminServices.settings.getRuntimeConfig()
      : null;
    const promptLanguage = runtimeConfig?.promptLanguage || null;
    const systemPromptConfig = loadSystemPromptFromDb(snapshot.prompts || [], {
      language: promptLanguage,
    });
    const promptPathLabel = '(admin.db)';
    const systemPromptMainInternal = systemPromptConfig.mainInternal || '';
    const systemDefaultPrompt = systemPromptConfig.defaultPrompt || '';
    const systemUserPrompt = systemPromptConfig.userPrompt || '';
    const subagentSystemPromptInternal = systemPromptConfig.subagentInternal || '';
    const subagentUserPrompt = systemPromptConfig.subagentUserPrompt || '';
    const prompts = {
      internal_main: systemPromptMainInternal,
      default: systemDefaultPrompt,
      user_prompt: systemUserPrompt,
      internal_subagent: subagentSystemPromptInternal,
      subagent_user_prompt: subagentUserPrompt,
    };
    const mcpServers = snapshot.mcpServers || [];
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
    const tasksList = readTasksFromDbFile(defaultPaths.adminDb, { tableName: TASK_TABLES.legacy });
    const tasksListCli = readTasksFromDbFile(defaultPaths.adminDb, { tableName: TASK_TABLES.cli });
    const tasksListChat = readTasksFromDbFile(defaultPaths.adminDb, { tableName: TASK_TABLES.chat });
    const eventsList = parseEvents(safeRead(defaultPaths.events));
    const adminState = sanitize(snapshot);
    const runtimeSettings = Array.isArray(snapshot.settings) ? snapshot.settings : [];
    const tasksJson = JSON.stringify({ tasks: tasksList || [] }, null, 2);
    const eventsContent = eventsList.map((e) => JSON.stringify(e)).join('\n');
    return {
      modelsPath: defaultPaths.models,
      models: safeRead(defaultPaths.models),
      modelsList,
      systemPromptPath: promptPathLabel,
      systemPrompt: systemPromptMainInternal,
      systemDefaultPromptPath: promptPathLabel,
      systemDefaultPrompt,
      systemUserPromptPath: promptPathLabel,
      systemUserPrompt,
      subagentSystemPromptPath: promptPathLabel,
      subagentSystemPrompt: subagentSystemPromptInternal,
      subagentUserPromptPath: promptPathLabel,
      subagentUserPrompt,
      prompts,
      mcpServers,
      marketplace,
      installedPlugins,
      sessionReportPath: defaultPaths.sessionReport,
      tasksPath: defaultPaths.tasks,
      tasks: tasksJson,
      tasksList,
      tasksListCli,
      tasksListChat,
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
    const dbEntries =
      typeof adminServices?.fileChanges?.list === 'function' ? adminServices.fileChanges.list() : null;
    const list = Array.isArray(dbEntries) ? dbEntries : [];
    const sorted = list
      .slice()
      .sort((a, b) => String(a?.ts || a?.createdAt || '').localeCompare(String(b?.ts || b?.createdAt || '')));
    return {
      path: defaultPaths.adminDb,
      entries: sorted,
      source: 'db',
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
    readChatConfigPayload: () => {
      const tasksListChat =
        (chatRuntimeDb && typeof chatRuntimeDb.list === 'function'
          ? chatRuntimeDb.list(TASK_TABLES.chat)
          : readTasksFromDbFile(resolveChatDbPath(), { tableName: TASK_TABLES.chat })) || [];
      return { tasksListChat };
    },
    readChatEventsPayload: () => {
      const eventsPath = chatRuntimePaths?.events || '';
      const eventsList = parseEvents(safeRead(eventsPath));
      return {
        path: eventsPath,
        content: eventsList.map((e) => JSON.stringify(e)).join('\n'),
        eventsList,
      };
    },
    readChatFileChangesPayload: () => {
      const list = listChatDb('fileChanges');
      const sorted = list
        .slice()
        .sort((a, b) => String(a?.ts || a?.createdAt || '').localeCompare(String(b?.ts || b?.createdAt || '')));
      return {
        path: resolveChatDbPath(),
        entries: sorted,
        source: 'db',
      };
    },
    readChatUiPromptsPayload: () => {
      const uiPromptsPath = chatRuntimePaths?.uiPrompts || '';
      const entries = parseJsonLines(safeRead(uiPromptsPath));
      return {
        path: uiPromptsPath,
        entries,
      };
    },
    readChatRunsPayload: () => {
      const runsPath = chatRuntimePaths?.runs || '';
      const entries = parseJsonLines(safeRead(runsPath));
      return {
        path: runsPath,
        entries,
      };
    },
  };
}
