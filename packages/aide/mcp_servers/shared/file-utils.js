import crypto from 'crypto';

export function hashContent(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}

export function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) {
    return 'n/a';
  }
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  const units = ['KB', 'MB', 'GB'];
  let value = bytes;
  let unitIndex = -1;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(1)} ${units[unitIndex]} (${bytes} B)`;
}

export function isBinaryBuffer(buffer, sampleSize = 512) {
  if (!buffer) return false;
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  if (buf.length === 0) return false;
  const sample = buf.length > sampleSize ? buf.subarray(0, sampleSize) : buf;
  for (const byte of sample) {
    if (byte === 0) return true;
  }
  return false;
}
