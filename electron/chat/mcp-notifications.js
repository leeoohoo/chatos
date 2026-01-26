import {
  normalizeProgressKind,
  normalizeStepsPayload,
  pickToolCallId,
  resolveProgressDone,
  resolveProgressJobId,
} from '../../packages/common/chat-stream-utils.js';

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
