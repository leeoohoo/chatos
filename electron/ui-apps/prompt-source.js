import fs from 'fs';
import path from 'path';

export function resolvePathWithinPlugin(pluginDir, relPath, label) {
  const rel = typeof relPath === 'string' ? relPath.trim() : '';
  if (!rel) return '';
  const resolved = path.resolve(pluginDir, rel);
  const relative = path.relative(pluginDir, resolved);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`${label} must be within plugin directory`);
  }
  return resolved;
}

export function readPromptSource({ pluginDir, source, label, maxPromptBytes } = {}) {
  if (!source) return '';
  const content = typeof source?.content === 'string' ? source.content : '';
  if (content && content.trim()) return content.trim();
  const relPath = typeof source?.path === 'string' ? source.path : '';
  if (!relPath) return '';
  const resolved = resolvePathWithinPlugin(pluginDir, relPath, label);
  if (!resolved) return '';
  const stat = fs.statSync(resolved);
  if (!stat.isFile()) {
    throw new Error(`${label} must be a file: ${relPath}`);
  }
  if (Number.isFinite(maxPromptBytes) && stat.size > maxPromptBytes) {
    throw new Error(`${label} too large (${stat.size} bytes): ${relPath}`);
  }
  const raw = fs.readFileSync(resolved, 'utf8');
  return String(raw || '').trim();
}
