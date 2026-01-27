import { safeTrim } from '../../shared/text-utils.js';

export function buildDedupeKey(rawKey, { scope, runId, sessionId } = {}) {
  const key = safeTrim(rawKey);
  if (!key) return '';
  const parts = [];
  const scopePart = safeTrim(scope);
  if (scopePart) parts.push(scopePart);
  const normalizedRunId = safeTrim(runId);
  const normalizedSessionId = safeTrim(sessionId);
  if (normalizedRunId) parts.push(`run=${normalizedRunId}`);
  if (normalizedSessionId) parts.push(`session=${normalizedSessionId}`);
  const prefix = parts.join('|');
  return prefix ? `${prefix}::${key}` : key;
}
