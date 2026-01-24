const TOOL_STATUSES = new Set([
  'ok',
  'error',
  'canceled',
  'not_found',
  'invalid',
  'denied',
  'timeout',
  'partial',
  'noop',
]);

export const TOOL_STATUS = {
  OK: 'ok',
  ERROR: 'error',
  CANCELED: 'canceled',
  NOT_FOUND: 'not_found',
  INVALID: 'invalid',
  DENIED: 'denied',
  TIMEOUT: 'timeout',
  PARTIAL: 'partial',
  NOOP: 'noop',
};

export const TOOL_ERROR_CODES = {
  INVALID_ARGUMENT: 'invalid_argument',
  NOT_FOUND: 'not_found',
  PERMISSION_DENIED: 'permission_denied',
  TIMEOUT: 'timeout',
  CONFLICT: 'conflict',
  INTERNAL: 'internal',
  NOT_SUPPORTED: 'not_supported',
  RATE_LIMITED: 'rate_limited',
};

function normalizeStatus(value, fallback = TOOL_STATUS.OK) {
  const raw = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!raw) return fallback;
  const normalized = raw === 'cancelled' ? 'canceled' : raw;
  if (TOOL_STATUSES.has(normalized)) return normalized;
  return fallback;
}

function normalizeCode(value) {
  const raw = typeof value === 'string' ? value.trim() : '';
  return raw || '';
}

function normalizeError(input) {
  if (!input) return null;
  if (typeof input === 'string') {
    const message = input.trim();
    return message ? { message } : null;
  }
  if (input instanceof Error) {
    const message = typeof input.message === 'string' ? input.message.trim() : '';
    const type = typeof input.name === 'string' ? input.name.trim() : '';
    const payload = {};
    if (message) payload.message = message;
    if (type) payload.type = type;
    return Object.keys(payload).length > 0 ? payload : null;
  }
  if (typeof input === 'object') {
    const message = typeof input.message === 'string' ? input.message.trim() : '';
    const type = typeof input.type === 'string' ? input.type.trim() : '';
    const code = typeof input.code === 'string' ? input.code.trim() : '';
    const payload = {};
    if (message) payload.message = message;
    if (type) payload.type = type;
    if (code) payload.code = code;
    if (input.details && typeof input.details === 'object') {
      payload.details = input.details;
    }
    return Object.keys(payload).length > 0 ? payload : null;
  }
  const fallback = String(input).trim();
  return fallback ? { message: fallback } : null;
}

function normalizeServerName(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function buildChatosMeta(structuredContent, options = {}) {
  const existing = structuredContent?.chatos && typeof structuredContent.chatos === 'object' ? structuredContent.chatos : null;
  const statusFromPayload =
    typeof structuredContent?.status === 'string' ? structuredContent.status.trim() : '';
  const status = normalizeStatus(options.status || statusFromPayload || existing?.status);
  const code = normalizeCode(options.code || structuredContent?.code || existing?.code);
  const error = normalizeError(options.error || structuredContent?.error || existing?.error);
  const server = normalizeServerName(options.server || existing?.server);
  const tool = normalizeServerName(options.tool || existing?.tool);
  const trace = options.trace || existing?.trace;
  const meta = {
    status,
    ...(code ? { code } : {}),
    ...(error ? { error } : {}),
    ...(server ? { server } : {}),
    ...(tool ? { tool } : {}),
    ...(trace ? { trace } : {}),
    ts: new Date().toISOString(),
  };
  return existing ? { ...existing, ...meta } : meta;
}

export function textResponse(text) {
  return {
    content: [
      {
        type: 'text',
        text: text || '',
      },
    ],
  };
}

export function structuredResponse(text, structuredContent, options = {}) {
  const payload = structuredContent && typeof structuredContent === 'object' ? { ...structuredContent } : {};
  payload.chatos = buildChatosMeta(payload, options);
  return {
    ...textResponse(text),
    structuredContent: payload,
  };
}

export function errorResponse(message, options = {}) {
  const text = typeof message === 'string' ? message : message?.message || 'Tool failed';
  const errorPayload = normalizeError(options.error || message) || { message: text };
  return structuredResponse(text, options.data || {}, {
    ...options,
    status: options.status || TOOL_STATUS.ERROR,
    error: errorPayload,
  });
}

export function createToolResponder({ serverName } = {}) {
  const server = normalizeServerName(serverName);
  return {
    textResponse,
    structuredResponse: (text, structuredContent, options = {}) =>
      structuredResponse(text, structuredContent, {
        ...options,
        ...(server ? { server } : {}),
      }),
    errorResponse: (message, options = {}) =>
      errorResponse(message, {
        ...options,
        ...(server ? { server } : {}),
      }),
  };
}
