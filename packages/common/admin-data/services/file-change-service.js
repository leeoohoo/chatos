import { BaseService } from './base-service.js';
import { fileChangeSchema } from '../schema.js';

export class FileChangeService extends BaseService {
  constructor(db) {
    super(db, 'fileChanges', fileChangeSchema);
  }

  append(entry) {
    const payload = this.#withTimestamp(entry);
    return this.create(payload);
  }

  appendMany(entries = []) {
    const list = Array.isArray(entries) ? entries : [];
    const normalized = list.map((item) => this.#withTimestamp(item));
    if (typeof this.db.insertMany === 'function') {
      const parsed = normalized.map((item) => this.schema.parse(item));
      return this.db.insertMany(this.tableName, parsed);
    }
    return normalized.map((item) => this.create(item));
  }

  #withTimestamp(entry) {
    const payload = entry && typeof entry === 'object' ? { ...entry } : {};
    if (!payload.ts) {
      payload.ts = new Date().toISOString();
    }
    return payload;
  }
}
