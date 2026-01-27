import fs from 'fs';
import path from 'path';
import { ensureRunId } from '../../common/run-id.js';

function ensureDir(filePath) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

export function createEventLogger(filePath, options = {}) {
  const target = filePath;
  ensureDir(target);
  const runId = (typeof options.runId === 'string' && options.runId.trim()) || ensureRunId();
  return {
    path: target,
    runId,
    log(type, payload) {
      const entry = {
        ts: new Date().toISOString(),
        type,
        payload,
        runId,
      };
      try {
        fs.appendFileSync(target, `${JSON.stringify(entry)}\n`, 'utf8');
      } catch {
        // ignore file logging errors
      }
      if (typeof options.onEntry === 'function') {
        try {
          options.onEntry(entry);
        } catch {
          // ignore callback errors
        }
      }
    },
  };
}
