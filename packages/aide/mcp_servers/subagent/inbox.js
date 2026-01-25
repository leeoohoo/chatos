import fs from 'fs';
import path from 'path';
import { resolveTerminalsDir } from '../../shared/state-paths.js';
import { ensureDir, ensureFileExists } from '../shared/fs-utils.js';

function touchFile(filePath) {
  ensureFileExists(filePath);
}

function readCursor(cursorPath) {
  try {
    if (!fs.existsSync(cursorPath)) return 0;
    const raw = fs.readFileSync(cursorPath, 'utf8');
    const num = Number(String(raw || '').trim());
    return Number.isFinite(num) && num >= 0 ? Math.floor(num) : 0;
  } catch {
    return 0;
  }
}

function persistCursor(cursorPath, cursor) {
  const num = Number(cursor);
  if (!Number.isFinite(num) || num < 0) return;
  try {
    fs.writeFileSync(cursorPath, String(Math.floor(num)), 'utf8');
  } catch {
    // ignore
  }
}

export function createRunInboxListener({ runId, sessionRoot, consumerId, onEntry, skipExisting, serverName } = {}) {
  const rid = typeof runId === 'string' ? runId.trim() : '';
  const root = typeof sessionRoot === 'string' ? sessionRoot.trim() : '';
  if (!rid || !root) return null;
  const cb = typeof onEntry === 'function' ? onEntry : null;
  if (!cb) return null;
  const consumer = typeof consumerId === 'string' && consumerId.trim() ? consumerId.trim() : String(process.pid);
  const nameText = typeof serverName === 'string' && serverName.trim() ? serverName.trim() : 'subagent_router';
  const dir = resolveTerminalsDir(root);
  const inboxPath = path.join(dir, `${rid}.inbox.jsonl`);
  const cursorPath = path.join(dir, `${rid}.inbox.${consumer}.cursor`);
  ensureDir(dir);
  touchFile(inboxPath);

  let cursor = readCursor(cursorPath);
  if (skipExisting === true && !fs.existsSync(cursorPath)) {
    try {
      cursor = fs.statSync(inboxPath).size;
      persistCursor(cursorPath, cursor);
    } catch {
      // ignore
    }
  }
  let partial = '';
  let watcher = null;
  let poll = null;
  let draining = false;

  const drain = () => {
    if (draining) return;
    draining = true;
    try {
      const buf = fs.readFileSync(inboxPath);
      const total = buf.length;
      if (cursor > total) {
        cursor = 0;
      }
      if (total <= cursor) {
        return;
      }
      const chunk = buf.slice(cursor);
      cursor = total;
      persistCursor(cursorPath, cursor);
      partial += chunk.toString('utf8');
      const lines = partial.split('\n');
      partial = lines.pop() || '';
      lines.forEach((line) => {
        const trimmed = String(line || '').trim();
        if (!trimmed) return;
        try {
          const parsed = JSON.parse(trimmed);
          cb(parsed);
        } catch {
          // ignore parse failures
        }
      });
    } catch {
      // ignore read failures
    } finally {
      draining = false;
    }
  };

  try {
    watcher = fs.watch(inboxPath, { persistent: false }, () => drain());
    if (watcher && typeof watcher.on === 'function') {
      watcher.on('error', (err) => {
        try {
          console.error(`[${nameText}] inbox watcher error: ${err?.message || err}`);
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
  poll = setInterval(drain, 650);
  if (poll && typeof poll.unref === 'function') poll.unref();
  drain();

  const close = () => {
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

  return { close };
}
