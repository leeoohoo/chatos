import { normalizeRunId, parseTimestampMs } from './runs.js';
import { RUN_FILTER_ALL, RUN_FILTER_UNKNOWN } from './storage.js';

export function listPendingUiPrompts(entries = []) {
  const requests = new Map();
  const responses = new Set();

  (Array.isArray(entries) ? entries : []).forEach((entry) => {
    if (!entry || typeof entry !== 'object') return;
    if (entry.type !== 'ui_prompt') return;
    const requestId = typeof entry.requestId === 'string' ? entry.requestId.trim() : '';
    if (!requestId) return;
    if (entry.action === 'request') {
      requests.set(requestId, entry);
    } else if (entry.action === 'response') {
      responses.add(requestId);
    }
  });

  const pending = [];
  requests.forEach((req, requestId) => {
    if (responses.has(requestId)) return;
    pending.push(req);
  });
  pending.sort((a, b) => parseTimestampMs(a?.ts) - parseTimestampMs(b?.ts));
  return pending;
}

export function pickActiveUiPrompt(pending = [], preferredRunId) {
  const list = Array.isArray(pending) ? pending : [];
  if (list.length === 0) return null;
  const prefer = normalizeRunId(preferredRunId);
  if (prefer && prefer !== RUN_FILTER_ALL && prefer !== RUN_FILTER_UNKNOWN) {
    for (let i = list.length - 1; i >= 0; i -= 1) {
      if (normalizeRunId(list[i]?.runId) === prefer) {
        return list[i];
      }
    }
  }
  return list[list.length - 1];
}

const ACTIONABLE_PROMPT_KINDS = new Set([
  'kv',
  'choice',
  'task_confirm',
  'file_change_confirm',
  'result',
]);

export function isActionablePromptKind(kind, options = {}) {
  const normalized = typeof kind === 'string' ? kind.trim() : '';
  if (!normalized) return false;
  if (normalized === 'result' && options?.includeResult === false) return false;
  return ACTIONABLE_PROMPT_KINDS.has(normalized);
}
