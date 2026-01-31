import { BaseService } from './base-service.js';
import { shellSessionSchema } from '../schema.js';

export class ShellSessionService extends BaseService {
  constructor(db) {
    super(db, 'shellSessions', shellSessionSchema);
  }

  upsert(payload) {
    const parsed = this.parseInput(payload);
    if (typeof this.db.upsert === 'function') {
      return this.db.upsert(this.tableName, parsed);
    }
    const existing = parsed?.id ? this.get(parsed.id) : null;
    if (existing && parsed?.id) {
      return this.update(parsed.id, parsed);
    }
    return this.create(parsed);
  }
}
