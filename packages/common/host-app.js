import { normalizeHostApp } from './state-core/utils.js';

export { normalizeHostApp };

export function getHostApp(env = process.env) {
  return normalizeHostApp(env?.MODEL_CLI_HOST_APP);
}

export function resolveConfigHostApp({ env = process.env, fallbackHostApp = 'chatos' } = {}) {
  const sourceEnv = env && typeof env === 'object' ? env : process.env;
  const explicit = normalizeHostApp(sourceEnv?.MODEL_CLI_CONFIG_HOST_APP);
  if (explicit) return explicit;
  const hostRaw = normalizeHostApp(sourceEnv?.MODEL_CLI_HOST_APP);
  const stripped = hostRaw && hostRaw.endsWith('_chat_runtime') ? hostRaw.replace(/_chat_runtime$/, '') : hostRaw;
  if (stripped) return stripped;
  const fallback = normalizeHostApp(fallbackHostApp);
  return fallback || 'chatos';
}

export function isChatosHost() {
  return getHostApp() === 'chatos';
}

export { normalizeMcpServerName } from './mcp-utils.js';

export function isExternalOnlyMcpServerName(name) {
  return false;
}

export function allowExternalOnlyMcpServers() {
  const override = normalizeHostApp(process.env.MODEL_CLI_ALLOW_EXTERNAL_ONLY_MCP);
  if (override === '1' || override === 'true' || override === 'yes') {
    return true;
  }
  return isChatosHost();
}

