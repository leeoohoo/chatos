import crypto from 'crypto';
import fs from 'fs';
import { spawn } from 'child_process';

import {
  ensureDir,
  escapeShellValue,
  getSessionPaths,
  readJsonSafe,
  resolveBaseSessionRoot,
  resolveSessionsDir,
  sanitizeName,
  safeUnlink,
  writeJsonAtomic,
} from './utils.js';

export function resolveDefaultSessionShell(env) {
  const sourceEnv = env && typeof env === 'object' ? env : process.env;
  if (process.platform === 'win32') {
    return sourceEnv.COMSPEC || sourceEnv.ComSpec || 'cmd.exe';
  }
  const shell = typeof sourceEnv.SHELL === 'string' && sourceEnv.SHELL.trim() ? sourceEnv.SHELL.trim() : '';
  return shell || '/bin/bash';
}

function buildLaunchCommand({ token, command } = {}) {
  const tok = typeof token === 'string' ? token.trim() : '';
  const cmd = typeof command === 'string' ? command.trim() : '';
  if (!cmd) return '';
  if (process.platform === 'win32') {
    return tok ? `set "MODEL_CLI_SESSION_TOKEN=${tok}" && ${cmd}` : cmd;
  }
  if (!tok) return cmd;
  return `export MODEL_CLI_SESSION_TOKEN=${escapeShellValue(tok)}\n${cmd}\ncmd_status=$?\nwait\nwait_status=$?\nif [ $cmd_status -ne 0 ]; then exit $cmd_status; else exit $wait_status; fi`;
}

export async function startSession({ sessionRoot, name, command, cwd, windowName, env } = {}) {
  const sessionName = sanitizeName(name);
  if (!sessionName) {
    throw new Error('session name is required');
  }
  const cmd = typeof command === 'string' ? command.trim() : '';
  if (!cmd) {
    throw new Error(`session "${sessionName}" has no command`);
  }
  const spawnEnv = env && typeof env === 'object' ? env : process.env;

  const sessionsDir = resolveSessionsDir(sessionRoot, spawnEnv);
  ensureDir(sessionsDir);
  const paths = getSessionPaths(sessionsDir, sessionName);

  safeUnlink(`${paths.statusPath}.tmp`);
  safeUnlink(`${paths.outputPath}.tmp`);
  safeUnlink(`${paths.controlPath}.tmp`);
  try {
    fs.writeFileSync(paths.outputPath, '', 'utf8');
  } catch {
    // ignore
  }
  try {
    fs.writeFileSync(paths.controlPath, '', 'utf8');
  } catch {
    // ignore
  }

  const token = crypto.randomUUID();
  const launchCommand = buildLaunchCommand({ token, command: cmd });
  const fallbackCwd = resolveBaseSessionRoot(sessionRoot, spawnEnv);
  const workingDir = typeof cwd === 'string' && cwd.trim() ? cwd.trim() : fallbackCwd;
  const shell = resolveDefaultSessionShell(spawnEnv);
  const startedAt = new Date().toISOString();

  let outFd = null;
  try {
    outFd = fs.openSync(paths.outputPath, 'a');
  } catch (err) {
    throw new Error(`Failed to open output file for session "${sessionName}": ${err?.message || String(err)}`);
  }

  let child;
  try {
    child = spawn(launchCommand, {
      cwd: workingDir,
      env: spawnEnv,
      shell,
      windowsHide: true,
      stdio: ['pipe', outFd, outFd],
      detached: process.platform !== 'win32',
    });
  } catch (err) {
    throw new Error(`Failed to start session "${sessionName}": ${err?.message || String(err)}`);
  } finally {
    try {
      fs.closeSync(outFd);
    } catch {
      // ignore
    }
  }

  try {
    child.unref();
  } catch {
    // ignore
  }

  const statusPayload = {
    name: sessionName,
    pid: child?.pid || null,
    // pgid will be resolved on demand; best-effort when detached
    pgid: process.platform === 'win32' ? null : child?.pid || null,
    token,
    command: cmd,
    cwd: workingDir,
    window: typeof windowName === 'string' && windowName.trim() ? windowName.trim() : null,
    startedAt,
    exitedAt: null,
    exitCode: null,
    signal: null,
    platform: process.platform,
    outputPath: paths.outputPath,
    controlPath: paths.controlPath,
    statusPath: paths.statusPath,
    updatedAt: startedAt,
  };
  writeJsonAtomic(paths.statusPath, statusPayload);

  child.on('exit', (code, signal) => {
    try {
      const existing = readJsonSafe(paths.statusPath);
      if (!existing) return;
      writeJsonAtomic(paths.statusPath, {
        ...existing,
        exitedAt: existing.exitedAt || new Date().toISOString(),
        exitCode: typeof code === 'number' ? code : null,
        signal: signal || null,
        updatedAt: new Date().toISOString(),
      });
    } catch {
      // ignore
    }
  });

  child.on('error', (err) => {
    try {
      fs.appendFileSync(paths.outputPath, `\n[session error] ${err?.message || String(err)}\n`, 'utf8');
    } catch {
      // ignore
    }
  });

  return { ok: true, name: sessionName, pid: child?.pid || null };
}
