import { normalizeKey } from '../../shared/text-utils.js';

function buildConfigSignature(models = [], secrets = []) {
  const modelParts = (Array.isArray(models) ? models : [])
    .filter((m) => m && typeof m === 'object')
    .map((m) => {
      const id = String(m.id || '').trim();
      const name = String(m.name || '').trim();
      const updatedAt = String(m.updatedAt || '').trim();
      const provider = String(m.provider || '').trim();
      const modelId = String(m.model || '').trim();
      const keyEnv = String(m.apiKeyEnv || m.api_key_env || '').trim();
      return `m:${id}:${name}:${provider}:${modelId}:${keyEnv}:${updatedAt}`;
    })
    .sort();
  const secretParts = (Array.isArray(secrets) ? secrets : [])
    .filter((s) => s && typeof s === 'object')
    .map((s) => {
      const id = String(s.id || '').trim();
      const name = String(s.name || '').trim();
      const updatedAt = String(s.updatedAt || '').trim();
      return `s:${id}:${name}:${updatedAt}`;
    })
    .sort();
  return `${modelParts.join('|')}#${secretParts.join('|')}`;
}

export function createRuntimeConfigManager(options = {}) {
  const {
    adminServices,
    createAppConfigFromModels,
    ModelClient,
    initializeMcpRuntime,
    listTools,
    configPath,
    sessionRoot,
    workspaceRoot,
    eventLogger,
    landSelection,
    serverName = 'subagent_router',
    getToolAllowPrefixes,
    toolDenyPrefixes = [],
  } = options;

  const resolveAllowPrefixes = () => {
    if (typeof getToolAllowPrefixes === 'function') return getToolAllowPrefixes();
    return getToolAllowPrefixes;
  };
  const denyPrefixes = Array.isArray(toolDenyPrefixes) ? toolDenyPrefixes : [];
  const resolvedServerName = typeof serverName === 'string' && serverName.trim() ? serverName.trim() : 'subagent_router';

  const summarizeServers = (list, limit = 8) =>
    (Array.isArray(list) ? list : [])
      .map((entry) => String(entry?.name || '').trim())
      .filter(Boolean)
      .slice(0, limit);
  const summarizeMissing = (list, limit = 6) =>
    (Array.isArray(list) ? list : [])
      .slice(0, limit)
      .map((entry) => {
        const label = entry?.name || entry?.id || 'unknown';
        const reason = entry?.reason || 'unknown';
        return `${label}:${reason}`;
      });
  const logMcpSelection = (payload) => {
    try {
      console.error(`[${resolvedServerName}] MCP selection`, payload);
    } catch {
      // ignore
    }
    try {
      eventLogger?.log?.('mcp_warning', {
        stage: 'subagent_selection',
        ...(payload && typeof payload === 'object' ? payload : null),
      });
    } catch {
      // ignore
    }
  };

  let cachedConfig = null;
  let cachedClient = null;
  let cachedConfigSignature = '';
  let mcpRuntimePromise = null;

  function isToolAllowed(name) {
    if (!name) return false;
    const value = String(name || '').trim();
    // Prevent nested sub-agent calls from inside sub-agent sessions.
    if (value === 'invoke_sub_agent') {
      return false;
    }
    // Explicit deny list to prevent sub-agents from calling the subagent router tools.
    if (denyPrefixes.some((prefix) => value.startsWith(prefix))) {
      return false;
    }
    const allowMcpPrefixes = resolveAllowPrefixes();
    if (value.startsWith('mcp_') && Array.isArray(allowMcpPrefixes) && allowMcpPrefixes.length > 0) {
      if (!allowMcpPrefixes.some((prefix) => value.startsWith(prefix))) {
        return false;
      }
    }
    // Otherwise allow all registered tools (including shell/code writer/etc.).
    return true;
  }

  function applyToolWhitelist(config) {
    if (!config || !config.models || typeof listTools !== 'function') return;
    const registered = new Set(listTools());
    Object.values(config.models).forEach((settings) => {
      if (!settings) return;
      const normalized = new Set();
      const addIfAllowed = (name) => {
        if (!name) return;
        if (!isToolAllowed(name)) return;
        if (!registered.has(name)) return;
        normalized.add(name);
      };
      (Array.isArray(settings.tools) ? settings.tools : []).forEach(addIfAllowed);
      settings.tools = Array.from(normalized);
    });
  }

  async function ensureMcpRuntime() {
    if (mcpRuntimePromise) {
      return mcpRuntimePromise;
    }
    mcpRuntimePromise = (async () => {
      try {
        const allServers = adminServices?.mcpServers?.list?.() || [];
        const landSelected = landSelection
          ? (landSelection.sub?.selectedServers || []).map((entry) => entry?.server).filter(Boolean)
          : null;
        const servers = landSelection ? landSelected : allServers;
        if (landSelection) {
          const missing = landSelection.sub?.missingServers || [];
          if (servers.length === 0 || missing.length > 0) {
            logMcpSelection({
              mode: 'land_config',
              total_servers: allServers.length,
              selected_servers: servers.length,
              selected_names: summarizeServers(servers),
              missing_count: missing.length,
              missing: summarizeMissing(missing),
            });
          }
        } else if (allServers.length === 0) {
          logMcpSelection({
            mode: 'admin',
            total_servers: 0,
            selected_servers: 0,
            selected_names: [],
          });
        }
        const seen = new Set();
        const resolved = [];
        servers.forEach((entry) => {
          const key = normalizeKey(entry?.name);
          if (!key || seen.has(key)) return;
          if (key === 'subagent_router') return; // Prevent recursive self-connection.
          seen.add(key);
          resolved.push(entry);
        });
        return await initializeMcpRuntime(configPath, sessionRoot, workspaceRoot, {
          caller: 'subagent',
          servers: resolved,
          eventLogger,
        });
      } catch (err) {
        console.error(`[${resolvedServerName}] MCP init failed:`, err.message);
        return null;
      }
    })();
    return mcpRuntimePromise;
  }

  async function loadAppConfig(options = {}) {
    const force = options?.force === true;
    const models = adminServices.models.list();
    const secrets = adminServices.secrets?.list ? adminServices.secrets.list() : [];
    const signature = buildConfigSignature(models, secrets);
    if (!force && cachedConfig && cachedConfigSignature === signature) {
      return cachedConfig;
    }
    cachedConfigSignature = signature;
    cachedConfig = createAppConfigFromModels(models, secrets);
    cachedClient = null;
    const runtime = await ensureMcpRuntime();
    if (runtime) {
      runtime.applyToConfig(cachedConfig);
    }
    applyToolWhitelist(cachedConfig);
    return cachedConfig;
  }

  function getClient(config) {
    if (cachedClient) {
      return cachedClient;
    }
    cachedClient = new ModelClient(config);
    return cachedClient;
  }

  return {
    loadAppConfig,
    getClient,
    ensureMcpRuntime,
  };
}
