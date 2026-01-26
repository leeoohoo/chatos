import { safeTrim } from '../../shared/text-utils.js';

export { safeTrim };

export function normalizeTaskPriority(value) {
  const v = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (v === 'high' || v === 'medium' || v === 'low') return v;
  return undefined;
}

export function normalizeTaskStatus(value) {
  const v = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (v === 'todo' || v === 'doing' || v === 'blocked' || v === 'done') return v;
  return undefined;
}

export function normalizeTags(value) {
  const list = Array.isArray(value) ? value : [];
  const out = [];
  list.forEach((tag) => {
    const t = safeTrim(tag);
    if (t) out.push(t);
  });
  return out;
}

export function normalizeCallerKind(value) {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (normalized === 'sub' || normalized === 'subagent' || normalized === 'worker') return 'subagent';
  return 'main';
}

export function normalizeCallerOverride(value) {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!normalized) return '';
  if (normalized === 'main') return 'main';
  if (normalized === 'sub' || normalized === 'subagent' || normalized === 'worker') return 'subagent';
  return '';
}

export function pickCallerKind(candidate, fallbackKind = 'main') {
  const override = normalizeCallerOverride(candidate);
  return override || fallbackKind;
}

export function formatTaskList(tasks) {
  if (!tasks || tasks.length === 0) {
    return 'Task list is empty.';
  }
  const lines = tasks.map((task) => renderTaskLine(task));
  return lines.join('\n');
}

export function renderTaskLine(task) {
  const tagText = task.tags && task.tags.length > 0 ? ` #${task.tags.join(' #')}` : '';
  const sessionText = task.sessionId ? `, session=${task.sessionId}` : '';
  return `[${task.status}/${task.priority}] ${task.title} (id=${task.id}${sessionText})${tagText}`;
}

export function renderTaskSummary(task, prefix = '') {
  const header = prefix ? `${prefix}\n` : '';
  const body = [
    renderTaskLine(task),
    task.details ? `Details: ${task.details}` : 'Details: <empty, use update_task to add context/acceptance>',
    `Session: ${task.sessionId || '<unspecified>'}`,
    `Created: ${task.createdAt}`,
    `Updated: ${task.updatedAt}`,
  ]
    .filter(Boolean)
    .join('\n');
  return `${header}${body}`;
}

export function createWriteQueue() {
  let chain = Promise.resolve();
  return (fn) => {
    const run = chain.then(fn, fn);
    chain = run.catch(() => {});
    return run;
  };
}

export function buildTaskDedupeKey(rawKey, { runId, sessionId } = {}) {
  const key = safeTrim(rawKey);
  if (!key) return '';
  const scopeParts = [];
  const normalizedRunId = safeTrim(runId);
  const normalizedSessionId = safeTrim(sessionId);
  if (normalizedRunId) scopeParts.push(`run=${normalizedRunId}`);
  if (normalizedSessionId) scopeParts.push(`session=${normalizedSessionId}`);
  const scope = scopeParts.join('|');
  return scope ? `${scope}::${key}` : key;
}

export function dedupeTasksById(tasks) {
  const list = Array.isArray(tasks) ? tasks : [];
  const seen = new Set();
  const out = [];
  list.forEach((task) => {
    const id = safeTrim(task?.id);
    if (!id || seen.has(id)) return;
    seen.add(id);
    out.push(task);
  });
  return out;
}

export function buildTaskConfirmChanges({ before, after }) {
  const original = Array.isArray(before) ? before : [];
  const final = Array.isArray(after) ? after : [];
  const originalById = new Map(original.map((t) => [t.draftId, t]));
  const finalById = new Map(final.map((t) => [t.draftId, t]));
  const added = final.filter((t) => t && typeof t === 'object' && t.draftId && !originalById.has(t.draftId));
  const removed = original.filter((t) => t && typeof t === 'object' && t.draftId && !finalById.has(t.draftId));
  const modified = [];
  final.forEach((t) => {
    if (!t || typeof t !== 'object') return;
    if (!t.draftId || !originalById.has(t.draftId)) return;
    const prev = originalById.get(t.draftId);
    if (!prev) return;
    const changed =
      safeTrim(prev.title) !== safeTrim(t.title) ||
      safeTrim(prev.details) !== safeTrim(t.details) ||
      safeTrim(prev.priority) !== safeTrim(t.priority) ||
      safeTrim(prev.status) !== safeTrim(t.status) ||
      normalizeTags(prev.tags).join(',') !== normalizeTags(t.tags).join(',');
    if (changed) {
      modified.push({ before: prev, after: t });
    }
  });
  return {
    added: added.map((t) => ({ title: safeTrim(t.title) })),
    removed: removed.map((t) => ({ title: safeTrim(t.title) })),
    modified: modified.map((pair) => ({
      before: { title: safeTrim(pair.before?.title) },
      after: { title: safeTrim(pair.after?.title) },
    })),
  };
}

export function buildTaskConfirmSummary({ before, after, remark }) {
  const changes = buildTaskConfirmChanges({ before, after });
  const lines = [];
  if (changes.added.length > 0) {
    lines.push(`用户新增任务：${changes.added.map((t) => t.title).filter(Boolean).join('；')}`);
  }
  if (changes.removed.length > 0) {
    lines.push(`用户删除任务：${changes.removed.map((t) => t.title).filter(Boolean).join('；')}`);
  }
  if (changes.modified.length > 0) {
    lines.push(`用户变更任务：${changes.modified.map((t) => t.after.title).filter(Boolean).join('；')}`);
  }
  const remarkText = safeTrim(remark);
  if (remarkText) {
    lines.push(`用户备注：${remarkText}`);
  }
  return lines.join('\n');
}
