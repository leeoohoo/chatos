import { normalizeKey } from '../../shared/text-utils.js';

export function booleanFromArg(value) {
  if (value === true) return true;
  const text = normalizeKey(value);
  if (!text) return false;
  return text === '1' || text === 'true' || text === 'yes' || text === 'y';
}

export function resolveBoolFlag(value, fallback = false) {
  if (typeof value === 'boolean') return value;
  const raw = normalizeKey(value);
  if (!raw) return fallback;
  if (['1', 'true', 'yes', 'y', 'on'].includes(raw)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(raw)) return false;
  return fallback;
}
