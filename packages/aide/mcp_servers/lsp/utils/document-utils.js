import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';
import { clampNumber } from '../../cli-utils.js';
import { formatBytes, hashContent } from '../../shared/file-utils.js';

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

export { hashContent, formatBytes };
