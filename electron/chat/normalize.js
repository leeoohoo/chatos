import path from 'path';

export function normalizeId(value) {
  return typeof value === 'string' ? value.trim() : '';
}

export function normalizeAgentMode(value) {
  const raw = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return raw === 'flow' ? 'flow' : 'custom';
}

export function normalizeWorkspaceRoot(value) {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  if (!trimmed) return '';
  return path.resolve(trimmed);
}
