import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';

import { resolveRuntimeLogPath } from '../packages/common/state-core/runtime-log.js';
import { readLastLinesFromFile } from './sessions/utils.js';

export function createActionId(prefix) {
  const base = typeof prefix === 'string' && prefix.trim() ? prefix.trim() : 'action';
  const short = crypto.randomUUID().split('-')[0];
  return `${base}-${Date.now().toString(36)}-${short}`;
}

export function createInstallLog(logger) {
  return (level, message, meta, err) => {
    if (!logger) return;
    const fn = typeof logger[level] === 'function' ? logger[level] : logger.info;
    if (typeof fn !== 'function') return;
    fn(message, meta, err);
  };
}

export function resolveAppIconPath(projectRoot) {
  const root = typeof projectRoot === 'string' ? projectRoot : '';
  const candidates = [
    path.join(root, 'apps', 'ui', 'dist', 'icon.png'),
    path.join(root, 'apps', 'ui', 'icon.png'),
    path.join(root, 'build_resources', 'icon.png'),
  ];
  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) return candidate;
    } catch {
      // ignore
    }
  }
  return null;
}

export function createRuntimeLogReader({ sessionRoot, hostApp, runtimeEnv } = {}) {
  const env = runtimeEnv && typeof runtimeEnv === 'object' ? runtimeEnv : process.env;
  return ({ lineCount, maxBytes } = {}) => {
    const outputPath = resolveRuntimeLogPath({
      sessionRoot,
      hostApp,
      fallbackHostApp: 'chatos',
      preferSessionRoot: true,
      env,
    });
    if (!outputPath) {
      return { ok: false, message: 'runtime log path not available' };
    }
    try {
      fs.mkdirSync(path.dirname(outputPath), { recursive: true });
      if (!fs.existsSync(outputPath)) {
        fs.writeFileSync(outputPath, '', 'utf8');
      }
    } catch {
      // ignore file bootstrap failures
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
    return { ok: true, outputPath, size, mtime, lineCount: lines, maxBytes: bytes, content };
  };
}

export function patchProcessPath(env) {
  // GUI apps on macOS often do not inherit the user's shell PATH (e.g., Homebrew lives in /opt/homebrew/bin).
  // Ensure common binary locations are available for child_process exec/spawn.
  if (process.platform !== 'darwin') return;
  if (!env || typeof env !== 'object') return;

  const current = typeof env.PATH === 'string' ? env.PATH : '';
  const parts = current.split(':').filter(Boolean);
  const prepend = [];

  const addDir = (dirPath) => {
    const normalized = typeof dirPath === 'string' ? dirPath.trim() : '';
    if (!normalized) return;
    if (prepend.includes(normalized)) return;
    if (parts.includes(normalized)) return;
    try {
      if (fs.existsSync(normalized)) {
        prepend.push(normalized);
      }
    } catch {
      // ignore
    }
  };

  const addLatestNvmNodeBin = (homeDir) => {
    if (!homeDir) return;
    const versionsDir = path.join(homeDir, '.nvm', 'versions', 'node');
    let entries = [];
    try {
      entries = fs.readdirSync(versionsDir, { withFileTypes: true });
    } catch {
      return;
    }
    const parseSemver = (dirName) => {
      const match = String(dirName || '')
        .trim()
        .match(/^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?$/);
      if (!match) return null;
      return {
        major: Number(match[1] || 0),
        minor: Number(match[2] || 0),
        patch: Number(match[3] || 0),
        dir: dirName,
      };
    };
    const candidates = entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => parseSemver(entry.name))
      .filter(Boolean)
      .sort((a, b) => {
        if (a.major !== b.major) return b.major - a.major;
        if (a.minor !== b.minor) return b.minor - a.minor;
        return b.patch - a.patch;
      });
    const best = candidates[0];
    if (!best?.dir) return;
    addDir(path.join(versionsDir, best.dir, 'bin'));
  };

  // Homebrew (Apple Silicon / Intel), MacPorts, plus common user bins.
  addDir('/opt/homebrew/bin');
  addDir('/opt/homebrew/sbin');
  addDir('/usr/local/bin');
  addDir('/usr/local/sbin');
  addDir('/opt/local/bin');
  addDir('/opt/local/sbin');

  const home = env.HOME || env.USERPROFILE || os.homedir();
  if (home) {
    // Popular Node/Python toolchains and version managers (for MCP servers using npx/uvx/etc).
    addDir(path.join(home, '.volta', 'bin'));
    addDir(path.join(home, '.asdf', 'shims'));
    addDir(path.join(home, '.nodenv', 'shims'));
    addLatestNvmNodeBin(home);

    // Common language toolchain bins (for LSP installers).
    addDir(path.join(home, '.cargo', 'bin'));
    addDir(path.join(home, '.dotnet', 'tools'));
    addDir(path.join(home, 'go', 'bin'));

    addDir(path.join(home, '.local', 'bin'));
    addDir(path.join(home, 'bin'));
  }

  if (prepend.length === 0) return;
  env.PATH = [...prepend, ...parts].join(':');
}
