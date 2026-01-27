import fs from 'fs';
import path from 'path';

import { ensureDir } from '../../packages/common/state-core/utils.js';

export function createTerminalStatusStore({ baseTerminalsDir, getMainWindow } = {}) {
  const baseDir = typeof baseTerminalsDir === 'string' && baseTerminalsDir.trim() ? baseTerminalsDir : '';
  const resolveWindow = typeof getMainWindow === 'function' ? getMainWindow : () => null;

  let terminalStatusWatcher = null;
  let terminalStatusWatcherDebounce = null;

  const readTerminalStatus = (runId) => {
    const rid = typeof runId === 'string' ? runId.trim() : '';
    if (!rid || !baseDir) return null;
    const statusPath = path.join(baseDir, `${rid}.status.json`);
    try {
      if (!fs.existsSync(statusPath)) return null;
      const raw = fs.readFileSync(statusPath, 'utf8');
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        return parsed;
      }
    } catch {
      // ignore status read errors
    }
    return null;
  };

  const listTerminalStatuses = () => {
    try {
      if (!baseDir) return [];
      ensureDir(baseDir);
      const files = fs.readdirSync(baseDir).filter((name) => name.endsWith('.status.json'));
      const out = [];
      files.forEach((name) => {
        const runId = name.replace(/\.status\.json$/, '');
        const status = readTerminalStatus(runId);
        if (status) out.push(status);
      });
      return out;
    } catch {
      return [];
    }
  };

  const broadcastTerminalStatuses = () => {
    const win = resolveWindow();
    if (!win) return;
    win.webContents.send('terminalStatus:update', {
      statuses: listTerminalStatuses(),
    });
  };

  const startTerminalStatusWatcher = () => {
    if (terminalStatusWatcher || !baseDir) return;
    ensureDir(baseDir);
    terminalStatusWatcher = fs.watch(baseDir, { persistent: false }, () => {
      if (terminalStatusWatcherDebounce) {
        clearTimeout(terminalStatusWatcherDebounce);
      }
      terminalStatusWatcherDebounce = setTimeout(() => {
        terminalStatusWatcherDebounce = null;
        broadcastTerminalStatuses();
      }, 120);
    });
    broadcastTerminalStatuses();
  };

  const appendTerminalControl = (runId, command) => {
    const rid = typeof runId === 'string' ? runId.trim() : '';
    if (!rid) throw new Error('runId is required');
    if (!baseDir) throw new Error('terminalsDir is required');
    ensureDir(baseDir);
    const controlPath = path.join(baseDir, `${rid}.control.jsonl`);
    fs.appendFileSync(controlPath, `${JSON.stringify(command)}\n`, 'utf8');
  };

  const appendTerminalInbox = (runId, entry) => {
    const rid = typeof runId === 'string' ? runId.trim() : '';
    if (!rid) throw new Error('runId is required');
    if (!baseDir) throw new Error('terminalsDir is required');
    ensureDir(baseDir);
    const inboxPath = path.join(baseDir, `${rid}.inbox.jsonl`);
    fs.appendFileSync(inboxPath, `${JSON.stringify(entry)}\n`, 'utf8');
  };

  const waitForTerminalStatus = async (runId, timeoutMs = 1200) => {
    const rid = typeof runId === 'string' ? runId.trim() : '';
    if (!rid) return null;
    const deadline = Date.now() + Math.max(0, Number(timeoutMs) || 0);
    while (Date.now() < deadline) {
      const status = readTerminalStatus(rid);
      if (status) return status;
      await new Promise((resolve) => setTimeout(resolve, 120));
    }
    return null;
  };

  const waitForTerminalState = async (runId, predicate, timeoutMs = 2000) => {
    const rid = typeof runId === 'string' ? runId.trim() : '';
    if (!rid) return null;
    const check = typeof predicate === 'function' ? predicate : () => false;
    const deadline = Date.now() + Math.max(0, Number(timeoutMs) || 0);
    while (Date.now() < deadline) {
      const status = readTerminalStatus(rid);
      if (check(status)) return status;
      await new Promise((resolve) => setTimeout(resolve, 140));
    }
    return readTerminalStatus(rid);
  };

  const dispose = () => {
    try {
      terminalStatusWatcher?.close?.();
    } catch {
      // ignore
    }
    terminalStatusWatcher = null;
    if (terminalStatusWatcherDebounce) {
      clearTimeout(terminalStatusWatcherDebounce);
      terminalStatusWatcherDebounce = null;
    }
  };

  return {
    appendTerminalControl,
    appendTerminalInbox,
    broadcastTerminalStatuses,
    dispose,
    listTerminalStatuses,
    readTerminalStatus,
    startTerminalStatusWatcher,
    waitForTerminalState,
    waitForTerminalStatus,
  };
}
