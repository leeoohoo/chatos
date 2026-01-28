const RUNTIME_PROMPT_LANGUAGES = new Set(['zh', 'en']);
const RUNTIME_SHELL_SAFETY_MODES = new Set(['strict', 'relaxed']);
const RUNTIME_SYMLINK_POLICIES = new Set(['allow', 'deny']);
const RUNTIME_MCP_LOG_LEVELS = new Set(['off', 'info', 'debug']);
const RUNTIME_PROMPT_LOG_MODES = new Set(['full', 'minimal']);
const RUNTIME_UI_TERMINAL_MODES = new Set(['auto', 'system', 'headless']);

const SHELL_SAFETY_ALIASES = new Map([
  ['unsafe', 'relaxed'],
  ['loose', 'relaxed'],
  ['safe', 'strict'],
]);
const SYMLINK_POLICY_ALIASES = new Map([['disallow', 'deny']]);

export function normalizeRuntimeEnum(value, allowed, fallback = '') {
  const raw = typeof value === 'string' ? value.trim().toLowerCase() : '';
  const allowedSet = allowed instanceof Set ? allowed : new Set(Array.isArray(allowed) ? allowed : []);
  if (allowedSet.has(raw)) return raw;
  return fallback ?? '';
}

export function normalizeRuntimeLanguage(value, fallback = '') {
  return normalizeRuntimeEnum(value, RUNTIME_PROMPT_LANGUAGES, fallback);
}

export function normalizeShellSafetyMode(value, options = {}) {
  const raw = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (RUNTIME_SHELL_SAFETY_MODES.has(raw)) return raw;
  if (options.allowAliases) {
    const alias = SHELL_SAFETY_ALIASES.get(raw);
    if (alias) return alias;
  }
  return options.fallback ?? '';
}

export function normalizeSymlinkPolicy(value, options = {}) {
  const raw = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (RUNTIME_SYMLINK_POLICIES.has(raw)) return raw;
  if (options.allowAliases) {
    const alias = SYMLINK_POLICY_ALIASES.get(raw);
    if (alias) return alias;
  }
  return options.fallback ?? '';
}

export function normalizeMcpLogLevel(value, fallback = '') {
  return normalizeRuntimeEnum(value, RUNTIME_MCP_LOG_LEVELS, fallback);
}

export function normalizePromptLogMode(value, fallback = '') {
  return normalizeRuntimeEnum(value, RUNTIME_PROMPT_LOG_MODES, fallback);
}

export function normalizeUiTerminalMode(value, fallback = '') {
  return normalizeRuntimeEnum(value, RUNTIME_UI_TERMINAL_MODES, fallback);
}

export function coerceRuntimeNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : undefined;
}

export function resolveRuntimeOptions(runtimeConfig) {
  const normalized = {};
  if (!runtimeConfig || typeof runtimeConfig !== 'object') {
    return normalized;
  }
  const summaryThreshold = coerceRuntimeNumber(runtimeConfig.summaryTokenThreshold);
  const maxToolPasses = coerceRuntimeNumber(runtimeConfig.maxToolPasses);
  if (summaryThreshold !== undefined) {
    normalized.summaryThreshold = summaryThreshold;
  }
  if (maxToolPasses !== undefined) {
    normalized.maxToolPasses = maxToolPasses;
  }
  const promptLanguage = normalizeRuntimeLanguage(runtimeConfig.promptLanguage);
  if (promptLanguage) {
    normalized.promptLanguage = promptLanguage;
  }
  if (typeof runtimeConfig.landConfigId === 'string') {
    const trimmed = runtimeConfig.landConfigId.trim();
    if (trimmed) {
      normalized.landConfigId = trimmed;
    }
  }
  return normalized;
}

export function applyRuntimeSettingsToEnv(runtimeConfig, options = {}) {
  if (!runtimeConfig || typeof runtimeConfig !== 'object') return;
  const env = options.env || process.env;
  const scope = options.scope || 'cli';
  const isCli = scope === 'cli';
  const setFlag = (key, enabled) => {
    env[key] = enabled ? '1' : '0';
  };
  const setNumberEnv = (key, value) => {
    if (Number.isFinite(value)) {
      env[key] = String(value);
    }
  };
  const setStringEnv = (key, value) => {
    if (typeof value === 'string' && value.trim()) {
      env[key] = value.trim();
    }
  };

  if (isCli) {
    const summaryThreshold = coerceRuntimeNumber(runtimeConfig.summaryTokenThreshold);
    if (summaryThreshold !== undefined) {
      setNumberEnv('MODEL_CLI_SUMMARY_TOKENS', summaryThreshold);
    }
    const promptLanguage = normalizeRuntimeLanguage(runtimeConfig.promptLanguage);
    if (promptLanguage) {
      env.MODEL_CLI_PROMPT_LANGUAGE = promptLanguage;
    }
    setFlag('MODEL_CLI_AUTO_ROUTE', Boolean(runtimeConfig.autoRoute));
    setFlag('MODEL_CLI_LOG_REQUEST', Boolean(runtimeConfig.logRequests));
    setFlag('MODEL_CLI_STREAM_RAW', Boolean(runtimeConfig.streamRaw));
    setNumberEnv('MODEL_CLI_TOOL_PREVIEW_LIMIT', coerceRuntimeNumber(runtimeConfig.toolPreviewLimit));
    setNumberEnv('MODEL_CLI_RETRY', coerceRuntimeNumber(runtimeConfig.retry));
    setNumberEnv('MODEL_CLI_MCP_TIMEOUT_MS', coerceRuntimeNumber(runtimeConfig.mcpTimeoutMs));
    setNumberEnv('MODEL_CLI_MCP_MAX_TIMEOUT_MS', coerceRuntimeNumber(runtimeConfig.mcpMaxTimeoutMs));
  }

  const shellSafetyMode = normalizeShellSafetyMode(runtimeConfig.shellSafetyMode);
  if (shellSafetyMode) {
    setStringEnv('MODEL_CLI_SHELL_SAFETY_MODE', shellSafetyMode);
  }
  const symlinkPolicy = normalizeSymlinkPolicy(runtimeConfig.filesystemSymlinkPolicy);
  if (symlinkPolicy) {
    setFlag('MODEL_CLI_ALLOW_SYMLINK_ESCAPE', symlinkPolicy === 'allow');
  }
  const logLevel = normalizeMcpLogLevel(runtimeConfig.mcpToolLogLevel);
  if (logLevel) {
    setStringEnv('MODEL_CLI_MCP_LOG_LEVEL', logLevel);
  }
  setNumberEnv('MODEL_CLI_MCP_TOOL_LOG_MAX_BYTES', coerceRuntimeNumber(runtimeConfig.mcpToolLogMaxBytes));
  setNumberEnv('MODEL_CLI_MCP_TOOL_LOG_MAX_LINES', coerceRuntimeNumber(runtimeConfig.mcpToolLogMaxLines));
  setNumberEnv('MODEL_CLI_MCP_TOOL_LOG_MAX_FIELD_CHARS', coerceRuntimeNumber(runtimeConfig.mcpToolLogMaxFieldChars));
  setNumberEnv('MODEL_CLI_MCP_STARTUP_CONCURRENCY', coerceRuntimeNumber(runtimeConfig.mcpStartupConcurrency));
  const promptLogMode = normalizePromptLogMode(runtimeConfig.uiPromptLogMode);
  if (promptLogMode) {
    setStringEnv('MODEL_CLI_UI_PROMPTS_LOG_MODE', promptLogMode);
  }
  const subagentDefaultModel =
    typeof runtimeConfig.subagentDefaultModel === 'string'
      ? runtimeConfig.subagentDefaultModel.trim()
      : '';
  if (subagentDefaultModel) {
    setStringEnv('MODEL_CLI_SUBAGENT_DEFAULT_MODEL', subagentDefaultModel);
  }
}

export function applyRuntimeSettings(runtimeConfig, options = {}) {
  applyRuntimeSettingsToEnv(runtimeConfig, options);
  return resolveRuntimeOptions(runtimeConfig);
}

export {
  RUNTIME_PROMPT_LANGUAGES,
  RUNTIME_SHELL_SAFETY_MODES,
  RUNTIME_SYMLINK_POLICIES,
  RUNTIME_MCP_LOG_LEVELS,
  RUNTIME_PROMPT_LOG_MODES,
  RUNTIME_UI_TERMINAL_MODES,
};
