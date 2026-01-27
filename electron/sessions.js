import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

import {
  ensureDir,
  getSessionPaths,
  readJsonSafe,
  readLastLinesFromFile,
  resolveSessionsDir,
  sanitizeName,
  writeJsonAtomic,
} from './sessions/utils.js';
import { startSession } from './sessions/launch-utils.js';
import { cleanupSessionArtifacts } from './sessions/cleanup-utils.js';
import { appendPort, extractPortsFromCommand, extractPortsFromText } from './sessions/port-utils.js';
import {
  isSessionAlive,
  listProcessTreePidsFromPs,
  resolveSessionIds,
  resolveSessionRuntimeFromToken,
  tryKillPid,
  tryKillProcessGroup,
  verifyPidToken,
  waitForSessionExit,
} from './sessions/runtime-utils.js';
import { isPidAlive } from './sessions/process-utils.js';

const execAsync = promisify(exec);
const PORT_SCAN_LINES = 140;
const PORT_SCAN_BYTES = 128 * 1024;

export async function listSessions({ sessionRoot, env } = {}) {
  const sessionsDir = resolveSessionsDir(sessionRoot, env);
  ensureDir(sessionsDir);
  const platform = process.platform;
  try {
    const files = fs.readdirSync(sessionsDir).filter((name) => name.endsWith('.status.json'));
    const sessions = [];
    for (const fileName of files) {
      const statusPath = path.join(sessionsDir, fileName);
      const status = readJsonSafe(statusPath);
      if (!status?.name) continue;
      const { pid, pgid } = resolveSessionIds(status);
      let running = pid ? isSessionAlive(pid, pgid) : false;
      let resolvedPid = pid;
      let resolvedPgid = pgid;
      let recovered = false;

      if (status.token) {
        if (running && pid && isPidAlive(pid)) {
          const verified = await verifyPidToken(pid, status.token);
          if (!verified) {
            running = false;
          }
        }

        if (!running) {
          const runtime = await resolveSessionRuntimeFromToken(status.token);
          if (runtime?.pid) {
            running = true;
            resolvedPid = runtime.pid;
            resolvedPgid = runtime.pgid;
            recovered = true;
          }
        }
      }

      const ports = [];
      const outputPath = typeof status?.outputPath === 'string' ? status.outputPath : '';
      if (running && outputPath) {
        const tail = readLastLinesFromFile(outputPath, PORT_SCAN_LINES, PORT_SCAN_BYTES);
        extractPortsFromText(tail).forEach((port) => appendPort(ports, port));
      }
      if (ports.length === 0) {
        extractPortsFromCommand(status?.command).forEach((port) => appendPort(ports, port));
      }
      const port = ports.length > 0 ? ports[0] : null;

      sessions.push({ ...status, running, resolvedPid, resolvedPgid, recovered, port, ports });
    }
    sessions.sort((a, b) => String(b.startedAt || '').localeCompare(String(a.startedAt || '')));
    return { available: true, platform, sessionsDir, sessions };
  } catch (err) {
    return { available: true, platform, sessionsDir, sessions: [], error: err?.message || String(err) };
  }
}

export async function killSession({ sessionRoot, name, signal, env } = {}) {
  const sessionName = sanitizeName(name);
  if (!sessionName) {
    throw new Error('session name is required');
  }
  const sessionsDir = resolveSessionsDir(sessionRoot, env);
  ensureDir(sessionsDir);
  const statusPath = path.join(sessionsDir, `${sessionName}.status.json`);
  const status = readJsonSafe(statusPath);
  let { pid, pgid } = resolveSessionIds(status);

  if (status?.token && !isSessionAlive(pid, pgid)) {
    const runtime = await resolveSessionRuntimeFromToken(status.token);
    if (runtime?.pid) {
      pid = runtime.pid;
      pgid = runtime.pgid || pgid;
    }
  }

  if (!pid && !pgid) {
    cleanupSessionArtifacts({ sessionsDir, sessionName, status });
    return { ok: true, name: sessionName, pid: null, removed: true };
  }

  // Only verify token when the leader pid is still present; otherwise we cannot trust the cmdline check.
  if (status?.token && pid && isPidAlive(pid)) {
    const verified = await verifyPidToken(pid, status.token);
    if (!verified) {
      throw new Error(`refusing to kill pid ${pid}: token mismatch (session=${sessionName})`);
    }
  }

  const initialSignal = typeof signal === 'string' && signal.trim() ? signal.trim() : 'SIGTERM';
  const killTreeOnce = async (sig) => {
    if (process.platform === 'win32') {
      if (pid) {
        if (sig === 'SIGKILL') {
          await execAsync(`taskkill /pid ${pid} /T /F`).catch(() => {});
          return;
        }
        tryKillPid(pid, sig);
      }
      return;
    }

    if (pgid) {
      tryKillProcessGroup(pgid, sig);
    }

    if (pid) {
      const killList = await listProcessTreePidsFromPs([pid]);
      killList.forEach((targetPid) => {
        if (targetPid === process.pid) return;
        tryKillPid(targetPid, sig);
      });
    }
  };

  await killTreeOnce(initialSignal);
  let exited = await waitForSessionExit({ pid, pgid });
  if (!exited) {
    await killTreeOnce('SIGKILL');
    exited = await waitForSessionExit({ pid, pgid });
  }
  if (!exited) {
    throw new Error(`failed to stop session ${sessionName} (pid=${pid || 'n/a'})`);
  }

  cleanupSessionArtifacts({ sessionsDir, sessionName, status });
  return { ok: true, name: sessionName, pid: pid || null, removed: true };
}

export async function stopSession({ sessionRoot, name, signal, env } = {}) {
  const sessionName = sanitizeName(name);
  if (!sessionName) {
    throw new Error('session name is required');
  }
  const sessionsDir = resolveSessionsDir(sessionRoot, env);
  ensureDir(sessionsDir);
  const statusPath = path.join(sessionsDir, `${sessionName}.status.json`);
  const status = readJsonSafe(statusPath);
  let { pid, pgid } = resolveSessionIds(status);

  if (status?.token && !isSessionAlive(pid, pgid)) {
    const runtime = await resolveSessionRuntimeFromToken(status.token);
    if (runtime?.pid) {
      pid = runtime.pid;
      pgid = runtime.pgid || pgid;
    }
  }

  if (!pid && !pgid) {
    if (status) {
      const now = new Date().toISOString();
      writeJsonAtomic(statusPath, { ...status, exitedAt: status.exitedAt || now, updatedAt: now, pid: null, pgid: null });
    }
    return { ok: true, name: sessionName, pid: null, stopped: true };
  }

  // Only verify token when the leader pid is still present; otherwise we cannot trust the cmdline check.
  if (status?.token && pid && isPidAlive(pid)) {
    const verified = await verifyPidToken(pid, status.token);
    if (!verified) {
      throw new Error(`refusing to stop pid ${pid}: token mismatch (session=${sessionName})`);
    }
  }

  const initialSignal = typeof signal === 'string' && signal.trim() ? signal.trim() : 'SIGTERM';
  const killTreeOnce = async (sig) => {
    if (process.platform === 'win32') {
      if (pid) {
        if (sig === 'SIGKILL') {
          await execAsync(`taskkill /pid ${pid} /T /F`).catch(() => {});
          return;
        }
        tryKillPid(pid, sig);
      }
      return;
    }

    if (pgid) {
      tryKillProcessGroup(pgid, sig);
    }

    if (pid) {
      const killList = await listProcessTreePidsFromPs([pid]);
      killList.forEach((targetPid) => {
        if (targetPid === process.pid) return;
        tryKillPid(targetPid, sig);
      });
    }
  };

  await killTreeOnce(initialSignal);
  let exited = await waitForSessionExit({ pid, pgid });
  if (!exited) {
    await killTreeOnce('SIGKILL');
    exited = await waitForSessionExit({ pid, pgid });
  }
  if (!exited) {
    throw new Error(`failed to stop session ${sessionName} (pid=${pid || 'n/a'})`);
  }

  if (status) {
    const now = new Date().toISOString();
    writeJsonAtomic(statusPath, {
      ...status,
      exitedAt: status.exitedAt || now,
      signal: initialSignal,
      updatedAt: now,
      pid: null,
      pgid: null,
    });
  }

  return { ok: true, name: sessionName, pid: pid || null, stopped: true };
}

export async function readSessionLog({ sessionRoot, name, lineCount, maxBytes, env } = {}) {
  const sessionName = sanitizeName(name);
  if (!sessionName) {
    throw new Error('session name is required');
  }
  const sessionsDir = resolveSessionsDir(sessionRoot, env);
  ensureDir(sessionsDir);
  const { statusPath, outputPath } = getSessionPaths(sessionsDir, sessionName);
  const status = readJsonSafe(statusPath);
  if (!status) {
    throw new Error(`Session "${sessionName}" is not found.`);
  }
  const size = (() => {
    try {
      return fs.statSync(outputPath).size;
    } catch {
      return null;
    }
  })();
  const mtime = (() => {
    try {
      const stat = fs.statSync(outputPath);
      return stat?.mtime ? stat.mtime.toISOString() : null;
    } catch {
      return null;
    }
  })();
  const bytes = Number.isFinite(Number(maxBytes))
    ? Math.max(1024, Math.min(4 * 1024 * 1024, Math.floor(Number(maxBytes))))
    : 1024 * 1024;
  const lines = Number.isFinite(Number(lineCount))
    ? Math.max(1, Math.min(50_000, Math.floor(Number(lineCount))))
    : 500;
  const content = readLastLinesFromFile(outputPath, lines, bytes);
  return { ok: true, name: sessionName, outputPath, size, mtime, lineCount: lines, maxBytes: bytes, content };
}

export async function restartSession({ sessionRoot, name, env } = {}) {
  const sessionName = sanitizeName(name);
  if (!sessionName) {
    throw new Error('session name is required');
  }
  const sessionsDir = resolveSessionsDir(sessionRoot, env);
  ensureDir(sessionsDir);
  const { statusPath } = getSessionPaths(sessionsDir, sessionName);
  const status = readJsonSafe(statusPath);
  if (!status) {
    throw new Error(`Session "${sessionName}" is not found.`);
  }
  const command = typeof status?.command === 'string' ? status.command.trim() : '';
  if (!command) {
    throw new Error(`Session "${sessionName}" has no command to restart.`);
  }
  const cwd = typeof status?.cwd === 'string' && status.cwd.trim() ? status.cwd.trim() : null;
  const windowName = typeof status?.window === 'string' ? status.window : null;

  await killSession({ sessionRoot, name: sessionName, env });
  return await startSession({ sessionRoot, name: sessionName, command, cwd, windowName, env });
}

export async function killAllSessions({ sessionRoot, signal, env } = {}) {
  const summary = { ok: true, killed: [], errors: [] };
  const list = await listSessions({ sessionRoot, env });
  const sessions = Array.isArray(list.sessions) ? list.sessions : [];
  if (sessions.length === 0) return summary;
  for (const sess of sessions) {
    if (!sess?.name) continue;
    try {
      const result = await killSession({ sessionRoot, name: sess.name, signal, env });
      summary.killed.push(result?.name || sess.name);
    } catch (err) {
      summary.ok = false;
      summary.errors.push(`${sess.name}: ${err?.message || err}`);
    }
  }
  return summary;
}
