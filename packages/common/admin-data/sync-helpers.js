import fs from 'fs';
import path from 'path';
import YAML from 'yaml';

function resolveMode(options = {}) {
  return options.mode === 'minimal' ? 'minimal' : 'full';
}

export function ensureDir(filePath) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

export function writeYaml(filePath, payload) {
  ensureDir(filePath);
  fs.writeFileSync(filePath, YAML.stringify(payload), 'utf8');
}

export function writeJson(filePath, payload) {
  ensureDir(filePath);
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf8');
}

export function buildModelsYamlPayload(models = [], options = {}) {
  const mode = resolveMode(options);
  const includeExtras = mode !== 'minimal';
  const result = {};
  models.forEach((m) => {
    const entry = {
      provider: m.provider || '',
      model: m.model || '',
      base_url: m.baseUrl || m.base_url || '',
      baseUrl: m.baseUrl || m.base_url || '',
      api_key_env: m.apiKeyEnv || m.api_key_env || '',
      tools: Array.isArray(m.tools) ? m.tools : [],
      description: m.description || '',
    };

    if (includeExtras) {
      const reasoningEffort =
        typeof m.reasoningEffort === 'string'
          ? m.reasoningEffort
          : typeof m.reasoning_effort === 'string'
            ? m.reasoning_effort
            : '';
      const toolFollowupMode =
        typeof m.toolFollowupMode === 'string'
          ? m.toolFollowupMode
          : typeof m.tool_followup_mode === 'string'
            ? m.tool_followup_mode
            : '';
      const supportsVision = Boolean(m.supportsVision ?? m.supports_vision);
      entry.supports_vision = supportsVision || undefined;
      entry.supportsVision = supportsVision || undefined;
      entry.reasoning_effort = reasoningEffort || undefined;
      entry.reasoningEffort = reasoningEffort || undefined;
      entry.tool_followup_mode = toolFollowupMode || undefined;
      entry.toolFollowupMode = toolFollowupMode || undefined;
    }

    result[m.name] = entry;
  });
  const defaultModel = models.find((m) => m.isDefault)?.name || models[0]?.name || '';
  return {
    default_model: defaultModel || undefined,
    models: result,
  };
}

export function buildMcpConfig(mcpServers = [], options = {}) {
  const mode = resolveMode(options);
  const includeExtras = mode !== 'minimal';
  return {
    servers: mcpServers.map((s) => {
      const base = {
        name: s.name || '',
        url: s.url || '',
        description: s.description || '',
        auth: s.auth || undefined,
        tags: s.tags || [],
      };
      if (!includeExtras) {
        return base;
      }
      return {
        ...base,
        app_id: s.app_id || undefined,
        callMeta: s.callMeta || undefined,
        enabled: s.enabled !== false,
        timeout_ms: Number.isFinite(s.timeout_ms) ? s.timeout_ms : undefined,
        max_timeout_ms: Number.isFinite(s.max_timeout_ms) ? s.max_timeout_ms : undefined,
      };
    }),
  };
}

export function buildSubagentsPayload(subagents = [], options = {}) {
  const mode = resolveMode(options);
  const includeExtras = mode !== 'minimal';
  return {
    plugins: subagents.map((s) => {
      const base = {
        id: s.id || undefined,
        name: s.name || '',
        description: s.description || '',
        entry: s.entry || '',
        enabled: s.enabled !== false,
        agents: s.agents || [],
        tags: s.tags || [],
        skills: s.skills || [],
        createdAt: s.createdAt,
        updatedAt: s.updatedAt,
      };
      if (!includeExtras) {
        return base;
      }
      return {
        ...base,
        commands: s.commands || [],
        models: Array.isArray(s.models) ? s.models : [],
        modelImplicit: s.modelImplicit === true,
      };
    }),
  };
}
