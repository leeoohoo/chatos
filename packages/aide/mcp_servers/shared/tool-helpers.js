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

const ERROR_CODE_PATTERNS = [
  { code: TOOL_ERROR_CODES.INVALID_ARGUMENT, patterns: [/invalid argument/i, /input validation/i, /invalid params/i] },
  { code: TOOL_ERROR_CODES.NOT_FOUND, patterns: [/not found/i, /unknown .*id/i] },
  { code: TOOL_ERROR_CODES.PERMISSION_DENIED, patterns: [/permission denied/i, /outside the workspace/i, /writes are disabled/i] },
  { code: TOOL_ERROR_CODES.TIMEOUT, patterns: [/timeout/i, /timed out/i] },
  { code: TOOL_ERROR_CODES.CONFLICT, patterns: [/conflict/i, /already exists/i] },
  { code: TOOL_ERROR_CODES.NOT_SUPPORTED, patterns: [/not supported/i, /unsupported/i] },
  { code: TOOL_ERROR_CODES.RATE_LIMITED, patterns: [/rate limit/i, /too many requests/i] },
];

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

function inferErrorCode(err, fallback = TOOL_ERROR_CODES.INTERNAL) {
  const message = normalizeError(err)?.message || '';
  if (!message) return fallback;
  for (const entry of ERROR_CODE_PATTERNS) {
    if (entry.patterns.some((pattern) => pattern.test(message))) {
      return entry.code;
    }
  }
  return fallback;
}

function normalizeServerName(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function estimatePayloadSize(value) {
  if (value == null) return 0;
  if (typeof value === 'string') return Buffer.byteLength(value, 'utf8');
  try {
    return Buffer.byteLength(JSON.stringify(value), 'utf8');
  } catch {
    return 0;
  }
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
  const code = normalizeCode(options.code || errorPayload.code || inferErrorCode(errorPayload));
  return structuredResponse(text, options.data || {}, {
    ...options,
    status: options.status || TOOL_STATUS.ERROR,
    code,
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

export function patchMcpServer(server, options = {}) {
  if (!server || typeof server.registerTool !== 'function') {
    throw new Error('patchMcpServer requires a valid MCP server instance');
  }
  if (server.__chatosPatched) {
    return server;
  }
  const serverName = normalizeServerName(options.serverName);
  const logger = options.logger && typeof options.logger.log === 'function' ? options.logger : null;
  const responder = createToolResponder({ serverName });
  const originalRegisterTool = server.registerTool.bind(server);
  const originalCreateToolError =
    typeof server.createToolError === 'function' ? server.createToolError.bind(server) : null;

  server.registerTool = (name, definition, handler) => {
    if (typeof handler !== 'function') {
      return originalRegisterTool(name, definition, handler);
    }
    const toolName = String(name || '').trim() || 'unknown_tool';
    const wrapped = async (args, extra) => {
      const start = Date.now();
      const meta = extra?._meta && typeof extra._meta === 'object' ? extra._meta : {};
      const sessionId =
        typeof meta?.sessionId === 'string'
          ? meta.sessionId
          : typeof meta?.session_id === 'string'
            ? meta.session_id
            : '';
      const trace = meta?.chatos?.trace || meta?.trace || undefined;
      logger?.log?.('tool_call', {
        server: serverName || undefined,
        tool: toolName,
        sessionId,
        args,
        size: estimatePayloadSize(args),
        trace,
      });
      try {
        const result = await handler(args, extra);
        const elapsedMs = Date.now() - start;
        logger?.log?.('tool_result', {
          server: serverName || undefined,
          tool: toolName,
          sessionId,
          elapsedMs,
          isError: Boolean(result?.isError),
          size: estimatePayloadSize(result?.structuredContent || result?.content),
          trace,
        });
        return result;
      } catch (err) {
        const elapsedMs = Date.now() - start;
        logger?.log?.('tool_error', {
          server: serverName || undefined,
          tool: toolName,
          sessionId,
          elapsedMs,
          message: err?.message || String(err),
          trace,
        });
        const response = responder.errorResponse(err, {
          tool: toolName,
          trace,
          status: TOOL_STATUS.ERROR,
        });
        return { ...response, isError: true };
      }
    };
    return originalRegisterTool(name, definition, wrapped);
  };

  if (originalCreateToolError) {
    server.createToolError = (message) => {
      const response = responder.errorResponse(message, {
        status: TOOL_STATUS.ERROR,
        code: inferErrorCode(message),
      });
      return { ...response, isError: true };
    };
  }

  server.__chatosPatched = true;
  return server;
}
