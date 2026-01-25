#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { performance } from 'perf_hooks';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { importEngineModule } from '../../../src/engine-loader.js';
import { resolveAppStateDir, resolveEventsPath } from '../shared/state-paths.js';
import { resolveSessionRoot } from '../shared/session-root.js';
import { extractTraceMeta } from '../shared/trace-utils.js';
import {
  filterAgents,
  jsonTextResponse,
  normalizeSkills,
  parseArgs,
  serializeAgent,
  withSubagentGuardrails,
  withTaskTracking,
} from './subagent/utils.js';
import { createAsyncJobManager } from './subagent/async-jobs.js';
import { createCorrectionManager } from './subagent/corrections.js';
import { resolveSubagentLandSelection } from './subagent/land-selection.js';
import { appendRunPid, registerProcessShutdownHooks } from './subagent/process-utils.js';
import { registerSubagentTools } from './subagent/register-tools.js';
import { createRuntimeConfigManager } from './subagent/runtime-config.js';
import { handleSubagentModelError } from './subagent/model-error.js';
import { resolveSubagentModels } from './subagent/model-selection.js';
import { resolveSubagentPrompt } from './subagent/prompt-selection.js';
import { createSubagentStepTracker } from './subagent/step-tracker.js';
import { STEP_REASONING_LIMIT, STEP_TEXT_LIMIT, normalizeStepText } from './subagent/step-utils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ENGINE_ROOT = path.resolve(__dirname, '..');

async function importEngine(relativePath) {
  return await importEngineModule({ engineRoot: ENGINE_ROOT, relativePath });
}

const [
  { createSubAgentManager },
  { selectAgent },
  { createAppConfigFromModels },
  { getAdminServices },
  { ModelClient },
  { ChatSession, generateSessionId },
  { initializeMcpRuntime },
  { listTools },
  { buildUserPromptMessages },
  { buildLandConfigSelection, resolveLandConfig },
  { createEventLogger },
  { resolveSubagentInvocationModel, describeModelError, shouldFallbackToCurrentModelOnError },
] = await Promise.all([
  importEngine('subagents/index.js'),
  importEngine('subagents/selector.js'),
  importEngine('config.js'),
  importEngine('config-source.js'),
  importEngine('client.js'),
  importEngine('session.js'),
  importEngine('mcp/runtime.js'),
  importEngine('tools/index.js'),
  importEngine('prompts.js'),
  importEngine('land-config.js'),
  importEngine('event-log.js'),
  importEngine('subagents/model.js'),
]);

const args = parseArgs(process.argv.slice(2));
const isWorkerMode = args.worker === true || args.worker === '1' || process.env.SUBAGENT_WORKER === '1';
const server = new McpServer({
  name: 'subagent_router',
  version: '0.1.0',
});
const CURRENT_FILE = fileURLToPath(import.meta.url);

const { services: adminServices, defaultPaths } = getAdminServices();
const {
  landSelection,
  combinedSubagentPrompt,
  missingMcpPromptNames,
  missingAppServers,
} = resolveSubagentLandSelection({
  adminServices,
  buildLandConfigSelection,
  resolveLandConfig,
});
const manager = createSubAgentManager({
  internalSystemPrompt: '',
});
const userPromptMessages = buildUserPromptMessages(combinedSubagentPrompt, 'subagent_user_prompt');
if (landSelection) {
  if (missingMcpPromptNames.length > 0) {
    console.error(
      `[prompts] Missing MCP prompt(s) for subagent_router subagent sessions: ${missingMcpPromptNames.join(', ')}`
    );
  }
  if (missingAppServers.length > 0) {
    console.error(
      `[land_config] Missing app MCP servers (subagent_router): ${missingAppServers.join(', ')}`
    );
  }
}
const mcpConfigPath =
  process.env.SUBAGENT_CONFIG_PATH ||
  args.config ||
  defaultPaths?.mcpConfig ||
  path.join(defaultPaths?.defaultsRoot || process.cwd(), 'shared', 'defaults', 'mcp.config.json');
const SESSION_ROOT = resolveSessionRoot({ preferCwd: true });
const WORKSPACE_ROOT = process.env.MODEL_CLI_WORKSPACE_ROOT || process.env.MODEL_CLI_SESSION_ROOT || process.cwd();
const RUN_ID = typeof process.env.MODEL_CLI_RUN_ID === 'string' ? process.env.MODEL_CLI_RUN_ID.trim() : '';
const TOOL_ALLOW_LIST = ['get_current_time', 'echo_text'];
let TOOL_ALLOW_PREFIXES = null;
const TOOL_DENY_PREFIXES = ['mcp_subagent_router_']; // block recursive routing; allow all other MCP tools
const eventLogPath =
  process.env.MODEL_CLI_EVENT_LOG ||
  defaultPaths?.events ||
  resolveEventsPath(SESSION_ROOT);
const eventLogger = createEventLogger(eventLogPath);
const HEARTBEAT_INTERVAL_MS = 10000;
const HEARTBEAT_STALE_MS = 120000;
const DEFAULT_MODEL_NAME = 'deepseek_chat';
const jobManager = createAsyncJobManager({
  performance,
  eventLogger,
  mcpConfigPath,
  sessionRoot: SESSION_ROOT,
  workspaceRoot: WORKSPACE_ROOT,
  eventLogPath,
  currentFile: CURRENT_FILE,
  runId: RUN_ID,
  heartbeatIntervalMs: HEARTBEAT_INTERVAL_MS,
  heartbeatStaleMs: HEARTBEAT_STALE_MS,
  executeSubAgent,
});
const {
  jobStore,
  buildJobResultPayload,
  createAsyncJob,
  startAsyncJob,
  formatJobStatus,
  hydrateStaleStatus,
  runWorkerJob,
} = jobManager;
const runtimeConfigManager = createRuntimeConfigManager({
  adminServices,
  createAppConfigFromModels,
  ModelClient,
  initializeMcpRuntime,
  listTools,
  mcpConfigPath,
  sessionRoot: SESSION_ROOT,
  workspaceRoot: WORKSPACE_ROOT,
  eventLogger,
  landSelection,
  serverName: 'subagent_router',
  getToolAllowPrefixes: () => TOOL_ALLOW_PREFIXES,
  toolDenyPrefixes: TOOL_DENY_PREFIXES,
});
const { loadAppConfig, getClient } = runtimeConfigManager;

if (landSelection) {
  const prefixes = Array.from(
    new Set((landSelection.sub?.selectedServerNames || []).map((name) => `mcp_${name}_`))
  );
  TOOL_ALLOW_PREFIXES = prefixes.length > 0 ? prefixes : ['__none__'];
}

appendRunPid({
  pid: process.pid,
  kind: isWorkerMode ? 'subagent_worker' : 'mcp',
  name: 'subagent_router',
  runId: RUN_ID,
  sessionRoot: SESSION_ROOT,
});
registerProcessShutdownHooks({ isWorkerMode, getJobStore: () => jobStore });

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('[subagent_router] ready');
}

if (isWorkerMode) {
  runWorkerJob().catch((err) => {
    console.error('[subagent_router worker] crashed:', err);
    process.exit(1);
  });
} else {
  registerSubagentTools({
    server,
    z,
    manager,
    jsonTextResponse,
    serializeAgent,
    normalizeSkills,
    pickAgent,
    executeSubAgent,
    buildJobResultPayload,
    createAsyncJob,
    startAsyncJob,
    formatJobStatus,
    hydrateStaleStatus,
    getJobStore: () => jobStore,
    performance,
  });
  main().catch((err) => {
    console.error('[subagent_router] crashed:', err);
    process.exit(1);
  });
}

async function pickAgent({ agentId, category, skills, query, commandId, task }) {
  if (agentId) {
    const ref = manager.getAgent(agentId);
    if (!ref) return null;
    if (commandId && !hasCommand(ref, commandId)) return null;
    return ref;
  }
  
  // Try AI-based suggestion if task is provided
  if (task) {
    try {
      const aiResult = await suggestAgentWithAI(manager.listAgents(), task, { category, query, commandId });
      if (aiResult && aiResult.agent_id && aiResult.confidence > 0.6) {
        const aiRef = manager.getAgent(aiResult.agent_id);
        if (aiRef) {
          return aiRef;
        }
      }
    } catch (err) {
      // ignore AI errors and fall back to rule-based
    }
  }

  const candidates = filterAgents(manager.listAgents(), {
    filterCategory: category,
    query: commandId ? commandId : query,
  }).filter((agent) => (commandId ? hasCommand(agent, commandId) : true));
  if (candidates.length === 0) {
    return selectAgent(manager, { category, skills, query: commandId || query });
  }
  const first = candidates[0];
  return manager.getAgent(first.id) || selectAgent(manager, { category, skills, query });
}

function hasCommand(agentOrRef, commandId) {
  if (!commandId) return true;
  const needle = String(commandId).toLowerCase().trim();
  if (!needle) return true;
  if (!agentOrRef) return false;

  // `hasCommand` is used with two different shapes:
  // 1) items from `manager.listAgents()` which include a `commands` array
  // 2) an `{ plugin, agent }` ref from `manager.getAgent()`
  const commands =
    (Array.isArray(agentOrRef.commands) && agentOrRef.commands) ||
    (Array.isArray(agentOrRef.agent?.commands) && agentOrRef.agent.commands) ||
    (Array.isArray(agentOrRef.plugin?.commands) && agentOrRef.plugin.commands) ||
    [];

  if (commands.length > 0) {
    return commands.some((c) => {
      const id = typeof c === 'string' ? c : c?.id || '';
      const name = typeof c === 'string' ? c : c?.name || '';
      return id.toLowerCase().includes(needle) || name.toLowerCase().includes(needle);
    });
  }

  // Fallback for plugins that only expose a commandMap.
  const map = agentOrRef.plugin?.commandMap;
  if (map && typeof map.get === 'function') {
    for (const [id, cmd] of map.entries()) {
      const name = cmd?.name || '';
      if (String(id).toLowerCase().includes(needle) || String(name).toLowerCase().includes(needle)) {
        return true;
      }
    }
  }

  return false;
}

async function executeSubAgent({
  task,
  agentId,
  category,
  skills = [],
  model,
  callerModel,
  query,
  commandId,
  trace,
  progress,
}) {
  const traceMeta = extractTraceMeta(trace);
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

  let config = await loadAppConfig();
  let client = getClient(config);
  const {
    configuredModel,
    normalizedCallerModel,
    defaultModel,
    targetModel,
    fallbackModel,
  } = resolveSubagentModels({
    modelOverride: model,
    commandModel,
    agentModel: agentRef.agent.model || null,
    callerModel,
    config,
    client,
    resolveSubagentInvocationModel,
    defaultModelName: DEFAULT_MODEL_NAME,
  });
  let usedFallbackModel = false;
  const sessionPrompt = withSubagentGuardrails(withTaskTracking(systemPrompt, internalPrompt));
  eventLogger?.log?.('subagent_start', {
    agent: agentRef.agent.id,
    task,
    command: commandMeta?.id || null,
    model: targetModel,
    trace: traceMeta || undefined,
  });
  const session = new ChatSession(sessionPrompt, {
    sessionId: generateSessionId(task || ''),
    trailingSystemPrompts: internalPrompt ? [internalPrompt] : [],
    extraSystemPrompts: userPromptMessages,
  });
  session.addUser(task);

  const corrections = createCorrectionManager({
    runId: RUN_ID,
    sessionRoot: SESSION_ROOT,
    isWorkerMode,
    eventLogger,
    agentId: agentRef.agent.id,
    traceMeta,
    session,
  });

  let response;
  let refreshedConfig = false;
  let loggedAuthDebug = false;
  try {
    for (let attempt = 0; attempt < 40; attempt += 1) {
      corrections.applyCorrections();
      const controller = new AbortController();
      corrections.setActiveController(controller);
      try {
        // eslint-disable-next-line no-await-in-loop
        response = await client.chat(targetModel, session, {
          stream: true, // align with main flow to reduce request size/buffered responses
          reasoning,
          trace: traceMeta || undefined,
          signal: controller.signal,
          onAssistantStep,
          onToolCall,
          onToolResult,
        });
        break;
      } catch (err) {
        if (err?.name === 'AbortError') {
          if (corrections.hasPending()) {
            continue;
          }
        }
        const errorResult = await handleSubagentModelError({
          err,
          state: { loggedAuthDebug, refreshedConfig, usedFallbackModel },
          config,
          targetModel,
          fallbackModel,
          configuredModel,
          normalizedCallerModel,
          defaultModel: defaultModel || DEFAULT_MODEL_NAME,
          adminServices,
          sessionRoot: SESSION_ROOT,
          mcpConfigPath,
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
        loggedAuthDebug = errorResult.state.loggedAuthDebug;
        refreshedConfig = errorResult.state.refreshedConfig;
        usedFallbackModel = errorResult.state.usedFallbackModel;
        if (errorResult.config) {
          config = errorResult.config;
        }
        if (errorResult.client) {
          client = errorResult.client;
        }
        if (errorResult.targetModel) {
          targetModel = errorResult.targetModel;
        }
        if (errorResult.action === 'retry') {
          continue;
        }
        throw err;
      } finally {
        corrections.clearActiveController(controller);
      }
    }
  } finally {
    corrections.close();
  }

  if (response === undefined) {
    throw new Error('Sub-agent was interrupted too many times; no final response produced.');
  }

  const responsePreview =
    typeof response === 'string' ? response : JSON.stringify(response || {});
  eventLogger?.log?.('subagent_done', {
    agent: agentRef.agent.id,
    model: targetModel,
    command: commandMeta?.id || null,
    responsePreview,
    trace: traceMeta || undefined,
  });

  const { elapsedMs, toolCallCount, toolResultCount, stepsCount } = getStats(startedAt);

  if (emitProgress) {
    try {
      emitProgress({
        stage: 'done',
        done: true,
        stats: {
          elapsed_ms: elapsedMs,
          steps: stepsCount,
          tool_calls: toolCallCount,
          tool_results: toolResultCount,
        },
      });
    } catch {
      // ignore progress failures
    }
  }

  return {
    agentRef,
    usedSkills,
    commandMeta,
    targetModel,
    response,
    steps,
    trace: traceMeta || null,
    stats: {
      elapsed_ms: elapsedMs,
      steps: stepsCount,
      tool_calls: toolCallCount,
      tool_results: toolResultCount,
    },
  };
}

async function suggestAgentWithAI(agents, task, hints = {}) {
  const summaries = agents.map(summarizeAgentForPrompt);
  const hintText = [
    hints.category ? `Preferred Category: ${hints.category}` : '',
    hints.query ? `Search Query: ${hints.query}` : '',
    hints.commandId ? `Required Command: ${hints.commandId}` : ''
  ].filter(Boolean).join('\n');

  const systemPrompt = `You are an intelligent router for a multi-agent system.
Your task is to select the most suitable sub-agent for the user's request.

Available Agents:
${JSON.stringify(summaries, null, 2)}

User Request: "${task}"
${hintText}

Analyze the request and available agents.
Return a JSON object with the following structure (no markdown formatting, just raw JSON):
{
  "agent_id": "The ID of the chosen agent",
  "reason": "A brief explanation of why this agent was chosen",
  "confidence": 0.0 to 1.0
}`;

  const config = await loadAppConfig();
  const client = getClient(config);
  
  // Use the default model for routing (matching CLI behavior)
  const model = config.defaultModel || Object.keys(config.models)[0] || DEFAULT_MODEL_NAME;
  
  if (!model) {
      return null;
  }

  const session = new ChatSession(systemPrompt, {
    sessionId: generateSessionId('router_' + Date.now()),
  });
  // We already put the task in the system prompt context, but adding a user message triggers the generation
  session.addUser('Please analyze the request and select the best agent in JSON format.');

  try {
    let fullText = '';
    await client.chat(model, session, {
      stream: true,
      reasoning: false,
      
      onToken: (token) => {
        console.error(`[suggestAgentWithAI] token: ${JSON.stringify(token)}`);
        fullText += token;
      }
    });
    
    const text = fullText;
    // Clean up markdown code blocks if present
    const cleanText = text.replace(/```json\n?|\n?```/g, '').trim();
    // Find the first '{' and last '}'
    const start = cleanText.indexOf('{');
    const end = cleanText.lastIndexOf('}');
    if (start >= 0 && end >= 0) {
        return JSON.parse(cleanText.substring(start, end + 1));
    }
    return JSON.parse(cleanText);
  } catch (err) {
    console.error('[suggestAgentWithAI] Error:', err);
    return null;
  }
}

function summarizeAgentForPrompt(agent) {
  return {
    id: agent.id,
    name: agent.name,
    description: agent.description,
    category: agent.category || agent.pluginCategory,
    skills: (agent.skills || []).map(s => s.id),
    commands: (agent.commands || []).map(c => typeof c === 'string' ? c : c.id || c.name)
  };
}
