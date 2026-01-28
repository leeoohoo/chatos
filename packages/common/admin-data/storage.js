import fs from 'fs';
import os from 'os';
import path from 'path';
import { createRequire } from 'module';
import { createDb as createDbCore } from '../state-core/db.js';
import { resolveSessionRoot } from '../state-core/session-root.js';
import {
  STATE_ROOT_DIRNAME,
  ensureAppStateDir,
  resolveAppDbFileName,
  resolveAppDbJsonFileName,
} from '../state-core/state-paths.js';
import { getHomeDir, resolveHostApp } from '../state-core/utils.js';

const LEGACY_DEFAULT_DB_PATH = path.join(os.homedir(), STATE_ROOT_DIRNAME, 'admin.db.sqlite');

const require = createRequire(import.meta.url);

function normalizeDriverName(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

let betterSqliteError = null;
let betterSqliteFallback = false;

function loadBetterSqlite3() {
  try {
    const Database = require('better-sqlite3');
    try {
      const probe = new Database(':memory:');
      probe.close();
    } catch (err) {
      betterSqliteError = err;
      return null;
    }
    return Database;
  } catch (err) {
    betterSqliteError = err;
    return null;
  }
}

const driverHint = normalizeDriverName(process.env.MODEL_CLI_DB_DRIVER);
const forceSqlJs = driverHint === 'sqljs' || driverHint === 'sql.js';
const forceBetterSqlite =
  driverHint === 'better-sqlite3' || driverHint === 'better-sqlite' || driverHint === 'sqlite';

let driver = null;
let driverSource = '';
if (!forceSqlJs) {
  const Database = loadBetterSqlite3();
  if (Database) {
    driver = { type: 'better-sqlite3', Database };
    driverSource = forceBetterSqlite ? 'env' : 'default';
  } else if (forceBetterSqlite) {
    const suffix = betterSqliteError ? ` (${betterSqliteError?.message || String(betterSqliteError)})` : '';
    throw new Error(`MODEL_CLI_DB_DRIVER requested better-sqlite3 but the module is not available${suffix}.`);
  } else {
    // Fall back to SQL.js when better-sqlite3 is present but incompatible (e.g., ABI mismatch).
    const message = betterSqliteError?.message || '';
    const isModuleMissing = betterSqliteError?.code === 'MODULE_NOT_FOUND';
    const isDlopenFailed = betterSqliteError?.code === 'ERR_DLOPEN_FAILED';
    const isModuleVersionMismatch = /NODE_MODULE_VERSION/i.test(message);
    if (!isModuleMissing && (isDlopenFailed || isModuleVersionMismatch)) {
      betterSqliteFallback = true;
    } else {
      throw new Error(
        'better-sqlite3 is required by default. Install it or set MODEL_CLI_DB_DRIVER=sqljs to use SQL.js.'
      );
    }
  }
}

if (!driver) {
  const initSqlJsPkg = require('sql.js');
  const initSqlJs =
    initSqlJsPkg && typeof initSqlJsPkg === 'object' && 'default' in initSqlJsPkg ? initSqlJsPkg.default : initSqlJsPkg;
  const wasmPath = require.resolve('sql.js/dist/sql-wasm.wasm');
  const wasmBinary = fs.readFileSync(wasmPath);
  const SQL = await initSqlJs({ wasmBinary });
  driver = { type: 'sql.js', SQL };
  driverSource = forceSqlJs ? 'env' : betterSqliteFallback ? 'fallback' : 'env';
}

let didLogDriver = false;
function logDbDriverSelection() {
  if (didLogDriver) return;
  didLogDriver = true;
  const suffix = driverSource ? ` (${driverSource})` : '';
  if (betterSqliteFallback && betterSqliteError) {
    const shortMessage = String(betterSqliteError?.message || betterSqliteError).split('\n')[0];
    console.error(`[db] better-sqlite3 unavailable (${shortMessage}); falling back to sql.js`);
  }
  console.error(`[db] driver=${driver.type}${suffix}`);
}
logDbDriverSelection();

export function getDefaultDbPath(env = process.env) {
  const home = getHomeDir(env) || os.homedir();
  const hostApp = resolveHostApp({ env, fallbackHostApp: 'chatos' }) || 'chatos';
  const sessionRoot = resolveSessionRoot({ env, hostApp, fallbackHostApp: 'chatos' });
  const stateDir = ensureAppStateDir(sessionRoot, { env, hostApp, fallbackHostApp: 'chatos', homeDir: home });

  if (stateDir && hostApp) {
    const desired = path.join(stateDir, resolveAppDbFileName(hostApp));
    const legacy = path.join(stateDir, 'admin.db.sqlite');
    const desiredJson = path.join(stateDir, resolveAppDbJsonFileName(hostApp));
    const legacyJson = path.join(stateDir, 'admin.db.json');

    if (!fs.existsSync(desired) && fs.existsSync(legacy)) {
      try {
        fs.renameSync(legacy, desired);
      } catch {
        try {
          fs.copyFileSync(legacy, desired);
        } catch {
          // ignore
        }
      }
    }

    if (!fs.existsSync(desiredJson) && fs.existsSync(legacyJson)) {
      try {
        fs.renameSync(legacyJson, desiredJson);
      } catch {
        try {
          fs.copyFileSync(legacyJson, desiredJson);
        } catch {
          // ignore
        }
      }
    }

    return desired;
  }
  return LEGACY_DEFAULT_DB_PATH;
}

export function createDb({ driver: overrideDriver, dbPath = getDefaultDbPath(), seed = {}, ...rest } = {}) {
  return createDbCore({ driver: overrideDriver || driver, dbPath, seed, ...rest });
}
