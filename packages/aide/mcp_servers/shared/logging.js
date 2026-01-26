import fs from 'fs';
import path from 'path';
import { capJsonlFile } from '../../shared/log-utils.js';
import { normalizeKey } from '../../shared/text-utils.js';
import { ensureDir } from './fs-utils.js';

const DEFAULT_MAX_BYTES = 5 * 1024 * 1024;
const DEFAULT_MAX_LINES = 5000;
const DEFAULT_MAX_FIELD_CHARS = 4000;
const SENSITIVE_KEYS = [
  'token',
  'secret',
  'password',
  'api_key',
  'apikey',
  'auth',
  'authorization',
];

function clampNumber(value, min, max, fallback) {
  const parsed = Number(value);
  if (Number.isFinite(parsed)) {
    return Math.min(Math.max(parsed, min), max);
  }
  return fallback;
}

function shouldRedactKey(key, extraKeys = []) {
  const normalized = normalizeKey(key);
  if (!normalized) return false;
  if (extraKeys.some((entry) => normalized.includes(entry))) return true;
  return SENSITIVE_KEYS.some((entry) => normalized.includes(entry));
}

function truncateText(value, maxChars) {
  const limit = clampNumber(maxChars, 200, 200000, DEFAULT_MAX_FIELD_CHARS);
  const text = typeof value === 'string' ? value : value == null ? '' : String(value);
  if (!text) return text;
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)}...(${text.length - limit} more chars)`;
}

function sanitizePayload(value, options = {}) {
  const { maxFieldChars, redactKeys } = options;
  if (value == null) return value;
  if (typeof value === 'string') {
    return truncateText(value, maxFieldChars);
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => sanitizePayload(entry, options));
  }
  if (typeof value === 'object') {
    const output = {};
    Object.entries(value).forEach(([key, entry]) => {
      if (shouldRedactKey(key, redactKeys)) {
        output[key] = '[redacted]';
        return;
      }
      output[key] = sanitizePayload(entry, options);
    });
    return output;
  }
  return truncateText(String(value), maxFieldChars);
}

export function createJsonlLogger({
  filePath,
  maxBytes = DEFAULT_MAX_BYTES,
  maxLines = DEFAULT_MAX_LINES,
  maxFieldChars = DEFAULT_MAX_FIELD_CHARS,
  redactKeys = [],
  runId,
} = {}) {
  const target = typeof filePath === 'string' ? filePath.trim() : '';
  if (!target) return null;
  ensureDir(path.dirname(target));
  const effectiveMaxBytes = clampNumber(maxBytes, 0, 200 * 1024 * 1024, DEFAULT_MAX_BYTES);
  const effectiveMaxLines = clampNumber(maxLines, 0, 200000, DEFAULT_MAX_LINES);
  const effectiveRunId = typeof runId === 'string' ? runId.trim() : '';
  return {
    path: target,
    log(type, payload) {
      const entry = {
        ts: new Date().toISOString(),
        type: String(type || ''),
        payload: sanitizePayload(payload, { maxFieldChars, redactKeys }),
        ...(effectiveRunId ? { runId: effectiveRunId } : {}),
      };
      try {
        fs.appendFileSync(target, `${JSON.stringify(entry)}\n`, 'utf8');
      } catch {
        // ignore
      }
      capJsonlFile(target, { maxBytes: effectiveMaxBytes, maxLines: effectiveMaxLines });
    },
  };
}

export function resolveToolLogPath(env = process.env) {
  const direct = typeof env.MODEL_CLI_MCP_TOOL_LOG === 'string' ? env.MODEL_CLI_MCP_TOOL_LOG.trim() : '';
  if (direct) return direct;
  const fallback = typeof env.MODEL_CLI_EVENT_LOG === 'string' ? env.MODEL_CLI_EVENT_LOG.trim() : '';
  return fallback;
}
