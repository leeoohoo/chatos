export const TASK_TABLES = {
  legacy: 'tasks',
  cli: 'tasks_cli',
  chat: 'tasks_chat',
};

const KNOWN_TABLES = new Set(Object.values(TASK_TABLES));

export function normalizeTaskTableName(value) {
  const raw = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!raw) return '';
  return KNOWN_TABLES.has(raw) ? raw : '';
}

export function normalizeTaskScope(value) {
  const raw = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!raw) return '';
  if (raw === 'cli' || raw === 'terminal') return 'cli';
  if (raw === 'chat' || raw === 'ui') return 'chat';
  if (raw === 'legacy' || raw === 'default') return 'legacy';
  return '';
}

export function resolveTaskTableName(options = {}) {
  const explicit = normalizeTaskTableName(options?.tableName);
  if (explicit) return explicit;
  const scope = normalizeTaskScope(options?.scope);
  if (scope === 'cli') return TASK_TABLES.cli;
  if (scope === 'chat') return TASK_TABLES.chat;
  if (scope === 'legacy') return TASK_TABLES.legacy;

  const env = options?.env && typeof options.env === 'object' ? options.env : process?.env;
  const envTable = normalizeTaskTableName(env?.MODEL_CLI_TASK_TABLE);
  if (envTable) return envTable;
  const envScope = normalizeTaskScope(env?.MODEL_CLI_TASK_SCOPE || env?.MODEL_CLI_CALLER);
  if (envScope === 'cli') return TASK_TABLES.cli;
  if (envScope === 'chat') return TASK_TABLES.chat;
  if (envScope === 'legacy') return TASK_TABLES.legacy;

  return TASK_TABLES.legacy;
}
