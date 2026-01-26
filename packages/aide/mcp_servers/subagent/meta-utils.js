import { normalizeTraceValue } from '../../shared/trace-utils.js';

export function normalizeText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

export function normalizeMetaValue(meta, keys = []) {
  if (!meta || typeof meta !== 'object') return '';
  for (const key of keys) {
    if (!key) continue;
    const value = normalizeTraceValue(meta[key]);
    if (value) return value;
  }
  return '';
}
