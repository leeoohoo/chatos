import crypto from 'crypto';
import { normalizeTags } from './utils.js';
import { normalizeKey } from '../../shared/text-utils.js';

export async function confirmTaskCreation({
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
} = {}) {
  const tty = typeof createTtyPrompt === 'function' ? createTtyPrompt() : null;
  const tasksSeed = Array.isArray(promptTasks) ? promptTasks : [];
  const titleText = typeof promptTitle === 'string' ? promptTitle : '';
  const callerText = typeof requestCallerKind === 'string' ? requestCallerKind : '';
  const nameText = typeof serverName === 'string' ? serverName : 'task_manager';
  const reqId = typeof requestId === 'string' ? requestId : '';
  const runId = typeof promptRunId === 'string' && promptRunId.trim() ? promptRunId.trim() : '';

  const normalizeTaskConfirmList = (list) =>
    (Array.isArray(list) ? list : [])
      .filter((t) => t && typeof t === 'object')
      .map((t, idx) => ({
        draftId: typeof t.draftId === 'string' ? t.draftId.trim() : '',
        title: typeof t.title === 'string' ? t.title : '',
        details: typeof t.details === 'string' ? t.details : '',
        priority: typeof t.priority === 'string' ? t.priority : '',
        status: typeof t.status === 'string' ? t.status : '',
        tags: normalizeTags(t.tags),
        _index: idx,
      }))
      .filter((t) => t.draftId && t.title.trim());

  const runTtyConfirm = async ({ signal } = {}) => {
    if (!tty) return null;

    const tasks = tasksSeed.map((t) => ({
      draftId: typeof t?.draftId === 'string' && t.draftId.trim() ? t.draftId.trim() : crypto.randomUUID(),
      title: typeof t?.title === 'string' ? t.title : '',
      details: typeof t?.details === 'string' ? t.details : '',
      priority: typeof t?.priority === 'string' ? t.priority : '',
      status: typeof t?.status === 'string' ? t.status : '',
      tags: normalizeTags(t?.tags),
    }));

    const allowedPriority = new Set(['high', 'medium', 'low']);
    const allowedStatus = new Set(['todo', 'doing', 'blocked', 'done']);
    const maxDetailChars = 240;

    const renderTasks = () => {
      tty.writeln('');
      if (tasks.length === 0) {
        tty.writeln('(当前任务列表为空)');
        return;
      }
      tasks.forEach((task, index) => {
        const title = typeof task?.title === 'string' ? task.title.trim() : '';
        const priority = typeof task?.priority === 'string' ? task.priority.trim() : '';
        const status = typeof task?.status === 'string' ? task.status.trim() : '';
        const tags = normalizeTags(task?.tags);
        const meta = [
          priority ? `priority=${priority}` : '',
          status ? `status=${status}` : '',
          tags.length > 0 ? `tags=${tags.join(',')}` : '',
        ]
          .filter(Boolean)
          .join(' ');
        tty.writeln(`[${index + 1}] ${title || '<untitled>'}${meta ? ` (${meta})` : ''}`);
        const details = typeof task?.details === 'string' ? task.details.trim() : '';
        if (details) {
          const compact = details.replace(/\s+/g, ' ').trim();
          const shown = compact.length > maxDetailChars ? `${compact.slice(0, maxDetailChars)}...` : compact;
          tty.writeln(`    ${shown}`);
        }
      });
    };

    const help = () => {
      tty.writeln('');
      tty.writeln('命令：');
      tty.writeln('  y            确认创建');
      tty.writeln('  n            取消');
      tty.writeln('  e            进入编辑模式（可新增/删除/修改/排序）');
      tty.writeln('');
    };

    const helpEdit = () => {
      tty.writeln('');
      tty.writeln('编辑命令：');
      tty.writeln('  l                    列表');
      tty.writeln('  a                    新增任务');
      tty.writeln('  e <n>                编辑第 n 个任务');
      tty.writeln('  d <n>                删除第 n 个任务');
      tty.writeln('  m <from> <to>         移动/排序（把 from 移到 to）');
      tty.writeln('  y                    确认创建');
      tty.writeln('  n                    取消');
      tty.writeln('  h                    帮助');
      tty.writeln('');
    };

    const parseTagsInput = (text) =>
      String(text || '')
        .split(/[,，]/g)
        .map((t) => t.trim())
        .filter(Boolean);

    const askTaskFields = async ({ existing } = {}) => {
      const base = existing && typeof existing === 'object' ? existing : null;
      const out = base
        ? { ...base, tags: normalizeTags(base.tags) }
        : {
            draftId: crypto.randomUUID(),
            title: '',
            details: '',
            priority: 'medium',
            status: 'todo',
            tags: [],
          };

      while (true) {
        const titlePrompt = base ? `title [${out.title || ''}]: ` : 'title (必填): ';
        const titleRaw = await tty.ask(titlePrompt, { signal });
        if (titleRaw == null) return null;
        const title = String(titleRaw ?? '').trim();
        if (title) {
          out.title = title;
          break;
        }
        if (base && out.title && out.title.trim()) break;
        tty.writeln('title 为必填。');
      }

      const detailsPrompt = base ? `details [${out.details || ''}]: ` : 'details (可选): ';
      const detailsRaw = await tty.ask(detailsPrompt, { signal });
      if (detailsRaw == null) return null;
      const details = String(detailsRaw ?? '');
      if (details.trim() || !base) {
        out.details = details.trim();
      }

      while (true) {
        const current = out.priority && out.priority.trim() ? out.priority.trim() : 'medium';
        const pRaw = await tty.ask(`priority (high/medium/low) [${current}]: `, { signal });
        if (pRaw == null) return null;
        const p = normalizeKey(pRaw);
        if (!p) {
          out.priority = current;
          break;
        }
        if (allowedPriority.has(p)) {
          out.priority = p;
          break;
        }
        tty.writeln('priority 无效，请输入 high/medium/low。');
      }

      while (true) {
        const current = out.status && out.status.trim() ? out.status.trim() : 'todo';
        const sRaw = await tty.ask(`status (todo/doing/blocked/done) [${current}]: `, { signal });
        if (sRaw == null) return null;
        const s = normalizeKey(sRaw);
        if (!s) {
          out.status = current;
          break;
        }
        if (allowedStatus.has(s)) {
          out.status = s;
          break;
        }
        tty.writeln('status 无效，请输入 todo/doing/blocked/done。');
      }

      const tagsPrompt = base
        ? `tags (逗号分隔) [${(out.tags || []).join(', ')}]: `
        : 'tags (逗号分隔，可选): ';
      const tagsRaw = await tty.ask(tagsPrompt, { signal });
      if (tagsRaw == null) return null;
      const tagsText = String(tagsRaw ?? '').trim();
      if (tagsText) {
        out.tags = parseTagsInput(tagsText);
      } else if (!base) {
        out.tags = [];
      }

      return out;
    };

    const confirmWithRemark = async (finalTasks) => {
      const remarkRaw = await tty.ask('备注（可选，直接回车跳过）： ', { signal });
      if (remarkRaw == null) return null;
      const remark = String(remarkRaw ?? '').trim();
      return { status: 'ok', tasks: finalTasks, remark };
    };

    tty.writeln('');
    tty.writeln(`[${nameText}] ${titleText}`);
    tty.writeln('可在 UI 或本终端确认；输入 y 确认创建，e 编辑任务列表，直接回车取消。');
    tty.writeln(`source: ${callerText}`);
    help();
    renderTasks();

    const first = await tty.ask('操作 (y/N/e): ', { signal });
    if (first == null) return null;
    const action = normalizeKey(first);
    if (action === 'y' || action === 'yes') {
      return await confirmWithRemark(tasks);
    }
    if (action !== 'e' && action !== 'edit') {
      return { status: 'canceled' };
    }

    helpEdit();
    renderTasks();
    while (true) {
      const cmdRaw = await tty.ask('task_confirm> ', { signal });
      if (cmdRaw == null) return null;
      const cmd = String(cmdRaw ?? '').trim();
      const parts = cmd.split(/\s+/g).filter(Boolean);
      const head = (parts[0] || '').toLowerCase();

      if (!head) continue;
      if (head === 'h' || head === 'help' || head === '?') {
        helpEdit();
        continue;
      }
      if (head === 'l' || head === 'list') {
        renderTasks();
        continue;
      }
      if (head === 'y' || head === 'yes' || head === 'confirm') {
        if (tasks.length === 0) {
          tty.writeln('任务列表为空，请至少保留 1 个任务。');
          continue;
        }
        const confirmed = await confirmWithRemark(tasks);
        return confirmed;
      }
      if (head === 'n' || head === 'no' || head === 'cancel') {
        return { status: 'canceled' };
      }
      if (head === 'a' || head === 'add') {
        const created = await askTaskFields();
        if (!created) return null;
        tasks.push(created);
        renderTasks();
        continue;
      }
      if (head === 'e' || head === 'edit') {
        const index = Number(parts[1]);
        if (!Number.isFinite(index) || index < 1 || index > tasks.length) {
          tty.writeln('用法: e <n>（n 为任务序号）');
          continue;
        }
        const updated = await askTaskFields({ existing: tasks[index - 1] });
        if (!updated) return null;
        tasks[index - 1] = updated;
        renderTasks();
        continue;
      }
      if (head === 'd' || head === 'del' || head === 'delete') {
        const index = Number(parts[1]);
        if (!Number.isFinite(index) || index < 1 || index > tasks.length) {
          tty.writeln('用法: d <n>（n 为任务序号）');
          continue;
        }
        tasks.splice(index - 1, 1);
        renderTasks();
        continue;
      }
      if (head === 'm' || head === 'move') {
        const from = Number(parts[1]);
        const to = Number(parts[2]);
        if (
          !Number.isFinite(from) ||
          !Number.isFinite(to) ||
          from < 1 ||
          from > tasks.length ||
          to < 1 ||
          to > tasks.length
        ) {
          tty.writeln('用法: m <from> <to>（序号从 1 开始）');
          continue;
        }
        const [item] = tasks.splice(from - 1, 1);
        tasks.splice(to - 1, 0, item);
        renderTasks();
        continue;
      }

      tty.writeln('未知命令，输入 h 查看帮助。');
    }
  };

  const applyConfirmResponse = (responseEntry) => {
    const status = normalizeResponseStatus(responseEntry?.response?.status);
    if (status !== 'ok') {
      return {
        ok: false,
        status,
        tasks: [],
        remark: typeof responseEntry?.response?.remark === 'string' ? responseEntry.response.remark : '',
      };
    }
    const tasksFromUser = Array.isArray(responseEntry?.response?.tasks) ? responseEntry.response.tasks : [];
    const tasks = normalizeTaskConfirmList(tasksFromUser);
    const remark = typeof responseEntry?.response?.remark === 'string' ? responseEntry.response.remark : '';
    return { ok: tasks.length > 0, status: 'ok', tasks, remark };
  };

  const cancelMessage = (emptyList) =>
    emptyList ? `[${nameText}] 用户提交了空任务列表，已取消创建。` : `[${nameText}] 用户取消创建任务 (requestId=${reqId})`;

  if (tty && tty.backend === 'tty') {
    try {
      const terminalResult = await runTtyConfirm();
      appendPromptEntry?.({
        ts: new Date().toISOString(),
        type: 'ui_prompt',
        action: 'response',
        requestId: reqId,
        ...(runId ? { runId } : {}),
        response: terminalResult || { status: 'canceled' },
      });

      const parsed = applyConfirmResponse({ response: terminalResult || { status: 'canceled' } });
      if (!parsed.ok) {
        return { ok: false, status: parsed.status, remark: parsed.remark, tasks: [], message: cancelMessage(false) };
      }
      return { ok: true, status: 'ok', tasks: parsed.tasks, remark: parsed.remark, message: '' };
    } finally {
      tty.close();
    }
  }

  if (tty && tty.backend === 'auto') {
    const abort = new AbortController();
    try {
      const uiWait = waitForPromptResponse({ requestId: reqId }).then((entry) => ({ kind: 'ui', entry }));
      const ttyWait = runTtyConfirm({ signal: abort.signal }).then((res) => ({ kind: 'tty', res }));
      const first = await Promise.race([uiWait, ttyWait]);
      if (first.kind === 'ui') {
        abort.abort();
        const parsed = applyConfirmResponse(first.entry);
        if (!parsed.ok) {
          return { ok: false, status: parsed.status, remark: parsed.remark, tasks: [], message: cancelMessage(false) };
        }
        return { ok: true, status: 'ok', tasks: parsed.tasks, remark: parsed.remark, message: '' };
      }

      const terminalResult = first.res;
      if (!terminalResult) {
        const ui = await uiWait;
        const parsed = applyConfirmResponse(ui.entry);
        if (!parsed.ok) {
          return { ok: false, status: parsed.status, remark: parsed.remark, tasks: [], message: cancelMessage(false) };
        }
        return { ok: true, status: 'ok', tasks: parsed.tasks, remark: parsed.remark, message: '' };
      }

      appendPromptEntry?.({
        ts: new Date().toISOString(),
        type: 'ui_prompt',
        action: 'response',
        requestId: reqId,
        ...(runId ? { runId } : {}),
        response: terminalResult,
      });
      const parsed = applyConfirmResponse({ response: terminalResult });
      if (!parsed.ok) {
        return { ok: false, status: parsed.status, remark: parsed.remark, tasks: [], message: cancelMessage(false) };
      }
      return { ok: true, status: 'ok', tasks: parsed.tasks, remark: parsed.remark, message: '' };
    } finally {
      abort.abort();
      tty.close();
    }
  }

  const response = await waitForPromptResponse({ requestId: reqId });
  const parsed = applyConfirmResponse(response);
  if (!parsed.ok) {
    if (parsed.status === 'ok') {
      return {
        ok: false,
        status: 'canceled',
        remark: parsed.remark,
        tasks: [],
        message: cancelMessage(true),
      };
    }
    return { ok: false, status: parsed.status, remark: parsed.remark, tasks: [], message: cancelMessage(false) };
  }
  return { ok: true, status: 'ok', tasks: parsed.tasks, remark: parsed.remark, message: '' };
}
