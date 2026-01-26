import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { pathToFileURL } from 'url';
import { clampNumber } from '../../cli-utils.js';

const fsp = fs.promises;

export function safeStat(target) {
  return fsp
    .stat(target)
    .catch((err) => {
      if (err && err.code === 'ENOENT') return null;
      throw err;
    });
}

export function toFileUri(p) {
  return pathToFileURL(path.resolve(p)).toString();
}

export function fromFileUri(uri) {
  try {
    const url = new URL(uri);
    if (url.protocol !== 'file:') return null;
    return url.pathname ? decodeURIComponent(url.pathname) : null;
  } catch {
    return null;
  }
}

export function guessLanguageId(absPath) {
  const name = path.basename(absPath);
  if (name === 'Dockerfile') return 'dockerfile';
  const ext = path.extname(name).toLowerCase();
  const map = {
    '.ts': 'typescript',
    '.tsx': 'typescriptreact',
    '.js': 'javascript',
    '.jsx': 'javascriptreact',
    '.mjs': 'javascript',
    '.cjs': 'javascript',
    '.json': 'json',
    '.py': 'python',
    '.go': 'go',
    '.rs': 'rust',
    '.java': 'java',
    '.kt': 'kotlin',
    '.c': 'c',
    '.h': 'c',
    '.cc': 'cpp',
    '.cpp': 'cpp',
    '.cxx': 'cpp',
    '.hpp': 'cpp',
    '.cs': 'csharp',
    '.php': 'php',
    '.rb': 'ruby',
    '.swift': 'swift',
    '.lua': 'lua',
    '.sh': 'shellscript',
    '.bash': 'shellscript',
    '.zsh': 'shellscript',
    '.yaml': 'yaml',
    '.yml': 'yaml',
    '.toml': 'toml',
    '.md': 'markdown',
    '.html': 'html',
    '.htm': 'html',
    '.css': 'css',
    '.scss': 'scss',
    '.less': 'less',
  };
  return map[ext] || 'plaintext';
}

export function toLspPosition({ line, character }) {
  const l = clampNumber(line, 1, Number.MAX_SAFE_INTEGER, 1) - 1;
  const c = clampNumber(character, 1, Number.MAX_SAFE_INTEGER, 1) - 1;
  return { line: l, character: c };
}

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
