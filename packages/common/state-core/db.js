import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { normalizeKey } from '../text-utils.js';

const DEFAULT_SQLITE_BUSY_TIMEOUT_MS = 5_000;

function ensureDirForFile(filePath) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}


function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeTableSeed(seed = {}) {
  const out = {};
  Object.entries(seed || {}).forEach(([key, value]) => {
    if (!key) return;
    if (Array.isArray(value)) out[key] = value;
  });
  return out;
}

function parsePayload(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function getLegacyJsonPath(dbPath) {
  if (typeof dbPath !== 'string') return null;
  if (dbPath.endsWith('.sqlite')) {
    const candidate = dbPath.replace(/\.sqlite$/, '.json');
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function loadLegacyJson(jsonPath) {
  try {
    return JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  } catch {
    return null;
  }
}

function selectManySqlite(db, sql, params = []) {
  return db.prepare(sql).all(params);
}

function selectOneSqlite(db, sql, params = []) {
  return db.prepare(sql).get(params) || null;
}

function execWithChangesSqlite(db, sql, params = []) {
  const result = db.prepare(sql).run(params);
  return result?.changes || 0;
}

function countRecordsSqlite(db) {
  const row = db.prepare('SELECT COUNT(*) as c FROM records').get();
  return Number(row?.c) || 0;
}

function bootstrapSeedSqlite(db, seed) {
  if (countRecordsSqlite(db) > 0) return false;
  const tables = Object.keys(seed || {});
  if (tables.length === 0) return false;
  const insertSeed = db.prepare(
    'INSERT INTO records (table_name, id, payload, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
  );
  const now = new Date().toISOString();
  const runSeed = db.transaction(() => {
    tables.forEach((table) => {
      const list = Array.isArray(seed[table]) ? seed[table] : [];
      list.forEach((item) => {
        const payload = { ...(item && typeof item === 'object' ? item : {}) };
        payload.id = payload.id || crypto.randomUUID();
        payload.createdAt = payload.createdAt || now;
        payload.updatedAt = payload.updatedAt || now;
        insertSeed.run([table, payload.id, JSON.stringify(payload), payload.createdAt, payload.updatedAt]);
      });
    });
  });
  runSeed();
  return true;
}

function maybeMigrateFromJsonSqlite(db, dbPath, options = {}) {
  const legacyPath = typeof options.legacyJsonPath === 'string' ? options.legacyJsonPath.trim() : '';
  const candidate = legacyPath || getLegacyJsonPath(dbPath);
  if (!candidate) return false;
  if (countRecordsSqlite(db) > 0) return false;

  const state = loadLegacyJson(candidate);
  if (!state || typeof state !== 'object') return false;

  const insert = db.prepare(
    'INSERT INTO records (table_name, id, payload, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
  );
  const now = new Date().toISOString();
  const runMigration = db.transaction(() => {
    Object.entries(state).forEach(([table, list]) => {
      if (!table || !Array.isArray(list)) return;
      list.forEach((item) => {
        const payload = { ...(item && typeof item === 'object' ? item : {}) };
        payload.id = payload.id || crypto.randomUUID();
        payload.createdAt = payload.createdAt || now;
        payload.updatedAt = payload.updatedAt || now;
        insert.run([table, payload.id, JSON.stringify(payload), payload.createdAt, payload.updatedAt]);
      });
    });
  });
  runMigration();
  return true;
}

function openSqliteDb(Database, dbPath, sqlite = {}) {
  ensureDirForFile(dbPath);
  const options = {};
  if (sqlite.readonly === true) options.readonly = true;
  if (sqlite.fileMustExist === true) options.fileMustExist = true;
  const db = new Database(dbPath, options);

  const busyTimeoutMs = Number.isFinite(sqlite.busyTimeoutMs) ? sqlite.busyTimeoutMs : DEFAULT_SQLITE_BUSY_TIMEOUT_MS;
  if (busyTimeoutMs > 0) {
    try {
      db.pragma(`busy_timeout = ${Math.floor(busyTimeoutMs)}`);
    } catch {
      // ignore pragma failures
    }
  }

  const journalMode = typeof sqlite.journalMode === 'string' ? sqlite.journalMode.trim() : '';
  if (journalMode) {
    try {
      db.pragma(`journal_mode = ${journalMode}`);
    } catch {
      // ignore pragma failures
    }
  } else {
    try {
      db.pragma('journal_mode = WAL');
    } catch {
      // ignore pragma failures
    }
  }

  db.exec(
    `CREATE TABLE IF NOT EXISTS records (
      table_name TEXT NOT NULL,
      id TEXT NOT NULL,
      payload TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (table_name, id)
    )`
  );

  return db;
}

function createBetterSqliteDb({
  Database,
  dbPath,
  seed = {},
  migrateFromJson = true,
  legacyJsonPath = '',
  sqlite = {},
} = {}) {
  if (typeof Database !== 'function') {
    throw new Error(
      'better-sqlite3 module is required: pass { driver: { type: "better-sqlite3", Database } }'
    );
  }
  const resolvedDbPath = typeof dbPath === 'string' ? dbPath.trim() : '';
  if (!resolvedDbPath) {
    throw new Error('dbPath is required');
  }

  const normalizedSeed = normalizeTableSeed(seed);
  const now = () => new Date().toISOString();
  const genId = () => crypto.randomUUID();

  const withDb = (fn) => {
    const db = openSqliteDb(Database, resolvedDbPath, sqlite);
    try {
      if (migrateFromJson) {
        maybeMigrateFromJsonSqlite(db, resolvedDbPath, { legacyJsonPath });
      }
      bootstrapSeedSqlite(db, normalizedSeed);
      return fn(db);
    } finally {
      try {
        db.close();
      } catch {
        // ignore
      }
    }
  };

  return {
    path: resolvedDbPath,
    snapshot() {
      return withDb((db) => {
        const tables = selectManySqlite(db, 'SELECT DISTINCT table_name as name FROM records')
          .map((row) => row.name)
          .filter(Boolean);
        const state = {};
        tables.forEach((table) => {
          const rows = selectManySqlite(db, 'SELECT id, payload FROM records WHERE table_name = ?', [table]);
          state[table] = rows.map((row) => parsePayload(row.payload)).filter(Boolean);
        });
        return state;
      });
    },
    list(table) {
      return withDb((db) => {
        const rows = selectManySqlite(db, 'SELECT id, payload FROM records WHERE table_name = ?', [table]);
        return rows.map((row) => parsePayload(row.payload)).filter(Boolean);
      });
    },
    get(table, id) {
      return withDb((db) => {
        const row = selectOneSqlite(db, 'SELECT id, payload FROM records WHERE table_name = ? AND id = ?', [
          table,
          id,
        ]);
        return row ? parsePayload(row.payload) : null;
      });
    },
    insert(table, record) {
      return withDb((db) => {
        const payload = record && typeof record === 'object' ? { ...record } : {};
        payload.id = payload.id || genId();
        const ts = now();
        payload.createdAt = payload.createdAt || ts;
        payload.updatedAt = ts;
        execWithChangesSqlite(
          db,
          'INSERT INTO records (table_name, id, payload, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
          [table, payload.id, JSON.stringify(payload), payload.createdAt, payload.updatedAt]
        );
        return clone(payload);
      });
    },
    insertMany(table, records) {
      return withDb((db) => {
        const list = Array.isArray(records) ? records : [];
        if (list.length === 0) return [];
        const insert = db.prepare(
          'INSERT INTO records (table_name, id, payload, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
        );
        const runBatch = db.transaction((items) => {
          const out = [];
          items.forEach((record) => {
            const payload = record && typeof record === 'object' ? { ...record } : {};
            payload.id = payload.id || genId();
            const ts = now();
            payload.createdAt = payload.createdAt || ts;
            payload.updatedAt = ts;
            insert.run([table, payload.id, JSON.stringify(payload), payload.createdAt, payload.updatedAt]);
            out.push(clone(payload));
          });
          return out;
        });
        return runBatch(list);
      });
    },
    update(table, id, patch) {
      return withDb((db) => {
        const existingRow = selectOneSqlite(db, 'SELECT payload FROM records WHERE table_name = ? AND id = ?', [
          table,
          id,
        ]);
        const existing = existingRow ? parsePayload(existingRow.payload) : null;
        if (!existing) return null;
        const merged = {
          ...existing,
          ...(patch && typeof patch === 'object' ? patch : {}),
          id,
          updatedAt: now(),
        };
        execWithChangesSqlite(db, 'UPDATE records SET payload = ?, updated_at = ? WHERE table_name = ? AND id = ?', [
          JSON.stringify(merged),
          merged.updatedAt,
          table,
          id,
        ]);
        return clone(merged);
      });
    },
    remove(table, id) {
      return withDb((db) => {
        const changes = execWithChangesSqlite(db, 'DELETE FROM records WHERE table_name = ? AND id = ?', [table, id]);
        return changes > 0;
      });
    },
    reset(table, records) {
      return withDb((db) => {
        const runReset = db.transaction((list) => {
          execWithChangesSqlite(db, 'DELETE FROM records WHERE table_name = ?', [table]);
          const insert = db.prepare(
            'INSERT INTO records (table_name, id, payload, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
          );
          (Array.isArray(list) ? list : []).forEach((item) => {
            const payload = item && typeof item === 'object' ? { ...item } : {};
            if (!payload.id) payload.id = genId();
            const ts = payload.updatedAt || payload.createdAt || now();
            payload.createdAt = payload.createdAt || ts;
            payload.updatedAt = payload.updatedAt || ts;
            insert.run([table, payload.id, JSON.stringify(payload), payload.createdAt, payload.updatedAt]);
          });
          const rows = selectManySqlite(db, 'SELECT id, payload FROM records WHERE table_name = ?', [table]);
          return rows.map((row) => parsePayload(row.payload)).filter(Boolean);
        });
        return runReset(records);
      });
    },
  };
}

export function createDb({
  driver,
  dbPath,
  seed = {},
  migrateFromJson = true,
  legacyJsonPath = '',
  sqlite = {},
} = {}) {
  const resolvedDriver = driver || null;
  if (!resolvedDriver || !resolvedDriver.type) {
    throw new Error('DB driver is required: pass { driver: { type: "better-sqlite3", Database } }');
  }
  const driverType = normalizeKey(resolvedDriver.type);
  if (driverType === 'better-sqlite3' || driverType === 'better-sqlite') {
    const mergedSqlite = { ...(resolvedDriver.sqlite || {}), ...(sqlite || {}) };
    return createBetterSqliteDb({
      Database: resolvedDriver.Database,
      dbPath,
      seed,
      migrateFromJson,
      legacyJsonPath,
      sqlite: mergedSqlite,
    });
  }
  throw new Error(`Unsupported DB driver: ${resolvedDriver.type}`);
}
