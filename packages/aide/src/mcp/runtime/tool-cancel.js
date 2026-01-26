import { normalizeSessionId, normalizeToolName } from './identity-utils.js';

export function resolveCancelToolCandidates(serverEntry, toolName) {
  const candidates = [];
  const callMeta = serverEntry?.callMeta ?? serverEntry?.call_meta;
  const raw =
    callMeta?.cancel_tool ||
    callMeta?.cancelTool ||
    callMeta?.cancelTools ||
    callMeta?.cancel_tools;
  if (Array.isArray(raw)) {
    raw.forEach((entry) => {
      const name = typeof entry === 'string' ? entry.trim() : '';
      if (name) candidates.push(name);
    });
  } else if (typeof raw === 'string' && raw.trim()) {
    candidates.push(raw.trim());
  }
  const normalizedTool = normalizeToolName(toolName);
  if (normalizedTool.endsWith('_run')) {
    candidates.push(`${normalizedTool.slice(0, -4)}_stop`);
    candidates.push(`${normalizedTool.slice(0, -4)}_cancel`);
  }
  const serverName = normalizeToolName(serverEntry?.name);
  if (serverName.includes('codex_app') && normalizedTool.includes('window_run')) {
    candidates.push('window_stop');
    candidates.push('window_cancel');
    candidates.push('cancel');
    candidates.push('stop');
    candidates.push('abort');
  }
  const seen = new Set();
  const unique = [];
  candidates.forEach((entry) => {
    const key = normalizeToolName(entry);
    if (!key || seen.has(key)) return;
    seen.add(key);
    unique.push(entry);
  });
  return unique;
}

export function resolveCancelToolName(serverEntry, toolName, availableTools) {
  const candidates = resolveCancelToolCandidates(serverEntry, toolName);
  if (candidates.length === 0) return '';
  if (availableTools && typeof availableTools.get === 'function') {
    for (const entry of candidates) {
      const actual = availableTools.get(normalizeToolName(entry));
      if (actual) return actual;
    }
    return '';
  }
  return candidates[0];
}

export function buildCancelArgs({ callMeta, toolContext, args, taskId } = {}) {
  const payload = {};
  const maybeSet = (key, value) => {
    if (!key || payload[key] !== undefined) return;
    if (value === undefined || value === null || value === '') return;
    payload[key] = value;
  };
  const meta = callMeta && typeof callMeta === 'object' ? callMeta : {};
  const sourceArgs = args && typeof args === 'object' ? args : {};
  const sessionId = normalizeSessionId(toolContext?.session?.sessionId);
  maybeSet('sessionId', sessionId);
  if (taskId) {
    maybeSet('taskId', taskId);
    maybeSet('task_id', taskId);
  }
  ['taskId', 'task_id', 'requestId', 'request_id', 'windowId', 'window_id', 'jobId', 'job_id'].forEach((key) => {
    if (Object.prototype.hasOwnProperty.call(meta, key)) {
      maybeSet(key, meta[key]);
    }
    if (Object.prototype.hasOwnProperty.call(sourceArgs, key)) {
      maybeSet(key, sourceArgs[key]);
    }
  });
  const toolCallId = typeof toolContext?.toolCallId === 'string' ? toolContext.toolCallId.trim() : '';
  if (toolCallId) {
    maybeSet('tool_call_id', toolCallId);
  }
  return payload;
}
