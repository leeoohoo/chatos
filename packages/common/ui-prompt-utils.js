import { normalizeTextList, safeTrim } from './text-utils.js';

function buildError(message, returnResult) {
  if (returnResult) {
    return { ok: false, message };
  }
  throw new Error(message);
}

export function normalizeKvFields(fields, options = {}) {
  const {
    maxFields,
    returnResult = false,
    label = 'fields',
    keyLabel = 'field.key',
  } = options;
  if (!Array.isArray(fields) || fields.length === 0) {
    return buildError(`${label} is required`, returnResult);
  }
  if (Number.isFinite(maxFields) && fields.length > maxFields) {
    return buildError(`${label} must be <= ${maxFields}`, returnResult);
  }
  const seen = new Set();
  const out = [];
  for (const field of fields) {
    const key = safeTrim(field?.key);
    if (!key) {
      return buildError(`${keyLabel} is required`, returnResult);
    }
    if (seen.has(key)) {
      return buildError(`duplicate field key: ${key}`, returnResult);
    }
    seen.add(key);
    out.push({
      key,
      label: safeTrim(field?.label),
      description: safeTrim(field?.description),
      placeholder: safeTrim(field?.placeholder),
      default: typeof field?.default === 'string' ? field.default : '',
      required: field?.required === true,
      multiline: field?.multiline === true,
      secret: field?.secret === true,
    });
  }
  return returnResult ? { ok: true, fields: out } : out;
}

export function normalizeChoiceOptions(options, config = {}) {
  const {
    maxOptions,
    returnResult = false,
    label = 'options',
    valueLabel = 'options[].value',
  } = config;
  if (!Array.isArray(options) || options.length === 0) {
    return buildError(`${label} is required`, returnResult);
  }
  if (Number.isFinite(maxOptions) && options.length > maxOptions) {
    return buildError(`${label} must be <= ${maxOptions}`, returnResult);
  }
  const seen = new Set();
  const out = [];
  for (const opt of options) {
    const value = safeTrim(opt?.value);
    if (!value) {
      return buildError(`${valueLabel} is required`, returnResult);
    }
    if (seen.has(value)) {
      return buildError(`duplicate option value: ${value}`, returnResult);
    }
    seen.add(value);
    out.push({
      value,
      label: safeTrim(opt?.label),
      description: safeTrim(opt?.description),
    });
  }
  return returnResult ? { ok: true, options: out } : out;
}

export function normalizeChoiceLimits(params = {}) {
  const {
    multiple,
    minSelections,
    maxSelections,
    min,
    max,
    optionCount,
    mode = 'strict',
    singleMin,
    singleMax,
    returnResult = false,
    minLabel = 'minSelections',
    maxLabel = 'maxSelections',
  } = params;
  const count = Number.isFinite(Number(optionCount)) ? Number(optionCount) : 0;
  const minValue = minSelections ?? min;
  const maxValue = maxSelections ?? max;

  if (!multiple) {
    const resolvedMin = Number.isFinite(Number(singleMin))
      ? Number(singleMin)
      : mode === 'clamp'
        ? 1
        : 0;
    const resolvedMax = Number.isFinite(Number(singleMax))
      ? Number(singleMax)
      : count;
    const base = { minSelections: resolvedMin, maxSelections: resolvedMax };
    return returnResult ? { ok: true, ...base } : base;
  }

  if (mode === 'clamp') {
    const minRaw = Number(minValue);
    const maxRaw = Number(maxValue);
    const minSelectionsValue =
      Number.isFinite(minRaw) && minRaw >= 0
        ? Math.min(Math.max(0, Math.floor(minRaw)), count)
        : 0;
    const maxSelectionsValue =
      Number.isFinite(maxRaw) && maxRaw >= 1
        ? Math.min(Math.max(1, Math.floor(maxRaw)), count)
        : count;
    const base = {
      minSelections: Math.min(minSelectionsValue, maxSelectionsValue),
      maxSelections: maxSelectionsValue,
    };
    return returnResult ? { ok: true, ...base } : base;
  }

  const minRaw = Number.isFinite(Number(minValue)) ? Number(minValue) : 0;
  const maxRaw = Number.isFinite(Number(maxValue)) ? Number(maxValue) : count;
  if (!Number.isInteger(minRaw) || minRaw < 0 || minRaw > count) {
    return buildError(`${minLabel} must be an int between 0 and ${count}`, returnResult);
  }
  if (!Number.isInteger(maxRaw) || maxRaw < 1 || maxRaw > count) {
    return buildError(`${maxLabel} must be an int between 1 and ${count}`, returnResult);
  }
  if (minRaw > maxRaw) {
    return buildError(`${minLabel} must be <= ${maxLabel}`, returnResult);
  }
  const base = { minSelections: minRaw, maxSelections: maxRaw };
  return returnResult ? { ok: true, ...base } : base;
}

export function normalizeTaskConfirmTasks(tasks, options = {}) {
  const list = Array.isArray(tasks) ? tasks : [];
  const allowedPriority = options.allowedPriority instanceof Set
    ? options.allowedPriority
    : new Set(Array.isArray(options.allowedPriority) ? options.allowedPriority : ['high', 'medium', 'low']);
  const allowedStatus = options.allowedStatus instanceof Set
    ? options.allowedStatus
    : new Set(Array.isArray(options.allowedStatus) ? options.allowedStatus : ['todo', 'doing', 'blocked', 'done']);
  const defaultPriority = typeof options.defaultPriority === 'string' ? options.defaultPriority : 'medium';
  const defaultStatus = typeof options.defaultStatus === 'string' ? options.defaultStatus : 'todo';
  const generateId =
    typeof options.generateId === 'function'
      ? options.generateId
      : () => `draft_${Date.now().toString(36)}_${Math.random().toString(16).slice(2, 10)}`;

  return list
    .filter((item) => item && typeof item === 'object')
    .map((task) => {
      const priorityRaw = safeTrim(task?.priority);
      const statusRaw = safeTrim(task?.status);
      const draftId = safeTrim(task?.draftId) || generateId();
      return {
        draftId,
        title: typeof task?.title === 'string' ? task.title : '',
        details: typeof task?.details === 'string' ? task.details : '',
        priority: allowedPriority.has(priorityRaw) ? priorityRaw : defaultPriority,
        status: allowedStatus.has(statusRaw) ? statusRaw : defaultStatus,
        tags: normalizeTextList(task?.tags),
      };
    });
}

export function normalizePromptBase(rawPrompt = {}) {
  const kind = safeTrim(rawPrompt?.kind);
  const title = typeof rawPrompt?.title === 'string' ? rawPrompt.title : '';
  const message = typeof rawPrompt?.message === 'string' ? rawPrompt.message : '';
  const source = typeof rawPrompt?.source === 'string' ? rawPrompt.source : '';
  const allowCancel = rawPrompt?.allowCancel !== false;
  return {
    kind,
    title,
    message,
    allowCancel,
    ...(source && source.trim() ? { source } : {}),
  };
}
