import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { performance } from 'perf_hooks';
import { resolveAppStateDir } from '../../../shared/state-paths.js';
import { normalizeKey } from '../../../shared/text-utils.js';
import { normalizeSessionId } from './identity-utils.js';
import { resolveMcpStreamTimeoutMs } from './stream-utils.js';
import { sleepWithSignal } from './async-utils.js';

const UI_PROMPTS_FILE_DEFAULT = 'ui-prompts.jsonl';
const UI_PROMPT_CACHE_LIMIT = 2000;
const DEFAULT_ASYNC_POLL_MS = 1000;

const uiPromptCache = new Map();

function normalizeAsyncToolName(value) {
  return normalizeKey(value);
}

export function normalizeAsyncTaskConfig(raw, toolName) {
  if (!raw || typeof raw !== 'object') return null;
  const tools = Array.isArray(raw.tools)
    ? raw.tools.map(normalizeAsyncToolName).filter(Boolean)
    : [];
  const toolKey = normalizeAsyncToolName(toolName);
  if (tools.length > 0 && toolKey && !tools.includes(toolKey)) return null;
  const taskIdKey = typeof raw.taskIdKey === 'string' ? raw.taskIdKey.trim() : 'taskId';
  if (!taskIdKey) return null;
  const resultSource = typeof raw.resultSource === 'string' ? normalizeKey(raw.resultSource) : 'ui_prompts';
  const uiPromptFile = typeof raw.uiPromptFile === 'string' ? raw.uiPromptFile.trim() : UI_PROMPTS_FILE_DEFAULT;
  const pollIntervalMs = Number.isFinite(Number(raw.pollIntervalMs))
    ? Math.max(200, Math.min(5000, Number(raw.pollIntervalMs)))
    : DEFAULT_ASYNC_POLL_MS;
  return {
    taskIdKey,
    resultSource,
    uiPromptFile,
    pollIntervalMs,
  };
}

export function generateTaskId({ sessionId, serverName, toolName } = {}) {
  const parts = [];
  const sid = normalizeSessionId(sessionId);
  if (sid) parts.push(sid);
  const server = String(serverName || '').trim();
  const tool = String(toolName || '').trim();
  if (server || tool) parts.push([server, tool].filter(Boolean).join('.'));
  let token = '';
  if (typeof crypto?.randomUUID === 'function') {
    token = crypto.randomUUID();
  } else {
    token = `${Date.now().toString(36)}_${Math.random().toString(16).slice(2, 10)}`;
  }
  parts.push(token);
  return parts.filter(Boolean).join('_');
}

async function readUiPromptState(filePath, { forceFull = false } = {}) {
  const normalized = typeof filePath === 'string' ? filePath.trim() : '';
  if (!normalized) return null;

  let state = uiPromptCache.get(normalized);
  if (!state) {
    state = { position: 0, buffer: '', entries: [] };
  }

  let stats;
  try {
    stats = await fs.promises.stat(normalized);
  } catch {
    return { ...state };
  }
  if (!stats?.isFile?.()) return { ...state };

  const size = stats.size;
  const shouldReset = forceFull || size < state.position;
  let start = shouldReset ? 0 : state.position;
  let carry = shouldReset ? '' : state.buffer || '';
  if (shouldReset) {
    state.entries = [];
  }
  if (size <= start) {
    state.position = size;
    state.buffer = carry;
    uiPromptCache.set(normalized, state);
    return { ...state };
  }

  let handle = null;
  let text = '';
  try {
    handle = await fs.promises.open(normalized, 'r');
    const length = size - start;
    const buffer = Buffer.alloc(length);
    await handle.read(buffer, 0, length, start);
    text = buffer.toString('utf8');
  } finally {
    try {
      await handle?.close?.();
    } catch {
      // ignore
    }
  }

  const merged = `${carry}${text}`;
  const lines = merged.split(/\r?\n/);
  state.buffer = lines.pop() || '';
  state.position = size;

  const parsed = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      parsed.push(JSON.parse(trimmed));
    } catch {
      // ignore parse errors
    }
  }

  if (parsed.length > 0) {
    state.entries.push(...parsed);
    if (state.entries.length > UI_PROMPT_CACHE_LIMIT) {
      state.entries.splice(0, state.entries.length - UI_PROMPT_CACHE_LIMIT);
    }
  }

  uiPromptCache.set(normalized, state);
  return { ...state };
}

function extractUiPromptResult(entries, requestIds) {
  const ids = new Set(
    (Array.isArray(requestIds) ? requestIds : [])
      .map((id) => (typeof id === 'string' ? id.trim() : ''))
      .filter(Boolean)
  );
  if (ids.size === 0) return null;
  const list = Array.isArray(entries) ? entries : [];
  for (let i = list.length - 1; i >= 0; i -= 1) {
    const entry = list[i];
    if (!entry || typeof entry !== 'object') continue;
    if (entry.type !== 'ui_prompt') continue;
    if (entry.action !== 'request') continue;
    const requestId = typeof entry.requestId === 'string' ? entry.requestId.trim() : '';
    if (!requestId || !ids.has(requestId)) continue;
    const prompt = entry.prompt && typeof entry.prompt === 'object' ? entry.prompt : null;
    if (!prompt || typeof prompt.kind !== 'string' || prompt.kind.trim() !== 'result') continue;
    const markdown =
      typeof prompt.markdown === 'string'
        ? prompt.markdown
        : typeof prompt.result === 'string'
          ? prompt.result
          : typeof prompt.content === 'string'
            ? prompt.content
            : '';
    return markdown;
  }
  return null;
}

export async function waitForUiPromptResult({ taskId, config, callMeta, options, signal } = {}) {
  const id = typeof taskId === 'string' ? taskId.trim() : '';
  if (!id) return { found: false, text: '' };

  const stateDir =
    callMeta?.chatos?.uiApp?.stateDir ||
    resolveAppStateDir(process.env.MODEL_CLI_SESSION_ROOT || process.cwd());
  const uiPromptFile =
    typeof config?.uiPromptFile === 'string' && config.uiPromptFile.trim()
      ? config.uiPromptFile.trim()
      : UI_PROMPTS_FILE_DEFAULT;
  const filePath = path.isAbsolute(uiPromptFile) ? uiPromptFile : stateDir ? path.join(stateDir, uiPromptFile) : '';
  if (!filePath) return { found: false, text: '' };

  const requestIds = [id, `mcp-task:${id}`];
  const pollIntervalMs = config?.pollIntervalMs || DEFAULT_ASYNC_POLL_MS;
  const timeoutMs = resolveMcpStreamTimeoutMs(options);
  const deadline = performance.now() + timeoutMs;
  let forceFull = !uiPromptCache.has(filePath);

  while (performance.now() < deadline) {
    const state = await readUiPromptState(filePath, { forceFull });
    forceFull = false;
    const text = extractUiPromptResult(state?.entries || [], requestIds);
    if (text !== null) {
      return { found: true, text };
    }
    await sleepWithSignal(pollIntervalMs, signal);
  }

  return { found: false, text: '' };
}
