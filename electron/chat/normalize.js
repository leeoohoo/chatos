import path from 'path';
import { normalizeId as normalizeCommonId } from '../../packages/common/text-utils.js';

export function normalizeId(value) {
  return normalizeCommonId(value);
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
