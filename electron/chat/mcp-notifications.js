import { normalizeId } from './normalize.js';

export function createMcpNotificationHandler({
  eventLogPath,
  appendEventLog,
  sendEvent,
  store,
  resolveMcpSessionId,
} = {}) {
  const resolveSessionId = typeof resolveMcpSessionId === 'function' ? resolveMcpSessionId : () => '';
  const emitEvent = typeof sendEvent === 'function' ? sendEvent : () => {};
  const logEvent = typeof appendEventLog === 'function' ? appendEventLog : null;

  const normalizeProgressKind = (params) => {
    const raw = typeof params?.kind === 'string' ? params.kind.trim().toLowerCase() : '';
    if (raw) return raw;
    const fallback = typeof params?.type === 'string' ? params.type.trim().toLowerCase() : '';
    return fallback;
  };
  const pickToolCallId = (params) => {
    if (!params || typeof params !== 'object') return '';
    return normalizeId(params.toolCallId || params.tool_call_id || params.callId || params.call_id);
  };
  const normalizeStepsPayload = (params) => {
    if (!params || typeof params !== 'object') return [];
    if (Array.isArray(params.steps)) return params.steps.filter(Boolean);
    if (params.step && typeof params.step === 'object') return [params.step];
    return [];
  };
  const resolveProgressDone = (params) => {
    if (params?.done === true) return true;
    if (typeof params?.stage === 'string' && params.stage.trim().toLowerCase() === 'done') return true;
    const status = typeof params?.status === 'string' ? params.status.trim().toLowerCase() : '';
    return ['completed', 'failed', 'aborted', 'cancelled', 'canceled', 'error'].includes(status);
  };
  const resolveProgressJobId = (params) =>
    normalizeId(params?.job_id || params?.jobId || params?.jobID || '');

  return (notification) => {
    if (!notification) return;
    const params = notification?.params && typeof notification.params === 'object' ? notification.params : null;
    const runId = typeof params?.runId === 'string' ? params.runId : '';
    const payload = {
      server: notification.serverName || '',
      method: notification.method || '',
      params,
    };
    const type = notification.method === 'notifications/message' ? 'mcp_log' : 'mcp_stream';
    if (eventLogPath && logEvent) {
      logEvent(eventLogPath, type, payload, runId);
    }
    if (type === 'mcp_stream') {
      const sessionId = resolveSessionId(params);
      if (sessionId) {
        if (
          payload.server === 'subagent_router' &&
          payload.method === 'notifications/progress' &&
          store?.subagentStreams?.upsert
        ) {
          const callId = pickToolCallId(params);
          const kind = normalizeProgressKind(params);
          if (callId && (!kind || kind === 'subagent_step' || kind === 'subagent_progress')) {
            const steps = normalizeStepsPayload(params);
            const done = resolveProgressDone(params);
            const jobId = resolveProgressJobId(params);
            const status = typeof params?.status === 'string' ? params.status : done ? 'completed' : '';
            if (steps.length > 0 || done || jobId) {
              try {
                store.subagentStreams.upsert({
                  sessionId,
                  toolCallId: callId,
                  jobId,
                  status,
                  done,
                  steps,
                });
              } catch {
                // ignore persistence errors
              }
            }
          }
        }
        emitEvent({
          type: 'mcp_stream',
          sessionId,
          payload: {
            ...payload,
            receivedAt: new Date().toISOString(),
          },
        });
      } else {
        const debug = {
          server: payload.server,
          method: payload.method,
          runId,
          rpcId: params?.rpcId,
          windowId: params?.windowId,
          requestId: params?.requestId,
          status: params?.status,
        };
        if (eventLogPath && logEvent) {
          logEvent(eventLogPath, 'mcp_stream_unrouted', debug, runId);
        }
        try {
          console.warn('[mcp] stream notification missing sessionId', debug);
        } catch {
          // ignore
        }
      }
    }
  };
}
