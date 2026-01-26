import path from 'path';
import fs from 'fs';
import { createRequire } from 'module';
import { createLogger } from '../../logger.js';
import { resolveAppStateDir, resolveStateDirPath, STATE_DIR_NAMES } from '../../../shared/state-paths.js';
import { normalizeKey } from '../../../shared/text-utils.js';
import { resolveBoolEnv } from '../../../../common/env-utils.js';

const log = createLogger('MCP');
const require = createRequire(import.meta.url);
const uiAppNodeModulesReady = new Set();
let cachedHostNodeModulesDir = null;

function resolveHostNodeModulesDir() {
  if (cachedHostNodeModulesDir !== null) {
    return cachedHostNodeModulesDir;
  }
  try {
    const pkgJsonPath = require.resolve('@modelcontextprotocol/sdk/package.json');
    const pkgDir = path.dirname(pkgJsonPath);
    const nodeModulesDir = path.dirname(path.dirname(pkgDir));
    cachedHostNodeModulesDir = nodeModulesDir;
    return nodeModulesDir;
  } catch {
    cachedHostNodeModulesDir = '';
    return '';
  }
}

function isPathWithin(root, target) {
  if (!root || !target) return false;
  const relative = path.relative(root, target);
  if (!relative) return true;
  return !relative.startsWith('..') && !path.isAbsolute(relative);
}

function normalizeCommandPath(token, baseDir) {
  const raw = typeof token === 'string' ? token.trim() : '';
  if (!raw) return '';
  const unquoted = raw.replace(/^['"]|['"]$/g, '');
  if (!unquoted) return '';
  if (path.isAbsolute(unquoted) || /^[a-zA-Z]:[\\/]/.test(unquoted)) {
    return path.resolve(unquoted);
  }
  const base = typeof baseDir === 'string' && baseDir.trim() ? baseDir.trim() : process.cwd();
  return path.resolve(base, unquoted);
}

export function isUiAppMcpServer(entry, options = {}) {
  const tags = Array.isArray(entry?.tags) ? entry.tags : [];
  const tagged = tags
    .map((tag) => normalizeKey(tag))
    .filter(Boolean)
    .some((tag) => tag === 'uiapp' || tag.startsWith('uiapp:'));
  if (tagged) return true;

  const endpoint = options?.endpoint;
  if (!endpoint || endpoint.type !== 'command') return false;
  const sessionRoot = typeof options?.sessionRoot === 'string' ? options.sessionRoot.trim() : '';
  const stateDir = resolveAppStateDir(sessionRoot || process.cwd());
  if (!stateDir) return false;
  const uiAppsRoot = resolveStateDirPath(stateDir, STATE_DIR_NAMES.uiApps, 'plugins');
  const args = Array.isArray(endpoint.args) ? endpoint.args : [];
  for (const arg of args) {
    const candidate = normalizeCommandPath(arg, options?.baseDir);
    if (candidate && isPathWithin(uiAppsRoot, candidate)) {
      return true;
    }
  }
  return false;
}

export function ensureUiAppNodeModules(sessionRoot, runtimeLogger) {
  const allowShared = resolveBoolEnv(process.env.MODEL_CLI_UIAPPS_SHARE_NODE_MODULES, false);
  if (!allowShared) return;
  const root = typeof sessionRoot === 'string' && sessionRoot.trim() ? sessionRoot.trim() : process.cwd();
  const stateDir = resolveAppStateDir(root);
  if (!stateDir || uiAppNodeModulesReady.has(stateDir)) return;
  uiAppNodeModulesReady.add(stateDir);

  const hostNodeModules = resolveHostNodeModulesDir();
  if (!hostNodeModules) return;

  const target = resolveStateDirPath(stateDir, 'node_modules');
  try {
    if (fs.existsSync(target)) return;
  } catch {
    return;
  }

  try {
    fs.mkdirSync(path.dirname(target), { recursive: true });
  } catch {
    // ignore
  }
  try {
    const linkType = process.platform === 'win32' ? 'junction' : 'dir';
    fs.symlinkSync(hostNodeModules, target, linkType);
  } catch (err) {
    log.warn('UI Apps MCP node_modules 连接失败', err);
    runtimeLogger?.warn('UI Apps MCP node_modules 连接失败', { target, source: hostNodeModules }, err);
  }
}
