import { formatDateTime } from './format.js';
import { RUN_FILTER_ALL, RUN_FILTER_AUTO, RUN_FILTER_UNKNOWN } from './storage.js';

export function normalizeRunId(value) {
  const text = typeof value === 'string' ? value.trim() : '';
  return text || '';
}

export function getRunId(entry) {
  return normalizeRunId(entry?.runId);
}

export function parseTimestampMs(ts) {
  if (!ts) return 0;
  if (typeof ts === 'number') {
    if (!Number.isFinite(ts)) return 0;
    return ts < 1e12 ? ts * 1000 : ts;
  }
  if (typeof ts === 'string') {
    const trimmed = ts.trim();
    if (!trimmed) return 0;
    const asNum = Number(trimmed);
    if (Number.isFinite(asNum)) {
      return asNum < 1e12 ? asNum * 1000 : asNum;
    }
    const parsed = Date.parse(trimmed);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  const date = new Date(ts);
  const ms = date.getTime();
  return Number.isFinite(ms) ? ms : 0;
}

export function collectRunStats({
  eventList = [],
  fileChangeEntries = [],
  tasksEntries = [],
  runEntries = [],
} = {}) {
  const runMap = new Map();
  const unknown = { events: 0, changes: 0, tasks: 0, lastMs: 0 };

  const touch = (runId, ts, kind) => {
    const ms = parseTimestampMs(ts);
    if (!runId) {
      if (kind === 'event') unknown.events += 1;
      if (kind === 'change') unknown.changes += 1;
      if (kind === 'task') unknown.tasks += 1;
      unknown.lastMs = Math.max(unknown.lastMs, ms);
      return;
    }
    if (!runMap.has(runId)) {
      runMap.set(runId, { runId, events: 0, changes: 0, tasks: 0, lastMs: 0 });
    }
    const item = runMap.get(runId);
    if (kind === 'event') item.events += 1;
    if (kind === 'change') item.changes += 1;
    if (kind === 'task') item.tasks += 1;
    item.lastMs = Math.max(item.lastMs, ms);
  };

  (Array.isArray(eventList) ? eventList : []).forEach((e) => touch(getRunId(e), e?.ts, 'event'));
  (Array.isArray(fileChangeEntries) ? fileChangeEntries : []).forEach((c) =>
    touch(getRunId(c), c?.ts, 'change')
  );
  (Array.isArray(tasksEntries) ? tasksEntries : []).forEach((t) =>
    touch(getRunId(t), t?.updatedAt || t?.createdAt, 'task')
  );
  (Array.isArray(runEntries) ? runEntries : []).forEach((r) => touch(getRunId(r), r?.ts, 'run'));

  const runs = Array.from(runMap.values()).sort((a, b) => b.lastMs - a.lastMs);
  return { runs, unknown };
}

export function buildRunFilterOptions(eventList = [], fileChangeEntries = [], tasksEntries = [], runEntries = []) {
  const { runs, unknown } = collectRunStats({
    eventList,
    fileChangeEntries,
    tasksEntries,
    runEntries,
  });
  const hasUnknown = unknown.events + unknown.changes + unknown.tasks > 0;
  const latestAnyRunId = runs.length > 0 ? runs[0].runId : null;
  const latestActiveRunId =
    runs.find((r) => (r.events || 0) + (r.changes || 0) + (r.tasks || 0) > 0)?.runId || null;
  // Prefer the most recent run that actually has logs (events/changes/tasks), but fall back to the
  // latest registered run so the UI can still surface newly-started terminals.
  const latestRunId = latestActiveRunId || latestAnyRunId;
  const options = [
    { label: '最近终端', value: RUN_FILTER_AUTO },
    { label: '全部终端', value: RUN_FILTER_ALL },
    ...(hasUnknown ? [{ label: '未标记(legacy)', value: RUN_FILTER_UNKNOWN }] : []),
    ...runs.map((r) => ({
      label: (() => {
        const total = (r.events || 0) + (r.changes || 0) + (r.tasks || 0);
        const stats =
          total > 0 ? ` · 事件:${r.events || 0} 改动:${r.changes || 0} 任务:${r.tasks || 0}` : ' · 无日志';
        return r.lastMs ? `${r.runId} · ${formatDateTime(r.lastMs)}${stats}` : `${r.runId}${stats}`;
      })(),
      value: r.runId,
    })),
  ];

  return { options, latestRunId };
}

export function resolveEffectiveRunFilter(selection, latestRunId, fallback = RUN_FILTER_ALL) {
  const normalized = typeof selection === 'string' ? selection.trim() : '';
  if (!normalized || normalized === RUN_FILTER_AUTO) {
    const latest = normalizeRunId(latestRunId);
    return latest || fallback;
  }
  return normalized;
}

export function resolveDispatchRunId(selection, latestRunId, options = {}) {
  const { emptyAsAuto = false, preferLatestForAll = false, preferLatestForUnknown = false } = options;
  const normalized = typeof selection === 'string' ? selection.trim() : '';
  const effective = normalized || (emptyAsAuto ? RUN_FILTER_AUTO : '');
  if (!effective) return null;
  if (effective === RUN_FILTER_AUTO) {
    return normalizeRunId(latestRunId) || null;
  }
  if (effective === RUN_FILTER_ALL) {
    return preferLatestForAll ? normalizeRunId(latestRunId) || null : null;
  }
  if (effective === RUN_FILTER_UNKNOWN) {
    return preferLatestForUnknown ? normalizeRunId(latestRunId) || null : null;
  }
  return normalizeRunId(effective);
}

export function filterEntriesByRunId(list, runFilter) {
  const selection = runFilter || RUN_FILTER_ALL;
  if (selection === RUN_FILTER_ALL) return Array.isArray(list) ? list : [];
  if (selection === RUN_FILTER_UNKNOWN) {
    return (Array.isArray(list) ? list : []).filter((entry) => !getRunId(entry));
  }
  return (Array.isArray(list) ? list : []).filter((entry) => getRunId(entry) === selection);
}
