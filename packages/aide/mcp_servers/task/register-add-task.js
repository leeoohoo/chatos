import crypto from 'crypto';
import { confirmTaskCreation } from './confirm.js';
import { createTtyPrompt } from '../tty-prompt.js';
import {
  buildTaskConfirmChanges,
  buildTaskConfirmSummary,
  buildTaskDedupeKey,
  dedupeTasksById,
  normalizeCallerKind,
  normalizeTags,
  normalizeTaskPriority,
  normalizeTaskStatus,
  pickCallerKind,
  renderTaskSummary,
  safeTrim,
} from './utils.js';
import {
  readDedupeEntry,
  writeDedupeEntry,
  removeDedupeEntry,
  flushDedupeStore,
} from '../shared/dedupe-store.js';

export function registerAddTaskTool({
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
  callerKind,
} = {}) {
  if (!server) throw new Error('Missing MCP server');
  if (!z) throw new Error('Missing zod');
  if (!taskDb) throw new Error('Missing taskDb');
  if (!taskDedupeStore) throw new Error('Missing taskDedupeStore');
  if (typeof enqueueTaskWrite !== 'function') throw new Error('Missing enqueueTaskWrite');
  if (typeof pickRunId !== 'function') throw new Error('Missing pickRunId');
  if (typeof pickSessionId !== 'function') throw new Error('Missing pickSessionId');
  if (typeof structuredResponse !== 'function') throw new Error('Missing structuredResponse');

  const resolvedCallerKind = normalizeCallerKind(
    typeof callerKind === 'string' ? callerKind : process.env.MODEL_CLI_CALLER
  );

  const shouldConfirmTaskCreate = (requestCallerKind = resolvedCallerKind) => {
    try {
      const runtime = settingsDb?.getRuntime?.();
      if (!runtime) return false;
      if (requestCallerKind === 'subagent') return runtime.confirmSubTaskCreate === true;
      return runtime.confirmMainTaskCreate === true;
    } catch {
      return false;
    }
  };

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
      userMessageId: z.string().optional().describe('User message ID (optional; binds task to a chat turn)'),
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
      userMessageId: z.string().optional().describe('User message ID (optional; binds task to a chat turn)'),
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

  const createTasksWithDedupe = (payloads = []) => {
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
    async (payload, extra) => {
      const normalizedPayload = normalizeAddTaskPayload(payload);
      const runDefault = pickRunId(normalizedPayload.runId);
      const sessionDefault = pickSessionId(normalizedPayload.sessionId);
      const metaUserMessageId = safeTrim(
        extra?._meta && typeof extra._meta === 'object'
          ? extra._meta.userMessageId || extra._meta.user_message_id
          : ''
      );
      const userMessageDefault = metaUserMessageId || safeTrim(normalizedPayload.userMessageId);
      const inputs =
        Array.isArray(normalizedPayload.tasks) && normalizedPayload.tasks.length > 0
          ? normalizedPayload.tasks
          : [normalizedPayload];

      const requestCallerKind = pickCallerKind(normalizedPayload?.caller, resolvedCallerKind);
      const shouldConfirm = shouldConfirmTaskCreate(requestCallerKind);
      const draftTasks = inputs.map((item, idx) => {
        const resolvedRunId = pickRunId(item?.runId) || runDefault;
        const resolvedSessionId = pickSessionId(item?.sessionId) || sessionDefault;
        const resolvedUserMessageId = metaUserMessageId || safeTrim(item?.userMessageId) || userMessageDefault;
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
          userMessageId: resolvedUserMessageId,
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
          const resolvedUserMessageId =
            metaUserMessageId || safeTrim(item?.userMessageId) || safeTrim(prev?.userMessageId) || userMessageDefault;
          return {
            title: safeTrim(item.title),
            details: typeof item.details === 'string' ? item.details : '',
            priority: normalizeTaskPriority(item.priority),
            status: normalizeTaskStatus(item.status),
            tags: normalizeTags(item.tags),
            runId: runIdResolved,
            sessionId: sessionIdResolved,
            userMessageId: resolvedUserMessageId,
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
}
