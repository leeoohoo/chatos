const STATUS_MAP = {
  ok: 'ok',
  success: 'ok',
  noop: 'ok',
  pending: 'pending',
  running: 'pending',
  error: 'error',
  invalid: 'error',
  denied: 'error',
  not_found: 'error',
  canceled: 'canceled',
  cancelled: 'canceled',
  timeout: 'timeout',
  timed_out: 'timeout',
  partial: 'partial',
};

function normalizeLower(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

export function normalizeToolStatus(value, options = {}) {
  const raw = normalizeLower(value);
  if (raw && Object.prototype.hasOwnProperty.call(STATUS_MAP, raw)) return STATUS_MAP[raw];
  const color = normalizeLower(options?.color);
  if (color) {
    if (color === 'gold' || color === 'yellow') return 'pending';
    if (color === 'red' || color === 'volcano') return 'error';
    if (color === 'green' || color === 'purple' || color === 'geekblue') return 'ok';
  }
  return options?.fallback || '';
}

export function inferToolKind(toolName) {
  const raw = normalizeLower(toolName);
  if (!raw) return 'default';
  if (raw.includes('run_shell_command') || raw.includes('session_') || raw.includes('shell')) return 'shell';
  if (raw.includes('code_maintainer') || raw.includes('code-maintainer')) return 'code_maintainer';
  if (
    raw.includes('read_file') ||
    raw.includes('write_file') ||
    raw.includes('edit_file') ||
    raw.includes('apply_patch') ||
    raw.includes('delete_path') ||
    raw.includes('list_directory') ||
    raw.includes('list_workspace_files') ||
    raw.includes('search_text')
  ) {
    return 'filesystem';
  }
  if (raw.includes('lsp')) return 'lsp';
  if (raw.includes('task')) return 'task';
  if (raw.includes('subagent') || raw.includes('sub_agent')) return 'subagent';
  if (raw.includes('prompt')) return 'prompt';
  if (raw.includes('journal')) return 'journal';
  if (raw.includes('chrome') || raw.includes('browser') || raw.includes('devtools')) return 'browser';
  return 'default';
}
