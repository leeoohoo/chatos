import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

import { createRestrictedSubAgentManager } from './subagent-restriction.js';
import { resolveAllowedTools } from './tool-selection.js';
import { createMcpRuntimeHelpers } from './mcp-runtime-helpers.js';
import { createMcpNotificationHandler } from './mcp-notifications.js';
import { createUiAppRegistryHelpers } from './ui-app-registry.js';
import { buildSystemPrompt, normalizeAgentMode, normalizeId, normalizeWorkspaceRoot } from './runner-helpers.js';
import {
  SUMMARY_MESSAGE_NAME,
  appendSummaryText,
  extractLatestSummaryText,
  pickLatestSummaryMessage,
} from '../../packages/common/chat-summary-utils.js';
import { normalizeToolCallMessages } from '../../packages/common/chat-toolcall-utils.js';
import { buildUserMessageContent } from '../../packages/common/chat-utils.js';
import { computeTailStartIndex } from '../../packages/common/chat-tail-utils.js';
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
import { resolveEngineModule } from '../../src/engine-loader.js';
import { resolveEngineRoot } from '../../src/engine-paths.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..', '..');
const ENGINE_ROOT = resolveEngineRoot({ projectRoot });
if (!ENGINE_ROOT) {
  throw new Error('Engine sources not found (expected ./packages/aide relative to chatos).');
}

function resolveEngineModulePath(relativePath) {
  return resolveEngineModule({ engineRoot: ENGINE_ROOT, relativePath, allowMissing: true });
}

let engineDepsPromise = null;
async function loadEngineDeps() {
  if (engineDepsPromise) return engineDepsPromise;
  engineDepsPromise = (async () => {
    const [
      sessionMod,
      clientMod,
      configMod,
      mcpRuntimeMod,
      subagentRuntimeMod,
      toolsMod,
      landConfigMod,
      summaryMod,
      clientHelpersMod,
    ] = await Promise.all([
      import(pathToFileURL(resolveEngineModulePath('session.js')).href),
      import(pathToFileURL(resolveEngineModulePath('client.js')).href),
      import(pathToFileURL(resolveEngineModulePath('config.js')).href),
      import(pathToFileURL(resolveEngineModulePath('mcp/runtime.js')).href),
      import(pathToFileURL(resolveEngineModulePath('subagents/runtime.js')).href),
      import(pathToFileURL(resolveEngineModulePath('tools/index.js')).href),
      import(pathToFileURL(resolveEngineModulePath('land-config.js')).href),
      import(pathToFileURL(resolveEngineModulePath('chat/summary.js')).href),
      import(pathToFileURL(resolveEngineModulePath('client-helpers.js')).href),
    ]);
    return {
      ChatSession: sessionMod.ChatSession,
      ModelClient: clientMod.ModelClient,
      createAppConfigFromModels: configMod.createAppConfigFromModels,
      initializeMcpRuntime: mcpRuntimeMod.initializeMcpRuntime,
      runWithSubAgentContext: subagentRuntimeMod.runWithSubAgentContext,
      registerTool: toolsMod.registerTool,
      buildLandConfigSelection: landConfigMod.buildLandConfigSelection,
      resolveLandConfig: landConfigMod.resolveLandConfig,
      createSummaryManager: summaryMod.createSummaryManager,
      summarizeSession: summaryMod.summarizeSession,
      estimateTokenCount: summaryMod.estimateTokenCount,
      throwIfAborted: summaryMod.throwIfAborted,
      sanitizeToolResultForSession: clientHelpersMod.sanitizeToolResultForSession,
    };
  })();
  return engineDepsPromise;
}


function truncateLogText(value, limit = 4000) {
  const text = typeof value === 'string' ? value : value == null ? '' : String(value);
  if (!text) return '';
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)}...`;
}

function formatLogValue(value, limit = 4000) {
  if (value == null) return '';
  if (typeof value === 'string') return truncateLogText(value, limit);
  try {
    return truncateLogText(JSON.stringify(value), limit);
  } catch {
    return truncateLogText(String(value), limit);
  }
}

function normalizeConversationMessages(messages) {
  const { messages: normalized } = normalizeToolCallMessages(messages, {
    toolCallsKey: 'toolCalls',
    toolCallIdKey: 'toolCallId',
    normalizeId,
    pendingMode: 'strip',
  });
  return normalized;
}

function buildChatSessionFromMessages({
  ChatSession,
  sessionId,
  systemPrompt,
  messages,
  allowVisionInput,
  extraSystemPrompts,
  trailingSystemPrompts,
} = {}) {
  const { messages: normalizedMessages } = normalizeToolCallMessages(messages, {
    toolCallsKey: 'toolCalls',
    toolCallIdKey: 'toolCallId',
    normalizeId,
    pendingMode: 'strip',
  });
  const chatSession = new ChatSession(systemPrompt || null, {
    sessionId,
    ...(extraSystemPrompts ? { extraSystemPrompts } : {}),
  });
  if (trailingSystemPrompts) {
    chatSession.setTrailingSystemPrompts(trailingSystemPrompts);
  }
  normalizedMessages.forEach((msg) => {
    const role = msg?.role;
    if (role === 'user') {
      const content = buildUserMessageContent({
        text: msg?.content || '',
        attachments: msg?.attachments,
        allowVisionInput,
      });
      if (content) {
        chatSession.addUser(content);
      }
      return;
    }
    if (role === 'assistant') {
      const toolCalls = Array.isArray(msg?.toolCalls) ? msg.toolCalls.filter(Boolean) : null;
      const usableToolCalls = toolCalls && toolCalls.length > 0 ? toolCalls : null;
      const rawContent = msg?.content;
      const normalizedContent =
        usableToolCalls && (!rawContent || (typeof rawContent === 'string' && !rawContent.trim()))
          ? null
          : rawContent || '';
      chatSession.addAssistant(normalizedContent, usableToolCalls);
      return;
    }
    if (role === 'tool') {
      const callId = normalizeId(msg?.toolCallId);
      if (!callId) return;
      chatSession.addToolResult(callId, msg?.content || '', msg?.toolName || msg?.name);
    }
  });
  return chatSession;
}

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

    const listSessionMessages = () => store.messages.list(sid);
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
    const getConversationSnapshot = () => {
      const all = listSessionMessages();
      const summaryRecord = pickLatestSummaryMessage(all);
      const filtered = all
        .filter((msg) => msg?.id !== initialAssistantMessageId)
        .filter((msg) => msg?.role !== 'system');
      const conversation = normalizeConversationMessages(filtered);
      return { all, summaryRecord, conversation };
    };
    const buildRequestSession = () => {
      const snapshot = getConversationSnapshot();
      const summaryRecord = snapshot.summaryRecord;
      const trailingPrompts =
        summaryRecord && typeof summaryRecord?.content === 'string' && summaryRecord.content.trim()
          ? [{ content: summaryRecord.content, name: SUMMARY_MESSAGE_NAME }]
          : null;
      return buildChatSessionFromMessages({
        ChatSession,
        sessionId: sid,
        systemPrompt,
        messages: snapshot.conversation,
        allowVisionInput,
        trailingSystemPrompts: trailingPrompts,
      });
    };
    let chatSession = buildRequestSession();
    const rebuildChatSession = () => {
      chatSession = buildRequestSession();
      return chatSession;
    };

    const estimateConversationTokens = (conversation, summaryRecord) => {
      const parts = [];
      if (systemPrompt) {
        parts.push({ role: 'system', content: systemPrompt });
      }
      if (summaryRecord && typeof summaryRecord.content === 'string' && summaryRecord.content.trim()) {
        parts.push({ role: 'system', content: summaryRecord.content });
      }
      parts.push(...(Array.isArray(conversation) ? conversation : []));
      return estimateTokenCount(parts);
    };

    const summarizeConversation = async ({ force = false, signal } = {}) => {
      const defaultThreshold = 60000;
      const threshold = Number.isFinite(summaryThreshold) ? summaryThreshold : defaultThreshold;
      const targetThreshold = threshold > 0 ? threshold : defaultThreshold;
      if (!force && !(threshold > 0)) return false;
      const keepRatio =
        Number.isFinite(summaryKeepRatio) && summaryKeepRatio > 0 && summaryKeepRatio < 1
          ? summaryKeepRatio
          : 0.3;
      const maxPasses = force ? 6 : 3;
      let didSummarize = false;

      for (let pass = 0; pass < maxPasses; pass += 1) {
        if (typeof throwIfAborted === 'function') {
          throwIfAborted(signal);
        } else if (signal?.aborted) {
          throw new Error('aborted');
        }
        const snapshot = getConversationSnapshot();
        const conversation = snapshot.conversation;
        if (conversation.length < 2) return didSummarize;
        const tokenCount = estimateConversationTokens(conversation, snapshot.summaryRecord);
        if (!force && tokenCount <= threshold) return didSummarize;
        if (force && tokenCount <= targetThreshold && pass > 0) return didSummarize;

        const summarySession = buildChatSessionFromMessages({
          ChatSession,
          sessionId: sid,
          systemPrompt,
          messages: conversation,
          allowVisionInput,
          extraSystemPrompts:
            snapshot.summaryRecord && typeof snapshot.summaryRecord.content === 'string'
              ? [{ content: snapshot.summaryRecord.content, name: SUMMARY_MESSAGE_NAME }]
              : null,
        });

        let changed = false;
        try {
          changed = await summarizeSession(summarySession, client, modelRecord.name, {
            keepRatio,
            signal,
            configPath: summaryConfigPath || undefined,
          });
        } catch (err) {
          if (err?.name === 'AbortError' || signal?.aborted) {
            throw err;
          }
          console.error(`[summary] Failed: ${err?.message || String(err)}`);
          return didSummarize;
        }

        if (!changed) return didSummarize;
        const summaryText = extractLatestSummaryText(summarySession.messages);
        if (!summaryText) return didSummarize;
        const maxTailTokens = Math.max(2000, Math.floor(targetThreshold * 0.4));
        let effectiveKeepRatio = keepRatio;
        let tailStartIndex = computeTailStartIndex(conversation, effectiveKeepRatio, estimateTokenCount);
        if (tailStartIndex > 0) {
          let tailTokens = estimateTokenCount(conversation.slice(tailStartIndex));
          let guard = 0;
          while (tailTokens > maxTailTokens && effectiveKeepRatio > 0.05 && guard < 5) {
            effectiveKeepRatio = Math.max(0.05, effectiveKeepRatio * 0.5);
            tailStartIndex = computeTailStartIndex(conversation, effectiveKeepRatio, estimateTokenCount);
            if (tailStartIndex <= 0) break;
            tailTokens = estimateTokenCount(conversation.slice(tailStartIndex));
            guard += 1;
          }
        }
        if (tailStartIndex <= 0) return didSummarize;

        const tail = conversation.slice(tailStartIndex);
        const keepIds = new Set(tail.map((msg) => normalizeId(msg?.id)).filter(Boolean));
        const assistantId = normalizeId(initialAssistantMessageId);
        if (assistantId) keepIds.add(assistantId);
        const currentUserId = normalizeId(userMessageId);
        if (currentUserId) keepIds.add(currentUserId);

        let summaryId = null;
        if (snapshot.summaryRecord?.id) {
          summaryId = normalizeId(snapshot.summaryRecord.id);
          if (summaryId) {
            const combined = appendSummaryText(snapshot.summaryRecord.content, summaryText);
            store.messages.update(summaryId, {
              content: combined,
              name: SUMMARY_MESSAGE_NAME,
              hidden: true,
            });
          }
        } else {
          const created = store.messages.create({
            sessionId: sid,
            role: 'system',
            content: summaryText,
            name: SUMMARY_MESSAGE_NAME,
            hidden: true,
          });
          summaryId = normalizeId(created?.id);
        }
        if (summaryId) keepIds.add(summaryId);

        snapshot.all.forEach((msg) => {
          const mid = normalizeId(msg?.id);
          if (!mid || keepIds.has(mid)) return;
          store.messages.remove(mid);
        });
        touchSessionUpdatedAt();
        notifyMessagesRefresh();
        didSummarize = true;
      }

      if (didSummarize) {
        rebuildChatSession();
      }
      return didSummarize;
    };

    const hardTrimConversation = () => {
      const all = listSessionMessages();
      const summaryRecord = pickLatestSummaryMessage(all);
      const lastUser = (() => {
        for (let i = all.length - 1; i >= 0; i -= 1) {
          const msg = all[i];
          if (msg && msg.role === 'user') return msg;
        }
        return null;
      })();
      const keepIds = new Set();
      const assistantId = normalizeId(initialAssistantMessageId);
      if (assistantId) keepIds.add(assistantId);
      const currentUserId = normalizeId(userMessageId);
      if (currentUserId) keepIds.add(currentUserId);
      const summaryId = normalizeId(summaryRecord?.id);
      if (summaryId) keepIds.add(summaryId);
      const lastUserId = normalizeId(lastUser?.id);
      if (lastUserId) keepIds.add(lastUserId);
      all.forEach((msg) => {
        const mid = normalizeId(msg?.id);
        if (!mid || keepIds.has(mid)) return;
        store.messages.remove(mid);
      });
      touchSessionUpdatedAt();
      notifyMessagesRefresh();
      rebuildChatSession();
    };

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
