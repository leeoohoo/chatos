function normalizeErrorText(value) {
  if (typeof value === 'string') return value.trim();
  if (value === undefined || value === null) return '';
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value instanceof Error && typeof value.message === 'string') {
    return value.message.trim();
  }
  return '';
}

function matchesAnyPattern(text, patterns) {
  if (!text) return false;
  return patterns.some((pattern) => pattern.test(text));
}

function getErrorStatus(err) {
  const candidates = [
    err?.status,
    err?.statusCode,
    err?.response?.status,
    err?.response?.statusCode,
    err?.response?.data?.status,
    err?.response?.data?.statusCode,
  ];
  for (const value of candidates) {
    const num = Number(value);
    if (Number.isFinite(num) && num > 0) return num;
  }
  return null;
}

function collectErrorMessages(err) {
  const messages = [];
  const push = (value) => {
    const text = normalizeErrorText(value);
    if (text) messages.push(text);
  };
  push(err?.message);
  push(err?.error?.message);
  push(err?.error?.error?.message);
  push(err?.response?.data?.error?.message);
  push(err?.response?.data?.message);
  push(err?.response?.data?.error_description);
  push(err?.response?.data?.error?.detail);
  push(err?.response?.data?.error?.details);
  if (typeof err?.response?.data === 'string') push(err.response.data);
  if (typeof err?.data === 'string') push(err.data);
  if (typeof err?.error === 'string') push(err.error);
  return Array.from(new Set(messages));
}

function collectErrorCodes(err) {
  const codes = [];
  const push = (value) => {
    const text = normalizeErrorText(value);
    if (text) codes.push(text);
  };
  push(err?.code);
  push(err?.error?.code);
  push(err?.error?.error?.code);
  push(err?.response?.data?.error?.code);
  push(err?.response?.data?.code);
  return Array.from(new Set(codes));
}

function collectErrorTypes(err) {
  const types = [];
  const push = (value) => {
    const text = normalizeErrorText(value);
    if (text) types.push(text);
  };
  push(err?.type);
  push(err?.error?.type);
  push(err?.error?.error?.type);
  push(err?.response?.data?.error?.type);
  push(err?.response?.data?.type);
  return Array.from(new Set(types));
}

export function extractErrorInfo(err) {
  const status = getErrorStatus(err);
  const messages = collectErrorMessages(err);
  const codes = collectErrorCodes(err);
  const types = collectErrorTypes(err);
  return {
    status,
    messages,
    message: messages[0] || '',
    code: codes[0] || '',
    type: types[0] || '',
  };
}

export function isContextLengthError(err) {
  const info = extractErrorInfo(err);
  const status = info.status;
  const messageText = info.messages.join('\n').toLowerCase();
  const codeText = [info.code, info.type].filter(Boolean).join(' ').toLowerCase();
  const codePatterns = [
    /context[_\s-]?length/,
    /context_length_exceeded/,
    /max[_\s-]?tokens?/,
    /token[_\s-]?limit/,
    /context_window/,
    /length_exceeded/,
  ];
  const messagePatterns = [
    /maximum context length/,
    /context length/,
    /context window/,
    /token limit/,
    /max(?:imum)?\s*tokens?/,
    /too many tokens/,
    /exceed(?:ed|s)?\s*(?:the )?(?:maximum )?(?:context|token)/,
    /input.*too long/,
    /prompt.*too long/,
    /上下文.*(过长|超出|超长|超过|上限|限制)/,
    /上下文长度/,
    /(token|tokens).*(超|超过|上限|限制)/,
    /最大.*(上下文|token)/,
    /输入.*过长/,
  ];
  const hasCodeHint = matchesAnyPattern(codeText, codePatterns);
  const hasMessageHint = matchesAnyPattern(messageText, messagePatterns);
  if (hasCodeHint || hasMessageHint) {
    return true;
  }
  if (status === 400) {
    const statusHints = /(context|token|length|window|上下文|长度)/i;
    return statusHints.test(messageText) || statusHints.test(codeText);
  }
  return false;
}

export { normalizeErrorText };
