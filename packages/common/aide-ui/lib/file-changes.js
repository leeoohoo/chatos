export function getFileChangeKey(entry) {
  const relativePath = typeof entry?.path === 'string' ? entry.path : '';
  if (relativePath) return relativePath;
  return typeof entry?.absolutePath === 'string' ? entry.absolutePath : '';
}

export function dedupeFileChanges(entries = []) {
  const list = Array.isArray(entries) ? entries : [];
  const seen = new Set();
  const result = [];
  for (let i = list.length - 1; i >= 0; i -= 1) {
    const item = list[i];
    const key = getFileChangeKey(item);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}
