import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { BaseService } from './base-service.js';
import { secretSchema } from '../schema.js';
import { normalizeKey } from '../../text-utils.js';

const SECRET_KEY_ENV = 'MODEL_CLI_SECRET_KEY';
const SECRET_ENCRYPT_DISABLE_ENV = 'MODEL_CLI_SECRET_ENCRYPT';
const SECRET_KEY_FILENAME = '.secrets.key';
const ENCRYPTED_PREFIX = 'enc:v1:';

function isEncryptionDisabled() {
  const raw = typeof process.env[SECRET_ENCRYPT_DISABLE_ENV] === 'string'
    ? process.env[SECRET_ENCRYPT_DISABLE_ENV].trim().toLowerCase()
    : '';
  return raw === '0' || raw === 'false' || raw === 'off';
}

function deriveKeyFromString(raw) {
  return crypto.createHash('sha256').update(String(raw)).digest();
}

function resolveKeyPath(dbPath) {
  const db = typeof dbPath === 'string' ? dbPath.trim() : '';
  if (!db) return '';
  return path.join(path.dirname(db), SECRET_KEY_FILENAME);
}

function loadKeyFromFile(keyPath) {
  try {
    const raw = fs.readFileSync(keyPath, 'utf8').trim();
    if (!raw) return null;
    const key = Buffer.from(raw, 'base64');
    if (key.length !== 32) return null;
    return key;
  } catch {
    return null;
  }
}

function saveKeyFile(keyPath, key) {
  try {
    fs.mkdirSync(path.dirname(keyPath), { recursive: true });
  } catch {
    // ignore
  }
  try {
    fs.writeFileSync(keyPath, key.toString('base64'), { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    return true;
  } catch {
    return false;
  }
}

function resolveSecretKey(dbPath) {
  if (isEncryptionDisabled()) return null;
  const envRaw = typeof process.env[SECRET_KEY_ENV] === 'string' ? process.env[SECRET_KEY_ENV].trim() : '';
  if (envRaw) return deriveKeyFromString(envRaw);
  const keyPath = resolveKeyPath(dbPath);
  if (!keyPath) return null;
  const existing = loadKeyFromFile(keyPath);
  if (existing) return existing;
  const generated = crypto.randomBytes(32);
  if (saveKeyFile(keyPath, generated)) return generated;
  return loadKeyFromFile(keyPath);
}

function isEncryptedValue(value) {
  return typeof value === 'string' && value.startsWith(ENCRYPTED_PREFIX);
}

function encryptSecretValue(value, key) {
  const raw = typeof value === 'string' ? value : String(value ?? '');
  if (!raw || !key) return { value: raw, encrypted: false };
  if (isEncryptedValue(raw)) return { value: raw, encrypted: true };
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(raw, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    value: `${ENCRYPTED_PREFIX}${iv.toString('base64')}:${tag.toString('base64')}:${encrypted.toString('base64')}`,
    encrypted: true,
  };
}

function decryptSecretValue(value, key) {
  const raw = typeof value === 'string' ? value : String(value ?? '');
  if (!isEncryptedValue(raw)) return { value: raw, encrypted: false };
  if (!key) return { value: '', encrypted: true, ok: false };
  const payload = raw.slice(ENCRYPTED_PREFIX.length);
  const parts = payload.split(':');
  if (parts.length !== 3) return { value: '', encrypted: true, ok: false };
  try {
    const iv = Buffer.from(parts[0], 'base64');
    const tag = Buffer.from(parts[1], 'base64');
    const data = Buffer.from(parts[2], 'base64');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);
    return { value: decrypted.toString('utf8'), encrypted: true, ok: true };
  } catch {
    return { value: '', encrypted: true, ok: false };
  }
}

export class SecretService extends BaseService {
  constructor(db) {
    super(db, 'secrets', secretSchema);
    this.secretKey = resolveSecretKey(db?.path);
  }

  create(payload) {
    const parsed = this.parseInput(payload);
    this.#ensureUniqueName(null, parsed.name);
    const encrypted = encryptSecretValue(parsed.value, this.secretKey);
    return this.db.insert(this.tableName, { ...parsed, value: encrypted.value });
  }

  update(id, payload) {
    const parsed = this.parsePartial(payload);
    if (parsed?.name) {
      this.#ensureUniqueName(id, parsed.name);
    }
    if (Object.prototype.hasOwnProperty.call(parsed, 'value')) {
      const encrypted = encryptSecretValue(parsed.value, this.secretKey);
      parsed.value = encrypted.value;
    }
    return this.db.update(this.tableName, id, parsed);
  }

  list() {
    const items = this.db.list(this.tableName) || [];
    return items.map((item) => this.#decryptRecord(item, { migrate: true }));
  }

  get(id) {
    const item = this.db.get(this.tableName, id);
    return this.#decryptRecord(item);
  }

  getByName(name) {
    const normalized = this.#normalizeName(name);
    if (!normalized) return null;
    const items = this.list() || [];
    return items.find((item) => this.#normalizeName(item?.name) === normalized) || null;
  }

  #normalizeName(value) {
    return normalizeKey(value);
  }

  #ensureUniqueName(currentId, name) {
    const normalized = this.#normalizeName(name);
    if (!normalized) return;
    const items = this.list() || [];
    const conflict = items.find(
      (item) => item?.id !== currentId && this.#normalizeName(item?.name) === normalized
    );
    if (conflict) {
      throw new Error(`secrets.name already exists: ${name}`);
    }
  }

  #decryptRecord(record, { migrate = false } = {}) {
    if (!record || typeof record !== 'object') return record;
    const decrypted = decryptSecretValue(record.value, this.secretKey);
    if (migrate && this.secretKey && !decrypted.encrypted) {
      const encrypted = encryptSecretValue(decrypted.value, this.secretKey);
      if (encrypted.encrypted && record?.id) {
        try {
          this.db.update(this.tableName, record.id, { value: encrypted.value });
        } catch {
          // ignore migration errors
        }
      }
    }
    return { ...record, value: decrypted.value };
  }
}

