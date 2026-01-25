#!/usr/bin/env node
import path from 'path';
import crypto from 'crypto';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { clampNumber, parseArgs } from './cli-utils.js';
import { createDb } from '../shared/data/storage.js';
import { TaskService } from '../shared/data/services/task-service.js';
import { SettingsService } from '../shared/data/services/settings-service.js';
import { createTtyPrompt } from './tty-prompt.js';
import { ensureAppDbPath, resolveUiPromptsPath } from '../shared/state-paths.js';
import { resolveSessionRoot } from '../shared/session-root.js';
import { createToolResponder } from './shared/tool-helpers.js';
import { createMcpServer } from './shared/server-bootstrap.js';
import { ensureDir, ensureFileExists } from './shared/fs-utils.js';
import { createPromptLog } from './task/prompt-log.js';
import { confirmTaskCreation } from './task/confirm.js';
import {
  buildTaskConfirmChanges,
  buildTaskConfirmSummary,
  buildTaskDedupeKey,
  createWriteQueue,
  dedupeTasksById,
  formatTaskList,
  normalizeCallerKind,
  normalizeTags,
  normalizeTaskPriority,
  normalizeTaskStatus,
  pickCallerKind,
  renderTaskSummary,
  safeTrim,
} from './task/utils.js';
import {
  createDedupeStore,
  readDedupeEntry,
  writeDedupeEntry,
  removeDedupeEntry,
  flushDedupeStore,
} from './shared/dedupe-store.js';

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
const callerKind = normalizeCallerKind(process.env.MODEL_CLI_CALLER);
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
  taskDb = new TaskService(db);
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
  const singleTaskInput = z
    .object({
      title: z.string().min(1).describe('Task title'),
      details: z.string().optional().describe('Context or acceptance criteria'),
      priority: z.enum(['high', 'medium', 'low']).optional().describe('Priority (default medium)'),
      status: z.enum(['todo', 'doing', 'blocked', 'done']).optional().describe('Initial status (default todo)'),
      tags: z.array(z.string()).optional().describe('Tags, e.g., ["backend","release"]'),
      dedupe_key: z.string().optional().describe('Optional idempotency key to dedupe repeated calls'),
      runId: z.string().optional().describe('Run ID (optional; defaults to current run)'),
      sessionId: z.string().optional().describe('Session ID (optional; defaults to current session)'),
      caller: z
        .string()
        .optional()
        .describe('Caller kind override ("main" | "subagent"). Used to decide which confirmation toggle applies.'),
    })
    .strict();

  const batchTaskInput = z.array(singleTaskInput).min(1);

  const addTaskInputSchema = z
    .object({
      title: z.string().min(1).optional().describe('Task title'),
      details: z.string().optional().describe('Context or acceptance criteria'),
      priority: z.enum(['high', 'medium', 'low']).optional().describe('Priority (default medium)'),
      status: z.enum(['todo', 'doing', 'blocked', 'done']).optional().describe('Initial status (default todo)'),
      tags: z.array(z.string()).optional().describe('Tags, e.g., ["backend","release"]'),
      dedupe_key: z.string().optional().describe('Optional idempotency key to dedupe repeated calls'),
      tasks: z
        .union([batchTaskInput, z.string()])
        .optional()
        .describe('Batch of tasks to create (array or JSON string)'),
      runId: z.string().optional().describe('Run ID (optional; defaults to current run)'),
      sessionId: z.string().optional().describe('Session ID (optional; defaults to current session)'),
      caller: z
        .string()
        .optional()
        .describe('Caller kind override ("main" | "subagent"). Used to decide which confirmation toggle applies.'),
    })
    .strict();

  const normalizeAddTaskPayload = (payload) => {
    const base = payload && typeof payload === 'object' ? payload : {};
    let tasks = base.tasks;

    if (typeof tasks === 'string') {
      const raw = tasks.trim();
      if (!raw) {
        throw new Error('tasks 为空时请省略该字段，或提供 JSON 数组字符串。');
      }
      let parsed;
      try {
        parsed = JSON.parse(raw);
      } catch {
        throw new Error('tasks 必须是 JSON 数组字符串，例如: [{"title":"Fix login bug"}]。');
      }
      if (!Array.isArray(parsed)) {
        throw new Error('tasks 必须是 JSON 数组字符串，例如: [{"title":"Fix login bug"}]。');
      }
      const validated = batchTaskInput.safeParse(parsed);
      if (!validated.success) {
        const first = validated.error?.errors?.[0];
        const detail = first?.message ? `（${first.message}）` : '';
        throw new Error(`tasks JSON 数组校验失败${detail}`);
      }
      tasks = validated.data;
    }

    if (Array.isArray(tasks)) {
      if (tasks.length === 0) {
        throw new Error('tasks 至少包含 1 项任务。');
      }
    } else {
      const title = typeof base.title === 'string' ? base.title.trim() : '';
      if (!title) {
        throw new Error('add_task 需要提供 title 或 tasks。');
      }
    }

    return tasks === undefined ? base : { ...base, tasks };
  };

  server.registerTool(
    'add_task',
    {
      title: 'Add task',
      description:
        [
          'Create one or more tasks with priority, tags, and details.',
          'Examples: {"title":"Fix login bug","priority":"high","tags":["frontend","bug"]} or {"tasks":[{"title":"Write docs"},{"title":"Add tests","priority":"medium","tags":["qa"]}]}',
        ].join('\n'),
      inputSchema: addTaskInputSchema,
    },
    async (payload) => {
      const normalizedPayload = normalizeAddTaskPayload(payload);
      const runDefault = pickRunId(normalizedPayload.runId);
      const sessionDefault = pickSessionId(normalizedPayload.sessionId);
      const inputs =
        Array.isArray(normalizedPayload.tasks) && normalizedPayload.tasks.length > 0
          ? normalizedPayload.tasks
          : [normalizedPayload];

      const requestCallerKind = pickCallerKind(normalizedPayload?.caller, callerKind);
      const shouldConfirm = shouldConfirmTaskCreate(requestCallerKind);
      const draftTasks = inputs.map((item, idx) => {
        const resolvedRunId = pickRunId(item?.runId) || runDefault;
        const resolvedSessionId = pickSessionId(item?.sessionId) || sessionDefault;
        const dedupeKey = buildTaskDedupeKey(item?.dedupe_key, {
          runId: resolvedRunId,
          sessionId: resolvedSessionId,
        });
        return {
          draftId: crypto.randomUUID(),
          title: typeof item?.title === 'string' ? item.title : '',
          details: typeof item?.details === 'string' ? item.details : '',
          priority: typeof item?.priority === 'string' ? item.priority : '',
          status: typeof item?.status === 'string' ? item.status : '',
          tags: Array.isArray(item?.tags) ? item.tags : [],
          runId: resolvedRunId,
          sessionId: resolvedSessionId,
          dedupeKey,
          _index: idx,
        };
      });
      const promptRunId =
        draftTasks.find((task) => typeof task?.runId === 'string' && task.runId.trim())?.runId ||
        runDefault ||
        runId;

      let confirmed = { status: 'ok', tasks: draftTasks, remark: '' };
      if (shouldConfirm) {
        const promptTitle = requestCallerKind === 'subagent' ? '子流程任务创建确认' : '主流程任务创建确认';
        const promptMessage =
          'AI 请求创建任务。你可以新增/删除/修改/调整顺序，并填写备注建议。点击确定后继续创建任务。';
        const requestId = crypto.randomUUID();
        const promptTasks = draftTasks.map((t) => ({
          draftId: t.draftId,
          title: t.title,
          details: t.details,
          priority: t.priority,
          status: t.status,
          tags: normalizeTags(t.tags),
        }));
        appendPromptEntry({
          ts: new Date().toISOString(),
          type: 'ui_prompt',
          action: 'request',
          requestId,
          ...(promptRunId ? { runId: promptRunId } : {}),
          prompt: {
            kind: 'task_confirm',
            title: promptTitle,
            message: promptMessage,
            allowCancel: true,
            source: requestCallerKind,
            tasks: promptTasks,
          },
        });

        const confirmResult = await confirmTaskCreation({
          createTtyPrompt,
          promptTasks,
          promptTitle,
          requestCallerKind,
          serverName,
          requestId,
          promptRunId,
          appendPromptEntry,
          waitForPromptResponse,
          normalizeResponseStatus,
        });
        if (!confirmResult?.ok) {
          return structuredResponse(
            confirmResult?.message || `[${serverName}] 用户取消创建任务 (requestId=${requestId})`,
            {
              status: confirmResult?.status || 'canceled',
              request_id: requestId,
              caller: requestCallerKind,
              remark: confirmResult?.remark || '',
            }
          );
        }
        confirmed = { status: 'ok', tasks: confirmResult.tasks, remark: confirmResult.remark };
      }

      const draftById = new Map(draftTasks.map((t) => [t.draftId, t]));
      const { created, deduped, total } = await enqueueTaskWrite(() => {
        const payloads = confirmed.tasks.map((item) => {
          const prev = item?.draftId ? draftById.get(item.draftId) : null;
          const runIdResolved = pickRunId(prev?.runId) || runDefault;
          const sessionIdResolved = pickSessionId(prev?.sessionId) || sessionDefault;
          return {
            title: safeTrim(item.title),
            details: typeof item.details === 'string' ? item.details : '',
            priority: normalizeTaskPriority(item.priority),
            status: normalizeTaskStatus(item.status),
            tags: normalizeTags(item.tags),
            runId: runIdResolved,
            sessionId: sessionIdResolved,
            dedupeKey: prev?.dedupeKey || '',
          };
        });
        const result = createTasksWithDedupe(payloads);
        const totalOpen = taskDb.listTasks({
          runId: runDefault,
          allRuns: false,
          allSessions: true,
          includeDone: false,
          limit: 100000,
        }).length;
        flushDedupeStore(taskDedupeStore);
        return {
          created: result.created,
          deduped: dedupeTasksById(result.deduped),
          total: totalOpen,
        };
      });
      const createdCount = created.length;
      const dedupedCount = deduped.length;
      const header =
        createdCount > 0
          ? `Created ${createdCount} task(s) (${total} total open${dedupedCount ? `, ${dedupedCount} deduped` : ''})`
          : dedupedCount > 0
            ? `No new tasks created (${dedupedCount} deduped, ${total} total open)`
            : `No tasks created (${total} total open)`;
      const summaryTasks = createdCount > 0 ? created : deduped;
      const summary = summaryTasks.map((task) => renderTaskSummary(task)).join('\n\n');

      const changeSummary = buildTaskConfirmSummary({
        before: draftTasks,
        after: confirmed.tasks,
        remark: confirmed.remark,
      });

      return structuredResponse(`${header}${summary ? `\n${summary}` : ''}${changeSummary ? `\n\n${changeSummary}` : ''}`, {
        status: createdCount > 0 ? 'ok' : 'noop',
        caller: requestCallerKind,
        created: created.map((t) => ({ id: t.id, title: t.title, status: t.status, priority: t.priority })),
        deduped: deduped.map((t) => ({ id: t.id, title: t.title, status: t.status, priority: t.priority })),
        user_changes: buildTaskConfirmChanges({ before: draftTasks, after: confirmed.tasks }),
        remark: confirmed.remark || '',
      });
    }
  );

  server.registerTool(
    'list_tasks',
    {
      title: 'List tasks',
      description:
        'List tasks with optional filters (status/tag). Defaults to current session unless allSessions=true.',
      inputSchema: z.object({
        status: z.enum(['todo', 'doing', 'blocked', 'done']).optional().describe('Filter by status'),
        tag: z.string().optional().describe('Filter by tag'),
        limit: z.number().int().min(1).max(200).optional().describe('Max items to return (default 50)'),
        includeDone: z.boolean().optional().describe('Include completed tasks (default true)'),
        allSessions: z.boolean().optional().describe('If true, ignore session scoping and list all'),
        allRuns: z.boolean().optional().describe('If true, ignore run scoping and list all'),
        runId: z.string().optional().describe('Run ID (optional; defaults to current run)'),
        sessionId: z.string().optional().describe('Session ID (optional; defaults to current session)'),
      }),
    },
    async ({ status, tag, limit, includeDone, allSessions, allRuns, runId, sessionId }) => {
      const scopedRunId = allRuns ? '' : pickRunId(runId);
      const scopedSessionId = allSessions ? '' : pickSessionId(sessionId);
      const tasks = taskDb.listTasks({
        status,
        tag,
        limit,
        includeDone,
        sessionId: scopedSessionId,
        allSessions,
        runId: scopedRunId,
        allRuns,
      });
      const capped = tasks.slice(0, limit && Number.isFinite(limit) ? limit : 50);
      return textResponse(formatTaskList(capped));
    }
  );

  server.registerTool(
    'get_task',
    {
      title: 'Get task',
      description: 'Get detailed task info by task ID.',
      inputSchema: z.object({
        id: z.string().min(1).describe('Task ID'),
      }),
    },
    async ({ id }) => {
      const task = taskDb.get(id);
      if (!task) {
        throw new Error(`未找到 ID 为 ${id} 的任务。`);
      }
      return textResponse(renderTaskSummary(task, 'Task'));
    }
  );

  server.registerTool(
    'update_task',
    {
      title: 'Update task',
      description:
        'Update title/details/status/tags/priority, or append a note to details.',
      inputSchema: z.object({
        id: z.string().min(1).describe('Task ID'),
        title: z.string().optional().describe('New title'),
        details: z.string().optional().describe('Replace details'),
        append_note: z.string().optional().describe('Append note to details'),
        priority: z.enum(['high', 'medium', 'low']).optional().describe('New priority'),
        status: z.enum(['todo', 'doing', 'blocked', 'done']).optional().describe('New status'),
        tags: z.array(z.string()).optional().describe('Replace tags'),
        runId: z.string().optional().describe('Run ID (optional)'),
        sessionId: z.string().optional().describe('Session ID (optional)'),
      }),
    },
    async ({ id, title, details, append_note: appendNote, priority, status, tags }) => {
      const task = await enqueueTaskWrite(() =>
        taskDb.updateTask(id, {
          title,
          details,
          appendNote,
          priority,
          status,
          tags,
        })
      );
      return textResponse(renderTaskSummary(task, 'Task updated'));
    }
  );

  server.registerTool(
    'complete_task',
    {
      title: 'Complete task',
      description: 'Mark a task as done and record a completion note.',
      inputSchema: z.object({
        id: z.string().min(1).describe('Task ID'),
        note: z
          .string()
          .min(5)
          .describe('Completion note (what was delivered + validation, min 5 chars)'),
        runId: z.string().optional().describe('Run ID (optional)'),
        sessionId: z.string().optional().describe('Session ID (optional)'),
      }),
    },
    async ({ id, note }) => {
      const task = await enqueueTaskWrite(() => taskDb.completeTask(id, note));
      return textResponse(renderTaskSummary(task, 'Task marked as done'));
    }
  );

  server.registerTool(
    'clear_tasks',
    {
      title: 'Clear tasks',
      description: 'Delete completed tasks, or clear all when explicitly requested.',
      inputSchema: z.object({
        mode: z
          .enum(['done', 'all'])
          .optional()
          .describe('done=delete completed only (default), all=delete everything'),
        allSessions: z.boolean().optional().describe('If true, ignore session scoping'),
        allRuns: z.boolean().optional().describe('If true, ignore run scoping'),
        runId: z.string().optional().describe('Run ID (optional; defaults to current run)'),
        sessionId: z.string().optional().describe('Session ID (optional; defaults to current session)'),
      }),
    },
    async ({ mode, allSessions, allRuns, runId, sessionId }) => {
      const result = await enqueueTaskWrite(() =>
        taskDb.clearTasks({
          mode: mode || 'done',
          allSessions,
          allRuns,
          runId: allRuns ? '' : pickRunId(runId),
          sessionId: allSessions ? '' : pickSessionId(sessionId),
        })
      );
      return textResponse(`Cleared ${result.removed} task(s), ${result.remaining} remaining.`);
    }
  );

  server.registerTool(
    'delete_task',
    {
      title: 'Delete task',
      description: 'Delete a task by ID. Requires confirm=true to proceed.',
      inputSchema: z.object({
        id: z.string().min(1).describe('Task ID'),
        confirm: z.boolean().optional().describe('Set true to confirm deletion'),
      }),
    },
    async ({ id, confirm }) => {
      if (confirm !== true) {
        throw new Error('Refusing to delete task without confirm=true.');
      }
      const task = await enqueueTaskWrite(() => {
        const existing = taskDb.get(id);
        if (!existing) {
          throw new Error(`未找到 ID 为 ${id} 的任务。`);
        }
        const removed = taskDb.remove(id);
        if (!removed) {
          throw new Error(`删除任务失败：${id}`);
        }
        return existing;
      });
      return textResponse(renderTaskSummary(task, 'Task deleted'));
    }
  );
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

function shouldConfirmTaskCreate(requestCallerKind = callerKind) {
  try {
    const runtime = settingsDb?.getRuntime?.();
    if (!runtime) return false;
    if (requestCallerKind === 'subagent') return runtime.confirmSubTaskCreate === true;
    return runtime.confirmMainTaskCreate === true;
  } catch {
    return false;
  }
}

function createTasksWithDedupe(payloads = []) {
  const created = [];
  const deduped = [];
  const toCreate = [];
  const localDedupe = new Map();

  (Array.isArray(payloads) ? payloads : []).forEach((payload) => {
    const key = safeTrim(payload?.dedupeKey);
    if (key) {
      const entry = readDedupeEntry(taskDedupeStore, key);
      if (entry) {
        const existingTasks = (Array.isArray(entry.ids) ? entry.ids : [])
          .map((id) => taskDb.get(id))
          .filter(Boolean);
        if (existingTasks.length > 0) {
          deduped.push(...existingTasks);
          writeDedupeEntry(taskDedupeStore, key, existingTasks.map((task) => task.id));
          return;
        }
        removeDedupeEntry(taskDedupeStore, key);
      }
      const local = localDedupe.get(key);
      if (local) {
        local.duplicates.push(payload);
        return;
      }
      localDedupe.set(key, { payload, duplicates: [] });
    }
    toCreate.push(payload);
  });

  const inserts = toCreate.map(({ dedupeKey, ...rest }) => rest);
  const createdTasks = inserts.length > 0 ? taskDb.addTasks(inserts) : [];
  const createdByKey = new Map();
  createdTasks.forEach((task, index) => {
    const key = safeTrim(toCreate[index]?.dedupeKey);
    if (!key) return;
    createdByKey.set(key, task);
    writeDedupeEntry(taskDedupeStore, key, [task.id]);
  });

  localDedupe.forEach((entry, key) => {
    const task = createdByKey.get(key);
    if (!task) return;
    if (Array.isArray(entry.duplicates) && entry.duplicates.length > 0) {
      entry.duplicates.forEach(() => deduped.push(task));
    }
  });

  created.push(...createdTasks);
  return { created, deduped };
}

function printHelp() {
  console.log(`Usage: node task-server.js [--root <path>] [--name <id>]

Options:
  --root <path>   Workspace root (default current directory)
  --name <id>     MCP server name (default task_manager)
  --help          Show help`);
}
