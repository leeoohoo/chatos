export function truncateLogText(value, limit = 4000) {
  const text = typeof value === 'string' ? value : value == null ? '' : String(value);
  if (!text) return '';
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)}...`;
}

export function formatLogValue(value, limit = 4000) {
  if (value == null) return '';
  if (typeof value === 'string') return truncateLogText(value, limit);
  try {
    return truncateLogText(JSON.stringify(value), limit);
  } catch {
    return truncateLogText(String(value), limit);
  }
}
