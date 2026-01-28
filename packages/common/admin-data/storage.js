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
const forceBetterSqlite =
  driverHint === 'better-sqlite3' || driverHint === 'better-sqlite' || driverHint === 'sqlite';
const disallowedSqlJs = driverHint === 'sqljs' || driverHint === 'sql.js';
if (disallowedSqlJs) {
  throw new Error('SQL.js driver is no longer supported. Install better-sqlite3 and remove MODEL_CLI_DB_DRIVER=sqljs.');
}

const Database = loadBetterSqlite3();
if (!Database) {
  const suffix = betterSqliteError ? ` (${betterSqliteError?.message || String(betterSqliteError)})` : '';
  throw new Error(`better-sqlite3 is required${suffix}.`);
}
const driver = { type: 'better-sqlite3', Database };
const driverSource = forceBetterSqlite ? 'env' : 'default';

let didLogDriver = false;
function logDbDriverSelection() {
  if (didLogDriver) return;
  didLogDriver = true;
  const suffix = driverSource ? ` (${driverSource})` : '';
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
