import fs from 'fs';
import crypto from 'crypto';

import { normalizeChoiceLimits, normalizeChoiceOptions, normalizeKvFields, normalizeTaskConfirmTasks } from '../../packages/common/ui-prompt-utils.js';
import { safeTrim } from '../../packages/common/text-utils.js';
import { capJsonlFile } from '../../packages/aide/shared/log-utils.js';
import { ensureFileExists } from '../session-api-helpers.js';

export function createUiPromptHandlers({
  defaultPaths,
  promptLogLimits,
  startUiPromptsWatcher,
  readUiPromptsPayload,
  getMainWindow,
  channelPrefix = '',
} = {}) {
  const ensureWatcher = typeof startUiPromptsWatcher === 'function' ? startUiPromptsWatcher : () => {};
  const readPayload = typeof readUiPromptsPayload === 'function' ? readUiPromptsPayload : () => ({ entries: [] });
  const resolveWindow = typeof getMainWindow === 'function' ? getMainWindow : () => null;
  const resolveChannel = (name) => (channelPrefix ? `${channelPrefix}${name}` : name);

  const requestUiPrompt = (payload = {}) => {
    const rawPrompt = payload?.prompt && typeof payload.prompt === 'object' ? payload.prompt : null;
    if (!rawPrompt) {
      return { ok: false, message: 'prompt is required' };
    }

    const requestIdRaw = typeof payload?.requestId === 'string' ? payload.requestId.trim() : '';
    const runId = typeof payload?.runId === 'string' ? payload.runId.trim() : '';
    const requestId =
      requestIdRaw ||
      (typeof crypto?.randomUUID === 'function'
        ? crypto.randomUUID()
        : `req_${Date.now().toString(36)}_${Math.random().toString(16).slice(2, 10)}`);

    const kind = safeTrim(rawPrompt?.kind);
    if (!kind) {
      return { ok: false, message: 'prompt.kind is required' };
    }

    const title = typeof rawPrompt?.title === 'string' ? rawPrompt.title : '';
    const message = typeof rawPrompt?.message === 'string' ? rawPrompt.message : '';
    const source = typeof rawPrompt?.source === 'string' ? rawPrompt.source : '';
    const allowCancel = rawPrompt?.allowCancel !== false;

    const promptBase = {
      kind,
      title,
      message,
      allowCancel,
      ...(source && source.trim() ? { source } : {}),
    };

    let prompt = null;
    if (kind === 'kv') {
      const normalized = normalizeKvFields(rawPrompt?.fields, {
        maxFields: 50,
        returnResult: true,
        label: 'prompt.fields',
        keyLabel: 'prompt.fields[].key',
      });
      if (!normalized.ok) return normalized;
      prompt = {
        ...promptBase,
        kind: 'kv',
        fields: normalized.fields,
      };
    } else if (kind === 'choice') {
      const multiple = rawPrompt?.multiple === true;
      const normalizedOptions = normalizeChoiceOptions(rawPrompt?.options, {
        maxOptions: 60,
        returnResult: true,
        label: 'prompt.options',
        valueLabel: 'prompt.options[].value',
      });
      if (!normalizedOptions.ok) return normalizedOptions;
      const optionValues = new Set(normalizedOptions.options.map((o) => o.value));
      const defaultSelection = (() => {
        if (multiple) {
          const raw = rawPrompt?.default;
          const list = Array.isArray(raw) ? raw : typeof raw === 'string' ? [raw] : [];
          return Array.from(new Set(list.map((v) => safeTrim(v)).filter((v) => v && optionValues.has(v))));
        }
        const raw = typeof rawPrompt?.default === 'string' ? rawPrompt.default : '';
        const selected = safeTrim(raw);
        return selected && optionValues.has(selected) ? selected : '';
      })();
      const normalizedLimits = normalizeChoiceLimits({
        multiple,
        minSelections: rawPrompt?.minSelections,
        maxSelections: rawPrompt?.maxSelections,
        optionCount: normalizedOptions.options.length,
        mode: 'strict',
        singleMin: 0,
        singleMax: normalizedOptions.options.length,
        returnResult: true,
        minLabel: 'prompt.minSelections',
        maxLabel: 'prompt.maxSelections',
      });
      if (!normalizedLimits.ok) return normalizedLimits;
      prompt = {
        ...promptBase,
        kind: 'choice',
        multiple,
        options: normalizedOptions.options,
        default: defaultSelection,
        minSelections: normalizedLimits.minSelections,
        maxSelections: normalizedLimits.maxSelections,
      };
    } else if (kind === 'task_confirm') {
      const tasks = normalizeTaskConfirmTasks(rawPrompt?.tasks, {
        generateId: () =>
          typeof crypto?.randomUUID === 'function'
            ? crypto.randomUUID()
            : `draft_${Date.now().toString(36)}_${Math.random().toString(16).slice(2, 10)}`,
      });
      const defaultRemark = typeof rawPrompt?.defaultRemark === 'string' ? rawPrompt.defaultRemark : '';
      prompt = {
        ...promptBase,
        kind: 'task_confirm',
        tasks,
        ...(defaultRemark && defaultRemark.trim() ? { defaultRemark } : {}),
      };
    } else if (kind === 'file_change_confirm') {
      const diff = typeof rawPrompt?.diff === 'string' ? rawPrompt.diff : '';
      const filePath = typeof rawPrompt?.path === 'string' ? rawPrompt.path : '';
      const command = typeof rawPrompt?.command === 'string' ? rawPrompt.command : '';
      const cwd = typeof rawPrompt?.cwd === 'string' ? rawPrompt.cwd : '';
      const defaultRemark = typeof rawPrompt?.defaultRemark === 'string' ? rawPrompt.defaultRemark : '';
      prompt = {
        ...promptBase,
        kind: 'file_change_confirm',
        diff,
        path: filePath,
        command,
        cwd,
        ...(defaultRemark && defaultRemark.trim() ? { defaultRemark } : {}),
      };
    } else {
      return { ok: false, message: `Unsupported prompt.kind: ${kind}` };
    }

    const entry = {
      ts: new Date().toISOString(),
      type: 'ui_prompt',
      action: 'request',
      requestId,
      ...(runId ? { runId } : {}),
      prompt,
    };

    try {
      ensureFileExists(defaultPaths.uiPrompts);
      capJsonlFile(defaultPaths.uiPrompts, promptLogLimits);
      fs.appendFileSync(defaultPaths.uiPrompts, `${JSON.stringify(entry)}\n`, 'utf8');
    } catch (err) {
      return { ok: false, message: err?.message || String(err) };
    }

    ensureWatcher();
    const win = resolveWindow();
    if (win) {
      win.webContents.send(resolveChannel('uiPrompts:update'), readPayload());
    }

    return { ok: true, requestId };
  };

  const respondUiPrompt = (payload = {}) => {
    const requestId = typeof payload?.requestId === 'string' ? payload.requestId.trim() : '';
    if (!requestId) {
      return { ok: false, message: 'requestId is required' };
    }
    const runId = typeof payload?.runId === 'string' ? payload.runId.trim() : '';
    const response = payload?.response && typeof payload.response === 'object' ? payload.response : null;
    if (!response) {
      return { ok: false, message: 'response is required' };
    }
    const status = typeof response?.status === 'string' ? response.status.trim() : '';
    if (!status) {
      return { ok: false, message: 'response.status is required' };
    }

    const entry = {
      ts: new Date().toISOString(),
      type: 'ui_prompt',
      action: 'response',
      requestId,
      ...(runId ? { runId } : {}),
      response,
    };
    try {
      ensureFileExists(defaultPaths.uiPrompts);
      capJsonlFile(defaultPaths.uiPrompts, promptLogLimits);
      fs.appendFileSync(defaultPaths.uiPrompts, `${JSON.stringify(entry)}\n`, 'utf8');
      return { ok: true };
    } catch (err) {
      return { ok: false, message: err?.message || String(err) };
    }
  };

  return { requestUiPrompt, respondUiPrompt };
}
