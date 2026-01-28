import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import YAML from 'yaml';
import { DEFAULT_RUNTIME_SETTINGS } from './schema.js';
import { getHostApp } from '../host-app.js';
import { normalizeKey } from '../text-utils.js';

export function safeRead(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return '';
  }
}

export function parseJsonSafe(text, fallback) {
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

export function parseYamlSafe(text, fallback) {
  try {
    return YAML.parse(text);
  } catch {
    return fallback;
  }
}

export function parseModelsWithDefault(raw) {
  const parsed = parseYamlSafe(raw, {});
  const modelsNode =
    parsed && typeof parsed === 'object' && !Array.isArray(parsed) && parsed.models && typeof parsed.models === 'object'
      ? parsed.models
      : parsed;
  const defaultModel = parsed.default_model || parsed.defaultModel || null;
  const entries = [];
  Object.entries(modelsNode || {}).forEach(([name, cfg]) => {
    if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) return;
    const reasoningEffort = typeof cfg.reasoning_effort === 'string'
      ? cfg.reasoning_effort
      : typeof cfg.reasoningEffort === 'string'
        ? cfg.reasoningEffort
        : '';
    const toolFollowupMode = typeof cfg.tool_followup_mode === 'string'
      ? cfg.tool_followup_mode
      : typeof cfg.toolFollowupMode === 'string'
        ? cfg.toolFollowupMode
        : '';
    const supportsReasoning =
      typeof cfg.supports_reasoning === 'boolean'
        ? cfg.supports_reasoning
        : typeof cfg.supportsReasoning === 'boolean'
          ? cfg.supportsReasoning
          : undefined;
    entries.push({
      name,
      provider: cfg.provider || '',
      model: cfg.model || '',
      reasoningEffort,
      toolFollowupMode,
      ...(supportsReasoning !== undefined ? { supportsReasoning } : {}),
      baseUrl: cfg.base_url || cfg.baseUrl || '',
      apiKeyEnv: cfg.api_key_env || '',
      tools: Array.isArray(cfg.tools) ? cfg.tools : [],
      description: cfg.description || '',
      isDefault: defaultModel ? name === defaultModel : false,
    });
  });
  return { entries, defaultModel };
}

export function parseModels(raw) {
  return parseModelsWithDefault(raw).entries;
}

export function parsePrompts(raw) {
  const parsed = parseYamlSafe(raw, {});
  const normalizeText = (value) => (typeof value === 'string' ? value : '');
  const output = {
    internal_main: '',
    internal_subagent: '',
    default: '',
    user_prompt: '',
    subagent_user_prompt: '',
  };
  const nodes = [];
  if (Array.isArray(parsed?.prompts)) {
    nodes.push(...parsed.prompts);
  } else if (parsed && typeof parsed === 'object') {
    nodes.push(parsed);
  }
  nodes.forEach((node) => {
    if (!node || typeof node !== 'object') return;
    const name = typeof node.name === 'string' ? node.name.trim() : typeof node.id === 'string' ? node.id.trim() : '';
    if (!name || !(name in output)) return;
    const content = normalizeText(node.content ?? node.prompt ?? node.text ?? '');
    output[name] = content;
  });
  return output;
}

export function parseMcpServers(raw) {
  const parsed = parseJsonSafe(raw, {});
  if (Array.isArray(parsed?.servers)) {
    return parsed.servers.map((s) => ({
      id: s.id,
      app_id: s.app_id || s.appId || '',
      name: s.name || '',
      url: s.url || '',
      description: s.description || '',
      auth: s.auth || s.headers ? { token: s.auth?.token, headers: s.headers } : undefined,
      callMeta: s.callMeta && typeof s.callMeta === 'object'
        ? s.callMeta
        : s.call_meta && typeof s.call_meta === 'object'
          ? s.call_meta
          : undefined,
      tags: s.tags || [],
      locked: s.locked === true,
      enabled: s.enabled !== false && s.disabled !== true,
      timeout_ms: Number.isFinite(s.timeout_ms) ? s.timeout_ms : undefined,
      max_timeout_ms: Number.isFinite(s.max_timeout_ms) ? s.max_timeout_ms : undefined,
    }));
  }
  return [];
}

function quoteCmdArg(token) {
  const raw = String(token ?? '');
  if (!raw) return '';
  if (/[\\\s"]/g.test(raw)) return JSON.stringify(raw);
  return raw;
}

function buildCmdUrl(command, args = []) {
  const parts = [command, ...(Array.isArray(args) ? args : [])].map(quoteCmdArg).filter(Boolean);
  return parts.length > 0 ? `cmd://${parts.join(' ')}` : '';
}

function resolveHostApp(options = {}) {
  const env = options?.env && typeof options.env === 'object' ? options.env : null;
  if (env) {
    return getHostApp(env) || 'chatos';
  }
  const hostApp = typeof options?.hostApp === 'string' ? options.hostApp.trim() : '';
  if (hostApp) {
    return getHostApp({ MODEL_CLI_HOST_APP: hostApp }) || 'chatos';
  }
  return getHostApp() || 'chatos';
}

export function buildBuiltinMcpServers(defaultPaths = {}, options = {}) {
  const defaultsRoot = path.resolve(defaultPaths.defaultsRoot || '');
  if (!defaultsRoot) return [];
  const appId = resolveHostApp(options);
  const resolveEntry = (relPath) => path.resolve(defaultsRoot, relPath);
  const makeCmdUrl = (relPath, args = []) => buildCmdUrl('node', [resolveEntry(relPath), ...args]);

  const entries = [
    {
      id: '8fe4e8f4-b8d1-4f59-967d-374a55f61417',
      name: 'project_files',
      entry: 'mcp_servers/filesystem-server.js',
      locked: true,
      enabled: true,
      description: 'Project files (read-only)',
    },
    {
      id: 'f2d0dbcb-e86e-493a-86b1-05cff71a14cb',
      name: 'code_writer',
      entry: 'mcp_servers/filesystem-server.js',
      args: ['--write', '--name', 'code_writer'],
      locked: true,
      enabled: true,
      description: 'Project files (write)',
    },
    {
      id: 'b10599fb-bda3-439f-9143-565fc2a2700c',
      name: 'code_maintainer',
      entry: 'mcp_servers/code-maintainer-server.js',
      args: ['--write'],
      locked: true,
      enabled: true,
      description: 'Code maintenance tools',
    },
    {
      id: 'a176d672-15f4-43c5-8c5f-6516cad8240f',
      name: 'shell_tasks',
      entry: 'mcp_servers/shell-server.js',
      locked: true,
      enabled: true,
      description: 'Shell task runner',
    },
    {
      id: '56b1ee50-8160-4ec8-89ed-b65c81b8a3fd',
      name: 'task_manager',
      entry: 'mcp_servers/task-server.js',
      locked: true,
      enabled: true,
      description: 'Task manager',
    },
    {
      id: '36bb1921-66e8-4901-9739-2177349f5dd4',
      name: 'subagent_router',
      entry: 'mcp_servers/subagent-server.js',
      locked: true,
      enabled: true,
      description: 'Subagent router',
    },
    {
      id: '9efd2c3e-435a-4aa5-8838-e4289f2b616a',
      name: 'project_journal',
      entry: 'mcp_servers/project-journal-server.js',
      locked: true,
      enabled: true,
      description: 'Project journal',
    },
    {
      id: 'bdc91c89-b9d8-44d2-a572-5afa9c0cccb9',
      name: 'ui_prompter',
      entry: 'mcp_servers/ui-prompt-server.js',
      locked: true,
      enabled: true,
      description: 'UI prompt helper',
    },
    {
      id: 'ba246952-8140-4f8e-ab46-33757b209585',
      name: 'lsp_bridge',
      entry: 'mcp_servers/lsp-bridge-server.js',
      locked: true,
      enabled: true,
      description: 'LSP bridge',
    },
    {
      id: 'cb5baaba-ab78-4189-b210-716be799268c',
      name: 'chrome_devtools',
      entry: 'mcp_servers/chrome-devtools-mcp-server.js',
      args: ['--browser-url=http://127.0.0.1:9222'],
      locked: false,
      enabled: false,
      description: 'Chrome DevTools MCP',
    },
  ];

  return entries
    .map((entry) => {
      const url = entry.url || (entry.entry ? makeCmdUrl(entry.entry, entry.args || []) : '');
      return {
        id: entry.id,
        app_id: entry.app_id || appId,
        name: entry.name || '',
        url,
        description: entry.description || '',
        tags: Array.isArray(entry.tags) ? entry.tags : [],
        locked: entry.locked === true,
        enabled: entry.enabled !== false,
        auth: entry.auth || undefined,
        callMeta: entry.callMeta || entry.call_meta || undefined,
        timeout_ms: Number.isFinite(entry.timeout_ms) ? entry.timeout_ms : undefined,
        max_timeout_ms: Number.isFinite(entry.max_timeout_ms) ? entry.max_timeout_ms : undefined,
      };
    })
    .filter((entry) => entry.name && entry.url);
}

export function upsertBuiltinMcpServers({ adminDb, adminServices, defaultPaths, env, hostApp } = {}) {
  if (!adminDb) return { inserted: 0, updated: 0, skipped: 0 };
  const builtins = buildBuiltinMcpServers(defaultPaths, { env, hostApp });
  if (builtins.length === 0) return { inserted: 0, updated: 0, skipped: 0 };

  const existing =
    (adminServices?.mcpServers?.list ? adminServices.mcpServers.list() : null) ||
    adminDb.list('mcpServers') ||
    [];
  const existingById = new Map(
    (Array.isArray(existing) ? existing : []).filter((srv) => srv?.id).map((srv) => [String(srv.id), srv])
  );
  const now = new Date().toISOString();
  let inserted = 0;
  let updated = 0;
  let skipped = 0;

  builtins.forEach((entry) => {
    if (!entry?.id) {
      skipped += 1;
      return;
    }
    const prev = existingById.get(String(entry.id)) || null;
    const base = {
      ...entry,
      createdAt: prev?.createdAt || now,
      updatedAt: now,
    };

    if (prev) {
      const payload = { ...base };
      if (typeof prev.enabled === 'boolean') {
        payload.enabled = prev.enabled;
      }
      if (!base.locked) {
        if (prev.url) payload.url = prev.url;
        if (typeof prev.description === 'string' && prev.description.trim()) {
          payload.description = prev.description;
        }
        if (Array.isArray(prev.tags) && prev.tags.length > 0) {
          payload.tags = prev.tags;
        }
        if (prev.auth) payload.auth = prev.auth;
        if (prev.callMeta) payload.callMeta = prev.callMeta;
      }
      adminDb.update('mcpServers', prev.id, payload);
      updated += 1;
      return;
    }

    adminDb.insert('mcpServers', {
      ...base,
      id: entry.id || crypto.randomUUID(),
      createdAt: now,
      updatedAt: now,
    });
    inserted += 1;
  });

  return { inserted, updated, skipped };
}

export function parseInstalledPlugins(raw, options = {}) {
  const parsed = parseJsonSafe(raw, {});
  let entries = [];
  if (Array.isArray(parsed?.plugins)) entries = parsed.plugins;
  else if (Array.isArray(parsed)) entries = parsed;
  else if (parsed && typeof parsed === 'object' && Array.isArray(parsed.items)) entries = parsed.items;

  const pluginMap = new Map();
  const register = (id, enabled = true) => {
    if (!id) return;
    if (pluginMap.has(id)) return;
    pluginMap.set(id, { id, enabled });
  };
  entries.forEach((item) => {
    if (!item) return;
    if (typeof item === 'string') {
      register(item, true);
    } else if (typeof item === 'object') {
      const id = item.id || item.plugin || item.name;
      if (id) {
        register(id, item.enabled !== false);
      }
    }
  });

  if (Array.isArray(options.defaultList)) {
    const defaultEnabled = options.defaultEnabled === false ? false : true;
    options.defaultList.forEach((id) => {
      register(id, defaultEnabled);
    });
  }

  const pluginIds = Array.from(pluginMap.values());

  return pluginIds.map((p) => resolvePluginMeta(p.id, { enabled: p.enabled, ...options }));
}

function normalizePathList(value) {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value.map((entry) => String(entry || '').trim()).filter(Boolean);
  }
  const single = String(value || '').trim();
  return single ? [single] : [];
}

function resolvePluginMeta(id, options = {}) {
  const meta = {
    id,
    name: id,
    description: '',
    tags: [],
    agents: [],
    skills: [],
    commands: [],
    models: [],
    modelImplicit: false,
    enabled: options.enabled !== false,
  };
  const marketplace = loadMarketplace(options.marketplacePath);
  const entry = marketplace.find((item) => item.id === id);
  if (entry) {
    meta.name = entry.name || entry.title || entry.id || id;
    meta.description = entry.description || '';
    meta.tags = entry.tags || (entry.category ? [entry.category] : []);
    if (Array.isArray(entry.skills)) {
      meta.skills = entry.skills.map((s) => (typeof s === 'string' ? s : s.name || s.id)).filter(Boolean);
    }
    if (Array.isArray(entry.commands)) {
      meta.commands = entry.commands
        .map((c) => ({
          id: typeof c === 'string' ? c : c.id || c.name || '',
          name: typeof c === 'string' ? c : c.name || c.id || '',
          description: typeof c === 'string' ? '' : c.description || '',
        }))
        .filter((c) => c.id || c.name);
    }
    if (Array.isArray(entry.agents)) {
      meta.agents = entry.agents.map((a) => (typeof a === 'string' ? a : a.name || a.id)).filter(Boolean);
    }
  }
  const pluginDirs = normalizePathList(options.pluginsDir);
  let pluginPath = null;
  let pluginDir = null;
  for (const root of pluginDirs) {
    const candidate = path.join(root, id, 'plugin.json');
    if (fs.existsSync(candidate)) {
      pluginPath = candidate;
      pluginDir = path.dirname(candidate);
      break;
    }
  }
  if (pluginPath && fs.existsSync(pluginPath)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(pluginPath, 'utf8'));
      meta.name = parsed.name || meta.name;
      meta.description = parsed.description || meta.description;
      meta.entry = pluginDir || path.dirname(pluginPath);
      if (Array.isArray(parsed.tags)) meta.tags = parsed.tags;
      if (parsed.category) meta.tags = [...new Set([...(meta.tags || []), parsed.category])];

      const explicitModels = new Set();
      let modelImplicit = false;
      const registerModel = (value) => {
        const raw = typeof value === 'string' ? value.trim() : '';
        if (raw) {
          explicitModels.add(raw);
          return;
        }
        modelImplicit = true;
      };
      if (Array.isArray(parsed.agents)) {
        parsed.agents.forEach((agent) => {
          if (!agent || typeof agent !== 'object') return;
          registerModel(agent.model);
        });
      }
      if (Array.isArray(parsed.commands)) {
        parsed.commands.forEach((command) => {
          if (!command || typeof command !== 'object') return;
          registerModel(command.model);
        });
      }
      meta.models = Array.from(explicitModels.values()).sort((a, b) => a.localeCompare(b));
      meta.modelImplicit = modelImplicit;

      if (Array.isArray(parsed.agents)) {
        meta.agents = parsed.agents.map((agent) => agent?.name || agent?.id).filter(Boolean);
      }
      if (Array.isArray(parsed.skills)) {
        meta.skills = parsed.skills.map((skill) => skill?.name || skill?.id).filter(Boolean);
      }
      if (Array.isArray(parsed.commands)) {
        meta.commands = parsed.commands
          .map((command) => ({
            id: command?.id || command?.name || '',
            name: command?.name || command?.id || '',
            description: command?.description || '',
          }))
          .filter((c) => c.id || c.name);
      }
    } catch {
      // ignore malformed plugin.json
    }
  } else if (pluginDirs.length > 0) {
    meta.entry = path.join(pluginDirs[0], id);
  }
  return meta;
}

function loadMarketplace(marketplacePath) {
  const paths = normalizePathList(marketplacePath);
  if (paths.length === 0) return [];
  const merged = new Map();
  paths.forEach((p) => {
    try {
      const raw = fs.readFileSync(p, 'utf8');
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return;
      parsed.forEach((entry) => {
        if (entry?.id) {
          merged.set(entry.id, entry);
        }
      });
    } catch {
      // ignore missing or malformed marketplace
    }
  });
  return Array.from(merged.values());
}

export function parseInstalledSubagentEntries(raw, options = {}) {
  return parseInstalledPlugins(raw, options);
}

export function parseTasks(raw) {
  const parsed = parseJsonSafe(raw, []);
  if (Array.isArray(parsed.tasks)) return parsed.tasks;
  if (Array.isArray(parsed)) return parsed;
  return [];
}

export function parseEvents(content = '') {
  const lines = content.split('\n').filter((l) => l.trim().length > 0);
  const entries = [];
  lines.forEach((line) => {
    const parsed = parseJsonSafe(line, null);
    if (parsed) entries.push(parsed);
  });
  return entries;
}

export function buildAdminSeed(defaultPaths = {}) {
  const now = new Date().toISOString();
  const hostApp = getHostApp() || 'chatos';
  const seed = {
    models: [],
    mcpServers: [],
    subagents: [],
    prompts: [],
    events: [],
    tasks: [],
    landConfigs: [],
  };

  if (defaultPaths.models) {
    const defaultsRoot = path.resolve(defaultPaths.defaultsRoot || '');
    const defaultModelsPath = path.join(defaultsRoot, 'shared', 'defaults', 'models.yaml');
    const content = safeRead(defaultPaths.models);
    let { entries } = parseModelsWithDefault(
      content && content.trim() ? content : safeRead(defaultModelsPath)
    );
    if (!entries || entries.length === 0) {
      entries = parseModelsWithDefault(safeRead(defaultModelsPath)).entries;
    }
    seed.models = entries.map((item) => ({
      ...item,
      id: crypto.randomUUID(),
      createdAt: now,
      updatedAt: now,
    }));
    if (!seed.models.some((m) => m.isDefault) && seed.models.length > 0) {
      seed.models[0].isDefault = true;
    }
  }

  const builtinMcpServers = buildBuiltinMcpServers(defaultPaths, { hostApp });
  if (builtinMcpServers.length > 0) {
    seed.mcpServers = builtinMcpServers.map((srv) => ({
      ...srv,
      id: srv.id || crypto.randomUUID(),
      createdAt: now,
      updatedAt: now,
    }));
  }


  if (defaultPaths.installedSubagents) {
    const defaultList =
      parseJsonSafe(
        safeRead(path.join(path.resolve(defaultPaths.defaultsRoot || ''), 'shared', 'defaults', 'subagents.json')),
        {}
      )?.plugins || [];
    const marketplacePathList = [
      defaultPaths.marketplace,
      defaultPaths.marketplaceUser,
      defaultPaths.userMarketplace,
    ].filter(Boolean);
    const pluginsDirList = [
      // Prefer user plugins to allow writable overrides (e.g. model settings in packaged apps).
      defaultPaths.pluginsDirUser,
      defaultPaths.userPluginsDir,
      defaultPaths.pluginsDir,
    ].filter(Boolean);
    const plugins = parseInstalledPlugins(safeRead(defaultPaths.installedSubagents), {
      pluginsDir: pluginsDirList.length > 0 ? pluginsDirList : defaultPaths.pluginsDir,
      marketplacePath: marketplacePathList.length > 0 ? marketplacePathList : defaultPaths.marketplace,
      defaultList: Array.isArray(defaultList) ? defaultList : [],
    });
    seed.subagents = plugins.map((p) => ({
      id: p.id || crypto.randomUUID(),
      name: p.name || p.title || '',
      description: p.description || '',
      entry: p.entry || p.url || '',
      enabled: p.enabled !== false,
      tags: p.tags || [],
      agents: p.agents || [],
      skills: p.skills || [],
      commands: p.commands || [],
      models: Array.isArray(p.models) ? p.models : [],
      modelImplicit: p.modelImplicit === true,
      createdAt: p.createdAt || now,
      updatedAt: p.updatedAt || now,
    }));
  }

  if (defaultPaths.events) {
    const eventsList = parseEvents(safeRead(defaultPaths.events));
    seed.events = Array.isArray(eventsList)
      ? eventsList.map((e) => ({
          ...e,
          id: e.id || crypto.randomUUID(),
          ts: e.ts || new Date().toISOString(),
          createdAt: e.createdAt || e.ts || now,
          updatedAt: now,
        }))
      : [];
  }

  if (defaultPaths.tasks) {
    const tasksList = parseTasks(safeRead(defaultPaths.tasks));
    seed.tasks = Array.isArray(tasksList)
      ? tasksList.map((t) => ({
          ...t,
          id: t.id || crypto.randomUUID(),
          createdAt: t.createdAt || now,
          updatedAt: t.updatedAt || t.createdAt || now,
        }))
      : [];
  }

  const landConfigRaw =
    safeRead(defaultPaths.landConfigs) ||
    safeRead(path.join(path.resolve(defaultPaths.defaultsRoot || ''), 'shared', 'defaults', 'land-configs.json'));
  const parsedLandConfigs = parseJsonSafe(landConfigRaw, {});
  const landConfigList = Array.isArray(parsedLandConfigs?.landConfigs)
    ? parsedLandConfigs.landConfigs
    : Array.isArray(parsedLandConfigs)
      ? parsedLandConfigs
      : [];
  seed.landConfigs = landConfigList
    .filter((item) => item && typeof item === 'object')
    .map((item) => ({
      ...item,
      id: item.id || crypto.randomUUID(),
      createdAt: item.createdAt || now,
      updatedAt: item.updatedAt || now,
    }));

  const builtinPrompts = loadBuiltinPromptFiles(defaultPaths);
  seed.prompts = (Array.isArray(builtinPrompts) ? builtinPrompts : [])
    .filter((prompt) => prompt?.name && prompt.content)
    .map((prompt) => ({
      id: crypto.randomUUID(),
      name: prompt.name,
      title: prompt.title || prompt.name,
      content: prompt.content,
      defaultContent: prompt.content,
      builtin: true,
      locked: true,
      variables: extractVariables(prompt.content),
      createdAt: now,
      updatedAt: now,
    }));

  const fallbackLandConfig =
    seed.landConfigs.find((cfg) => typeof cfg?.name === 'string' && cfg.name.trim() === '默认') ||
    seed.landConfigs[0] ||
    null;
  let landConfigId =
    typeof DEFAULT_RUNTIME_SETTINGS.landConfigId === 'string' ? DEFAULT_RUNTIME_SETTINGS.landConfigId.trim() : '';
  if (landConfigId && !seed.landConfigs.some((cfg) => cfg?.id === landConfigId)) {
    landConfigId = '';
  }
  if (!landConfigId && fallbackLandConfig?.id) {
    landConfigId = fallbackLandConfig.id;
  }
  seed.settings = [
    {
      ...DEFAULT_RUNTIME_SETTINGS,
      id: 'runtime',
      landConfigId,
      createdAt: now,
      updatedAt: now,
    },
  ];

  return seed;
}

export function loadBuiltinPromptFiles(defaultPaths = {}) {
  const defaultsRoot = path.resolve(defaultPaths.defaultsRoot || '');
  if (!defaultsRoot) return [];
  const defaultsDir = path.join(defaultsRoot, 'shared', 'defaults');
  const candidates = [];
  const builtinPromptFiles = new Set([
    'system-prompt.yaml',
    'system-prompt.en.yaml',
    'system-default-prompt.yaml',
    'system-default-prompt.en.yaml',
    'system-user-prompt.yaml',
    'subagent-system-prompt.yaml',
    'subagent-system-prompt.en.yaml',
    'subagent-user-prompt.yaml',
  ]);

  const shouldInclude = (filePath) => {
    const base = path.basename(filePath).toLowerCase();
    if (!(base.endsWith('.yaml') || base.endsWith('.yml'))) return false;
    if (base.includes('.prompt.')) return true;
    return builtinPromptFiles.has(base);
  };

  const walk = (dirPath) => {
    let entries;
    try {
      entries = fs.readdirSync(dirPath, { withFileTypes: true });
    } catch {
      return;
    }
    entries.forEach((entry) => {
      const fullPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        // Keep it shallow to avoid surprising scans.
        if (path.basename(dirPath) === 'defaults') {
          walk(fullPath);
        }
        return;
      }
      if (entry.isFile() && shouldInclude(fullPath)) {
        candidates.push(fullPath);
      }
    });
  };

  walk(defaultsDir);

  const normalizeName = (value) =>
    String(value || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, '_')
      .replace(/^_+|_+$/g, '');

  const results = [];
  candidates.forEach((filePath) => {
    let raw = '';
    try {
      raw = fs.readFileSync(filePath, 'utf8');
    } catch {
      return;
    }
    const parsed = parseYamlSafe(raw, null);
    const nodes = [];
    if (Array.isArray(parsed?.prompts)) {
      nodes.push(...parsed.prompts);
    } else if (parsed && typeof parsed === 'object') {
      nodes.push(parsed);
    } else {
      return;
    }

    nodes.forEach((node) => {
      if (!node || typeof node !== 'object') return;
      const content =
        typeof node.content === 'string'
          ? node.content
          : typeof node.prompt === 'string'
            ? node.prompt
            : typeof node.text === 'string'
              ? node.text
              : '';
      const trimmed = content.trim();
      if (!trimmed) return;
      const fileBase = path.basename(filePath).replace(/\.(ya?ml)$/i, '');
      const inferredName = normalizeName(fileBase.replace(/\.prompt\.[^.]+$/i, ''));
      const name = normalizeName(node.name || node.id || inferredName);
      if (!name) return;
      results.push({
        name,
        title: typeof node.title === 'string' ? node.title.trim() : name,
        content: trimmed,
      });
    });
  });

  const dedup = new Map();
  results.forEach((p) => {
    if (!p?.name) return;
    dedup.set(p.name, p);
  });
  return Array.from(dedup.values()).sort((a, b) => a.name.localeCompare(b.name));
}

export function extractVariables(text) {
  const matches = text.match(/\{\{\s*([\w\.]+)\s*\}\}/g) || [];
  return Array.from(
    new Set(
      matches.map((m) => m.replace(/[{}]/g, '').trim()).filter((v) => v.length > 0)
    )
  );
}
