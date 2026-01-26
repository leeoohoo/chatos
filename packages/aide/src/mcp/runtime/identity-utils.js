export function normalizeSessionId(value) {
  return typeof value === 'string' ? value.trim() : '';
}

export function normalizeToolName(value) {
  return String(value || '').trim().toLowerCase();
}
