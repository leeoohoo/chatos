import fs from 'fs';
import path from 'path';

import { ensureDir, ensureFileExists, readFileFingerprint } from '../session-api-helpers.js';

export function createSessionWatchers({
  defaultPaths,
  getMainWindow,
  readConfigPayload,
  readSessionPayload,
  readEventsPayload,
  readFileChangesPayload,
  readUiPromptsPayload,
  readRunsPayload,
} = {}) {
  const resolveWindow = typeof getMainWindow === 'function' ? getMainWindow : () => null;

  let sessionWatcher = null;
  let eventsWatcher = null;
  let tasksWatcher = null;
  let fileChangesWatcher = null;
  let uiPromptsWatcher = null;
  let runsWatcher = null;
  let tasksWatcherDebounce = null;
  let tasksWatcherRestart = null;
  let tasksPoller = null;
  let lastAdminDbFingerprint = null;

  const startSessionWatcher = () => {
    if (sessionWatcher) return;
    ensureFileExists(defaultPaths.sessionReport);
    sessionWatcher = fs.watch(defaultPaths.sessionReport, { persistent: false }, () => {
      const win = resolveWindow();
      if (win) {
        win.webContents.send('session:update', readSessionPayload());
      }
    });
  };

  const startEventsWatcher = () => {
    if (eventsWatcher) return;
    ensureFileExists(defaultPaths.events);
    eventsWatcher = fs.watch(defaultPaths.events, { persistent: false }, () => {
      const win = resolveWindow();
      if (win) {
        win.webContents.send('events:update', readEventsPayload());
      }
    });
  };

  const startFileChangesWatcher = () => {
    startTasksWatcher();
  };

  const startUiPromptsWatcher = () => {
    if (uiPromptsWatcher) return;
    ensureFileExists(defaultPaths.uiPrompts);
    uiPromptsWatcher = fs.watch(defaultPaths.uiPrompts, { persistent: false }, () => {
      const win = resolveWindow();
      if (win) {
        win.webContents.send('uiPrompts:update', readUiPromptsPayload());
      }
    });
  };

  const startRunsWatcher = () => {
    if (runsWatcher) return;
    ensureFileExists(defaultPaths.runs);
    runsWatcher = fs.watch(defaultPaths.runs, { persistent: false }, () => {
      const win = resolveWindow();
      if (win) {
        win.webContents.send('runs:update', readRunsPayload());
      }
    });
  };

  const startTasksWatcher = () => {
    if (tasksWatcher || tasksPoller) return;

    const emitConfigUpdate = () => {
      const fingerprint = readFileFingerprint(defaultPaths.adminDb);
      if (fingerprint && fingerprint === lastAdminDbFingerprint) {
        return;
      }
      lastAdminDbFingerprint = fingerprint;
      const win = resolveWindow();
      if (win) {
        win.webContents.send('config:update', readConfigPayload());
        win.webContents.send('fileChanges:update', readFileChangesPayload());
      }
    };

    const scheduleRefresh = () => {
      if (tasksWatcherDebounce) clearTimeout(tasksWatcherDebounce);
      tasksWatcherDebounce = setTimeout(() => {
        tasksWatcherDebounce = null;
        emitConfigUpdate();
      }, 50);
    };

    const startTasksPoller = (pollMs = 750) => {
      if (tasksPoller) return;
      // We may be falling back after missing fs events; force a refresh once so UI catches up.
      lastAdminDbFingerprint = null;
      emitConfigUpdate();
      tasksPoller = setInterval(() => emitConfigUpdate(), pollMs);
      if (tasksPoller && typeof tasksPoller.unref === 'function') {
        tasksPoller.unref();
      }
    };

    const restartWatch = (delayMs = 25) => {
      if (tasksWatcherRestart) return;
      try {
        tasksWatcher?.close?.();
      } catch {
        // ignore
      }
      tasksWatcher = null;
      tasksWatcherRestart = setTimeout(() => {
        tasksWatcherRestart = null;
        startTasksWatcher();
      }, delayMs);
    };

    const adminDbDir = path.dirname(defaultPaths.adminDb);
    const adminDbBase = path.basename(defaultPaths.adminDb);

    const sqliteSidecars = new Set([
      `${adminDbBase}-wal`,
      `${adminDbBase}-shm`,
      `${adminDbBase}-journal`,
    ]);

    const shouldRefreshForFilename = (filename) => {
      if (!filename) return true;
      const normalized = Buffer.isBuffer(filename) ? filename.toString('utf8') : String(filename || '');
      if (!normalized) return true;
      if (normalized === adminDbBase) return true;
      if (sqliteSidecars.has(normalized)) return true;
      return false;
    };

    ensureDir(adminDbDir);
    ensureFileExists(defaultPaths.adminDb);
    try {
      // Watch the directory (not the file). SQLite writes WAL/SHM sidecars,
      // and a file watcher can break across rename on some platforms.
      tasksWatcher = fs.watch(adminDbDir, { persistent: false }, (_eventType, filename) => {
        if (!shouldRefreshForFilename(filename)) return;
        scheduleRefresh();
      });
      if (tasksWatcher && tasksWatcher.on) {
        tasksWatcher.on('error', (err) => {
          const code = err?.code;
          if (code === 'EMFILE' || code === 'ENOSPC') {
            try {
              tasksWatcher?.close?.();
            } catch {
              // ignore
            }
            tasksWatcher = null;
            startTasksPoller();
            return;
          }
          restartWatch(250);
        });
      }
    } catch {
      startTasksPoller();
    }
  };

  const dispose = () => {
    try {
      sessionWatcher?.close?.();
    } catch {
      // ignore
    }
    sessionWatcher = null;

    try {
      eventsWatcher?.close?.();
    } catch {
      // ignore
    }
    eventsWatcher = null;

    try {
      tasksWatcher?.close?.();
    } catch {
      // ignore
    }
    tasksWatcher = null;

    try {
      fileChangesWatcher?.close?.();
    } catch {
      // ignore
    }
    fileChangesWatcher = null;

    try {
      uiPromptsWatcher?.close?.();
    } catch {
      // ignore
    }
    uiPromptsWatcher = null;

    try {
      runsWatcher?.close?.();
    } catch {
      // ignore
    }
    runsWatcher = null;

    if (tasksWatcherDebounce) {
      clearTimeout(tasksWatcherDebounce);
      tasksWatcherDebounce = null;
    }
    if (tasksWatcherRestart) {
      clearTimeout(tasksWatcherRestart);
      tasksWatcherRestart = null;
    }
    if (tasksPoller) {
      clearInterval(tasksPoller);
      tasksPoller = null;
    }
  };

  return {
    dispose,
    startEventsWatcher,
    startFileChangesWatcher,
    startRunsWatcher,
    startSessionWatcher,
    startTasksWatcher,
    startUiPromptsWatcher,
  };
}
