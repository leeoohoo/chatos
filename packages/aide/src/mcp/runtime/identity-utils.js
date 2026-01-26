import { normalizeKey } from '../../../shared/text-utils.js';

export function normalizeSessionId(value) {
  return typeof value === 'string' ? value.trim() : '';
}

export function normalizeToolName(value) {
  return normalizeKey(value);
}
