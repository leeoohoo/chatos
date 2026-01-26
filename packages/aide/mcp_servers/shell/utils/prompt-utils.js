export function tailText(text, maxChars = 4000) {
  const value = typeof text === 'string' ? text : text == null ? '' : String(text);
  const limit = Number.isFinite(Number(maxChars)) ? Math.max(0, Math.floor(Number(maxChars))) : 4000;
  if (limit <= 0) return '';
  if (value.length <= limit) return value;
  return value.slice(value.length - limit);
}

function getLastNonEmptyLine(text) {
  const normalized = String(text || '').replace(/\r\n/g, '\n');
  const lines = normalized.split('\n');
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = String(lines[i] || '').trimEnd();
    if (line.trim()) return line;
  }
  return '';
}

export function detectInteractivePrompt(outputTail) {
  const lastLine = getLastNonEmptyLine(outputTail);
  if (!lastLine) return null;
  const trimmed = lastLine.trimEnd();

  if (/are you sure you want to continue connecting/i.test(trimmed)) {
    return { kind: 'ssh_hostkey', line: trimmed };
  }
  if (/\b(?:password|passphrase)[^:\n]*:\s*$/i.test(trimmed)) {
    return { kind: 'password', line: trimmed };
  }
  if (/enter file in which to save the key/i.test(trimmed)) {
    return { kind: 'ssh_keygen', line: trimmed };
  }
  if (/enter (?:passphrase|same passphrase again)[^:\n]*:\s*$/i.test(trimmed)) {
    return { kind: 'passphrase', line: trimmed };
  }
  if (/(?:\(|\[)\s*y\s*\/\s*n\s*(?:\)|\])\s*$/i.test(trimmed)) {
    return { kind: 'confirm_yn', line: trimmed };
  }
  if (/\(\s*yes\s*\/\s*no(?:\/[^\)\]]+)?\s*\)\s*$/i.test(trimmed)) {
    return { kind: 'confirm_yesno', line: trimmed };
  }
  if (/(?:\?|:|：)\s*$/i.test(trimmed) && /(enter|请输入|输入|please enter|type|confirm|continue|proceed)/i.test(trimmed)) {
    return { kind: 'prompt', line: trimmed };
  }
  return null;
}
