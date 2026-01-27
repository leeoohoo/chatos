import fs from 'fs';
import path from 'path';
import { parseJsonSafe } from '../../packages/aide/shared/data/legacy.js';

export function createPidRegistry({ baseTerminalsDir } = {}) {
  const baseDir = typeof baseTerminalsDir === 'string' && baseTerminalsDir.trim() ? baseTerminalsDir : '';

  const listRunPidRegistry = (runId) => {
    const rid = typeof runId === 'string' ? runId.trim() : '';
    if (!rid || !baseDir) return [];
    const filePath = path.join(baseDir, `${rid}.pids.jsonl`);
    try {
      if (!fs.existsSync(filePath)) return [];
      const raw = fs.readFileSync(filePath, 'utf8');
      const lines = raw.split('\n').filter(Boolean);
      const unique = new Set();
      lines.forEach((line) => {
        try {
          const parsed = JSON.parse(line);
          const pid = Number(parsed?.pid);
          if (Number.isFinite(pid) && pid > 0) {
            unique.add(pid);
          }
        } catch {
          // ignore parse failures
        }
      });
      return Array.from(unique);
    } catch {
      return [];
    }
  };

  const listRunPidRecords = (runId) => {
    const rid = typeof runId === 'string' ? runId.trim() : '';
    if (!rid || !baseDir) return [];
    const filePath = path.join(baseDir, `${rid}.pids.jsonl`);
    try {
      if (!fs.existsSync(filePath)) return [];
      const raw = fs.readFileSync(filePath, 'utf8');
      const lines = raw.split('\n').filter(Boolean);
      const latestByPid = new Map();
      lines.forEach((line) => {
        const parsed = parseJsonSafe(line, null);
        if (!parsed || typeof parsed !== 'object') return;
        const pid = Number(parsed?.pid);
        if (!Number.isFinite(pid) || pid <= 0) return;
        const record = {
          pid,
          runId: typeof parsed?.runId === 'string' ? parsed.runId : rid,
          kind: typeof parsed?.kind === 'string' ? parsed.kind : '',
          name: typeof parsed?.name === 'string' ? parsed.name : '',
          ts: typeof parsed?.ts === 'string' ? parsed.ts : '',
        };
        const prev = latestByPid.get(pid);
        if (!prev || String(record.ts || '') >= String(prev.ts || '')) {
          latestByPid.set(pid, record);
        }
      });
      return Array.from(latestByPid.values());
    } catch {
      return [];
    }
  };

  return { listRunPidRegistry, listRunPidRecords };
}
