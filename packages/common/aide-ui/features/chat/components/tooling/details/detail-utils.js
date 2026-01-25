import { truncateText } from '../../../../../lib/format.js';

export function formatSummaryValue(value, maxLen = 160) {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return truncateText(value, maxLen);
  try {
    return truncateText(JSON.stringify(value), maxLen);
  } catch {
    return truncateText(String(value), maxLen);
  }
}

export function formatJson(value) {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export function formatListLines(items, { limit = 8, formatter } = {}) {
  const list = (Array.isArray(items) ? items : []).filter(Boolean);
  if (list.length === 0) return '';
  const mapped = list
    .slice(0, limit)
    .map((item, idx) => {
      const text = formatter ? formatter(item, idx) : String(item ?? '');
      return typeof text === 'string' ? text.trim() : String(text ?? '').trim();
    })
    .filter(Boolean);
  const lines = mapped.map((text) => `- ${text}`);
  if (list.length > limit) {
    lines.push(`- ... (${list.length - limit} more)`);
  }
  return lines.join('\n');
}

export function normalizeText(value) {
  return typeof value === 'string' ? value.trim() : '';
}
