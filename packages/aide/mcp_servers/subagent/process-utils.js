export { appendRunPid } from '../../shared/run-pids.js';

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
