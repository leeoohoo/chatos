import { LoggingMessageNotificationSchema, NotificationSchema } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod/v4';
import { getDefaultToolMaxTimeoutMs } from './timeouts.js';
import { normalizeSessionId } from './identity-utils.js';
import { buildFinalTextFromChunks } from '../../../../common/chat-stream-utils.js';
import { normalizeKey } from '../../../shared/text-utils.js';

const MCP_STREAM_NOTIFICATION_METHODS = [
  'codex_app.window_run.stream',
  'codex_app.window_run.done',
  'codex_app.window_run.completed',
  'notifications/progress',
];

const buildLooseNotificationSchema = (method) =>
  NotificationSchema.extend({
    method: z.literal(method),
    params: z.unknown().optional(),
  });

export const resolveMcpStreamTimeoutMs = (options) => {
  const fromOptions = Number(options?.maxTotalTimeout || options?.timeout || 0);
  if (Number.isFinite(fromOptions) && fromOptions > 0) return fromOptions;
  return getDefaultToolMaxTimeoutMs();
};

export const shouldUseFinalStreamResult = (serverName, toolName) => {
  const srv = normalizeKey(serverName);
  const tool = normalizeKey(toolName);
  if (tool === 'codex_app_window_run') return true;
  if (srv.includes('codex_app') && tool.includes('window_run')) return true;
  return false;
};

export const createMcpStreamTracker = () => {
  const pending = new Map();

  const cleanup = (rpcId) => {
    const entry = pending.get(rpcId);
    if (!entry) return;
    if (entry.timer) {
      try {
        clearTimeout(entry.timer);
      } catch {
        // ignore
      }
    }
    if (entry.abortHandler && entry.signal) {
      try {
        entry.signal.removeEventListener('abort', entry.abortHandler);
      } catch {
        // ignore
      }
    }
    pending.delete(rpcId);
  };

  const finalize = (rpcId, text, aborted = false) => {
    const entry = pending.get(rpcId);
    if (!entry) return;
    cleanup(rpcId);
    const finalText = aborted
      ? '[MCP调用已停止] 用户取消了操作。'
      : typeof text === 'string'
        ? text
        : '';
    entry.resolve(finalText);
  };

  const attachSessionId = (notification) => {
    if (!notification || typeof notification !== 'object') return;
    const params = notification?.params && typeof notification.params === 'object' ? notification.params : null;
    if (!params) return;
    if (normalizeSessionId(params?.sessionId)) return;
    const rpcId = params?.rpcId;
    if (!Number.isFinite(rpcId)) return;
    const entry = pending.get(rpcId);
    const sessionId = normalizeSessionId(entry?.sessionId);
    if (!sessionId) return;
    notification.params = { ...params, sessionId };
  };

  const handleNotification = (notification) => {
    const params = notification && typeof notification === 'object' ? notification.params : null;
    const rpcId = params?.rpcId;
    if (!Number.isFinite(rpcId)) return;
    const entry = pending.get(rpcId);
    if (!entry) return;
    const finalText =
      typeof params?.finalText === 'string'
        ? params.finalText
        : params?.final === true && typeof params?.text === 'string'
          ? params.text
          : '';
    if (finalText) {
      if (params?.finalTextChunk === true) {
        const idx = Number.isFinite(params?.chunkIndex) ? params.chunkIndex : entry.chunks.size;
        entry.chunks.set(idx, finalText);
        if (Number.isFinite(params?.chunkCount)) {
          entry.chunkCount = params.chunkCount;
        }
      } else {
        entry.finalWhole = finalText;
      }
    }

    const status = typeof params?.status === 'string' ? params.status.toLowerCase() : '';
    const done =
      params?.done === true ||
      notification?.method === 'codex_app.window_run.done' ||
      notification?.method === 'codex_app.window_run.completed' ||
      ['completed', 'failed', 'aborted', 'cancelled'].includes(status);
    if (done) entry.done = true;

    const chunksReady = entry.chunks.size > 0 && (Number.isFinite(entry.chunkCount) ? entry.chunks.size >= entry.chunkCount : entry.done);
    const ready = Boolean(entry.finalWhole) || chunksReady;

    if (entry.done && ready) {
      const text = entry.finalWhole || buildFinalTextFromChunks(entry.chunks);
      finalize(rpcId, text);
    }
  };

  const waitForFinalText = ({ rpcId, timeoutMs, signal, sessionId, onAbort } = {}) =>
    new Promise((resolve) => {
      if (!Number.isFinite(rpcId)) {
        resolve('');
        return;
      }
      if (pending.has(rpcId)) {
        pending.delete(rpcId);
      }
      const entry = {
        resolve,
        done: false,
        chunks: new Map(),
        chunkCount: null,
        finalWhole: '',
        timer: null,
        signal: signal || null,
        abortHandler: null,
        sessionId: normalizeSessionId(sessionId),
      };
      pending.set(rpcId, entry);

      const effectiveTimeout = resolveMcpStreamTimeoutMs({ maxTotalTimeout: timeoutMs });
      if (effectiveTimeout && effectiveTimeout > 0) {
        entry.timer = setTimeout(() => {
          const text = entry.finalWhole || buildFinalTextFromChunks(entry.chunks);
          const timeoutText = text ? text : '[MCP调用超时] 操作执行时间过长。';
          finalize(rpcId, timeoutText);
        }, effectiveTimeout);
      }
      if (signal && typeof signal.addEventListener === 'function') {
        entry.abortHandler = () => {
          try {
            if (typeof onAbort === 'function') {
              onAbort();
            }
          } catch {
            // ignore cancel errors
          }
          finalize(rpcId, '', true);
        };
        signal.addEventListener('abort', entry.abortHandler, { once: true });
      }
    });

  return { attachSessionId, handleNotification, waitForFinalText };
};

export function registerMcpNotificationHandlers(client, { serverName, onNotification, eventLogger, streamTracker } = {}) {
  if (!client || typeof client.setNotificationHandler !== 'function') return;
  const emit = (notification) => {
    streamTracker?.attachSessionId?.(notification);
    const payload = { server: serverName, method: notification.method, params: notification.params };
    if (notification.method === 'notifications/message') {
      eventLogger?.log?.('mcp_log', payload);
    } else {
      eventLogger?.log?.('mcp_stream', payload);
    }
    if (typeof onNotification === 'function') {
      try {
        onNotification({ serverName, ...notification });
      } catch {
        // ignore notification relay errors
      }
    }
    streamTracker?.handleNotification?.(notification);
  };
  client.setNotificationHandler(LoggingMessageNotificationSchema, (notification) => emit(notification));
  MCP_STREAM_NOTIFICATION_METHODS.forEach((method) => {
    client.setNotificationHandler(buildLooseNotificationSchema(method), (notification) => emit(notification));
  });
}
