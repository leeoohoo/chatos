import { parseJsonSafe } from '../../packages/aide/shared/data/legacy.js';

export function parseRuns(content = '') {
  const lines = String(content || '')
    .split('\n')
    .filter((line) => line.trim().length > 0);
  const entries = [];
  lines.forEach((line) => {
    const parsed = parseJsonSafe(line, null);
    if (parsed && typeof parsed === 'object') {
      entries.push(parsed);
    }
  });
  return entries;
}

function findLatestRunEntry(entries, runId) {
  const rid = typeof runId === 'string' ? runId.trim() : '';
  if (!rid) return null;
  let best = null;
  entries.forEach((entry) => {
    if (!entry || typeof entry !== 'object') return;
    if (String(entry.runId || '').trim() !== rid) return;
    if (!best || String(entry.ts || '') > String(best.ts || '')) {
      best = entry;
    }
  });
  return best;
}

export function createRunRegistry({ runsPath, safeRead, isPidAlive } = {}) {
  const path = typeof runsPath === 'string' && runsPath.trim() ? runsPath : '';
  const read = typeof safeRead === 'function' ? safeRead : () => '';
  const isAlive = typeof isPidAlive === 'function' ? isPidAlive : () => false;

  const readEntries = () => {
    if (!path) return [];
    return parseRuns(read(path));
  };

  const getLatestRunEntry = (runId) => {
    const entries = readEntries();
    return findLatestRunEntry(entries, runId);
  };

  const isRunPidAliveFromRegistry = (runId) => {
    if (!path) return false;
    const best = getLatestRunEntry(runId);
    const pid = best?.pid;
    return isAlive(pid);
  };

  const getRunPidFromRegistry = (runId) => {
    if (!path) return null;
    const best = getLatestRunEntry(runId);
    const pid = best?.pid;
    const num = Number(pid);
    return Number.isFinite(num) && num > 0 ? num : null;
  };

  return { getLatestRunEntry, isRunPidAliveFromRegistry, getRunPidFromRegistry };
}
