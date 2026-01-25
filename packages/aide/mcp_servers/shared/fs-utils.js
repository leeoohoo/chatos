import fs from 'fs';
import path from 'path';

function normalizeEnsureDirOptions(options) {
  if (typeof options === 'boolean') {
    return {
      readable: true,
      writable: options,
      requireDirectory: false,
      ignoreErrors: true,
    };
  }
  const resolved = options && typeof options === 'object' ? options : {};
  const requireDirectory = resolved.requireDirectory === true;
  return {
    readable: resolved.readable === true,
    writable: resolved.writable === true,
    requireDirectory,
    ignoreErrors: resolved.ignoreErrors === true ? true : resolved.ignoreErrors === false ? false : !requireDirectory,
  };
}

export function ensureDir(targetDir, options) {
  if (!targetDir) return;
  const { readable, writable, requireDirectory, ignoreErrors } = normalizeEnsureDirOptions(options);

  if (requireDirectory) {
    if (fs.existsSync(targetDir)) {
      const stats = fs.statSync(targetDir);
      if (!stats.isDirectory()) {
        throw new Error(`${targetDir} is not a directory`);
      }
    } else {
      fs.mkdirSync(targetDir, { recursive: true });
    }
  } else {
    try {
      fs.mkdirSync(targetDir, { recursive: true });
    } catch (err) {
      if (!ignoreErrors) throw err;
    }
  }

  if (readable || writable) {
    const mode = (readable ? fs.constants.R_OK : 0) | (writable ? fs.constants.W_OK : 0);
    try {
      fs.accessSync(targetDir, mode);
    } catch (err) {
      if (err && err.code === 'ENOENT') {
        fs.mkdirSync(targetDir, { recursive: true });
        return;
      }
      throw err;
    }
  }
}

export function ensureFileExists(filePath, defaultContent = '') {
  if (!filePath) return;
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
  } catch {
    // ignore
  }
  try {
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, defaultContent, 'utf8');
    }
  } catch {
    // ignore
  }
}
