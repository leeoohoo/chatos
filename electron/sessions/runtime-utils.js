import { exec } from 'child_process';
import { promisify } from 'util';

import { isPidAlive, isProcessGroupAlive } from './process-utils.js';

const execAsync = promisify(exec);
const DEFAULT_STOP_TIMEOUT_MS = 4000;
const DEFAULT_POLL_INTERVAL_MS = 200;
const PS_MAX_BUFFER = 8 * 1024 * 1024;

async function execText(command, options = {}) {
  try {
    const result = await execAsync(command, { maxBuffer: PS_MAX_BUFFER, ...options });
    return String(result?.stdout || '');
  } catch {
    return '';
  }
}

export async function getProcessCommandLine(pid) {
  const num = Number(pid);
  if (!Number.isFinite(num) || num <= 0) return '';
  if (process.platform === 'win32') {
    // Best-effort only; fall back to allowing kill/list if unavailable.
    const cmd = `powershell -NoProfile -Command "(Get-CimInstance Win32_Process -Filter 'ProcessId=${num}').CommandLine"`;
    try {
      const stdout = await execText(cmd);
      return String(stdout || '').trim();
    } catch {
      return '';
    }
  }
  const stdout = await execText(`ps -o command= -ww -p ${num}`);
  return String(stdout || '').trim();
}

async function getProcessCommandLineWithEnv(pid) {
  const num = Number(pid);
  if (!Number.isFinite(num) || num <= 0) return '';
  if (process.platform === 'win32') {
    return await getProcessCommandLine(num);
  }

  const commands = [
    `ps eww -p ${num} -o command=`,
    `ps eww -o command= -p ${num}`,
    `ps eww -p ${num}`,
  ];
  for (const cmd of commands) {
    const stdout = await execText(cmd);
    const text = String(stdout || '').trim();
    if (text) return text;
  }
  return '';
}

export async function verifyPidToken(pid, token) {
  const tok = typeof token === 'string' ? token.trim() : '';
  if (!tok) return true;
  const cmdline = await getProcessCommandLine(pid);
  if (!cmdline) return true;
  if (cmdline.includes(tok)) return true;
  const enriched = await getProcessCommandLineWithEnv(pid);
  if (!enriched) return true;
  return enriched.includes(tok);
}

function sleep(ms) {
  const duration = Number.isFinite(ms) ? Math.max(0, Math.floor(ms)) : 0;
  return new Promise((resolve) => setTimeout(resolve, duration));
}

export function tryKillPid(pid, signal) {
  const num = Number(pid);
  if (!Number.isFinite(num) || num <= 0) return false;
  try {
    process.kill(num, signal);
    return true;
  } catch {
    return false;
  }
}

export function tryKillProcessGroup(pgid, signal) {
  const num = Number(pgid);
  if (!Number.isFinite(num) || num <= 0) return false;
  if (process.platform === 'win32') return false;
  try {
    process.kill(-num, signal);
    return true;
  } catch {
    return false;
  }
}

export async function listProcessTreePidsFromPs(rootPids) {
  const roots = (Array.isArray(rootPids) ? rootPids : [])
    .map((pid) => Number(pid))
    .filter((pid) => Number.isFinite(pid) && pid > 0);
  if (roots.length === 0) return [];
  if (process.platform === 'win32') return roots;

  let stdout = '';
  try {
    const result = await execAsync('/bin/ps -ax -o pid=,ppid=');
    stdout = result?.stdout || '';
  } catch {
    try {
      const result = await execAsync('ps -ax -o pid=,ppid=');
      stdout = result?.stdout || '';
    } catch {
      return roots;
    }
  }

  const childrenMap = new Map();
  const lines = String(stdout || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  lines.forEach((line) => {
    const parts = line.split(/\s+/);
    if (parts.length < 2) return;
    const pid = Number(parts[0]);
    const ppid = Number(parts[1]);
    if (!Number.isFinite(pid) || pid <= 0) return;
    if (!Number.isFinite(ppid) || ppid < 0) return;
    if (!childrenMap.has(ppid)) {
      childrenMap.set(ppid, []);
    }
    childrenMap.get(ppid).push(pid);
  });

  const seen = new Set();
  const order = [];
  const queue = roots.slice();
  while (queue.length > 0) {
    const pid = queue.shift();
    if (!Number.isFinite(pid) || pid <= 0) continue;
    if (seen.has(pid)) continue;
    seen.add(pid);
    order.push(pid);
    const kids = childrenMap.get(pid);
    if (Array.isArray(kids) && kids.length > 0) {
      kids.forEach((childPid) => {
        if (!seen.has(childPid)) {
          queue.push(childPid);
        }
      });
    }
  }

  // Kill children first to reduce orphaning.
  return order.reverse();
}

function extractPidsFromPsOutput(stdout, token) {
  const tok = typeof token === 'string' ? token.trim() : '';
  if (!tok) return [];
  const pids = new Set();
  const lines = String(stdout || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  for (const line of lines) {
    if (!line.includes(tok)) continue;
    const match = line.match(/^(\d+)\s+/);
    if (!match) continue;
    const pid = Number(match[1]);
    if (!Number.isFinite(pid) || pid <= 0) continue;
    pids.add(pid);
  }
  return Array.from(pids);
}

async function listPidsMatchingToken(token) {
  const tok = typeof token === 'string' ? token.trim() : '';
  if (!tok) return [];

  if (process.platform === 'win32') {
    const escaped = tok.replace(/'/g, "''");
    const cmd =
      `powershell -NoProfile -Command \"Get-CimInstance Win32_Process ` +
      `| Where-Object { $_.CommandLine -like '*${escaped}*' } ` +
      `| Select-Object -ExpandProperty ProcessId\"`;
    const stdout = await execText(cmd);
    const matches = String(stdout || '')
      .split(/\s+/)
      .map((v) => Number(v))
      .filter((v) => Number.isFinite(v) && v > 0);
    return Array.from(new Set(matches));
  }

  const quickList = ['ps -ax -o pid=,command= -ww', '/bin/ps -ax -o pid=,command= -ww'];
  for (const cmd of quickList) {
    const stdout = await execText(cmd);
    const pids = extractPidsFromPsOutput(stdout, tok);
    if (pids.length > 0) return pids;
  }

  const envList = [
    'ps eww -ax',
    '/bin/ps eww -ax',
    'ps eww -ax -o pid=,command=',
    '/bin/ps eww -ax -o pid=,command=',
  ];
  for (const cmd of envList) {
    const stdout = await execText(cmd);
    const pids = extractPidsFromPsOutput(stdout, tok);
    if (pids.length > 0) return pids;
  }

  return [];
}

async function getProcessGroupId(pid) {
  const num = Number(pid);
  if (!Number.isFinite(num) || num <= 0) return null;
  if (process.platform === 'win32') return null;
  const stdout = await execText(`ps -o pgid= -p ${num}`);
  const parsed = Number(String(stdout || '').trim());
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export async function resolveSessionRuntimeFromToken(token) {
  const pids = await listPidsMatchingToken(token);
  const alive = pids.filter((pid) => pid !== process.pid && isPidAlive(pid));
  if (alive.length === 0) return null;

  if (process.platform === 'win32') {
    return { pid: alive[0], pgid: null, pids: alive };
  }

  const infos = await Promise.all(
    alive.map(async (pid) => ({
      pid,
      pgid: await getProcessGroupId(pid),
    }))
  );

  const groups = new Map();
  for (const info of infos) {
    const key = info.pgid || info.pid;
    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key).push(info.pid);
  }

  const ordered = Array.from(groups.entries()).sort((a, b) => b[1].length - a[1].length);
  const [bestPgid, bestPids] = ordered[0];
  const leaderPid = bestPids.includes(bestPgid) ? bestPgid : Math.min(...bestPids);
  return { pid: leaderPid, pgid: bestPgid, pids: alive };
}

export function resolveSessionIds(status) {
  const pidNum = Number(status?.pid);
  const pid = Number.isFinite(pidNum) && pidNum > 0 ? pidNum : null;

  const pgidNum = Number(status?.pgid);
  const pgid = Number.isFinite(pgidNum) && pgidNum > 0 ? pgidNum : pid;

  return { pid, pgid };
}

export function isSessionAlive(pid, pgid) {
  const leader = Number(pid);
  const group = Number(pgid);
  if (Number.isFinite(leader) && leader > 0 && isPidAlive(leader)) return true;
  if (Number.isFinite(group) && group > 0 && isProcessGroupAlive(group)) return true;
  return false;
}

export async function waitForPidExit(pid, timeoutMs = DEFAULT_STOP_TIMEOUT_MS, pollIntervalMs = DEFAULT_POLL_INTERVAL_MS) {
  const num = Number(pid);
  if (!Number.isFinite(num) || num <= 0) return true;
  const deadline = Date.now() + Math.max(0, Number(timeoutMs) || 0);
  const interval = Math.max(50, Number(pollIntervalMs) || DEFAULT_POLL_INTERVAL_MS);
  while (Date.now() < deadline) {
    if (!isPidAlive(num)) return true;
    await sleep(interval);
  }
  return !isPidAlive(num);
}

export async function waitForSessionExit({ pid, pgid, timeoutMs = DEFAULT_STOP_TIMEOUT_MS, pollIntervalMs = DEFAULT_POLL_INTERVAL_MS } = {}) {
  const leader = Number(pid);
  const group = Number(pgid);
  const deadline = Date.now() + Math.max(0, Number(timeoutMs) || 0);
  const interval = Math.max(50, Number(pollIntervalMs) || DEFAULT_POLL_INTERVAL_MS);
  while (Date.now() < deadline) {
    if (!isSessionAlive(leader, group)) return true;
    await sleep(interval);
  }
  return !isSessionAlive(leader, group);
}

export async function sendSignalToPid(pid, signal) {
  const sig = typeof signal === 'string' && signal.trim() ? signal.trim() : 'SIGTERM';
  const num = Number(pid);
  if (!Number.isFinite(num) || num <= 0) return;

  if (process.platform === 'win32') {
    if (sig === 'SIGKILL') {
      await execAsync(`taskkill /pid ${num} /T /F`).catch(() => {});
      return;
    }
    try {
      process.kill(num, sig);
      return;
    } catch {
      await execAsync(`taskkill /pid ${num} /T /F`).catch(() => {});
      return;
    }
  }

  try {
    process.kill(-num, sig);
    return;
  } catch {
    // ignore
  }
  try {
    process.kill(num, sig);
  } catch {
    // ignore
  }
}
