import { getMcpPromptNameForServer, normalizeMcpServerName } from './mcp/prompt-binding.js';
import { normalizePromptLanguage as normalizePromptLanguageBase } from '../shared/mcp-utils.js';
import { normalizeKey } from '../shared/text-utils.js';
import { allowExternalOnlyMcpServers, isExternalOnlyMcpServerName } from '../shared/host-app.js';

function normalizePromptLanguage(value, fallback = 'zh') {
  return normalizePromptLanguageBase(value) || fallback;
}

function ensureFlow(flow) {
  const base = flow && typeof flow === 'object' ? flow : {};
  return {
    mcpServers: Array.isArray(base.mcpServers) ? base.mcpServers : [],
    apps: Array.isArray(base.apps) ? base.apps : [],
    prompts: Array.isArray(base.prompts) ? base.prompts : [],
  };
}

function buildPromptMap(prompts) {
  const map = new Map();
  (Array.isArray(prompts) ? prompts : []).forEach((prompt) => {
    if (!prompt) return;
    const name = normalizeKey(prompt?.name);
    if (!name) return;
    const content = typeof prompt?.content === 'string' ? prompt.content.trim() : '';
    if (!content) return;
    map.set(name, content);
  });
  return map;
}

function buildPromptRecordMap(prompts) {
  const map = new Map();
  (Array.isArray(prompts) ? prompts : []).forEach((prompt) => {
    if (!prompt) return;
    const id = typeof prompt?.id === 'string' ? prompt.id.trim() : '';
    if (!id) return;
    map.set(id, prompt);
  });
  return map;
}

function buildGrantMap(grants, idKey) {
  const list = Array.isArray(grants) ? grants : [];
  if (list.length === 0) return null;
  const map = new Map();
  list.forEach((record) => {
    const appId = normalizeKey(record?.app_id);
    const id = typeof record?.[idKey] === 'string' ? record[idKey].trim() : '';
    if (!appId || !id) return;
    let set = map.get(appId);
    if (!set) {
      set = new Set();
      map.set(appId, set);
    }
    set.add(id);
  });
  return map;
}

function resolvePromptContent(names, promptMap, registryPromptMap) {
  const candidates = Array.isArray(names) ? names : [];
  for (const name of candidates) {
    const key = normalizeKey(name);
    if (!key) continue;
    const content = promptMap.get(key) || registryPromptMap?.get?.(key) || '';
    if (content) {
      return { name: String(name || '').trim(), content };
    }
  }
  return { name: String(candidates[0] || '').trim(), content: '' };
}

function matchAppServer(server, appKey, appKeyAlt) {
  const name = normalizeKey(server?.name);
  if (name && name === appKey) return true;
  const tags = Array.isArray(server?.tags) ? server.tags : [];
  if (tags.length === 0) return false;
  const match = tags.map((tag) => normalizeKey(tag));
  return match.some((tag) => tag === `uiapp:${appKey}` || tag === `uiapp:${appKeyAlt}`);
}

function findServerByApp({ pluginId, appId, mcpServers, registryMcpServers, allowedRegistryServerIds }) {
  const pid = typeof pluginId === 'string' ? pluginId.trim() : '';
  const aid = typeof appId === 'string' ? appId.trim() : '';
  if (!pid || !aid) return null;
  const appKey = normalizeKey(`${pid}.${aid}`);
  const appKeyAlt = normalizeKey(`${pid}:${aid}`);
  const mcpList = Array.isArray(mcpServers) ? mcpServers : [];
  const registryList = Array.isArray(registryMcpServers) ? registryMcpServers : [];

  const fromAdmin = mcpList.find((server) => matchAppServer(server, appKey, appKeyAlt)) || null;
  if (fromAdmin) {
    return { server: fromAdmin, source: 'admin' };
  }

  const registryCandidates =
    allowedRegistryServerIds instanceof Set
      ? registryList.filter((server) => server?.id && allowedRegistryServerIds.has(String(server.id)))
      : registryList;
  const fromRegistry = registryCandidates.find((server) => matchAppServer(server, appKey, appKeyAlt)) || null;
  if (fromRegistry) {
    return { server: fromRegistry, source: 'registry' };
  }
  return null;
}

function tryAddSelectedServer({
  server,
  source,
  promptLang,
  selected,
  seenNames,
  allowExternalOnly,
  consumerAppId,
} = {}) {
  if (!server || !server.name) return { ok: false, reason: 'not_found' };
  if (server.enabled === false) return { ok: false, reason: 'disabled' };
  if (!allowExternalOnly && isExternalOnlyMcpServerName(server.name)) {
    return { ok: false, reason: 'external_only' };
  }
  const nameKey = normalizeKey(server.name);
  if (!nameKey) return { ok: false, reason: 'invalid_name' };
  if (seenNames.has(nameKey)) return { ok: false, reason: 'duplicate_name' };
  seenNames.add(nameKey);
  selected.push({
    server,
    source,
    promptLang,
    ...(consumerAppId ? { consumerAppId } : null),
  });
  return { ok: true };
}

function buildFlowSelection(flow, options) {
  const {
    mcpServers,
    registryMcpServers,
    promptMap,
    registryPromptMap,
    registryPromptById,
    registryMcpGrantsByApp,
    registryPromptGrantsByApp,
    defaultPromptLang,
    allowExternalOnly,
  } = options;
  const normalizedFlow = ensureFlow(flow);
  const selectedServers = [];
  const seenNames = new Set();
  const missingServerIds = new Set();
  const missingServers = [];
  const missingAppServers = [];
  const registryPromptMapCache = new Map();
  const recordMissingServer = ({ id, name, reason, source, app } = {}) => {
    const entryId = typeof id === 'string' ? id.trim() : '';
    const entryName = typeof name === 'string' ? name.trim() : '';
    if (entryId) {
      missingServerIds.add(entryId);
    }
    missingServers.push({
      ...(entryId ? { id: entryId } : null),
      ...(entryName ? { name: entryName } : null),
      reason: reason || 'unknown',
      ...(source ? { source } : null),
      ...(app ? { app } : null),
    });
  };

  const resolveRegistryPromptMapForApp = (appIdRaw) => {
    if (!registryPromptGrantsByApp || !registryPromptById) return registryPromptMap;
    const appId = normalizeKey(appIdRaw);
    if (!appId) return registryPromptMap;
    if (registryPromptMapCache.has(appId)) return registryPromptMapCache.get(appId);
    const allowed = registryPromptGrantsByApp.get(appId);
    if (!allowed || allowed.size === 0) {
      const empty = new Map();
      registryPromptMapCache.set(appId, empty);
      return empty;
    }
    const map = new Map();
    allowed.forEach((id) => {
      const prompt = registryPromptById.get(id);
      if (!prompt) return;
      const name = normalizeKey(prompt?.name);
      if (!name) return;
      const content = typeof prompt?.content === 'string' ? prompt.content.trim() : '';
      if (!content) return;
      map.set(name, content);
    });
    registryPromptMapCache.set(appId, map);
    return map;
  };

  const serverById = new Map(
    (Array.isArray(mcpServers) ? mcpServers : []).filter((srv) => srv?.id).map((srv) => [String(srv.id), srv])
  );

  normalizedFlow.mcpServers.forEach((entry) => {
    const id = typeof entry?.id === 'string' ? entry.id.trim() : '';
    const server = id ? serverById.get(id) : null;
    const lang = normalizePromptLanguage(entry?.promptLang, defaultPromptLang);
    if (!server) {
      recordMissingServer({
        id,
        name: typeof entry?.name === 'string' ? entry.name.trim() : '',
        reason: id ? 'not_found' : 'missing_id',
        source: 'admin',
      });
      return;
    }
    const result = tryAddSelectedServer({
      server,
      source: 'admin',
      promptLang: lang,
      selected: selectedServers,
      seenNames,
      allowExternalOnly,
    });
    if (!result.ok) {
      recordMissingServer({
        id,
        name: typeof server?.name === 'string' ? server.name.trim() : '',
        reason: result.reason,
        source: 'admin',
      });
    }
  });

  normalizedFlow.apps.forEach((app) => {
    const pid = typeof app?.pluginId === 'string' ? app.pluginId.trim() : '';
    const aid = typeof app?.appId === 'string' ? app.appId.trim() : '';
    const consumerAppId = pid && aid ? normalizeKey(`${pid}.${aid}`) : '';
    const allowedRegistryServerIds = registryMcpGrantsByApp
      ? registryMcpGrantsByApp.get(consumerAppId) || new Set()
      : null;
    const resolved = findServerByApp({
      pluginId: pid,
      appId: aid,
      mcpServers,
      registryMcpServers,
      allowedRegistryServerIds,
    });
    if (!resolved?.server) {
      const key =
        typeof app?.pluginId === 'string' && typeof app?.appId === 'string' ? `${app.pluginId}.${app.appId}` : '';
      if (key) missingAppServers.push(key);
      return;
    }
    const result = tryAddSelectedServer({
      server: resolved.server,
      source: resolved.source,
      promptLang: defaultPromptLang,
      selected: selectedServers,
      seenNames,
      allowExternalOnly,
      consumerAppId: resolved.source === 'registry' ? consumerAppId : '',
    });
    if (!result.ok) {
      recordMissingServer({
        id: typeof resolved?.server?.id === 'string' ? resolved.server.id : '',
        name: typeof resolved?.server?.name === 'string' ? resolved.server.name : '',
        reason: result.reason,
        source: resolved.source,
        app: consumerAppId,
      });
    }
  });

  const promptTextParts = [];
  const promptNames = [];
  const missingPromptNames = [];
  normalizedFlow.prompts.forEach((entry) => {
    const key = typeof entry?.key === 'string' ? entry.key.trim() : '';
    if (!key) return;
    const lang = normalizePromptLanguage(entry?.lang, defaultPromptLang);
    const preferred = lang === 'en' ? `${key}__en` : key;
    const fallback = lang === 'en' ? key : `${key}__en`;
    const resolved = resolvePromptContent([preferred, fallback], promptMap, null);
    if (resolved.content) {
      promptTextParts.push(resolved.content);
      promptNames.push(resolved.name);
    } else {
      missingPromptNames.push(preferred);
    }
  });

  const mcpPromptTextParts = [];
  const mcpPromptNames = [];
  const missingMcpPromptNames = [];
  const selectedServerNames = [];
  selectedServers.forEach((entry) => {
    const serverName = String(entry?.server?.name || '').trim();
    if (!serverName) return;
    const normalizedName = normalizeMcpServerName(serverName);
    if (normalizedName) selectedServerNames.push(normalizedName);
    const lang = normalizePromptLanguage(entry?.promptLang, defaultPromptLang);
    const preferred = getMcpPromptNameForServer(serverName, lang);
    const fallback = getMcpPromptNameForServer(serverName, 'zh');
    const effectiveRegistryPromptMap =
      entry?.source === 'registry' && entry?.consumerAppId
        ? resolveRegistryPromptMapForApp(entry.consumerAppId)
        : registryPromptMap;
    const resolved = resolvePromptContent([preferred, fallback], promptMap, effectiveRegistryPromptMap);
    if (resolved.content) {
      mcpPromptTextParts.push(resolved.content);
      mcpPromptNames.push(resolved.name);
    } else {
      missingMcpPromptNames.push(preferred);
    }
  });

  return {
    selectedServers,
    selectedServerNames,
    promptText: promptTextParts.join('\n\n'),
    promptNames,
    missingPromptNames,
    mcpPromptText: mcpPromptTextParts.join('\n\n'),
    mcpPromptNames,
    missingMcpPromptNames,
    missingServers,
    missingServerIds: Array.from(missingServerIds.values()),
    missingAppServers,
  };
}

export function resolveLandConfig({ landConfigs, landConfigId } = {}) {
  const id = typeof landConfigId === 'string' ? landConfigId.trim() : '';
  if (!id) return null;
  const list = Array.isArray(landConfigs) ? landConfigs : [];
  return list.find((item) => item?.id === id) || null;
}

export function buildLandConfigSelection({
  landConfig,
  prompts,
  mcpServers,
  registryMcpServers,
  registryPrompts,
  registryMcpGrants,
  registryPromptGrants,
  promptLanguage,
} = {}) {
  if (!landConfig) return null;
  const defaultPromptLang = normalizePromptLanguage(promptLanguage, 'zh');
  const allowExternalOnly = allowExternalOnlyMcpServers();
  const promptMap = buildPromptMap(prompts);
  const registryPromptMap = buildPromptMap(registryPrompts);
  const registryPromptById = buildPromptRecordMap(registryPrompts);
  const registryMcpGrantsByApp = buildGrantMap(registryMcpGrants, 'server_id');
  const registryPromptGrantsByApp = buildGrantMap(registryPromptGrants, 'prompt_id');
  const main = buildFlowSelection(landConfig.main, {
    mcpServers,
    registryMcpServers,
    promptMap,
    registryPromptMap,
    registryPromptById,
    registryMcpGrantsByApp,
    registryPromptGrantsByApp,
    defaultPromptLang,
    allowExternalOnly,
  });
  const sub = buildFlowSelection(landConfig.sub, {
    mcpServers,
    registryMcpServers,
    promptMap,
    registryPromptMap,
    registryPromptById,
    registryMcpGrantsByApp,
    registryPromptGrantsByApp,
    defaultPromptLang,
    allowExternalOnly,
  });

  const extraMcpServers = [];
  const seenExtra = new Set();
  [...(main.selectedServers || []), ...(sub.selectedServers || [])].forEach((entry) => {
    if (entry?.source !== 'registry') return;
    const nameKey = normalizeKey(entry?.server?.name);
    if (!nameKey || seenExtra.has(nameKey)) return;
    seenExtra.add(nameKey);
    extraMcpServers.push(entry.server);
  });

  return { main, sub, extraMcpServers };
}

export { normalizePromptLanguage };
