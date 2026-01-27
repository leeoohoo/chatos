import fs from 'fs';
import path from 'path';
import { resolveTerminalsDir } from './state-paths.js';

export function appendRunPid({ runId, sessionRoot, pid, kind, name } = {}) {
  const rid = typeof runId === 'string' ? runId.trim() : '';
  const root = typeof sessionRoot === 'string' && sessionRoot.trim() ? sessionRoot.trim() : '';
  const num = Number(pid);
  if (!rid || !root || !Number.isFinite(num) || num <= 0) {
    return;
  }
  const dir = resolveTerminalsDir(root);
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch {
    // ignore
  }
  const pidsPath = path.join(dir, `${rid}.pids.jsonl`);
  const payload = {
    ts: new Date().toISOString(),
    runId: rid,
    pid: num,
    kind: typeof kind === 'string' && kind.trim() ? kind.trim() : 'process',
    name: typeof name === 'string' && name.trim() ? name.trim() : undefined,
  };
  try {
    fs.appendFileSync(pidsPath, `${JSON.stringify(payload)}\n`, 'utf8');
  } catch {
    // ignore pid registry failures
  }
}
