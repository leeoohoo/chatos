import fs from 'fs';
import path from 'path';
import { ensureDir } from './fs-utils.js';

const DEFAULT_MAX_ENTRIES = 5000;
const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const DEFAULT_MAX_IDS = 20;

function safeTrim(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function parseTimestamp(value) {
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : 0;
}

function normalizeIds(ids, maxIds) {
  const limit = Number.isFinite(Number(maxIds)) ? Math.max(1, Math.floor(Number(maxIds))) : DEFAULT_MAX_IDS;
  const seen = new Set();
  const out = [];
  (Array.isArray(ids) ? ids : []).forEach((id) => {
    const normalized = safeTrim(id);
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    out.push(normalized);
  });
  return out.slice(0, limit);
}

function pruneEntries(store) {
  if (!store) return;
  const ttlMs = Number.isFinite(Number(store.ttlMs)) ? Number(store.ttlMs) : 0;
  const maxEntries = Number.isFinite(Number(store.maxEntries)) ? Math.floor(Number(store.maxEntries)) : 0;
  const now = Date.now();
  if (ttlMs > 0) {
    for (const [key, entry] of store.entries.entries()) {
      const ts = parseTimestamp(entry?.ts);
      if (ts && now - ts > ttlMs) {
        store.entries.delete(key);
        store.dirty = true;
      }
    }
  }
  if (maxEntries > 0 && store.entries.size > maxEntries) {
    const sorted = Array.from(store.entries.entries()).sort((a, b) => {
      const aTs = parseTimestamp(a[1]?.ts);
      const bTs = parseTimestamp(b[1]?.ts);
      return aTs - bTs;
    });
    const removeCount = sorted.length - maxEntries;
    for (let i = 0; i < removeCount; i += 1) {
      store.entries.delete(sorted[i][0]);
    }
    if (removeCount > 0) {
      store.dirty = true;
    }
  }
}

function atomicWriteJson(filePath, payload) {
  ensureDir(path.dirname(filePath));
  const dir = path.dirname(filePath);
  const base = path.basename(filePath);
  const tmp = path.join(dir, `.${base}.${process.pid}.${Date.now().toString(36)}.tmp`);
  const content = `${JSON.stringify(payload, null, 2)}\n`;
  fs.writeFileSync(tmp, content, 'utf8');
  try {
    fs.renameSync(tmp, filePath);
  } catch (err) {
    try {
      fs.unlinkSync(filePath);
      fs.renameSync(tmp, filePath);
    } catch {
      try {
        fs.unlinkSync(tmp);
      } catch {
        // ignore
      }
      throw err;
    }
  }
}

export function createDedupeStore({
  filePath,
  maxEntries = DEFAULT_MAX_ENTRIES,
  ttlMs = DEFAULT_TTL_MS,
  maxIdsPerKey = DEFAULT_MAX_IDS,
} = {}) {
  const target = safeTrim(filePath);
  const store = {
    filePath: target,
    maxEntries,
    ttlMs,
    maxIdsPerKey,
    entries: new Map(),
    dirty: false,
  };
  if (!target) {
    return store;
  }
  try {
    if (fs.existsSync(target)) {
      const raw = fs.readFileSync(target, 'utf8');
      const parsed = JSON.parse(raw);
      const entries = parsed?.entries && typeof parsed.entries === 'object' ? parsed.entries : {};
      Object.entries(entries).forEach(([key, value]) => {
        const normalizedKey = safeTrim(key);
        if (!normalizedKey) return;
        const ids = normalizeIds(value?.ids, maxIdsPerKey);
        if (ids.length === 0) return;
        store.entries.set(normalizedKey, {
          ids,
          ts: typeof value?.ts === 'string' ? value.ts : '',
        });
      });
    }
  } catch {
    // ignore load errors
  }
  pruneEntries(store);
  return store;
}

export function readDedupeEntry(store, key) {
  if (!store || !store.entries) return null;
  const normalized = safeTrim(key);
  if (!normalized) return null;
  const entry = store.entries.get(normalized);
  if (!entry) return null;
  const ttlMs = Number.isFinite(Number(store.ttlMs)) ? Number(store.ttlMs) : 0;
  if (ttlMs > 0) {
    const ts = parseTimestamp(entry?.ts);
    if (ts && Date.now() - ts > ttlMs) {
      store.entries.delete(normalized);
      store.dirty = true;
      return null;
    }
  }
  return entry;
}

export function writeDedupeEntry(store, key, ids) {
  if (!store || !store.entries) return;
  const normalized = safeTrim(key);
  if (!normalized) return;
  const normalizedIds = normalizeIds(ids, store.maxIdsPerKey);
  if (normalizedIds.length === 0) return;
  store.entries.set(normalized, {
    ids: normalizedIds,
    ts: new Date().toISOString(),
  });
  store.dirty = true;
  pruneEntries(store);
}

export function removeDedupeEntry(store, key) {
  if (!store || !store.entries) return;
  const normalized = safeTrim(key);
  if (!normalized) return;
  if (store.entries.delete(normalized)) {
    store.dirty = true;
  }
}

export function flushDedupeStore(store) {
  if (!store || !store.filePath || !store.dirty) return;
  const entries = {};
  for (const [key, value] of store.entries.entries()) {
    entries[key] = {
      ids: normalizeIds(value?.ids, store.maxIdsPerKey),
      ts: typeof value?.ts === 'string' ? value.ts : '',
    };
  }
  const payload = {
    version: 1,
    updatedAt: new Date().toISOString(),
    entries,
  };
  try {
    atomicWriteJson(store.filePath, payload);
    store.dirty = false;
  } catch {
    // ignore flush errors
  }
}
