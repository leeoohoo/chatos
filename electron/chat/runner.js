import path from 'path';

import { createRestrictedSubAgentManager } from './subagent-restriction.js';
import { resolveAllowedTools } from './tool-selection.js';
import { createMcpRuntimeHelpers } from './mcp-runtime-helpers.js';
import { createMcpNotificationHandler } from './mcp-notifications.js';
import { createUiAppRegistryHelpers } from './ui-app-registry.js';
import { createConversationManager } from './conversation-manager.js';
import { buildSystemPrompt, normalizeAgentMode, normalizeId, normalizeWorkspaceRoot } from './runner-helpers.js';
import { loadEngineDeps } from './engine-deps.js';
import { formatLogValue } from './runner-log-utils.js';
import { runWithContextLengthRecovery } from '../../packages/common/context-recovery-utils.js';
import { appendEventLog } from '../../packages/common/event-log-utils.js';
import { isContextLengthError } from '../../packages/common/error-utils.js';
import { getMcpPromptNameForServer, normalizePromptLanguage } from '../../packages/common/mcp-utils.js';
import { appendPromptBlock } from '../../packages/common/prompt-utils.js';
import { applySecretsToProcessEnv } from '../../packages/common/secrets-env.js';
import { applyRuntimeSettingsToEnv } from '../../packages/common/runtime-settings-utils.js';
import { normalizeKey, uniqueIds } from '../../packages/common/text-utils.js';
import { extractTraceMeta } from '../../packages/common/trace-utils.js';
import { readRegistrySnapshot } from '../../packages/common/admin-data/registry-utils.js';



export function createChatRunner({
  adminServices,
  defaultPaths,
  sessionRoot,
  workspaceRoot,
  subAgentManager,
  uiApps,
  store,
  sendEvent,
} = {}) {
  if (!adminServices) throw new Error('adminServices is required');
  if (!defaultPaths?.models) throw new Error('defaultPaths.models is required');
  if (!store) throw new Error('store is required');
  if (typeof sendEvent !== 'function') throw new Error('sendEvent is required');

  const activeRuns = new Map();
  let mcpRuntime = null;
  let mcpInitPromise = null;
  let mcpWorkspaceRoot = '';
  let mcpInitWorkspaceRoot = '';
  let mcpConfigMtimeMs = null;
  let mcpSignature = '';
  let mcpInitSignature = '';
  const MCP_INIT_TIMEOUT_MS = 4_000;
  const MCP_INIT_TIMEOUT = Symbol('mcp_init_timeout');
  const eventLogPath =
    typeof defaultPaths?.events === 'string' && defaultPaths.events.trim() ? defaultPaths.events.trim() : '';
  const { computeMcpSignature, buildRuntimeMcpServers, resolveMcpConfigPath, readMcpConfigMtimeMs } =
    createMcpRuntimeHelpers({ defaultPaths });
  const { resolveUiAppAi, refreshUiAppsTrust, isUiAppTrusted, resolveUiAppRegistryAccess } =
    createUiAppRegistryHelpers({ uiApps, adminServices });
  const resolveMcpSessionId = (params) => {
    const explicit = normalizeId(params?.sessionId);
    if (explicit) return explicit;
    if (activeRuns.size === 1) {
      const [sid] = activeRuns.keys();
      return normalizeId(sid);
    }
    return '';
  };
  const handleMcpNotification = createMcpNotificationHandler({
    eventLogPath,
    appendEventLog,
    sendEvent,
    store,
    resolveMcpSessionId,
  });

  const dispose = async () => {
    for (const entry of activeRuns.values()) {
      try {
        entry.controller?.abort();
      } catch {
        // ignore
      }
    }
    activeRuns.clear();
    try {
      await mcpRuntime?.shutdown?.();
    } catch {
      // ignore
    }
    mcpRuntime = null;
    mcpInitPromise = null;
    mcpWorkspaceRoot = '';
    mcpInitWorkspaceRoot = '';
    mcpConfigMtimeMs = null;
    mcpSignature = '';
    mcpInitSignature = '';
  };

  const abort = (sessionId) => {
    const sid = normalizeId(sessionId);
    const entry = activeRuns.get(sid);
    if (!entry) return { ok: false, message: 'no active run' };
    try {
      entry.controller.abort();
    } catch {
      // ignore
    }
    if (store?.subagentStreams?.list && store?.subagentStreams?.markDone) {
      try {
        const streams = store.subagentStreams.list(sid) || [];
        streams.forEach((stream) => {
          if (stream?.done === true) return;
          const toolCallId = normalizeId(stream?.toolCallId);
          if (!toolCallId) return;
          store.subagentStreams.markDone(sid, toolCallId, 'cancelled');
        });
      } catch {
        // ignore
      }
    }
    return { ok: true };
  };

  const listActiveSessionIds = () => Array.from(activeRuns.keys());

  const ensureMcp = async ({
    timeoutMs = MCP_INIT_TIMEOUT_MS,
    workspaceRoot: desiredWorkspaceRoot,
    servers,
    extraServers,
    skipServers,
    emitEvent,
    eventLogger,
  } = {}) => {
    const notify = typeof emitEvent === 'function' ? emitEvent : sendEvent;
    const effectiveWorkspaceRoot =
      normalizeWorkspaceRoot(desiredWorkspaceRoot) || normalizeWorkspaceRoot(workspaceRoot) || process.cwd();
    const configPath = resolveMcpConfigPath() || defaultPaths.models;
    const baseDir = configPath ? path.dirname(configPath) : process.cwd();
    const useInlineServers = Array.isArray(servers);
    const signature = computeMcpSignature({
      servers: useInlineServers ? servers : extraServers,
      skipServers,
      baseDir,
      mode: useInlineServers ? 'inline' : 'config',
    });
    const currentMtime = useInlineServers ? null : readMcpConfigMtimeMs();
    const workspaceMatches = normalizeWorkspaceRoot(mcpWorkspaceRoot) === effectiveWorkspaceRoot;
    const configMatches =
      useInlineServers || currentMtime === null || mcpConfigMtimeMs === null ? true : currentMtime === mcpConfigMtimeMs;
    const signatureMatches = mcpSignature === signature;
    if (mcpRuntime && workspaceMatches && configMatches && signatureMatches) return mcpRuntime;
    if (
      mcpInitPromise &&
      (normalizeWorkspaceRoot(mcpInitWorkspaceRoot) !== effectiveWorkspaceRoot || mcpInitSignature !== signature)
    ) {
      try {
        await mcpInitPromise;
      } catch {
        // ignore
      }
    }
    if (mcpRuntime && (!workspaceMatches || !configMatches || !signatureMatches)) {
      try {
        await mcpRuntime?.shutdown?.();
      } catch {
        // ignore
      }
      mcpRuntime = null;
      mcpWorkspaceRoot = '';
      mcpConfigMtimeMs = null;
      mcpSignature = '';
    }
    if (!mcpInitPromise) {
      mcpInitWorkspaceRoot = effectiveWorkspaceRoot;
      mcpInitSignature = signature;
      mcpInitPromise = (async () => {
        try {
          const { initializeMcpRuntime } = await loadEngineDeps();
          mcpRuntime = await initializeMcpRuntime(configPath, sessionRoot, effectiveWorkspaceRoot, {
            caller: 'main',
            servers: useInlineServers ? servers : undefined,
            extraServers,
            skipServers,
            baseDir,
            onNotification: handleMcpNotification,
            eventLogger: eventLogger || null,
          });
          mcpWorkspaceRoot = effectiveWorkspaceRoot;
          mcpConfigMtimeMs = useInlineServers ? null : readMcpConfigMtimeMs();
          mcpSignature = signature;
        } catch (err) {
          mcpRuntime = null;
          mcpWorkspaceRoot = '';
          mcpConfigMtimeMs = null;
          mcpSignature = '';
          notify({
            type: 'notice',
            message: `[MCP] 初始化失败（root=${effectiveWorkspaceRoot}）：${err?.message || String(err)}`,
          });
        } finally {
          mcpInitPromise = null;
          mcpInitWorkspaceRoot = '';
          mcpInitSignature = '';
        }
        return mcpRuntime;
      })();
    }
    if (!timeoutMs || timeoutMs <= 0) {
      return mcpInitPromise;
    }
    let timer = null;
    try {
      const result = await Promise.race([
        mcpInitPromise,
        new Promise((resolve) => {
          timer = setTimeout(() => resolve(MCP_INIT_TIMEOUT), timeoutMs);
        }),
      ]);
      if (result === MCP_INIT_TIMEOUT) {
        notify({
          type: 'notice',
          message: `[MCP] 初始化超过 ${timeoutMs}ms，已跳过（后台仍会继续初始化）。`,
        });
        return null;
      }
      return result;
    } finally {
      if (timer) {
        try {
          clearTimeout(timer);
        } catch {
          // ignore
        }
      }
    }
  };

  const start = async ({
    sessionId,
    agentId,
    userMessageId,
    assistantMessageId,
    text,
    attachments,
    onComplete,
  } = {}) => {
    const sid = normalizeId(sessionId);
    const normalizedText = typeof text === 'string' ? text.trim() : '';
    const initialAssistantMessageId = normalizeId(assistantMessageId);
    if (!sid) throw new Error('sessionId is required');
    if (!normalizedText && (!Array.isArray(attachments) || attachments.length === 0)) {
      throw new Error('text is required');
    }
    if (!initialAssistantMessageId) throw new Error('assistantMessageId is required');

    if (activeRuns.has(sid)) {
      abort(sid);
    }

    const controller = new AbortController();
    activeRuns.set(sid, { controller, messageId: initialAssistantMessageId });
    const completionCallback = typeof onComplete === 'function' ? onComplete : null;

    const baseSendEvent = sendEvent;
    const sessionRecord = store.sessions.get(sid);
    const scopedSendEvent = baseSendEvent;
    const runId = typeof process.env.MODEL_CLI_RUN_ID === 'string' ? process.env.MODEL_CLI_RUN_ID.trim() : '';
    const eventLogger = eventLogPath
      ? {
          log: (type, payload) => appendEventLog(eventLogPath, type, payload, runId),
        }
      : null;

    const sessionWorkspaceRoot = normalizeWorkspaceRoot(sessionRecord?.workspaceRoot);
    const requestedAgentId = normalizeId(agentId);
    const effectiveAgentId = requestedAgentId || normalizeId(sessionRecord?.agentId);
    if (!effectiveAgentId) {
      throw new Error('agentId is required');
    }
    const agentRecord = effectiveAgentId ? store.agents.get(effectiveAgentId) : null;
    if (!agentRecord) {
      throw new Error('agent not found for session');
    }
    const agentMode = normalizeAgentMode(agentRecord?.mode);
    const agentLandConfigId = normalizeId(agentRecord?.landConfigId);
    const agentWorkspaceRoot = normalizeWorkspaceRoot(agentRecord?.workspaceRoot);
    const effectiveWorkspaceRoot =
      agentWorkspaceRoot || sessionWorkspaceRoot || normalizeWorkspaceRoot(workspaceRoot) || process.cwd();

    const models = adminServices.models.list();
    const modelRecord = models.find((m) => m?.id === agentRecord.modelId);
    if (!modelRecord) {
      throw new Error('model not found for agent');
    }
    const allowVisionInput = modelRecord.supportsVision === true;

    const {
      ChatSession,
      ModelClient,
      createAppConfigFromModels,
      runWithSubAgentContext,
      buildLandConfigSelection,
      resolveLandConfig,
      createSummaryManager,
      summarizeSession,
      estimateTokenCount,
      throwIfAborted,
      sanitizeToolResultForSession,
    } = await loadEngineDeps();

    applySecretsToProcessEnv(adminServices);
    const secrets = adminServices.secrets?.list ? adminServices.secrets.list() : [];
    const config = createAppConfigFromModels(models, secrets);
    const client = new ModelClient(config);

    const runtimeConfig = adminServices.settings?.getRuntimeConfig ? adminServices.settings.getRuntimeConfig() : null;
    applyRuntimeSettingsToEnv(runtimeConfig, { scope: 'electron' });
    const promptLanguage = runtimeConfig?.promptLanguage || null;
    const fallbackWorkspaceRoot = normalizeWorkspaceRoot(workspaceRoot) || process.cwd();
    const resolveToolWorkdir = () => {
      let sessionEntry = null;
      try {
        sessionEntry = store.sessions.get(sid);
      } catch {
        sessionEntry = null;
      }
      const sessionRoot = normalizeWorkspaceRoot(sessionEntry?.workspaceRoot);
      const sessionAgentId = normalizeId(sessionEntry?.agentId) || effectiveAgentId;
      let agentEntry = null;
      try {
        agentEntry = sessionAgentId ? store.agents.get(sessionAgentId) : null;
      } catch {
        agentEntry = null;
      }
      const agentRoot = normalizeWorkspaceRoot(agentEntry?.workspaceRoot);
      return agentRoot || sessionRoot || effectiveWorkspaceRoot || fallbackWorkspaceRoot;
    };
    const summaryConfigPath = typeof defaultPaths?.models === 'string' ? defaultPaths.models : null;
    const summaryManager = createSummaryManager({
      summaryThreshold: runtimeConfig?.summaryTokenThreshold,
      configPath: summaryConfigPath || undefined,
    });
    const summaryThreshold = summaryManager?.threshold;
    const summaryKeepRatio = summaryManager?.keepRatio;

    const prompts = adminServices.prompts.list();
    const subagents = adminServices.subagents.list();
    const mcpServers = adminServices.mcpServers.list();
    const serverById = new Map(
      (Array.isArray(mcpServers) ? mcpServers : [])
        .filter((srv) => srv?.id)
        .map((srv) => [String(srv.id), srv])
    );
    const serverByName = new Map(
      (Array.isArray(mcpServers) ? mcpServers : [])
        .filter((srv) => srv?.name && srv?.id)
        .map((srv) => [normalizeKey(srv.name), srv])
        .filter(([key]) => key)
    );
    const promptById = new Map(
      (Array.isArray(prompts) ? prompts : [])
        .filter((p) => p?.id)
        .map((p) => [String(p.id), p])
    );
    const promptByName = new Map(
      (Array.isArray(prompts) ? prompts : [])
        .filter((p) => p?.name)
        .map((p) => [normalizeKey(p.name), p])
        .filter(([key]) => key)
    );
    const subagentRouterIds = new Set(
      (Array.isArray(mcpServers) ? mcpServers : [])
        .filter((srv) => normalizeKey(srv?.name) === 'subagent_router')
        .map((srv) => normalizeId(srv?.id))
        .filter(Boolean)
    );
    const filterSubagentRouterIds = (ids) =>
      (Array.isArray(ids) ? ids : [])
        .map((id) => normalizeId(id))
        .filter((id) => id && !subagentRouterIds.has(id));
    const isFlowMode = agentMode === 'flow';
    let landSelection = null;
    if (isFlowMode) {
      const landConfigRecords = adminServices.landConfigs?.list ? adminServices.landConfigs.list() : [];
      const selectedLandConfig = resolveLandConfig({
        landConfigs: landConfigRecords,
        landConfigId: agentLandConfigId,
      });
      if (!selectedLandConfig) {
        throw new Error('Flow 模式需要有效的 Land Config，请在 Agent 中选择。');
      }
      const registrySnapshot = readRegistrySnapshot(adminServices);
      landSelection = buildLandConfigSelection({
        landConfig: selectedLandConfig,
        prompts,
        mcpServers,
        registryMcpServers: registrySnapshot.mcpServers,
        registryPrompts: registrySnapshot.prompts,
        registryMcpGrants: registrySnapshot.mcpGrants,
        registryPromptGrants: registrySnapshot.promptGrants,
        promptLanguage,
      });
      if (!landSelection) {
        throw new Error('Flow 模式无法解析 Land Config。');
      }
    }
    let effectiveAgent = agentRecord;
    let mergedPrompts = prompts;
    let mergedMcpServers = mcpServers;
    let systemPrompt = '';
    let mainUserPrompt = '';
    let subagentUserPrompt = '';
    let subagentMcpAllowPrefixes = null;
    let allowedMcpPrefixes = null;
    let runtimeMcpServers = [];
    let toolsOverride = null;
    let restrictedManager = null;
    if (!isFlowMode) {
    const derivedMcpServerIds = [];
    const derivedPromptIds = [];
    const derivedPromptNames = [];
    const missingUiAppServers = [];
    const missingUiAppPrompts = [];
    const deniedUiAppServers = [];
    const deniedUiAppPrompts = [];
    const extraMcpServers = [];
    const extraMcpRuntimeServers = [];
    const extraPrompts = [];
    const untrustedUiApps = new Set();

    await refreshUiAppsTrust();

    const uiRefs = Array.isArray(agentRecord?.uiApps) ? agentRecord.uiApps : [];
    for (const ref of uiRefs) {
      const pluginId = normalizeId(ref?.pluginId);
      const appId = normalizeId(ref?.appId);
      if (!pluginId || !appId) continue;
      if (!isUiAppTrusted(pluginId)) {
        untrustedUiApps.add(`${pluginId}.${appId}`);
        continue;
      }
      const serverName = `${pluginId}.${appId}`;
      const registryAccess = resolveUiAppRegistryAccess(pluginId, appId);
      const wantsMcp = ref?.mcp !== false;
      const wantsPrompt = ref?.prompt !== false;

      let resolvedContribution = undefined;
      const resolveContribution = async () => {
        if (resolvedContribution !== undefined) return resolvedContribution;
        if (!resolveUiAppAi) {
          resolvedContribution = null;
          return null;
        }
        try {
          resolvedContribution = await resolveUiAppAi({ pluginId, appId });
          return resolvedContribution;
        } catch {
          resolvedContribution = null;
          return null;
        }
      };

      if (wantsMcp) {
        const explicitMcpIds = Array.isArray(ref?.mcpServerIds)
          ? ref.mcpServerIds.map((id) => normalizeId(id)).filter(Boolean)
          : [];
        const explicitAllowedIds = [];
        if (explicitMcpIds.length > 0) {
          explicitMcpIds.forEach((id) => {
            const adminServer = serverById.get(id);
            if (adminServer) {
              if (registryAccess) {
                const allowedByName = registryAccess.serversByName.get(normalizeKey(adminServer?.name));
                if (allowedByName) {
                  explicitAllowedIds.push(id);
                }
              } else {
                explicitAllowedIds.push(id);
              }
              return;
            }
            if (registryAccess && registryAccess.serverIds.has(id)) {
              explicitAllowedIds.push(id);
            }
          });
        }

        if (explicitAllowedIds.length > 0) {
          explicitAllowedIds.forEach((id) => derivedMcpServerIds.push(id));
          if (registryAccess?.serversById) {
            explicitAllowedIds.forEach((id) => {
              if (serverById.has(id)) return;
              const record = registryAccess.serversById.get(id);
              if (!record?.url) return;
              extraMcpServers.push({
                id: record.id,
                name: record.name || record.provider_server_id || record.id,
                url: record.url,
                description: typeof record?.description === 'string' ? record.description : '',
                tags: Array.isArray(record?.tags) ? record.tags : [],
                enabled: record?.enabled !== false,
                auth: record?.auth || undefined,
                callMeta: record?.callMeta || undefined,
              });
              extraMcpRuntimeServers.push({
                name: record.name || record.provider_server_id || record.id,
                url: record.url,
                description: typeof record?.description === 'string' ? record.description : '',
                tags: Array.isArray(record?.tags) ? record.tags : [],
                enabled: record?.enabled !== false,
                auth: record?.auth || undefined,
                callMeta: record?.callMeta || undefined,
              });
            });
          }
        } else {
          const serverKey = normalizeKey(serverName);
          const srv = serverByName.get(serverKey);
          const registryAllowed = registryAccess?.serversByName?.get(serverKey) || null;
          if (srv?.id) {
            if (registryAccess && !registryAllowed) {
              deniedUiAppServers.push(serverName);
            } else {
              derivedMcpServerIds.push(srv.id);
            }
          } else {
            const contribute = await resolveContribution();
            const mcp = contribute?.mcp && typeof contribute.mcp === 'object' ? contribute.mcp : null;
            const mcpUrl = typeof mcp?.url === 'string' ? mcp.url.trim() : '';
            if (registryAccess && !registryAllowed) {
              deniedUiAppServers.push(serverName);
            } else if (mcpUrl) {
              const uiId = registryAllowed?.id || `uiapp:${serverName}`;
              const tags = Array.isArray(mcp?.tags) ? mcp.tags : [];
              const mergedTags = [
                ...tags,
                'uiapp',
                `uiapp:${pluginId}`,
                `uiapp:${pluginId}:${appId}`,
                `uiapp:${pluginId}.${appId}`,
              ];
              const enabled =
                typeof registryAllowed?.enabled === 'boolean'
                  ? registryAllowed.enabled
                  : typeof mcp?.enabled === 'boolean'
                    ? mcp.enabled
                    : true;
              const auth = registryAllowed?.auth || mcp?.auth || undefined;

              extraMcpServers.push({
                id: uiId,
                name: registryAllowed?.name || mcp?.name || serverName,
                url: registryAllowed?.url || mcpUrl,
                description: typeof registryAllowed?.description === 'string'
                  ? registryAllowed.description
                  : typeof mcp?.description === 'string'
                    ? mcp.description
                    : '',
                tags: Array.isArray(registryAllowed?.tags) ? registryAllowed.tags : mergedTags,
                enabled,
                auth,
                callMeta: registryAllowed?.callMeta || mcp?.callMeta || undefined,
              });
              extraMcpRuntimeServers.push({
                name: registryAllowed?.name || mcp?.name || serverName,
                url: registryAllowed?.url || mcpUrl,
                description: typeof registryAllowed?.description === 'string'
                  ? registryAllowed.description
                  : typeof mcp?.description === 'string'
                    ? mcp.description
                    : '',
                tags: Array.isArray(registryAllowed?.tags) ? registryAllowed.tags : mergedTags,
                enabled,
                auth,
                callMeta: registryAllowed?.callMeta || mcp?.callMeta || undefined,
              });
              derivedMcpServerIds.push(uiId);
            } else {
              missingUiAppServers.push(serverName);
            }
          }
        }
      }

      if (wantsPrompt) {
        const effectivePromptLang = normalizePromptLanguage(ref?.promptLang) || promptLanguage;
        const explicitPromptIds = Array.isArray(ref?.promptIds)
          ? ref.promptIds.map((id) => normalizeId(id)).filter(Boolean)
          : [];
        const explicitAllowedPromptIds = [];
        if (explicitPromptIds.length > 0) {
          explicitPromptIds.forEach((id) => {
            const adminPrompt = promptById.get(id);
            if (adminPrompt) {
              if (registryAccess) {
                const allowedByName = registryAccess.promptsByName.get(normalizeKey(adminPrompt?.name));
                if (allowedByName) {
                  explicitAllowedPromptIds.push(id);
                } else {
                  deniedUiAppPrompts.push(adminPrompt?.name || id);
                }
              } else {
                explicitAllowedPromptIds.push(id);
              }
              return;
            }

            if (registryAccess && registryAccess.promptIds.has(id)) {
              explicitAllowedPromptIds.push(id);
              const record = registryAccess.promptsById?.get(id);
              if (record?.content) {
                extraPrompts.push({
                  id: record.id,
                  name: record.name || record.provider_prompt_id || id,
                  title: typeof record?.title === 'string' ? record.title : '',
                  type: 'system',
                  content: String(record.content || '').trim(),
                  tags: Array.isArray(record?.tags) ? record.tags : [],
                });
              }
              return;
            }

            if (registryAccess) {
              deniedUiAppPrompts.push(id);
            }
          });
        }

        if (explicitAllowedPromptIds.length > 0) {
          explicitAllowedPromptIds.forEach((id) => derivedPromptIds.push(id));
          continue;
        }

        const preferredName = getMcpPromptNameForServer(serverName, effectivePromptLang).toLowerCase();
        const fallbackName = getMcpPromptNameForServer(serverName).toLowerCase();
        if (registryAccess) {
          const allowedPrompt =
            registryAccess.promptsByName.get(preferredName) ||
            (preferredName === fallbackName ? null : registryAccess.promptsByName.get(fallbackName));
          if (!allowedPrompt) {
            deniedUiAppPrompts.push(preferredName);
            continue;
          }
          const allowedName = normalizeKey(allowedPrompt?.name) || preferredName;
          const localPrompt = promptByName.get(allowedName);
          const localContent = typeof localPrompt?.content === 'string' ? localPrompt.content.trim() : '';
          if (localContent) {
            derivedPromptNames.push(allowedName);
            continue;
          }
          const registryContent = typeof allowedPrompt?.content === 'string' ? allowedPrompt.content.trim() : '';
          if (registryContent) {
            extraPrompts.push({
              id: allowedPrompt.id || `uiapp:${allowedName}`,
              name: allowedPrompt.name || allowedName,
              title: typeof allowedPrompt?.title === 'string' ? allowedPrompt.title : '',
              type: 'system',
              content: registryContent,
              tags: Array.isArray(allowedPrompt?.tags) ? allowedPrompt.tags : [],
            });
            derivedPromptNames.push(allowedName);
            continue;
          }
          missingUiAppPrompts.push(allowedName);
          continue;
        }

        const preferred = promptByName.get(preferredName);
        const preferredContent = typeof preferred?.content === 'string' ? preferred.content.trim() : '';
        if (preferredContent) {
          derivedPromptNames.push(preferredName);
          continue;
        }
        const fallback = preferredName === fallbackName ? null : promptByName.get(fallbackName);
        const fallbackContent = typeof fallback?.content === 'string' ? fallback.content.trim() : '';
        if (fallbackContent) {
          derivedPromptNames.push(fallbackName);
          continue;
        }

        const contribute = await resolveContribution();
        const prompt = contribute?.mcpPrompt && typeof contribute.mcpPrompt === 'object' ? contribute.mcpPrompt : null;
        const zhText = typeof prompt?.zh === 'string' ? prompt.zh.trim() : '';
        const enText = typeof prompt?.en === 'string' ? prompt.en.trim() : '';
        const lang = normalizePromptLanguage(effectivePromptLang) || 'zh';

        let pickedName = '';
        let pickedText = '';
        if (lang === 'en' && enText) {
          pickedName = preferredName;
          pickedText = enText;
        } else if (zhText) {
          pickedName = fallbackName;
          pickedText = zhText;
        } else if (enText) {
          pickedName = preferredName;
          pickedText = enText;
        }

        if (pickedName && pickedText) {
          extraPrompts.push({
            id: `uiapp:${pickedName}`,
            name: pickedName,
            title: typeof prompt?.title === 'string' ? prompt.title : '',
            type: 'system',
            content: pickedText,
          });
          derivedPromptNames.push(pickedName);
        } else {
          missingUiAppPrompts.push(preferredName);
        }
      }
    }

    if (missingUiAppServers.length > 0) {
      scopedSendEvent({
        type: 'notice',
        message: `[UI Apps] 未找到 MCP server：${missingUiAppServers.slice(0, 6).join(', ')}${
          missingUiAppServers.length > 6 ? ' ...' : ''
        }`,
      });
    }
    if (deniedUiAppServers.length > 0) {
      scopedSendEvent({
        type: 'notice',
        message: `[UI Apps] MCP server 未授权：${deniedUiAppServers.slice(0, 6).join(', ')}${
          deniedUiAppServers.length > 6 ? ' ...' : ''
        }`,
      });
    }
    if (missingUiAppPrompts.length > 0) {
      scopedSendEvent({
        type: 'notice',
        message: `[UI Apps] 未找到 Prompt：${missingUiAppPrompts.slice(0, 6).join(', ')}${
          missingUiAppPrompts.length > 6 ? ' ...' : ''
        }`,
      });
    }
    if (deniedUiAppPrompts.length > 0) {
      scopedSendEvent({
        type: 'notice',
        message: `[UI Apps] Prompt 未授权：${deniedUiAppPrompts.slice(0, 6).join(', ')}${
          deniedUiAppPrompts.length > 6 ? ' ...' : ''
        }`,
      });
    }
    if (untrustedUiApps.size > 0) {
      const list = Array.from(untrustedUiApps);
      scopedSendEvent({
        type: 'notice',
        message: `[UI Apps] 插件未受信任：${list.slice(0, 6).join(', ')}${list.length > 6 ? ' ...' : ''}`,
      });
    }

    const filteredAgentMcpIds = filterSubagentRouterIds(agentRecord?.mcpServerIds);
    const filteredDerivedMcpIds = filterSubagentRouterIds(derivedMcpServerIds);
    effectiveAgent = {
      ...agentRecord,
      mcpServerIds: uniqueIds([...filteredAgentMcpIds, ...filteredDerivedMcpIds]),
      promptIds: uniqueIds([
        ...(Array.isArray(agentRecord.promptIds) ? agentRecord.promptIds : []),
        ...derivedPromptIds,
      ]),
    };
    const hasUiApps = Array.isArray(agentRecord?.uiApps) && agentRecord.uiApps.length > 0;
    mergedPrompts = Array.isArray(extraPrompts) && extraPrompts.length > 0 ? [...prompts, ...extraPrompts] : prompts;
    mergedMcpServers =
      Array.isArray(extraMcpServers) && extraMcpServers.length > 0 ? [...mcpServers, ...extraMcpServers] : mcpServers;
    systemPrompt = buildSystemPrompt({
      agent: effectiveAgent,
      prompts: mergedPrompts,
      subagents,
      mcpServers: mergedMcpServers,
      language: promptLanguage,
      extraPromptNames: derivedPromptNames,
      autoMcpPrompts: !hasUiApps,
    });

    const extraRuntimeServers = Array.isArray(extraMcpRuntimeServers) ? extraMcpRuntimeServers : [];
    runtimeMcpServers = buildRuntimeMcpServers({
      selectedIds: effectiveAgent.mcpServerIds,
      servers: mergedMcpServers,
      extraServers: extraRuntimeServers,
    });
    const shouldInitMcp = runtimeMcpServers.length > 0;
    if (shouldInitMcp) {
      await ensureMcp({
        workspaceRoot: effectiveWorkspaceRoot,
        servers: runtimeMcpServers,
        emitEvent: scopedSendEvent,
        eventLogger,
      });
    }

    toolsOverride = resolveAllowedTools({
      agent: effectiveAgent,
      mcpServers: mergedMcpServers,
    });
    restrictedManager = subAgentManager
      ? createRestrictedSubAgentManager(subAgentManager, {
          allowedPluginIds: effectiveAgent.subagentIds,
          allowedSkills: effectiveAgent.skills,
        })
      : null;
    } else if (landSelection) {
      effectiveAgent = {
        ...agentRecord,
        prompt: '',
        promptIds: [],
        mcpServerIds: [],
        uiApps: [],
        subagentIds: [],
        skills: [],
      };
      systemPrompt = appendPromptBlock(landSelection.main.promptText, landSelection.main.mcpPromptText);
      subagentUserPrompt = appendPromptBlock(landSelection.sub.promptText, landSelection.sub.mcpPromptText);
      allowedMcpPrefixes = Array.from(
        new Set((landSelection.main?.selectedServerNames || []).map((name) => `mcp_${name}_`))
      );
      const subPrefixes = Array.from(
        new Set((landSelection.sub?.selectedServerNames || []).map((name) => `mcp_${name}_`))
      );
      subagentMcpAllowPrefixes = subPrefixes.length > 0 ? subPrefixes : ['__none__'];
      const landSelectedIds = [];
      const appendSelectedIds = (entries) => {
        (Array.isArray(entries) ? entries : []).forEach((entry) => {
          if (entry?.source !== 'admin') return;
          const id = normalizeId(entry?.server?.id);
          if (id) landSelectedIds.push(id);
        });
      };
      appendSelectedIds(landSelection.main?.selectedServers);
      appendSelectedIds(landSelection.sub?.selectedServers);
      runtimeMcpServers = buildRuntimeMcpServers({
        selectedIds: landSelectedIds,
        servers: mcpServers,
        extraServers: landSelection.extraMcpServers,
      });
      const shouldInitMcp = runtimeMcpServers.length > 0;
      if (shouldInitMcp) {
        await ensureMcp({
          workspaceRoot: effectiveWorkspaceRoot,
          servers: runtimeMcpServers,
          emitEvent: scopedSendEvent,
          eventLogger,
        });
      }
      toolsOverride = resolveAllowedTools({
        agent: effectiveAgent,
        mcpServers: mergedMcpServers,
        ...(Array.isArray(allowedMcpPrefixes) ? { allowedMcpPrefixes } : null),
      });
      restrictedManager = subAgentManager
        ? createRestrictedSubAgentManager(subAgentManager, {
            allowedPluginIds: effectiveAgent.subagentIds,
            allowedSkills: effectiveAgent.skills,
          })
        : null;
    }

    const touchSessionUpdatedAt = () => {
      try {
        store.sessions.update(sid, { updatedAt: new Date().toISOString() });
      } catch {
        // ignore
      }
    };
    const notifyMessagesRefresh = () => {
      scopedSendEvent({ type: 'messages_refresh', sessionId: sid });
    };
    const conversationManager = createConversationManager({
      store,
      sessionId: sid,
      userMessageId,
      initialAssistantMessageId,
      systemPrompt,
      allowVisionInput,
      summaryThreshold,
      summaryKeepRatio,
      summaryConfigPath,
      ChatSession,
      estimateTokenCount,
      summarizeSession,
      throwIfAborted,
      client,
      modelName: modelRecord.name,
      touchSessionUpdatedAt,
      notifyMessagesRefresh,
    });
    const getConversationSnapshot = conversationManager.getConversationSnapshot;
    const estimateConversationTokens = conversationManager.estimateConversationTokens;
    const summarizeConversation = async (options) => {
      const didSummarize = await conversationManager.summarizeConversation(options);
      chatSession = conversationManager.getChatSession();
      return didSummarize;
    };
    const hardTrimConversation = () => {
      conversationManager.hardTrimConversation();
      chatSession = conversationManager.getChatSession();
    };
    let chatSession = conversationManager.getChatSession();

    let currentAssistantId = initialAssistantMessageId;
    const assistantTexts = new Map([[currentAssistantId, '']]);
    const assistantReasonings = new Map([[currentAssistantId, '']]);
    const toolCallRefreshSent = new Set();

    const appendAssistantDelta = ({ map, messageId, delta, eventType }) => {
      const mid = normalizeId(messageId);
      if (!mid) return;
      const chunk = typeof delta === 'string' ? delta : String(delta || '');
      if (!chunk) return;
      const previous = map.get(mid) || '';
      map.set(mid, `${previous}${chunk}`);
      scopedSendEvent({ type: eventType, sessionId: sid, messageId: mid, delta: chunk });
    };

    const appendAssistantText = (messageId, delta) =>
      appendAssistantDelta({ map: assistantTexts, messageId, delta, eventType: 'assistant_delta' });

    const appendAssistantReasoning = (messageId, delta) =>
      appendAssistantDelta({
        map: assistantReasonings,
        messageId,
        delta,
        eventType: 'assistant_reasoning_delta',
      });

    const ensureAssistantBuffers = (messageId) => {
      const mid = normalizeId(messageId);
      if (!mid) return '';
      if (!assistantTexts.has(mid)) {
        assistantTexts.set(mid, '');
      }
      if (!assistantReasonings.has(mid)) {
        assistantReasonings.set(mid, '');
      }
      return mid;
    };

    const syncAssistantRecord = (messageId, patch) => {
      const mid = normalizeId(messageId);
      if (!mid) return;
      try {
        store.messages.update(mid, patch || {});
      } catch {
        // ignore
      }
    };
    const cleanupAssistantToolCalls = (messageId) => {
      const mid = normalizeId(messageId);
      if (!mid) return;
      let assistantRecord = null;
      let list = [];
      try {
        list = store.messages.list(sid);
        assistantRecord = list.find((msg) => normalizeId(msg?.id) === mid) || null;
      } catch {
        assistantRecord = null;
        list = [];
      }
      const toolCalls = Array.isArray(assistantRecord?.toolCalls) ? assistantRecord.toolCalls.filter(Boolean) : [];
      if (toolCalls.length === 0) return;
      const toolResultIds = new Set(
        list
          .filter((msg) => msg?.role === 'tool')
          .map((msg) => normalizeId(msg?.toolCallId))
          .filter(Boolean)
      );
      const filtered = toolCalls.filter((call) => toolResultIds.has(normalizeId(call?.id)));
      if (filtered.length === toolCalls.length) return;
      syncAssistantRecord(mid, { toolCalls: filtered });
    };

    const onBeforeRequest = async ({ iteration } = {}) => {
      const idx = Number.isFinite(iteration) ? iteration : 0;
      const preflightThreshold = Number.isFinite(summaryThreshold) ? summaryThreshold : 60000;
      if (preflightThreshold > 0) {
        const snapshot = getConversationSnapshot();
        const tokenCount = estimateConversationTokens(snapshot.conversation, snapshot.summaryRecord);
        const softLimit = Math.max(20000, Math.floor(preflightThreshold * 1.1));
        if (tokenCount > softLimit) {
          const didSummarize = await summarizeConversation({ force: true, signal: controller.signal });
          if (!didSummarize && tokenCount > softLimit * 1.2) {
            hardTrimConversation();
          }
        }
      }
      if (idx <= 0) {
        currentAssistantId = initialAssistantMessageId;
        ensureAssistantBuffers(currentAssistantId);
        activeRuns.set(sid, { controller, messageId: currentAssistantId });
        return;
      }
      let record = null;
      try {
        record = store.messages.create({ sessionId: sid, role: 'assistant', content: '' });
      } catch (err) {
        scopedSendEvent({ type: 'notice', message: `[Chat] 创建消息失败：${err?.message || String(err)}` });
        return;
      }
      currentAssistantId = ensureAssistantBuffers(record?.id) || currentAssistantId;
      activeRuns.set(sid, { controller, messageId: currentAssistantId });
      scopedSendEvent({ type: 'assistant_start', sessionId: sid, message: record });
    };

    const onToken = (delta) => {
      appendAssistantText(currentAssistantId, delta);
    };

    const onReasoning = (delta) => {
      appendAssistantReasoning(currentAssistantId, delta);
    };

    const onAssistantStep = ({ text, toolCalls, reasoning } = {}) => {
      const mid = normalizeId(currentAssistantId);
      if (!mid) return;
      const streamedText = assistantTexts.get(mid) || '';
      const fallbackText = typeof text === 'string' ? text : '';
      const currentText = streamedText || fallbackText;
      const streamedReasoning = assistantReasonings.get(mid) || '';
      const fallbackReasoning = typeof reasoning === 'string' ? reasoning : '';
      const currentReasoning = streamedReasoning || fallbackReasoning;
      const usableToolCalls = Array.isArray(toolCalls) && toolCalls.length > 0 ? toolCalls : null;
      const patch = {
        content: currentText,
        ...(usableToolCalls ? { toolCalls: usableToolCalls } : {}),
        ...(currentReasoning ? { reasoning: currentReasoning } : {}),
      };
      syncAssistantRecord(mid, patch);
      if (usableToolCalls && !toolCallRefreshSent.has(mid)) {
        toolCallRefreshSent.add(mid);
        notifyMessagesRefresh();
      }
    };

    const logToolEvent = (type, payload) => {
      if (!eventLogPath) return;
      appendEventLog(eventLogPath, type, payload, runId);
    };
    const onToolCall = ({ tool, callId, args, trace } = {}) => {
      const toolName = typeof tool === 'string' ? tool : '';
      const toolCallId = typeof callId === 'string' ? callId : '';
      const argsText = formatLogValue(args, 4000);
      const traceMeta = extractTraceMeta(trace);
      logToolEvent('tool_call', {
        tool: toolName,
        callId: toolCallId,
        ...(argsText ? { args: argsText } : {}),
        sessionId: sid,
        agentId: effectiveAgentId,
        caller: 'main',
        ...(traceMeta ? { trace: traceMeta } : {}),
      });
    };
    const onToolResult = ({ tool, callId, result, trace, structuredContent, isError } = {}) => {
      const toolName = typeof tool === 'string' ? tool : '';
      const toolCallId = typeof callId === 'string' ? callId : '';
      const rawContent = typeof result === 'string' ? result : String(result || '');
      const content =
        typeof sanitizeToolResultForSession === 'function'
          ? sanitizeToolResultForSession(rawContent, { tool: toolName })
          : rawContent;
      const toolStructuredContent =
        structuredContent && typeof structuredContent === 'object' ? structuredContent : null;
      const hasStructuredContent =
        toolStructuredContent && typeof toolStructuredContent === 'object'
          ? Object.keys(toolStructuredContent).length > 0
          : false;
      const toolIsError = isError === true;
      const record = store.messages.create({
        sessionId: sid,
        role: 'tool',
        toolCallId,
        toolName,
        content,
        ...(hasStructuredContent ? { toolStructuredContent } : {}),
        ...(toolIsError ? { toolIsError } : {}),
      });
      const resultText = formatLogValue(rawContent, 6000);
      const traceMeta = extractTraceMeta(trace);
      logToolEvent('tool_result', {
        tool: toolName,
        callId: toolCallId,
        ...(resultText ? { result: resultText } : {}),
        sessionId: sid,
        agentId: effectiveAgentId,
        caller: 'main',
        ...(traceMeta ? { trace: traceMeta } : {}),
      });
      scopedSendEvent({ type: 'tool_result', sessionId: sid, message: record });
      const normalizedTool = toolName.toLowerCase();
      if (
        toolCallId &&
        normalizedTool.includes('subagent_router') &&
        normalizedTool.includes('run_sub_agent') &&
        store?.subagentStreams?.markDone
      ) {
        try {
          store.subagentStreams.markDone(sid, toolCallId, toolIsError ? 'failed' : 'completed');
        } catch {
          // ignore
        }
      }
    };

    const run = async () => {
      try {
        let finalResponseText = '';
        const context = restrictedManager
          ? {
              manager: restrictedManager,
              getClient: () => client,
              getCurrentModel: () => modelRecord.name,
              userPrompt: mainUserPrompt,
              subagentUserPrompt,
              subagentMcpAllowPrefixes,
              toolHistory: null,
              registerToolResult: null,
              eventLogger: eventLogger || null,
            }
          : null;

        await summarizeConversation({ force: false, signal: controller.signal });

        const toolContext = Array.isArray(subagentMcpAllowPrefixes)
          ? { subagentMcpAllowPrefixes }
          : null;
        const runChat = async () =>
          client.chat(modelRecord.name, chatSession, {
            stream: true,
            toolsOverride,
            caller: 'main',
            signal: controller.signal,
            workdir: resolveToolWorkdir,
            onBeforeRequest,
            onToken,
            onReasoning,
            onAssistantStep,
            onToolCall,
            onToolResult,
            ...(toolContext ? { toolContext } : null),
          });

        const runChatOnce = async () => {
          if (context) {
            return await runWithSubAgentContext(context, runChat);
          }
          return await runChat();
        };

        finalResponseText = await runWithContextLengthRecovery({
          run: runChatOnce,
          summarize: () => summarizeConversation({ force: true, signal: controller.signal }),
          hardTrim: () => hardTrimConversation(),
          isContextLengthError,
          throwIfAborted,
          signal: controller.signal,
          retryIfSummarizeFailed: true,
        });

        const finalId = normalizeId(currentAssistantId) || initialAssistantMessageId;
        const finalText = assistantTexts.get(finalId) || finalResponseText || '';
        const finalReasoning = assistantReasonings.get(finalId) || '';
        syncAssistantRecord(
          finalId,
          finalReasoning ? { content: finalText, reasoning: finalReasoning } : { content: finalText }
        );
        touchSessionUpdatedAt();
        scopedSendEvent({ type: 'assistant_done', sessionId: sid, messageId: finalId });
        if (completionCallback) {
          try {
            completionCallback({
              ok: true,
              aborted: false,
              sessionId: sid,
              agentId: effectiveAgentId,
              messageId: finalId,
              text: finalText,
              reasoning: finalReasoning,
            });
          } catch {
            // ignore
          }
        }
      } catch (err) {
        const aborted = err?.name === 'AbortError' || controller.signal.aborted;
        const message = aborted ? '已停止' : err?.message || String(err);
        const mid = normalizeId(currentAssistantId) || initialAssistantMessageId;
        const existing = assistantTexts.get(mid) || '';
        const existingReasoning = assistantReasonings.get(mid) || '';
        syncAssistantRecord(mid, {
          content: existing || (aborted ? '' : `[error] ${message}`),
          ...(existingReasoning ? { reasoning: existingReasoning } : {}),
        });
        cleanupAssistantToolCalls(mid);
        touchSessionUpdatedAt();
        scopedSendEvent({
          type: aborted ? 'assistant_aborted' : 'assistant_error',
          sessionId: sid,
          messageId: mid,
          message,
        });
        if (completionCallback) {
          try {
            completionCallback({
              ok: false,
              aborted,
              sessionId: sid,
              agentId: effectiveAgentId,
              messageId: mid,
              text: existing || (aborted ? '' : `[error] ${message}`),
              reasoning: existingReasoning,
              error: message,
            });
          } catch {
            // ignore
          }
        }
      } finally {
        activeRuns.delete(sid);
      }
    };

    void run();
    return { ok: true, sessionId: sid, userMessageId, assistantMessageId: initialAssistantMessageId };
  };

  return { start, abort, dispose, listActiveSessionIds };
}
