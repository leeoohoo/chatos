const FILE_TAG_BLOCK_RE = /<!--\s*chatos-files:\s*([\s\S]*?)-->/gi;

export function normalizeFileTags(input) {
  const list = Array.isArray(input) ? input : input ? [input] : [];
  const seen = new Set();
  const result = [];
  for (const item of list) {
    const text = String(item || '').trim();
    if (!text || seen.has(text)) continue;
    seen.add(text);
    result.push(text);
  }
  return result;
}

export function buildFileTagBlock(input) {
  const files = normalizeFileTags(input);
  if (files.length === 0) return '';
  return `<!-- chatos-files:\n${files.join('\n')}\n-->`;
}

export function extractFileTags(content) {
  const raw = typeof content === 'string' ? content : String(content || '');
  if (!raw) return { text: raw, files: [] };
  const files = [];
  const cleaned = raw.replace(FILE_TAG_BLOCK_RE, (_match, group) => {
    const lines = String(group || '').split(/\r?\n/);
    for (const line of lines) {
      const text = String(line || '').trim();
      if (text) files.push(text);
    }
    return '';
  });
  if (files.length === 0) return { text: raw, files: [] };
  return {
    text: cleaned.replace(/\n{3,}/g, '\n\n').trim(),
    files: normalizeFileTags(files),
  };
}
