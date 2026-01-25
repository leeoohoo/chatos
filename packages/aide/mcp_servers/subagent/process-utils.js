import fs from 'fs';
import path from 'path';
import { resolveTerminalsDir } from '../../shared/state-paths.js';

export function appendRunPid({ pid, kind, name, runId, sessionRoot } = {}) {
  const resolvedRunId = typeof runId === 'string' ? runId.trim() : '';
  if (!resolvedRunId) return;
  const root = typeof sessionRoot === 'string' && sessionRoot.trim() ? sessionRoot.trim() : '';
  const num = Number(pid);
  if (!root || !Number.isFinite(num) || num <= 0) return;
  const dir = resolveTerminalsDir(root);
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch {
    // ignore
  }
  const pidsPath = path.join(dir, `${resolvedRunId}.pids.jsonl`);
  const payload = {
    ts: new Date().toISOString(),
    runId: resolvedRunId,
    pid: num,
    kind: typeof kind === 'string' && kind.trim() ? kind.trim() : 'process',
    name: typeof name === 'string' && name.trim() ? name.trim() : undefined,
  };
  try {
    fs.appendFileSync(pidsPath, `${JSON.stringify(payload)}\n`, 'utf8');
  } catch {
    // ignore
  }
}

export function registerProcessShutdownHooks({ isWorkerMode, jobStore, getJobStore } = {}) {
  if (process.env.SUBAGENT_WORKER === '1' || isWorkerMode) {
    return;
  }
  const resolveJobStore = typeof getJobStore === 'function' ? getJobStore : () => jobStore;
  const killAllWorkers = ({ signal = 'SIGKILL' } = {}) => {
    const store = resolveJobStore();
    if (!store || typeof store.forEach !== 'function') return;
    const sig = typeof signal === 'string' && signal ? signal : 'SIGKILL';
    store.forEach((job) => {
      const child = job?.worker;
      if (!child || typeof child.kill !== 'function') return;
      if (child.killed) return;
      try {
        child.kill(sig);
      } catch {
        // ignore
      }
    });
  };
  const stop = (signal) => {
    try {
      killAllWorkers({ signal: 'SIGTERM' });
    } catch {
      // ignore
    }
    try {
      killAllWorkers({ signal: 'SIGKILL' });
    } catch {
      // ignore
    }
    try {
      process.exit(signal === 'SIGINT' ? 130 : 143);
    } catch {
      // ignore
    }
  };
  process.once('SIGINT', () => stop('SIGINT'));
  process.once('SIGTERM', () => stop('SIGTERM'));
  process.once('exit', () => {
    try {
      killAllWorkers({ signal: 'SIGKILL' });
    } catch {
      // ignore
    }
  });
}
