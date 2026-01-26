import { normalizeId, normalizeText } from './text-utils.js';

export function normalizeProgressKind(params) {
  const raw = normalizeText(params?.kind).toLowerCase();
  if (raw) return raw;
  const fallback = normalizeText(params?.type).toLowerCase();
  return fallback;
}

export function pickToolCallId(params) {
  if (!params || typeof params !== 'object') return '';
  return normalizeId(params.toolCallId || params.tool_call_id || params.callId || params.call_id);
}

export function normalizeStepsPayload(params) {
  if (!params || typeof params !== 'object') return [];
  if (Array.isArray(params.steps)) return params.steps.filter(Boolean);
  if (params.step && typeof params.step === 'object') return [params.step];
  return [];
}

export function normalizeStepKey(step) {
  if (!step || typeof step !== 'object') return '';
  return normalizeId(step.ts) || String(step.index ?? '');
}

export function mergeSubagentSteps(current, incoming, limit = 240) {
  const base = Array.isArray(current) ? current.slice() : [];
  const additions = Array.isArray(incoming) ? incoming : incoming ? [incoming] : [];
  if (additions.length === 0) return base;
  const seen = new Set(base.map((step) => normalizeStepKey(step)));
  additions.forEach((step) => {
    const key = normalizeStepKey(step);
    if (key && seen.has(key)) return;
    base.push(step);
    if (key) seen.add(key);
  });
  if (limit > 0 && base.length > limit) {
    return base.slice(-limit);
  }
  return base;
}

export function resolveProgressDone(params) {
  if (params?.done === true) return true;
  const stage = normalizeText(params?.stage).toLowerCase();
  if (stage === 'done') return true;
  const status = normalizeText(params?.status).toLowerCase();
  return ['completed', 'failed', 'aborted', 'cancelled', 'canceled', 'error'].includes(status);
}

export function resolveProgressJobId(params) {
  return normalizeId(params?.job_id || params?.jobId || params?.jobID || '');
}
