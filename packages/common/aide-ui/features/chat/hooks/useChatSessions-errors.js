import { normalizeErrorText } from '../../../../error-utils.js';

export function collectErrorHints(payload) {
  const hints = [];
  const push = (value) => {
    const text = normalizeErrorText(value);
    if (text) hints.push(text);
  };
  push(payload?.message);
  push(payload?.error?.message);
  push(payload?.error?.detail);
  push(payload?.error?.details);
  push(payload?.error?.type);
  push(payload?.error?.code);
  push(payload?.error?.error?.message);
  push(payload?.error?.error?.type);
  push(payload?.error?.error?.code);
  push(payload?.code);
  push(payload?.type);
  return hints;
}

export function extractErrorMessage(payload) {
  const hints = collectErrorHints(payload);
  if (hints.length > 0) return hints[0];
  return '';
}
