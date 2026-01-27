import path from 'path';

import { sanitizeName, safeUnlink } from './utils.js';

function isPathInsideDir(filePath, dirPath) {
  try {
    const dir = path.resolve(dirPath);
    const file = path.resolve(filePath);
    if (file === dir) return true;
    const prefix = dir.endsWith(path.sep) ? dir : `${dir}${path.sep}`;
    return file.startsWith(prefix);
  } catch {
    return false;
  }
}

export function cleanupSessionArtifacts({ sessionsDir, sessionName, status } = {}) {
  const safeName = sanitizeName(sessionName);
  const baseDir = typeof sessionsDir === 'string' && sessionsDir ? sessionsDir : '';
  if (!safeName || !baseDir) return;

  const computed = {
    statusPath: path.join(baseDir, `${safeName}.status.json`),
    outputPath: path.join(baseDir, `${safeName}.output.log`),
    controlPath: path.join(baseDir, `${safeName}.control.jsonl`),
  };

  const candidates = new Set(
    [
      status?.statusPath,
      status?.outputPath,
      status?.controlPath,
      computed.statusPath,
      computed.outputPath,
      computed.controlPath,
      `${computed.statusPath}.tmp`,
      `${computed.outputPath}.tmp`,
      `${computed.controlPath}.tmp`,
    ].filter((v) => typeof v === 'string' && v.trim())
  );

  for (const filePath of candidates) {
    if (!isPathInsideDir(filePath, baseDir)) continue;
    safeUnlink(filePath);
  }
}
