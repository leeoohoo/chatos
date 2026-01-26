export function isBinaryBuffer(buffer) {
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || '');
  if (buf.length === 0) return false;
  let suspicious = 0;
  for (let i = 0; i < buf.length; i += 1) {
    const byte = buf[i];
    if (byte === 0) return true;
    // Allow common whitespace and ANSI escape.
    if (byte === 9 || byte === 10 || byte === 13 || byte === 27) continue;
    // Control characters (excluding allowed ones) are suspicious.
    if (byte < 32) {
      suspicious += 1;
      continue;
    }
    // DEL
    if (byte === 127) {
      suspicious += 1;
    }
  }
  if (buf.length < 32) return suspicious >= 4;
  return suspicious / buf.length > 0.3;
}

export function appendToRollingBuffer(state, chunk, maxBytes) {
  const limit = Number.isFinite(Number(maxBytes)) ? Math.max(16 * 1024, Math.floor(Number(maxBytes))) : 2 * 1024 * 1024;
  const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk ?? ''), 'utf8');
  if (buf.length === 0) return state;
  state.chunks.push(buf);
  state.bytes += buf.length;
  while (state.bytes > limit && state.chunks.length > 0) {
    const removed = state.chunks.shift();
    if (removed) state.bytes -= removed.length;
    state.truncated = true;
  }
  return state;
}
