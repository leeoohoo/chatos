import { formatTaskList, renderTaskSummary } from './utils.js';

export function registerTaskTools({
  server,
  z,
  textResponse,
  taskDb,
  enqueueTaskWrite,
  pickRunId,
  pickSessionId,
} = {}) {
  if (!server) throw new Error('Missing MCP server');
  if (!z) throw new Error('Missing zod');
  if (typeof textResponse !== 'function') throw new Error('Missing textResponse');
  if (!taskDb) throw new Error('Missing taskDb');
  if (typeof enqueueTaskWrite !== 'function') throw new Error('Missing enqueueTaskWrite');
  if (typeof pickRunId !== 'function') throw new Error('Missing pickRunId');
  if (typeof pickSessionId !== 'function') throw new Error('Missing pickSessionId');

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
