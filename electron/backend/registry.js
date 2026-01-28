import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { normalizeHostApp } from '../../packages/common/state-core/utils.js';
import {
  maybeMigrateLegacyDbFiles,
  resolveAppDbFileName,
  resolveAppStateDir,
  resolveCompatStateRootDir,
  resolveStateRootDir,
} from '../../packages/common/state-core/state-paths.js';

const require = createRequire(import.meta.url);

function normalizeDriverName(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

const driverHint = normalizeDriverName(process.env.MODEL_CLI_DB_DRIVER);
const disallowedSqlJs = driverHint === 'sqljs' || driverHint === 'sql.js';
if (disallowedSqlJs) {
  throw new Error('SQL.js driver is no longer supported. Install better-sqlite3 and remove MODEL_CLI_DB_DRIVER=sqljs.');
}

let BETTER_SQLITE3 = undefined;
function getBetterSqlite3() {
  if (BETTER_SQLITE3 !== undefined) return BETTER_SQLITE3;
  try {
    BETTER_SQLITE3 = require('better-sqlite3');
  } catch {
    BETTER_SQLITE3 = null;
  }
  return BETTER_SQLITE3;
}

function parseJsonSafe(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function listAppIds({ knownApps = [], env = process.env } = {}) {
  const out = [];
  const seen = new Set();
  const register = (id) => {
    const normalized = normalizeHostApp(id);
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    out.push(normalized);
  };

  (Array.isArray(knownApps) ? knownApps : []).forEach(register);

  const roots = [resolveStateRootDir({ env }), resolveCompatStateRootDir({ env })]
    .filter((dir) => typeof dir === 'string' && dir.trim())
    .filter((dir, index, arr) => arr.indexOf(dir) === index);
  roots.forEach((baseDir) => {
    try {
      const entries = fs.readdirSync(baseDir, { withFileTypes: true });
      entries.forEach((entry) => {
        if (!entry?.isDirectory?.()) return;
        register(entry.name);
      });
    } catch {
      // ignore
    }
  });

  return out;
}

function resolveDbPath({ sessionRoot, hostApp }) {
  const normalizedHost = normalizeHostApp(hostApp);
  const stateDir = resolveAppStateDir(sessionRoot, { hostApp: normalizedHost });
  if (stateDir && fs.existsSync(stateDir)) {
    try {
      const stat = fs.statSync(stateDir);
      if (stat?.isDirectory?.()) {
        maybeMigrateLegacyDbFiles(stateDir, { hostApp: normalizedHost });
      }
    } catch {
      // ignore migration fs errors
    }
  }
  const desiredDbPath = stateDir ? path.join(stateDir, resolveAppDbFileName(normalizedHost)) : '';
  const legacyDbPath = stateDir ? path.join(stateDir, 'admin.db.sqlite') : '';
  const desiredExists = Boolean(desiredDbPath && fs.existsSync(desiredDbPath));
  const legacyExists = Boolean(legacyDbPath && fs.existsSync(legacyDbPath));
  const dbPath = desiredExists ? desiredDbPath : legacyExists ? legacyDbPath : desiredDbPath;
  return {
    hostApp: normalizedHost,
    stateDir,
    dbPath: dbPath || desiredDbPath,
  };
}

function readDbTable({ Database, dbPath, tableName }) {
  const rawDbPath = typeof dbPath === 'string' ? dbPath.trim() : '';
  if (!rawDbPath) return [];
  if (!fs.existsSync(rawDbPath)) return [];
  const table = typeof tableName === 'string' ? tableName.trim() : '';
  if (!table) return [];

  let db;
  try {
    db = new Database(rawDbPath, { readonly: true, fileMustExist: true });
    const rows = db.prepare('SELECT payload FROM records WHERE table_name = ?').all(table);
    return rows.map((row) => parseJsonSafe(row?.payload)).filter(Boolean);
  } finally {
    try {
      db?.close?.();
    } catch {
      // ignore
    }
  }
}

function readDbRecord({ Database, dbPath, tableName, id }) {
  const rawDbPath = typeof dbPath === 'string' ? dbPath.trim() : '';
  if (!rawDbPath) return null;
  if (!fs.existsSync(rawDbPath)) return null;
  const table = typeof tableName === 'string' ? tableName.trim() : '';
  if (!table) return null;
  const recordId = typeof id === 'string' ? id.trim() : '';
  if (!recordId) return null;

  let db;
  try {
    db = new Database(rawDbPath, { readonly: true, fileMustExist: true });
    const row = db.prepare('SELECT payload FROM records WHERE table_name = ? AND id = ?').get(table, recordId);
    return row?.payload ? parseJsonSafe(row.payload) : null;
  } finally {
    try {
      db?.close?.();
    } catch {
      // ignore
    }
  }
}

function summarizePrompt(prompt) {
  const id = typeof prompt?.id === 'string' ? prompt.id : '';
  const name = typeof prompt?.name === 'string' ? prompt.name : '';
  const title = typeof prompt?.title === 'string' ? prompt.title : '';
  const builtin = Boolean(prompt?.builtin);
  const locked = Boolean(prompt?.locked);
  const updatedAt = typeof prompt?.updatedAt === 'string' ? prompt.updatedAt : '';
  const content = typeof prompt?.content === 'string' ? prompt.content : '';
  const preview = content.length > 240 ? `${content.slice(0, 240)}…` : content;
  return { id, name, title, builtin, locked, updatedAt, preview, length: content.length };
}

export function registerRegistryApi(ipcMain, options = {}) {
  const sessionRoot = typeof options.sessionRoot === 'string' && options.sessionRoot.trim()
    ? options.sessionRoot.trim()
    : process.env.MODEL_CLI_SESSION_ROOT || process.cwd();
  const knownApps = Array.isArray(options.knownApps) ? options.knownApps : ['chatos'];

  ipcMain.handle('registry:apps:list', async () => {
    const appIds = listAppIds({ knownApps });
    const apps = appIds.map((appId) => {
      const { stateDir, dbPath } = resolveDbPath({ sessionRoot, hostApp: appId });
      const dbExists = Boolean(dbPath && fs.existsSync(dbPath));
      return { appId, stateDir, dbPath, dbExists };
    });
    return { ok: true, apps };
  });

  ipcMain.handle('registry:mcpServers:list', async () => {
    try {
      const Database = getBetterSqlite3();
      if (!Database) {
        throw new Error('better-sqlite3 is required but the module is not available.');
      }
      const appIds = listAppIds({ knownApps });
      const apps = appIds.map((appId) => {
        const { stateDir, dbPath } = resolveDbPath({ sessionRoot, hostApp: appId });
        const dbExists = Boolean(dbPath && fs.existsSync(dbPath));
        const mcpServers = dbExists ? readDbTable({ Database, dbPath, tableName: 'mcpServers' }) : [];
        return { appId, stateDir, dbPath, dbExists, mcpServers };
      });
      return { ok: true, apps };
    } catch (err) {
      return { ok: false, message: err?.message || String(err) };
    }
  });

  ipcMain.handle('registry:prompts:list', async () => {
    try {
      const Database = getBetterSqlite3();
      if (!Database) {
        throw new Error('better-sqlite3 is required but the module is not available.');
      }
      const appIds = listAppIds({ knownApps });
      const apps = appIds.map((appId) => {
        const { stateDir, dbPath } = resolveDbPath({ sessionRoot, hostApp: appId });
        const dbExists = Boolean(dbPath && fs.existsSync(dbPath));
        const raw = dbExists ? readDbTable({ Database, dbPath, tableName: 'prompts' }) : [];
        const prompts = (Array.isArray(raw) ? raw : []).map((p) => summarizePrompt(p));
        return { appId, stateDir, dbPath, dbExists, prompts };
      });
      return { ok: true, apps };
    } catch (err) {
      return { ok: false, message: err?.message || String(err) };
    }
  });

  ipcMain.handle('registry:prompts:get', async (_event, payload = {}) => {
    try {
      const appId = normalizeHostApp(payload?.appId);
      const id = typeof payload?.id === 'string' ? payload.id.trim() : '';
      if (!appId) return { ok: false, message: 'appId is required' };
      if (!id) return { ok: false, message: 'id is required' };

      const { stateDir, dbPath } = resolveDbPath({ sessionRoot, hostApp: appId });
      if (!dbPath || !fs.existsSync(dbPath)) {
        return { ok: false, message: `DB not found for app: ${appId}` };
      }

      const Database = getBetterSqlite3();
      if (!Database) {
        throw new Error('better-sqlite3 is required but the module is not available.');
      }
      const record = readDbRecord({ Database, dbPath, tableName: 'prompts', id });
      return { ok: true, appId, stateDir, dbPath, record };
    } catch (err) {
      return { ok: false, message: err?.message || String(err) };
    }
  });
}
