import { extractTraceMeta } from '../../shared/trace-utils.js';
import { createCorrectionManager } from './corrections.js';
import { runSubagentChatLoop } from './chat-loop.js';
import { handleSubagentModelError } from './model-error.js';
import { resolveSubagentModels } from './model-selection.js';
import { resolveSubagentPrompt } from './prompt-selection.js';
import { finalizeSubagentRun, logSubagentStart } from './run-telemetry.js';
import { applyModelErrorResult, createRunState } from './run-state.js';
import { createSubagentStepTracker } from './step-tracker.js';
import { STEP_REASONING_LIMIT, STEP_TEXT_LIMIT, normalizeStepText } from './step-utils.js';
import { normalizeSkills, withSubagentGuardrails, withTaskTracking } from './utils.js';
import { filterSubagentTools } from '../../src/subagents/tooling.js';
import { normalizeMetaValue } from './meta-utils.js';

function normalizeAllowPrefixes(value) {
  if (!Array.isArray(value)) return null;
  const normalized = value.map((prefix) => String(prefix || '').trim()).filter(Boolean);
  return normalized.length > 0 ? normalized : null;
}

function buildToolsOverride(runState, allowMcpPrefixes) {
  if (!allowMcpPrefixes || !runState?.config?.getModel) return null;
  const settings = runState.config.getModel(runState.targetModel);
  const tools = Array.isArray(settings?.tools) ? settings.tools : [];
  return filterSubagentTools(tools, { allowMcpPrefixes });
}

export function createSubagentExecutor({
  manager,
  pickAgent,
  loadAppConfig,
  getClient,
  resolveSubagentInvocationModel,
  defaultModelName,
  ChatSession,
  generateSessionId,
  eventLogger,
  sessionRoot,
  runId,
  isWorkerMode,
  adminServices,
  userPromptMessages,
  describeModelError,
  shouldFallbackToCurrentModelOnError,
} = {}) {
  if (!manager) throw new Error('Missing subagent manager');
  if (typeof pickAgent !== 'function') throw new Error('Missing pickAgent');
  if (typeof loadAppConfig !== 'function') throw new Error('Missing loadAppConfig');
  if (typeof getClient !== 'function') throw new Error('Missing getClient');
  if (typeof resolveSubagentInvocationModel !== 'function') {
    throw new Error('Missing resolveSubagentInvocationModel');
  }
  if (typeof ChatSession !== 'function') throw new Error('Missing ChatSession');
  if (typeof generateSessionId !== 'function') throw new Error('Missing generateSessionId');

  const extraSystemPrompts = Array.isArray(userPromptMessages) ? userPromptMessages : [];
  const fallbackModelName = defaultModelName || '';

  return async function executeSubAgent({
    task,
    agentId,
    category,
    skills = [],
    model,
    callerModel,
    query,
    commandId,
    mcpAllowPrefixes,
    trace,
    userMessageId,
    progress,
  } = {}) {
    const traceMeta = extractTraceMeta(trace);
    const resolvedUserMessageId =
      typeof userMessageId === 'string' && userMessageId.trim()
        ? userMessageId.trim()
        : normalizeMetaValue(trace, ['userMessageId', 'user_message_id']);
    const toolContext = resolvedUserMessageId ? { userMessageId: resolvedUserMessageId } : null;
    const startedAt = Date.now();
    const agentRef = await pickAgent({ agentId, category, skills, query, commandId, task });
    if (!agentRef) {
      throw new Error('No sub-agent available; install relevant plugins first.');
    }
    const stepTracker = createSubagentStepTracker({
      eventLogger,
      agentId: agentRef.agent.id,
      progress,
      normalizeStepText,
      stepTextLimit: STEP_TEXT_LIMIT,
      stepReasoningLimit: STEP_REASONING_LIMIT,
    });
    const { steps, onAssistantStep, onToolCall, onToolResult, getStats, emitProgress } = stepTracker;
    const normalizedSkills = normalizeSkills(skills);
    const {
      systemPrompt,
      internalPrompt,
      usedSkills,
      reasoning,
      commandMeta,
      commandModel,
    } = resolveSubagentPrompt({
      manager,
      agentRef,
      task,
      normalizedSkills,
      commandId,
    });

    const config = await loadAppConfig();
    const client = getClient(config);
    const modelSelection = resolveSubagentModels({
      modelOverride: model,
      commandModel,
      agentModel: agentRef.agent.model || null,
      callerModel,
      config,
      client,
      resolveSubagentInvocationModel,
      defaultModelName: fallbackModelName,
    });
    const { configuredModel, normalizedCallerModel, defaultModel } = modelSelection;
    const runState = createRunState({
      config,
      client,
      targetModel: modelSelection.targetModel,
      fallbackModel: modelSelection.fallbackModel,
    });
    const allowMcpPrefixes = normalizeAllowPrefixes(mcpAllowPrefixes);
    const resolveToolsOverride = allowMcpPrefixes
      ? () => buildToolsOverride(runState, allowMcpPrefixes)
      : null;
    const sessionPrompt = withSubagentGuardrails(withTaskTracking(systemPrompt, internalPrompt));
    logSubagentStart({
      eventLogger,
      agentId: agentRef.agent.id,
      task,
      commandId: commandMeta?.id || null,
      model: runState.targetModel,
      traceMeta,
    });
    const session = new ChatSession(sessionPrompt, {
      sessionId: generateSessionId(task || ''),
      trailingSystemPrompts: internalPrompt ? [internalPrompt] : [],
      extraSystemPrompts,
    });
    session.addUser(task);

    const corrections = createCorrectionManager({
      runId,
      sessionRoot,
      isWorkerMode,
      eventLogger,
      agentId: agentRef.agent.id,
      traceMeta,
      session,
    });

    const handleModelError = async (err) => {
      const errorResult = await handleSubagentModelError({
        err,
        state: {
          loggedAuthDebug: runState.loggedAuthDebug,
          refreshedConfig: runState.refreshedConfig,
          usedFallbackModel: runState.usedFallbackModel,
        },
        config: runState.config,
        targetModel: runState.targetModel,
        fallbackModel: runState.fallbackModel,
        configuredModel,
        normalizedCallerModel,
        defaultModel: defaultModel || fallbackModelName,
        adminServices,
        sessionRoot,
        eventLogger,
        loadAppConfig,
        getClient,
        resolveSubagentInvocationModel,
        describeModelError,
        shouldFallbackToCurrentModelOnError,
        agentId: agentRef.agent.id,
        traceMeta,
        serverName: 'subagent_router',
      });
      applyModelErrorResult(runState, errorResult);
      return errorResult;
    };

    const response = await runSubagentChatLoop({
      runState,
      session,
      corrections,
      reasoning,
      traceMeta,
      toolContext,
      onAssistantStep,
      onToolCall,
      onToolResult,
      handleModelError,
      toolsOverride: resolveToolsOverride,
    });

    const stats = getStats(startedAt);
    const statsPayload = finalizeSubagentRun({
      eventLogger,
      agentId: agentRef.agent.id,
      commandId: commandMeta?.id || null,
      model: runState.targetModel,
      response,
      traceMeta,
      stats,
      emitProgress,
    });

    return {
      agentRef,
      usedSkills,
      commandMeta,
      targetModel: runState.targetModel,
      response,
      steps,
      trace: traceMeta || null,
      stats: statsPayload,
    };
  };
}
