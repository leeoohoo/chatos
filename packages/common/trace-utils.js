export function normalizeTraceValue(value) {
  return typeof value === 'string' ? value.trim() : '';
}

export function extractTraceMeta(meta) {
  if (!meta || typeof meta !== 'object') return null;
  const candidate =
    meta?.chatos?.trace && typeof meta.chatos.trace === 'object'
      ? meta.chatos.trace
      : meta?.trace && typeof meta.trace === 'object'
        ? meta.trace
        : meta;
  const traceId = normalizeTraceValue(candidate?.traceId);
  const spanId = normalizeTraceValue(candidate?.spanId);
  const parentSpanId = normalizeTraceValue(candidate?.parentSpanId);
  if (!traceId && !spanId && !parentSpanId) return null;
  return { traceId, spanId, parentSpanId };
}
