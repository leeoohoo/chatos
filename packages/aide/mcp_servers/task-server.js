#!/usr/bin/env node
import path from 'path';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { clampNumber, parseArgs } from './cli-utils.js';
import { createDb } from '../shared/data/storage.js';
import { TaskService } from '../shared/data/services/task-service.js';
import { SettingsService } from '../shared/data/services/settings-service.js';
import { ensureAppDbPath, resolveUiPromptsPath } from '../shared/state-paths.js';
import { resolveSessionRoot } from '../shared/session-root.js';
import { createToolResponder } from './shared/tool-helpers.js';
import { createMcpServer } from './shared/server-bootstrap.js';
import { ensureDir, ensureFileExists } from './shared/fs-utils.js';
import { createPromptLog } from './task/prompt-log.js';
import { registerAddTaskTool } from './task/register-add-task.js';
import { registerTaskTools } from './task/register-task-tools.js';
import { createWriteQueue } from './task/utils.js';
import {
  createDedupeStore,
} from './shared/dedupe-store.js';
import { resolveTaskTableName } from '../../common/admin-data/task-tables.js';

const args = parseArgs(process.argv.slice(2));
if (args.help || args.h) {
  printHelp();
  process.exit(0);
}

const root = path.resolve(args.root || process.cwd());
const serverName = args.name || 'task_manager';
const { textResponse, structuredResponse } = createToolResponder({ serverName });
const sessionRoot = resolveSessionRoot();
const adminDbPath =
  process.env.MODEL_CLI_TASK_DB ||
  ensureAppDbPath(sessionRoot);
const promptLogPath =
  process.env.MODEL_CLI_UI_PROMPTS ||
  resolveUiPromptsPath(sessionRoot);
const promptLogMaxBytes = clampNumber(process.env.MODEL_CLI_UI_PROMPTS_MAX_BYTES, 0, 100 * 1024 * 1024, 5 * 1024 * 1024);
const promptLogMaxLines = clampNumber(process.env.MODEL_CLI_UI_PROMPTS_MAX_LINES, 0, 200_000, 5_000);
const promptLogLimits = { maxBytes: promptLogMaxBytes, maxLines: promptLogMaxLines };
const taskDedupeStorePath =
  process.env.MODEL_CLI_TASK_DEDUPE ||
  path.join(path.dirname(adminDbPath), 'task-dedupe.json');
const taskDedupeStore = createDedupeStore({
  filePath: taskDedupeStorePath,
  maxEntries: 5000,
  ttlMs: 7 * 24 * 60 * 60 * 1000,
  maxIdsPerKey: 20,
});
const enqueueTaskWrite = createWriteQueue();
const { appendPromptEntry, waitForPromptResponse, normalizeResponseStatus } = createPromptLog({
  promptLogPath,
  promptLogLimits,
  serverName,
});

ensureDir(root, { requireDirectory: true });
ensureDir(path.dirname(adminDbPath), { requireDirectory: true });
ensureFileExists(promptLogPath);

let taskDb = null;
let settingsDb = null;
try {
  const db = createDb({ dbPath: adminDbPath });
  const taskTable = resolveTaskTableName({ env: process.env });
  taskDb = new TaskService(db, { tableName: taskTable });
  settingsDb = new SettingsService(db);
  settingsDb.ensureRuntime();
} catch (err) {
  console.error(`[${serverName}] DB init failed: ${err.message}`);
  process.exit(1);
}

const { server, runId } = createMcpServer({ serverName, version: '0.1.0' });

registerTools();

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`[${serverName}] MCP task server ready (db=${relativePath(adminDbPath)}).`);
}

main().catch((err) => {
  console.error(`[${serverName}] crashed:`, err);
  process.exit(1);
});

function registerTools() {
  registerAddTaskTool({
    server,
    z,
    serverName,
    runId,
    taskDb,
    taskDedupeStore,
    enqueueTaskWrite,
    pickRunId,
    pickSessionId,
    settingsDb,
    structuredResponse,
    appendPromptEntry,
    waitForPromptResponse,
    normalizeResponseStatus,
  });

  registerTaskTools({
    server,
    z,
    textResponse,
    taskDb,
    enqueueTaskWrite,
    pickRunId,
    pickSessionId,
  });
}

function relativePath(target) {
  const rel = path.relative(root, target);
  if (!rel || rel.startsWith('..')) {
    return target;
  }
  return rel;
}

function pickSessionId(candidate) {
  const normalized = typeof candidate === 'string' ? candidate.trim() : '';
  if (normalized) return normalized;
  const fromEnv = typeof process.env.MODEL_CLI_SESSION_ID === 'string' ? process.env.MODEL_CLI_SESSION_ID.trim() : '';
  return fromEnv || '';
}

function pickRunId(candidate) {
  const normalized = typeof candidate === 'string' ? candidate.trim() : '';
  if (normalized) return normalized;
  const fromEnv = typeof process.env.MODEL_CLI_RUN_ID === 'string' ? process.env.MODEL_CLI_RUN_ID.trim() : '';
  return fromEnv || '';
}

function printHelp() {
  console.log(`Usage: node task-server.js [--root <path>] [--name <id>]

Options:
  --root <path>   Workspace root (default current directory)
  --name <id>     MCP server name (default task_manager)
  --help          Show help`);
}
