import fs from 'fs';

function toPositiveInt(value, fallback = 0) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(0, Math.floor(num));
}

export function capJsonlFile(filePath, options = {}) {
  const target = typeof filePath === 'string' ? filePath.trim() : '';
  if (!target) return;
  const maxBytes = toPositiveInt(options.maxBytes, 0);
  const maxLines = toPositiveInt(options.maxLines, 0);
  if (maxBytes <= 0 && maxLines <= 0) return;

  let stat = null;
  try {
    stat = fs.statSync(target);
  } catch {
    return;
  }

  if (maxBytes > 0 && stat.size <= maxBytes && maxLines <= 0) return;
  if (maxBytes > 0 && stat.size <= maxBytes && maxLines > 0) {
    // Small files are unlikely to exceed line limits; avoid extra work.
    return;
  }

  let content = '';
  try {
    content = fs.readFileSync(target, 'utf8');
  } catch {
    return;
  }

  const lines = content.split('\n').filter((line) => line.trim().length > 0);
  if (lines.length === 0) return;

  let trimmed = lines;
  if (maxLines > 0 && trimmed.length > maxLines) {
    trimmed = trimmed.slice(trimmed.length - maxLines);
  }

  if (maxBytes > 0) {
    let combined = trimmed.join('\n');
    while (combined.length > maxBytes && trimmed.length > 1) {
      trimmed.shift();
      combined = trimmed.join('\n');
    }
  }

  const output = trimmed.length > 0 ? `${trimmed.join('\n')}\n` : '';
  try {
    fs.writeFileSync(target, output, 'utf8');
  } catch {
    // ignore trim errors
  }
}
