import fs from 'fs';
import { capJsonlFile } from '../../shared/log-utils.js';
import { ensureFileExists } from '../shared/fs-utils.js';

function normalizeResponseStatus(status) {
  const value = typeof status === 'string' ? status.trim().toLowerCase() : '';
  if (value === 'ok' || value === 'canceled' || value === 'timeout') {
    return value;
  }
  if (!value) return 'canceled';
  return 'canceled';
}

export function createPromptLog({ promptLogPath, promptLogLimits, serverName } = {}) {
  const logPath = typeof promptLogPath === 'string' ? promptLogPath : '';
  const logLimits = promptLogLimits && typeof promptLogLimits === 'object' ? promptLogLimits : null;
  const logServerName = typeof serverName === 'string' ? serverName : 'task_manager';

  const appendPromptEntry = (entry) => {
    if (!logPath) return;
    try {
      ensureFileExists(logPath);
      if (logLimits) {
        capJsonlFile(logPath, logLimits);
      }
      fs.appendFileSync(logPath, `${JSON.stringify(entry)}\n`, 'utf8');
    } catch {
      // ignore
    }
  };

  const findLatestPromptResponse = (requestId) => {
    if (!logPath) return null;
    try {
      if (!fs.existsSync(logPath)) {
        return null;
      }
      const raw = fs.readFileSync(logPath, 'utf8');
      const lines = raw.split('\n').filter((line) => line && line.trim().length > 0);
      let match = null;
      for (const line of lines) {
        try {
          const parsed = JSON.parse(line);
          if (
            parsed &&
            typeof parsed === 'object' &&
            parsed.type === 'ui_prompt' &&
            parsed.action === 'response' &&
            parsed.requestId === requestId
          ) {
            match = parsed;
          }
        } catch {
          // ignore parse errors
        }
      }
      return match;
    } catch {
      return null;
    }
  };

  const waitForPromptResponse = async ({ requestId }) => {
    if (!logPath) return null;
    let watcher = null;
    let poll = null;
    const cleanup = () => {
      if (watcher) {
        try {
          watcher.close();
        } catch {
          // ignore
        }
        watcher = null;
      }
      if (poll) {
        clearInterval(poll);
        poll = null;
      }
    };

    return await new Promise((resolve) => {
      const tryRead = () => {
        const found = findLatestPromptResponse(requestId);
        if (found) {
          cleanup();
          resolve(found);
        }
      };
      try {
        watcher = fs.watch(logPath, { persistent: false }, () => tryRead());
        if (watcher && typeof watcher.on === 'function') {
          watcher.on('error', (err) => {
            try {
              console.error(`[${logServerName}] prompt log watcher error: ${err?.message || err}`);
            } catch {
              // ignore
            }
            try {
              watcher?.close?.();
            } catch {
              // ignore
            }
            watcher = null;
          });
        }
      } catch {
        watcher = null;
      }
      poll = setInterval(tryRead, 800);
      if (poll && typeof poll.unref === 'function') {
        poll.unref();
      }
      tryRead();
    });
  };

  return {
    appendPromptEntry,
    waitForPromptResponse,
    normalizeResponseStatus,
  };
}
