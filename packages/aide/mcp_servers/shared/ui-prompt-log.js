import fs from 'fs';
import { safeTrim } from '../../shared/text-utils.js';
import { capJsonlFile } from '../../shared/log-utils.js';
import { ensureFileExists } from './fs-utils.js';

const PROMPT_LOG_MODES = new Set(['full', 'minimal']);
const DEFAULT_PROMPT_LOG_MODE = 'full';

function normalizePromptLogMode(value) {
  const raw = safeTrim(value).toLowerCase();
  if (PROMPT_LOG_MODES.has(raw)) return raw;
  return DEFAULT_PROMPT_LOG_MODE;
}

export function resolveUiPromptLogMode(env = process.env) {
  const raw = env && typeof env.MODEL_CLI_UI_PROMPTS_LOG_MODE === 'string' ? env.MODEL_CLI_UI_PROMPTS_LOG_MODE : '';
  return normalizePromptLogMode(raw);
}

function buildPromptMeta(prompt) {
  if (!prompt || typeof prompt !== 'object') return null;
  const kind = safeTrim(prompt.kind);
  const title = safeTrim(prompt.title);
  const source = safeTrim(prompt.source);
  const pathValue = safeTrim(prompt.path);
  const allowCancel = typeof prompt.allowCancel === 'boolean' ? prompt.allowCancel : undefined;
  const meta = {};
  if (kind) meta.kind = kind;
  if (title) meta.title = title;
  if (source) meta.source = source;
  if (pathValue) meta.path = pathValue;
  if (allowCancel !== undefined) meta.allowCancel = allowCancel;

  if (kind === 'kv') {
    meta.fieldCount = Array.isArray(prompt.fields) ? prompt.fields.length : 0;
  }
  if (kind === 'choice') {
    meta.multiple = prompt.multiple === true;
    meta.optionCount = Array.isArray(prompt.options) ? prompt.options.length : 0;
    if (Number.isFinite(prompt.minSelections)) meta.minSelections = prompt.minSelections;
    if (Number.isFinite(prompt.maxSelections)) meta.maxSelections = prompt.maxSelections;
  }
  if (kind === 'task_confirm') {
    meta.taskCount = Array.isArray(prompt.tasks) ? prompt.tasks.length : 0;
  }
  if (kind === 'file_change_confirm') {
    if (pathValue) meta.path = pathValue;
  }

  return Object.keys(meta).length > 0 ? meta : null;
}

function buildResponseMeta(response) {
  if (!response || typeof response !== 'object') return null;
  const status = safeTrim(response.status);
  const meta = {};
  if (status) meta.status = status;
  if (Array.isArray(response.tasks)) meta.taskCount = response.tasks.length;
  if (response && typeof response.values === 'object' && !Array.isArray(response.values)) {
    meta.valueCount = Object.keys(response.values || {}).length;
  }
  if (Array.isArray(response.selection)) {
    meta.selectionCount = response.selection.length;
  } else if (response.selection) {
    meta.selectionCount = 1;
  }
  return Object.keys(meta).length > 0 ? meta : null;
}

export function sanitizeUiPromptEntry(entry, mode = DEFAULT_PROMPT_LOG_MODE) {
  if (mode !== 'minimal') return entry;
  if (!entry || typeof entry !== 'object') return entry;
  const { prompt, response, ...rest } = entry;
  const next = { ...rest };
  const promptMeta = buildPromptMeta(prompt);
  const responseMeta = buildResponseMeta(response);
  if (promptMeta) next.prompt = promptMeta;
  if (responseMeta) next.response = responseMeta;
  return next;
}

export function appendUiPromptEntry({ filePath, entry, mode = DEFAULT_PROMPT_LOG_MODE, limits } = {}) {
  const target = safeTrim(filePath);
  if (!target) return null;
  ensureFileExists(target);
  const sanitized = sanitizeUiPromptEntry(entry, mode);
  try {
    if (limits) {
      capJsonlFile(target, limits);
    }
    fs.appendFileSync(target, `${JSON.stringify(sanitized)}\n`, 'utf8');
  } catch {
    // ignore
  }
  return sanitized;
}
