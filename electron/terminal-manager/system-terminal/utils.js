export { ensureDir } from '../../../packages/common/state-core/utils.js';

export function escapeShell(text) {
  return `'${String(text || '').replace(/'/g, `'\\''`)}'`;
}

export function escapeAppleScriptString(text) {
  return String(text || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

export function escapeCmdBatchString(text) {
  return String(text || '')
    .replace(/%/g, '%%')
    .replace(/"/g, '^"');
}

