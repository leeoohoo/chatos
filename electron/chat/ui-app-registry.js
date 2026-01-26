import { normalizeId } from './normalize.js';
import { getRegistryCenter } from '../backend/registry-center.js';

export function createUiAppRegistryHelpers({ uiApps, adminServices } = {}) {
  const resolveUiAppAi =
    uiApps && typeof uiApps.getAiContribution === 'function' ? uiApps.getAiContribution.bind(uiApps) : null;

  let registry = null;
  try {
    const registryDb = adminServices?.mcpServers?.db || null;
    registry = registryDb ? getRegistryCenter({ db: registryDb }) : null;
  } catch {
    registry = null;
  }

  let uiAppsTrustMap = new Map();
  const refreshUiAppsTrust = async () => {
    uiAppsTrustMap = new Map();
    if (!uiApps || typeof uiApps.listRegistry !== 'function') return;
    try {
      const snapshot = await uiApps.listRegistry();
      const plugins = Array.isArray(snapshot?.plugins) ? snapshot.plugins : [];
      uiAppsTrustMap = new Map(
        plugins
          .map((plugin) => [normalizeId(plugin?.id), plugin?.trusted === true])
          .filter(([id]) => id)
      );
    } catch {
      uiAppsTrustMap = new Map();
    }
  };

  const isUiAppTrusted = (pluginId) => {
    const pid = normalizeId(pluginId);
    if (!pid) return false;
    return uiAppsTrustMap.get(pid) === true;
  };

  const normalizeRegistryName = (value) => String(value || '').trim().toLowerCase();
  const resolveUiAppRegistryAccess = (pluginId, appId) => {
    if (!registry) return null;
    const pid = normalizeId(pluginId);
    const aid = normalizeId(appId);
    if (!pid || !aid) return null;
    const appKey = `${pid}.${aid}`;
    let servers = [];
    let prompts = [];
    try {
      servers = registry.getMcpServersForApp(appKey) || [];
    } catch {
      servers = [];
    }
    try {
      prompts = registry.getPromptsForApp(appKey) || [];
    } catch {
      prompts = [];
    }
    const serversByName = new Map(
      servers
        .filter((srv) => srv?.name)
        .map((srv) => [normalizeRegistryName(srv.name), srv])
    );
    const promptsByName = new Map(
      prompts
        .filter((p) => p?.name)
        .map((p) => [normalizeRegistryName(p.name), p])
    );
    const serversById = new Map(
      servers
        .filter((srv) => srv?.id)
        .map((srv) => [String(srv.id), srv])
    );
    const promptsById = new Map(
      prompts
        .filter((p) => p?.id)
        .map((p) => [String(p.id), p])
    );
    const serverIds = new Set(Array.from(serversById.keys()));
    const promptIds = new Set(Array.from(promptsById.keys()));
    return {
      appKey,
      servers,
      prompts,
      serversByName,
      promptsByName,
      serversById,
      promptsById,
      serverIds,
      promptIds,
    };
  };

  return {
    resolveUiAppAi,
    refreshUiAppsTrust,
    isUiAppTrusted,
    resolveUiAppRegistryAccess,
  };
}
