#!/usr/bin/env node
import path from 'path';
import { fileURLToPath } from 'url';
import { performance } from 'perf_hooks';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { importEngineModule } from '../../../src/engine-loader.js';
import { resolveEventsPath } from '../shared/state-paths.js';
import { resolveSessionRoot } from '../shared/session-root.js';
import {
  jsonTextResponse,
  normalizeSkills,
  parseArgs,
  serializeAgent,
} from './subagent/utils.js';
import { createAsyncJobManager } from './subagent/async-jobs.js';
import { createAgentSelector } from './subagent/agent-selection.js';
import { createSubagentExecutor } from './subagent/executor.js';
import { resolveSubagentLandSelection } from './subagent/land-selection.js';
import { appendRunPid, registerProcessShutdownHooks } from './subagent/process-utils.js';
import { registerSubagentTools } from './subagent/register-tools.js';
import { createRuntimeConfigManager } from './subagent/runtime-config.js';

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
const configPath = typeof defaultPaths?.models === 'string' ? defaultPaths.models : '';
const SESSION_ROOT = resolveSessionRoot({ preferCwd: true });
const WORKSPACE_ROOT = process.env.MODEL_CLI_WORKSPACE_ROOT || process.env.MODEL_CLI_SESSION_ROOT || process.cwd();
const RUN_ID = typeof process.env.MODEL_CLI_RUN_ID === 'string' ? process.env.MODEL_CLI_RUN_ID.trim() : '';
let TOOL_ALLOW_PREFIXES = null;
const TOOL_DENY_PREFIXES = ['mcp_subagent_router_']; // block recursive routing; allow all other MCP tools
const eventLogPath =
  process.env.MODEL_CLI_EVENT_LOG ||
  defaultPaths?.events ||
  resolveEventsPath(SESSION_ROOT);
const eventLogger = createEventLogger(eventLogPath);
const HEARTBEAT_INTERVAL_MS = 10000;
const HEARTBEAT_STALE_MS = 120000;
const runtimeSettings =
  adminServices?.settings?.getRuntimeConfig ? adminServices.settings.getRuntimeConfig() : null;
const runtimeSubagentDefaultModel =
  typeof runtimeSettings?.subagentDefaultModel === 'string'
    ? runtimeSettings.subagentDefaultModel.trim()
    : '';
if (runtimeSubagentDefaultModel) {
  process.env.MODEL_CLI_SUBAGENT_DEFAULT_MODEL = runtimeSubagentDefaultModel;
}
const DEFAULT_MODEL_NAME = runtimeSubagentDefaultModel;
const runtimeConfigManager = createRuntimeConfigManager({
  adminServices,
  createAppConfigFromModels,
  ModelClient,
  initializeMcpRuntime,
  listTools,
  configPath,
  sessionRoot: SESSION_ROOT,
  workspaceRoot: WORKSPACE_ROOT,
  eventLogger,
  landSelection,
  serverName: 'subagent_router',
  getToolAllowPrefixes: () => TOOL_ALLOW_PREFIXES,
  toolDenyPrefixes: TOOL_DENY_PREFIXES,
});
const { loadAppConfig, getClient } = runtimeConfigManager;
const { pickAgent } = createAgentSelector({
  manager,
  selectAgent,
  loadAppConfig,
  getClient,
  defaultModelName: DEFAULT_MODEL_NAME,
  ChatSession,
  generateSessionId,
  logToken: (token) => {
    console.error(`[suggestAgentWithAI] token: ${JSON.stringify(token)}`);
  },
});
const executeSubAgent = createSubagentExecutor({
  manager,
  pickAgent,
  loadAppConfig,
  getClient,
  resolveSubagentInvocationModel,
  defaultModelName: DEFAULT_MODEL_NAME,
  ChatSession,
  generateSessionId,
  eventLogger,
  sessionRoot: SESSION_ROOT,
  runId: RUN_ID,
  isWorkerMode,
  adminServices,
  userPromptMessages,
  describeModelError,
  shouldFallbackToCurrentModelOnError,
});
const jobManager = createAsyncJobManager({
  performance,
  eventLogger,
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

if (landSelection) {
  const prefixes = Array.from(
    new Set((landSelection.sub?.selectedServerNames || []).map((name) => `mcp_${name}_`))
  );
  const missingServers = Array.isArray(landSelection.sub?.missingServers) ? landSelection.sub.missingServers : [];
  if (missingServers.length > 0) {
    const preview = missingServers
      .slice(0, 6)
      .map((entry) => {
        const label = entry?.name || entry?.id || 'unknown';
        const reason = entry?.reason || 'unknown';
        return `${label}:${reason}`;
      })
      .join(', ');
    console.error(
      `[land_config] sub flow MCP unresolved: ${preview}${missingServers.length > 6 ? ' ...' : ''}`
    );
  }
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
