function decodeBase64(value) {
  const text = typeof value === 'string' ? value : '';
  if (!text) return '';
  if (typeof Buffer !== 'undefined') {
    try {
      return Buffer.from(text, 'base64').toString('utf8');
    } catch {
      return '';
    }
  }
  if (typeof atob === 'function') {
    try {
      return atob(text);
    } catch {
      return '';
    }
  }
  return '';
}

function normalizeEncoding(value, fallback = 'plain') {
  const raw = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return raw || fallback;
}

export function decodePayload(value, encoding = 'plain', options = {}) {
  const text = value === undefined || value === null ? '' : String(value);
  const normalized = normalizeEncoding(encoding, 'plain');
  if (normalized === 'base64') {
    const decoded = decodeBase64(text);
    if (decoded) return decoded;
    return options?.fallbackToRaw ? text : '';
  }
  return text;
}

function resolvePayloadFromArgs(args, options = {}) {
  if (!args || typeof args !== 'object') return '';
  const {
    textKey,
    base64Key,
    chunksKey = 'chunks',
    encodingKey = 'encoding',
    defaultEncoding = 'plain',
    ensureTrailingNewline = false,
    fallbackToRaw = false,
  } = options;
  const encoding = normalizeEncoding(args[encodingKey], defaultEncoding);

  const finalize = (payload) => {
    if (!payload) return '';
    if (!ensureTrailingNewline || payload.endsWith('\n')) return payload;
    return `${payload}\n`;
  };

  if (base64Key && typeof args[base64Key] === 'string' && args[base64Key].length > 0) {
    const decoded = decodePayload(args[base64Key], 'base64', { fallbackToRaw });
    return finalize(decoded);
  }

  if (Array.isArray(args[chunksKey]) && args[chunksKey].length > 0) {
    const segments = args[chunksKey].map((chunk) => {
      if (!chunk || typeof chunk !== 'object') return '';
      const chunkEncoding = normalizeEncoding(chunk.encoding, encoding);
      if (chunk.content === undefined || chunk.content === null) return '';
      return decodePayload(chunk.content, chunkEncoding, { fallbackToRaw });
    });
    return finalize(segments.join(''));
  }

  if (textKey && typeof args[textKey] === 'string') {
    const decoded = decodePayload(args[textKey], encoding, { fallbackToRaw });
    return finalize(decoded);
  }

  return '';
}

export function resolveWritePayload(args, options = {}) {
  return resolvePayloadFromArgs(args, {
    textKey: 'contents',
    base64Key: 'contents_base64',
    ...options,
  });
}

export function resolvePatchPayload(args, options = {}) {
  return resolvePayloadFromArgs(args, {
    textKey: 'patch',
    base64Key: 'patch_base64',
    ...options,
  });
}
