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
    mcpConfigPath,
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
        const skip = new Set(['subagent_router']); // Prevent recursive self-connection.
        try {
          const servers = adminServices?.mcpServers?.list?.() || [];
          if (landSelection) {
            const allowed = new Set(
              (landSelection.sub?.selectedServers || [])
                .map((entry) => String(entry?.server?.name || '').toLowerCase())
                .filter(Boolean)
            );
            servers.forEach((srv) => {
              if (!srv?.name) return;
              if (!allowed.has(String(srv.name || '').toLowerCase())) {
                skip.add(srv.name);
              }
            });
          }
        } catch {
          // ignore admin snapshot errors
        }
        return await initializeMcpRuntime(mcpConfigPath, sessionRoot, workspaceRoot, {
          caller: 'subagent',
          skipServers: Array.from(skip),
          extraServers: landSelection?.extraMcpServers || [],
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
