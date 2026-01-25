const STEP_TEXT_LIMIT = 8000;
const STEP_REASONING_LIMIT = 6000;

function safeStringify(value) {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function normalizeStepText(value, limit = STEP_TEXT_LIMIT) {
  const raw = safeStringify(value);
  if (!raw) {
    return { text: '', truncated: false, length: 0 };
  }
  if (raw.length <= limit) {
    return { text: raw, truncated: false, length: raw.length };
  }
  const clipped = raw.slice(0, limit);
  return {
    text: `${clipped}\n...[truncated ${raw.length - limit} chars]`,
    truncated: true,
    length: raw.length,
  };
}

export { STEP_REASONING_LIMIT, STEP_TEXT_LIMIT, normalizeStepText };
