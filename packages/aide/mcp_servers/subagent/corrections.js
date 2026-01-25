import { createRunInboxListener } from './inbox.js';

export function createCorrectionManager({
  runId,
  sessionRoot,
  isWorkerMode,
  eventLogger,
  agentId,
  traceMeta,
  session,
} = {}) {
  const pendingCorrections = [];
  let activeController = null;
  const agent = typeof agentId === 'string' ? agentId : '';
  const trace = traceMeta || undefined;
  const shouldAcceptTarget = (target) => {
    const value = typeof target === 'string' ? target.trim() : '';
    if (!value || value === 'all') return true;
    if (value === 'subagent_worker') return isWorkerMode;
    if (value === 'subagent_router') return !isWorkerMode;
    return false;
  };

  const inboxListener = createRunInboxListener({
    runId,
    sessionRoot,
    consumerId: `subagent_${isWorkerMode ? 'worker' : 'router'}_${process.pid}`,
    skipExisting: true,
    onEntry: (entry) => {
      if (!entry || typeof entry !== 'object') return;
      if (String(entry.type || '') !== 'correction') return;
      if (!shouldAcceptTarget(entry.target)) return;
      const text = typeof entry.text === 'string' ? entry.text.trim() : '';
      if (!text) return;
      pendingCorrections.push(text);
      eventLogger?.log?.('subagent_user', {
        agent,
        text,
        source: 'ui',
        target: typeof entry.target === 'string' ? entry.target : undefined,
        trace,
      });
      eventLogger?.log?.('subagent_notice', {
        agent,
        text: '收到纠正：已中止当前请求，正在带着纠正继续执行…',
        source: 'ui',
        trace,
      });
      if (activeController && !activeController.signal.aborted) {
        try {
          activeController.abort();
        } catch {
          // ignore
        }
      }
    },
  });

  const applyCorrections = () => {
    if (pendingCorrections.length === 0) return;
    const merged = pendingCorrections.splice(0, pendingCorrections.length);
    const combined = merged.join('\n');
    if (session && typeof session.addUser === 'function') {
      session.addUser(`【用户纠正】\n${combined}`);
    }
  };

  const hasPending = () => pendingCorrections.length > 0;

  const setActiveController = (controller) => {
    activeController = controller;
  };

  const clearActiveController = (controller) => {
    if (activeController === controller) {
      activeController = null;
    }
  };

  const close = () => {
    try {
      inboxListener?.close?.();
    } catch {
      // ignore
    }
  };

  return {
    applyCorrections,
    hasPending,
    setActiveController,
    clearActiveController,
    close,
  };
}
